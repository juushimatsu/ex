const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const multer = require('multer');

const app = express();
app.use(express.json());

const SIGNING_SECRET = process.env.SIGNING_SECRET || 'support-secret-key-change-me';
const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'http://localhost:3001';
const MAX_ACTIVE_TICKETS_PER_AGENT = 10;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const sessions = new Map();
const tickets = new Map();
const messages = new Map();
const agents = new Map();
const tokens = new Map();
const ticketImages = new Map();

[
  { id: 'a1', username: 'agent1', password: 'pass1' },
  { id: 'a2', username: 'agent2', password: 'pass2' },
].forEach(a => agents.set(a.id, a));

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function findAgentByCredentials(username, password) {
  for (const a of agents.values()) {
    if (a.username === username && a.password === password) return a;
  }
  return null;
}

function getAgentByToken(token) {
  const id = tokens.get(token);
  return id ? agents.get(id) : null;
}

function signImageUrl(imageId, ticketId, expiresAt) {
  const payload = `${imageId}:${ticketId}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
  return `${IMAGE_SERVICE_URL}/images/${imageId}?ticketId=${ticketId}&expires=${expiresAt}&sig=${sig}`;
}

function isTicketParticipant(ticket, sessionId, agentId) {
  if (agentId && ticket.agentId === agentId) return true;
  if (sessionId && ticket.sessionId === sessionId) return true;
  return false;
}

function activeTicketCountForAgent(agentId) {
  let count = 0;
  for (const t of tickets.values()) {
    if (t.agentId === agentId && t.status !== 'closed') count++;
  }
  return count;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, WebP images allowed'));
  },
});

const rateLimits = new Map();

function rateLimiter(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    let entry = rateLimits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      rateLimits.set(key, entry);
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

const wsRateLimits = new Map();

function wsRateLimiter(wsId, windowMs, maxMessages) {
  const now = Date.now();
  let entry = wsRateLimits.get(wsId);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    wsRateLimits.set(wsId, entry);
  }
  entry.count++;
  if (entry.count > maxMessages) return false;
  return true;
}

function requireAgent(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const agent = getAgentByToken(token);
  if (!agent) return res.status(401).json({ error: 'Unauthorized' });
  req.agent = agent;
  next();
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/session', rateLimiter(60000, 30), (req, res) => {
  const session = { id: uid(), createdAt: Date.now(), info: req.body.info || null };
  sessions.set(session.id, session);
  res.status(201).json(session);
});

app.post('/api/auth/login', rateLimiter(60000, 10), (req, res) => {
  const { username, password } = req.body;
  const agent = findAgentByCredentials(username, password);
  if (!agent) return res.status(401).json({ error: 'Invalid credentials' });
  const token = uid();
  tokens.set(token, agent.id);
  res.json({ token, agent: { id: agent.id, username: agent.username } });
});

app.get('/api/tickets', rateLimiter(10000, 50), (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  res.json([...tickets.values()].filter(t => t.sessionId === sessionId));
});

app.post('/api/tickets', rateLimiter(60000, 20), (req, res) => {
  const { sessionId, subject } = req.body;
  if (!sessionId || !subject) return res.status(400).json({ error: 'sessionId and subject required' });
  if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
  const ticket = {
    id: uid(),
    sessionId,
    subject,
    status: 'open',
    agentId: null,
    createdAt: Date.now(),
  };
  tickets.set(ticket.id, ticket);
  messages.set(ticket.id, []);
  ticketImages.set(ticket.id, []);
  broadcastToAgents({ type: 'new_ticket', ticket });
  res.status(201).json(ticket);
});

app.get('/api/tickets/all', rateLimiter(10000, 50), requireAgent, (_req, res) => {
  res.json([...tickets.values()]);
});

app.get('/api/tickets/:id', rateLimiter(10000, 50), (req, res) => {
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json({ ticket, messages: messages.get(ticket.id) || [] });
});

app.post('/api/tickets/:id/assign', rateLimiter(60000, 30), requireAgent, (req, res) => {
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (ticket.agentId && ticket.agentId !== req.agent.id) {
    return res.status(409).json({ error: 'Already assigned' });
  }
  const activeCount = activeTicketCountForAgent(req.agent.id);
  if (activeCount >= MAX_ACTIVE_TICKETS_PER_AGENT) {
    return res.status(429).json({ error: `Max ${MAX_ACTIVE_TICKETS_PER_AGENT} active tickets per agent` });
  }
  ticket.agentId = req.agent.id;
  ticket.status = 'active';
  broadcastToAgents({ type: 'ticket_update', ticket });
  broadcastToClientsInRoom(ticket.id, { type: 'ticket_update', ticket });
  res.json(ticket);
});

app.post('/api/tickets/:id/close', rateLimiter(60000, 30), requireAgent, (req, res) => {
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  ticket.status = 'closed';
  broadcastToAgents({ type: 'ticket_update', ticket });
  broadcastToClientsInRoom(ticket.id, { type: 'ticket_update', ticket });
  res.json(ticket);
});

app.post(
  '/api/tickets/:id/images',
  rateLimiter(60000, 30),
  upload.single('image'),
  async (req, res) => {
    const ticketId = req.params.id;
    const ticket = tickets.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const sessionId = req.body.sessionId;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const agent = getAgentByToken(token);

    if (!isTicketParticipant(ticket, sessionId, agent ? agent.id : null)) {
      return res.status(403).json({ error: 'Not a ticket participant' });
    }

    if (!req.file) return res.status(400).json({ error: 'No image file' });

    const imageId = uid();
    const ext = req.file.originalname ? path.extname(req.file.originalname).toLowerCase() : '.png';
    const filename = imageId + ext;

    try {
      const response = await fetch(`${IMAGE_SERVICE_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          data: req.file.buffer.toString('base64'),
          ticketId,
          mimetype: req.file.mimetype,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        return res.status(500).json({ error: err.error || 'Image service error' });
      }
      const result = await response.json();

      if (!ticketImages.has(ticketId)) ticketImages.set(ticketId, []);
      ticketImages.get(ticketId).push(imageId);

      const expiresAt = Date.now() + 3600 * 1000;
      const imageUrl = signImageUrl(imageId, ticketId, expiresAt);

      const message = {
        id: uid(),
        ticketId,
        sender: agent ? 'agent' : 'client',
        senderId: agent ? agent.id : sessionId,
        content: '',
        imageId,
        imageUrl,
        timestamp: Date.now(),
      };
      messages.get(ticketId).push(message);
      broadcastToRoom(ticketId, { type: 'message', ticketId, message });

      res.status(201).json({ imageId, imageUrl, message });
    } catch (err) {
      res.status(500).json({ error: 'Image upload failed' });
    }
  }
);

app.get('/api/tickets/:id/images/:imageId/signed-url', rateLimiter(60000, 60), (req, res) => {
  const ticketId = req.params.id;
  const imageId = req.params.imageId;
  const ticket = tickets.get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const sessionId = req.query.sessionId;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const agent = getAgentByToken(token);

  if (!isTicketParticipant(ticket, sessionId, agent ? agent.id : null)) {
    return res.status(403).json({ error: 'Not a ticket participant' });
  }

  const imgs = ticketImages.get(ticketId) || [];
  if (!imgs.includes(imageId)) return res.status(404).json({ error: 'Image not found in this ticket' });

  const expiresAt = Date.now() + 3600 * 1000;
  const imageUrl = signImageUrl(imageId, ticketId, expiresAt);
  res.json({ imageUrl, expiresAt });
});

const server = app.listen(3000, () => console.log('Main server: http://localhost:3000'));

const wss = new WebSocketServer({ server });
const wsClients = new Map();
const ticketRooms = new Map();

function broadcastToAgents(data) {
  const payload = JSON.stringify(data);
  for (const [ws, info] of wsClients) {
    if (info.type === 'agent' && ws.readyState === 1) ws.send(payload);
  }
}

function broadcastToRoom(ticketId, data) {
  const room = ticketRooms.get(ticketId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const ws of room) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function broadcastToClientsInRoom(ticketId, data) {
  const room = ticketRooms.get(ticketId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const ws of room) {
    const info = wsClients.get(ws);
    if (info && info.type === 'client' && ws.readyState === 1) ws.send(payload);
  }
}

function joinRoom(ws, ticketId) {
  if (!ticketRooms.has(ticketId)) ticketRooms.set(ticketId, new Set());
  ticketRooms.get(ticketId).add(ws);
  wsClients.get(ws).tickets.add(ticketId);
}

wss.on('connection', ws => {
  const wsId = uid();
  wsClients.set(ws, { type: null, tickets: new Set(), id: wsId });

  ws.on('message', raw => {
    if (!wsRateLimiter(wsId, 5000, 50)) {
      ws.send(JSON.stringify({ type: 'error', text: 'Rate limit exceeded' }));
      return;
    }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const info = wsClients.get(ws);

    switch (msg.type) {
      case 'client_init': {
        if (!sessions.has(msg.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', text: 'Invalid session' }));
          return;
        }
        info.type = 'client';
        info.sessionId = msg.sessionId;
        ws.send(JSON.stringify({ type: 'ready' }));
        break;
      }

      case 'agent_init': {
        const agent = getAgentByToken(msg.token);
        if (!agent) {
          ws.send(JSON.stringify({ type: 'error', text: 'Invalid token' }));
          return;
        }
        info.type = 'agent';
        info.agentId = agent.id;
        ws.send(JSON.stringify({ type: 'ready' }));
        break;
      }

      case 'open_ticket': {
        const ticket = tickets.get(msg.ticketId);
        if (!ticket) return;
        if (info.type === 'client' && ticket.sessionId !== info.sessionId) return;
        if (info.type !== 'client' && info.type !== 'agent') return;
        joinRoom(ws, msg.ticketId);

        const ticketMsgs = messages.get(msg.ticketId) || [];
        const enrichedMsgs = ticketMsgs.map(m => {
          if (m.imageId) {
            const expiresAt = Date.now() + 3600 * 1000;
            return { ...m, imageUrl: signImageUrl(m.imageId, msg.ticketId, expiresAt) };
          }
          return m;
        });

        ws.send(JSON.stringify({
          type: 'history',
          ticketId: msg.ticketId,
          messages: enrichedMsgs,
        }));
        break;
      }

      case 'message': {
        if (!info.type) return;
        const ticket = tickets.get(msg.ticketId);
        if (!ticket) return;
        if (!info.tickets.has(msg.ticketId)) return;
        if (info.type === 'client' && ticket.sessionId !== info.sessionId) return;
        if (ticket.status === 'closed') {
          ws.send(JSON.stringify({ type: 'error', text: 'Ticket is closed' }));
          return;
        }
        const content = (msg.content || '').trim();
        if (!content) return;
        if (content.length > 4000) {
          ws.send(JSON.stringify({ type: 'error', text: 'Message too long (max 4000 chars)' }));
          return;
        }
        const message = {
          id: uid(),
          ticketId: msg.ticketId,
          sender: info.type,
          senderId: info.type === 'client' ? info.sessionId : info.agentId,
          content,
          timestamp: Date.now(),
        };
        messages.get(msg.ticketId).push(message);
        broadcastToRoom(msg.ticketId, { type: 'message', ticketId: msg.ticketId, message });
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = wsClients.get(ws);
    if (info) {
      for (const ticketId of info.tickets) {
        const room = ticketRooms.get(ticketId);
        if (room) room.delete(ws);
      }
    }
    wsClients.delete(ws);
    wsRateLimits.delete(wsId);
  });
});

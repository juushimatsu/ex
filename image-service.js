const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '15mb' }));

const SIGNING_SECRET = process.env.SIGNING_SECRET || 'support-secret-key-change-me';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const IMAGE_EXPIRY_MS = 24 * 3600 * 1000;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const imageMeta = new Map();

app.post('/upload', (req, res) => {
  const { filename, data, ticketId, mimetype } = req.body;
  if (!filename || !data || !ticketId) {
    return res.status(400).json({ error: 'filename, data, ticketId required' });
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  const buffer = Buffer.from(data, 'base64');

  fs.writeFile(filePath, buffer, err => {
    if (err) return res.status(500).json({ error: 'Write failed' });
    imageMeta.set(filename, {
      ticketId,
      mimetype: mimetype || 'image/png',
      createdAt: Date.now(),
    });
    res.json({ imageId: filename, stored: true });
  });
});

app.get('/images/:imageId', (req, res) => {
  const { imageId } = req.params;
  const { ticketId, expires, sig } = req.query;

  if (!ticketId || !expires || !sig) {
    return res.status(401).json({ error: 'Missing signature parameters' });
  }

  const expiresNum = parseInt(expires, 10);
  if (isNaN(expiresNum) || Date.now() > expiresNum) {
    return res.status(401).json({ error: 'URL expired' });
  }

  const payload = `${imageId}:${ticketId}:${expiresNum}`;
  const expectedSig = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');

  if (sig !== expectedSig) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const meta = imageMeta.get(imageId);
  if (!meta) {
    return res.status(404).json({ error: 'Image not found' });
  }

  if (meta.ticketId !== ticketId) {
    return res.status(403).json({ error: 'Ticket mismatch' });
  }

  const filePath = path.join(UPLOAD_DIR, imageId);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.setHeader('Content-Type', meta.mimetype);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', images: imageMeta.size });
});

setInterval(() => {
  const now = Date.now();
  for (const [filename, meta] of imageMeta) {
    if (now - meta.createdAt > IMAGE_EXPIRY_MS) {
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.unlink(filePath, () => {});
      imageMeta.delete(filename);
    }
  }
}, 3600 * 1000);

app.listen(3001, () => console.log('Image service: http://localhost:3001'));

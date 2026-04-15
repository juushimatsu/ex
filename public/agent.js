let token = localStorage.getItem('agentToken');
let agentData = JSON.parse(localStorage.getItem('agentData') || 'null');
let ws = null;
let allTickets = [];
let ticketMessages = {};
let openTabs = [];
let activeTab = null;
let currentFilter = 'active';
let uploading = false;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s) {
  return { open: 'Открыто', active: 'Активно', closed: 'Закрыто' }[s] || s;
}

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    document.getElementById('login-err').style.display = 'block';
    return;
  }
  const data = await res.json();
  token = data.token;
  agentData = data.agent;
  localStorage.setItem('agentToken', token);
  localStorage.setItem('agentData', JSON.stringify(agentData));
  showMain();
}

function logout() {
  localStorage.removeItem('agentToken');
  localStorage.removeItem('agentData');
  token = null;
  agentData = null;
  if (ws) ws.close();
  ws = null;
  openTabs = [];
  activeTab = null;
  allTickets = [];
  ticketMessages = {};
  document.getElementById('main-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showMain() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'flex';
  document.getElementById('agent-label').textContent = agentData.username;
  connectWS();
  loadTickets();
}

async function loadTickets() {
  const res = await fetch('/api/tickets/all', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { logout(); return; }
  allTickets = await res.json();
  renderTicketList();
}

function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  renderTicketList();
}

function filteredTickets() {
  if (currentFilter === 'open') return allTickets.filter(t => t.status === 'open');
  if (currentFilter === 'mine') return allTickets.filter(t => t.agentId === agentData.id);
  if (currentFilter === 'active') return allTickets.filter(t => t.status !== 'closed');
  return allTickets;
}

function renderTicketList() {
  const list = filteredTickets().sort((a, b) => b.createdAt - a.createdAt);
  const el = document.getElementById('ticket-list');
  if (list.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">Нет обращений</div>';
    return;
  }
  el.innerHTML = list.map(t => {
    const mine = t.agentId === agentData.id;
    const canTake = t.status === 'open' && !t.agentId;
    return `
      <div class="ticket-item ${t.id === activeTab ? 'sel' : ''}" onclick="selectTicket('${t.id}')">
        <div class="subj">${esc(t.subject)}</div>
        <div class="meta">
          <span class="badge badge-${t.status}">${statusLabel(t.status)}</span>
          ${mine ? '<span class="badge badge-mine">мой</span>' : ''}
          ${canTake ? `<button class="btn-take" onclick="takeTicket('${t.id}',event)">Взять</button>` : ''}
          <span>${fmtTime(t.createdAt)}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function takeTicket(ticketId, e) {
  e.stopPropagation();
  const res = await fetch(`/api/tickets/${ticketId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const ticket = await res.json();
    upsertTicket(ticket);
    renderTicketList();
    if (activeTab === ticketId) renderChatArea();
  } else {
    const err = await res.json();
    alert(err.error || 'Ошибка');
  }
}

function upsertTicket(ticket) {
  const idx = allTickets.findIndex(t => t.id === ticket.id);
  if (idx >= 0) allTickets[idx] = ticket;
  else allTickets.unshift(ticket);
}

function selectTicket(ticketId) {
  if (!openTabs.includes(ticketId)) {
    openTabs.push(ticketId);
    if (!ticketMessages[ticketId]) ticketMessages[ticketId] = [];
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'open_ticket', ticketId }));
    }
  }
  activeTab = ticketId;
  renderTicketList();
  renderChatArea();
}

function switchTab(ticketId) {
  activeTab = ticketId;
  renderTicketList();
  renderChatArea();
}

function closeTab(ticketId, e) {
  e.stopPropagation();
  openTabs = openTabs.filter(id => id !== ticketId);
  if (activeTab === ticketId) {
    activeTab = openTabs[openTabs.length - 1] || null;
  }
  renderTicketList();
  renderChatArea();
}

function renderChatArea() {
  const el = document.getElementById('chat-area');
  if (openTabs.length === 0 || !activeTab) {
    el.innerHTML = '<div class="chat-empty">Выберите обращение из списка</div>';
    return;
  }
  const ticket = allTickets.find(t => t.id === activeTab);
  const msgs = ticketMessages[activeTab] || [];
  const mine = ticket && ticket.agentId === agentData.id;
  const closed = ticket && ticket.status === 'closed';

  const tabsHtml = openTabs.map(id => {
    const t = allTickets.find(x => x.id === id);
    const label = t ? esc(t.subject.length > 22 ? t.subject.slice(0, 22) + '…' : t.subject) : id;
    return `
      <div class="tab ${id === activeTab ? 'on' : ''}" onclick="switchTab('${id}')">
        ${label}
        <span class="tab-x" onclick="closeTab('${id}',event)">×</span>
      </div>
    `;
  }).join('');

  let inputHtml;
  if (!ticket) {
    inputHtml = '<div class="chat-note">Загрузка...</div>';
  } else if (closed) {
    inputHtml = '<div class="chat-note">Обращение закрыто</div>';
  } else if (!mine) {
    inputHtml = '<div class="chat-note">Примите обращение, чтобы отвечать</div>';
  } else {
    inputHtml = `
      <div class="chat-input">
        <label class="btn-attach" title="Прикрепить картинку">
          📎
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" id="file-input" onchange="uploadImage()" hidden>
        </label>
        <textarea id="msg-input" placeholder="Введите сообщение..." onkeydown="handleKey(event)"></textarea>
        <button onclick="sendMessage()">Отправить</button>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="tabs-bar">${tabsHtml}</div>
    <div class="chat-view">
      ${ticket ? `
        <div class="chat-head">
          <div>
            <h3>${esc(ticket.subject)}</h3>
            <div class="sub">
              <span class="badge badge-${ticket.status}">${statusLabel(ticket.status)}</span>
              ${ticket.agentId ? (mine ? ' — назначен вам' : ' — назначен другому агенту') : ' — без агента'}
              &nbsp;· ID сессии: ${esc(ticket.sessionId)}
            </div>
          </div>
          <div class="head-actions">
            ${!ticket.agentId ? `<button class="btn-assign" onclick="takeTicket('${ticket.id}',event)">Взять обращение</button>` : ''}
            ${mine && !closed ? `<button class="btn-close-t" onclick="closeTicket('${ticket.id}')">Закрыть</button>` : ''}
          </div>
        </div>
        <div class="messages" id="msg-list">${msgs.map(renderMsg).join('')}</div>
        ${inputHtml}
      ` : '<div class="chat-empty">Загрузка...</div>'}
    </div>
  `;
  scrollDown();
}

function renderMsg(m) {
  if (m.imageId && m.imageUrl) {
    return `
      <div class="msg ${m.sender}">
        <div class="from">${m.sender === 'client' ? 'Клиент' : 'Агент'}</div>
        <img class="chat-image" src="${m.imageUrl}" alt="Изображение" onclick="openImageFullscreen(this.src)">
        <div class="ts">${fmtTime(m.timestamp)}</div>
      </div>
    `;
  }
  return `
    <div class="msg ${m.sender}">
      <div class="from">${m.sender === 'client' ? 'Клиент' : 'Агент'}</div>
      ${esc(m.content)}
      <div class="ts">${fmtTime(m.timestamp)}</div>
    </div>
  `;
}

function openImageFullscreen(src) {
  document.getElementById('modal-body').innerHTML = `
    <img src="${src}" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:6px;">
    <div class="modal-actions" style="margin-top:12px;">
      <button class="btn btn-cancel" onclick="closeModal()">Закрыть</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('show');
}

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
}

function scrollDown() {
  const el = document.getElementById('msg-list');
  if (el) el.scrollTop = el.scrollHeight;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !activeTab || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'message', ticketId: activeTab, content }));
  input.value = '';
}

async function uploadImage() {
  if (uploading) return;
  const fileInput = document.getElementById('file-input');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой (макс. 10 МБ)');
    return;
  }
  uploading = true;
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await fetch(`/api/tickets/${activeTab}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Ошибка загрузки');
    }
  } catch (e) {
    alert('Ошибка загрузки изображения');
  } finally {
    uploading = false;
    fileInput.value = '';
  }
}

async function closeTicket(ticketId) {
  if (!confirm('Закрыть обращение? Переписка будет завершена.')) return;
  const res = await fetch(`/api/tickets/${ticketId}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const ticket = await res.json();
    upsertTicket(ticket);
    renderTicketList();
    renderChatArea();
  }
}

function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'agent_init', token }));
    for (const ticketId of openTabs) {
      ws.send(JSON.stringify({ type: 'open_ticket', ticketId }));
    }
  };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'error') {
      if (msg.text === 'Invalid token') logout();
      return;
    }

    if (msg.type === 'message') {
      const m = msg.message;
      if (!ticketMessages[m.ticketId]) ticketMessages[m.ticketId] = [];
      ticketMessages[m.ticketId].push(m);
      if (m.ticketId === activeTab) {
        const list = document.getElementById('msg-list');
        if (list) { list.insertAdjacentHTML('beforeend', renderMsg(m)); scrollDown(); }
      }
    }

    if (msg.type === 'history') {
      ticketMessages[msg.ticketId] = msg.messages;
      if (msg.ticketId === activeTab) {
        const list = document.getElementById('msg-list');
        if (list) { list.innerHTML = msg.messages.map(renderMsg).join(''); scrollDown(); }
      }
    }

    if (msg.type === 'new_ticket') {
      allTickets.unshift(msg.ticket);
      renderTicketList();
    }

    if (msg.type === 'ticket_update') {
      upsertTicket(msg.ticket);
      renderTicketList();
      if (msg.ticket.id === activeTab) renderChatArea();
    }
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

(function init() {
  if (token && agentData) showMain();
})();

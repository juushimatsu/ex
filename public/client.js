let sessionId = localStorage.getItem('sessionId');
let sessionInfo = JSON.parse(localStorage.getItem('sessionInfo') || 'null');
let ws = null;
let currentTickets = [];
let activeTicketId = null;
let ticketMessages = {};
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

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
}

function showSessionModal() {
  const i = sessionInfo || {};
  document.getElementById('modal-body').innerHTML = `
    <h2>${sessionId ? 'Данные сессии' : 'Начало сессии'}</h2>
    <p>Введите данные или оставьте пустым для анонимного доступа.</p>
    <div class="field"><label>ФИО</label><input id="f-name" value="${esc(i.name || '')}" placeholder="Не обязательно"></div>
    <div class="field"><label>Адрес</label><input id="f-addr" value="${esc(i.address || '')}" placeholder="Не обязательно"></div>
    <div class="field"><label>Паспорт</label><input id="f-passport" value="${esc(i.passport || '')}" placeholder="Не обязательно"></div>
    <div class="modal-actions">
      ${sessionId ? '<button class="btn btn-cancel" onclick="closeModal()">Отмена</button>' : ''}
      <button class="btn btn-primary" onclick="saveSession()">${sessionId ? 'Сохранить' : 'Начать'}</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('show');
}

async function saveSession() {
  const name = document.getElementById('f-name').value.trim();
  const address = document.getElementById('f-addr').value.trim();
  const passport = document.getElementById('f-passport').value.trim();
  const info = (name || address || passport) ? { name, address, passport } : null;

  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ info }),
  });
  const data = await res.json();

  sessionId = data.id;
  sessionInfo = data.info;
  localStorage.setItem('sessionId', sessionId);
  localStorage.setItem('sessionInfo', JSON.stringify(sessionInfo));

  closeModal();
  updateSessionLabel();
  connectWS();
  loadTickets();
}

function updateSessionLabel() {
  const el = document.getElementById('session-label');
  if (!sessionId) { el.textContent = 'Сессия не создана'; return; }
  const name = sessionInfo && sessionInfo.name ? sessionInfo.name : null;
  el.textContent = name ? `${name} — #${sessionId}` : `Анонимная сессия: #${sessionId}`;
}

async function loadTickets() {
  if (!sessionId) return;
  const res = await fetch(`/api/tickets?sessionId=${sessionId}`);
  currentTickets = await res.json();
  renderTicketList();
}

function renderTicketList() {
  const el = document.getElementById('ticket-list');
  if (currentTickets.length === 0) {
    el.innerHTML = '<div style="padding:18px;text-align:center;color:#94a3b8;font-size:13px;">Нет обращений</div>';
    return;
  }
  el.innerHTML = currentTickets
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(t => `
      <div class="ticket-item ${t.id === activeTicketId ? 'active' : ''}" onclick="openTicket('${t.id}')">
        <div class="subj">${esc(t.subject)}</div>
        <div class="meta">
          <span class="badge badge-${t.status}">${statusLabel(t.status)}</span>
          <span>${fmtTime(t.createdAt)}</span>
        </div>
      </div>
    `).join('');
}

function showNewTicketModal() {
  if (!sessionId) { showSessionModal(); return; }
  document.getElementById('modal-body').innerHTML = `
    <h2>Новое обращение</h2>
    <p>Опишите тему обращения в техподдержку.</p>
    <div class="field"><label>Тема</label><input id="f-subject" placeholder="Например: не работает оплата"></div>
    <div class="modal-actions">
      <button class="btn btn-cancel" onclick="closeModal()">Отмена</button>
      <button class="btn btn-primary" onclick="createTicket()">Создать</button>
    </div>
  `;
  document.getElementById('overlay').classList.add('show');
  document.getElementById('f-subject').focus();
}

async function createTicket() {
  const subject = document.getElementById('f-subject').value.trim();
  if (!subject) return;
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, subject }),
  });
  const ticket = await res.json();
  closeModal();
  currentTickets.unshift(ticket);
  renderTicketList();
  openTicket(ticket.id);
}

async function openTicket(ticketId) {
  activeTicketId = ticketId;
  renderTicketList();

  const res = await fetch(`/api/tickets/${ticketId}`);
  const { ticket, messages } = await res.json();
  ticketMessages[ticketId] = messages;
  renderChat(ticket);

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'open_ticket', ticketId }));
  }
}

function renderChat(ticket) {
  const msgs = ticketMessages[ticket.id] || [];
  const closed = ticket.status === 'closed';
  document.getElementById('chat-area').innerHTML = `
    <div class="chat-head">
      <h3>${esc(ticket.subject)}</h3>
      <div class="sub">
        <span class="badge badge-${ticket.status}">${statusLabel(ticket.status)}</span>
        ${ticket.agentId ? ' — Агент подключён' : ' — Ожидание агента'}
      </div>
    </div>
    <div class="messages" id="msg-list">${msgs.map(renderMsg).join('')}</div>
    ${closed
      ? '<div class="chat-closed-note">Обращение закрыто</div>'
      : `<div class="chat-input">
           <label class="btn-attach" title="Прикрепить картинку">
             📎
             <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" id="file-input" onchange="uploadImage()" hidden>
           </label>
           <textarea id="msg-input" placeholder="Введите сообщение..." onkeydown="handleKey(event)"></textarea>
           <button onclick="sendMessage()">Отправить</button>
         </div>`
    }
  `;
  scrollDown();
}

function renderMsg(m) {
  if (m.imageId && m.imageUrl) {
    return `
      <div class="msg ${m.sender}">
        <div class="from">${m.sender === 'client' ? 'Вы' : 'Агент'}</div>
        <img class="chat-image" src="${m.imageUrl}" alt="Изображение" onclick="openImageFullscreen(this.src)">
        <div class="ts">${fmtTime(m.timestamp)}</div>
      </div>
    `;
  }
  return `
    <div class="msg ${m.sender}">
      <div class="from">${m.sender === 'client' ? 'Вы' : 'Агент'}</div>
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

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !activeTicketId || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'message', ticketId: activeTicketId, content }));
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
  formData.append('sessionId', sessionId);
  try {
    const res = await fetch(`/api/tickets/${activeTicketId}/images`, {
      method: 'POST',
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

function scrollDown() {
  const el = document.getElementById('msg-list');
  if (el) el.scrollTop = el.scrollHeight;
}

function connectWS() {
  if (!sessionId) return;
  if (ws) ws.close();

  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'client_init', sessionId }));
    if (activeTicketId) {
      ws.send(JSON.stringify({ type: 'open_ticket', ticketId: activeTicketId }));
    }
  };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'message') {
      const m = msg.message;
      if (!ticketMessages[m.ticketId]) ticketMessages[m.ticketId] = [];
      ticketMessages[m.ticketId].push(m);
      if (m.ticketId === activeTicketId) {
        const list = document.getElementById('msg-list');
        if (list) { list.insertAdjacentHTML('beforeend', renderMsg(m)); scrollDown(); }
      }
    }

    if (msg.type === 'history') {
      ticketMessages[msg.ticketId] = msg.messages;
      if (msg.ticketId === activeTicketId) {
        const list = document.getElementById('msg-list');
        if (list) { list.innerHTML = msg.messages.map(renderMsg).join(''); scrollDown(); }
      }
    }

    if (msg.type === 'ticket_update') {
      const idx = currentTickets.findIndex(t => t.id === msg.ticket.id);
      if (idx >= 0) currentTickets[idx] = msg.ticket;
      renderTicketList();
      if (msg.ticket.id === activeTicketId) renderChat(msg.ticket);
    }
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

(function init() {
  updateSessionLabel();
  if (!sessionId) {
    showSessionModal();
  } else {
    connectWS();
    loadTickets();
  }
})();

/**
 * ============================================================================
 *  ИНСТРУКЦИЯ ПО ВСТРАИВАНИЮ ЗАГРУЗКИ ИЗОБРАЖЕНИЙ В СУЩЕСТВУЮЩИЙ ПРОЕКТ
 * ============================================================================
 *
 *  Ниже — 5 шагов. Каждый шаг — конкретный код, который нужно добавить.
 *  Помечено ГДЕ именно добавлять.
 *
 * ============================================================================
 *  ШАГ 1: Установить multer
 * ============================================================================
 *
 *  npm install multer
 *
 *
 * ============================================================================
 *  ШАГ 2: Добавить конфигурацию Multer на сервере
 * ============================================================================
 *
 *  ГДЕ: В начале файла сервера, рядом с другими require
 *
 *  КОД:
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// --- Конфигурация хранения файлов ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));   // Папка uploads/ должна существовать
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(8).toString('hex') + ext);  // Уникальное имя
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },       // Макс. 10 МБ
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

/**
 * ============================================================================
 *  ШАГ 3: Добавить маршрут загрузки и раздачу файлов
 * ============================================================================
 *
 *  ГДЕ: В файле сервера, после app.use(express.json())
 *
 *  КОД:
 */

// Раздача папки uploads как статики (чтобы <img src="/uploads/file.jpg"> работал)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Маршрут отправки сообщения с картинкой
// upload.single('image') — ожидает файл в поле "image" формы
app.post('/api/messages', upload.single('image'), (req, res) => {
  const text = (req.body.text || '').trim();
  const hasImage = !!req.file;

  if (!text && !hasImage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  const message = {
    id: crypto.randomBytes(4).toString('hex'),
    text,
    timestamp: Date.now(),
  };

  // КЛЮЧЕВАЯ СТРОКА: если файл загружен — добавляем URL
  // req.file.filename — имя файла на диске (сгенерированное в storage)
  // URL = /uploads/<filename> — потом браузер запросит это у Express
  if (hasImage) {
    message.imageUrl = `/uploads/${req.file.filename}`;
  }

  // ... сохрани message в базу / массив
  res.status(201).json(message);
});

// Обработка ошибок Multer (размер файла, неверный тип)
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Файл слишком большой (макс. 10 МБ)' });
  }
  if (err.message && err.message.includes('Только изображения')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Ошибка сервера' });
});

/**
 * ============================================================================
 *  ШАГ 4: Добавить UI на фронтенде (HTML)
 * ============================================================================
 *
 *  ГДЕ: В панели ввода сообщений (.chat-input или аналогичный блок)
 *
 *  ЧТО ДОБАВИТЬ ПЕРЕД textarea:
 *
 *    <label class="btn-attach" title="Прикрепить картинку">
 *      📎
 *      <input type="file"
 *             accept="image/jpeg,image/png,image/gif,image/webp"
 *             id="file-input"
 *             onchange="showPreview()"
 *             hidden>
 *    </label>
 *
 *  ПОСЛЕ панели ввода (или перед ней) — превью файла:
 *
 *    <div class="preview-bar" id="preview-bar" style="display:none;">
 *      <img id="preview-thumb" src="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;">
 *      <span id="preview-name"></span>
 *      <span onclick="clearFile()" style="cursor:pointer;">✕</span>
 *    </div>
 *
 *
 * ============================================================================
 *  ШАГ 5: Добавить JavaScript на фронтенде
 * ============================================================================
 *
 *  ГДЕ: В файле client.js / agent.js
 *
 *  КОД — функция отправки:
 */

async function sendMessage() {
  const textInput = document.getElementById('msg-input');   // Твой <textarea>
  const fileInput = document.getElementById('file-input');  // <input type="file">
  const text = textInput.value.trim();
  const file = fileInput && fileInput.files && fileInput.files[0];

  if (!text && !file) return;

  if (file) {
    // ====== ОТПРАВКА С ФАЙЛОМ ======
    //
    // FormData — формирует multipart/form-data запрос
    // НЕ нужно ставить Content-Type — браузер сделает это сам
    //
    const formData = new FormData();
    formData.append('image', file);     // 'image' = имя поля, совпадает с upload.single('image')
    formData.append('text', text);      // текст можно тоже добавить в FormData

    // Если нужна авторизация — добавь заголовок:
    // const headers = { Authorization: `Bearer ${token}` };
    // но НЕ добавляй Content-Type — FormData сам поставит!

    const res = await fetch('/api/messages', {
      method: 'POST',
      // headers,            // ← раскомментируй если нужна авторизация
      body: formData,       // ← FormData, не JSON.stringify
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Ошибка');
      return;
    }
  } else {
    // ====== ОТПРАВКА БЕЗ ФАЙЛА (обычный JSON) ======
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Ошибка');
      return;
    }
  }

  // Очистка
  textInput.value = '';
  if (fileInput) fileInput.value = '';
  const previewBar = document.getElementById('preview-bar');
  if (previewBar) previewBar.style.display = 'none';
}

// Превью выбранного файла
function showPreview() {
  const input = document.getElementById('file-input');
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой (макс. 10 МБ)');
    input.value = '';
    return;
  }
  const previewBar = document.getElementById('preview-bar');
  const thumb = document.getElementById('preview-thumb');
  const name = document.getElementById('preview-name');
  thumb.src = URL.createObjectURL(file);
  name.textContent = file.name;
  previewBar.style.display = 'flex';
}

function clearFile() {
  const input = document.getElementById('file-input');
  input.value = '';
  document.getElementById('preview-bar').style.display = 'none';
}

/**
 * ============================================================================
 *  ШАГ 5.1: Отрисовка сообщения с картинкой
 * ============================================================================
 *
 *  В твоей функции renderMsg() добавь проверку на imageUrl:
 *
 *    function renderMsg(m) {
 *      let content = '';
 *      if (m.text) content += escHtml(m.text);
 *      if (m.imageUrl) {
 *        content += `<img class="chat-image" src="${m.imageUrl}" alt="Изображение">`;
 *      }
 *      return `
 *        <div class="msg ${m.sender}">
 *          <div class="from">${m.sender === 'client' ? 'Клиент' : 'Агент'}</div>
 *          ${content}
 *          <div class="ts">${fmtTime(m.timestamp)}</div>
 *        </div>
 *      `;
 *    }
 *
 * ============================================================================
 *  ШАГ 5.2: CSS для картинок в чате
 * ============================================================================
 *
 *  Добавь в свой CSS:
 *
 *    .chat-image {
 *      max-width: 260px;
 *      max-height: 200px;
 *      border-radius: 6px;
 *      cursor: pointer;
 *      display: block;
 *      margin-top: 4px;
 *    }
 *
 *    .btn-attach {
 *      display: flex;
 *      align-items: center;
 *      justify-content: center;
 *      width: 36px;
 *      height: 36px;
 *      border-radius: 6px;
 *      background: #f1f5f9;
 *      border: 1px solid #cbd5e1;
 *      cursor: pointer;
 *      font-size: 16px;
 *      flex-shrink: 0;
 *    }
 *    .btn-attach:hover { background: #e2e8f0; }
 *
 *
 * ============================================================================
 *  ЧАСТЫЕ ВОПРОСЫ
 * ============================================================================
 *
 *  Q: Можно ли отправлять несколько файлов сразу?
 *  A: Да. Замени upload.single('image') на upload.array('images', 5)
 *     (макс. 5 файлов). На сервере файлы будут в req.files (массив).
 *     На клиенте: formData.append('images', file1); formData.append('images', file2);
 *
 *  Q: Как отправлять файл через WebSocket вместо HTTP?
 *  A: WebSocket не поддерживает multipart/form-data напрямую.
 *     Варианты:
 *     1. Отправлять файл через HTTP POST (как в этом шаблоне),
 *        а потом отправить сообщение "файл загружен" через WebSocket.
 *     2. Конвертировать файл в base64 на клиенте и отправить
 *        через WebSocket как строку. Но это на ~33% больше трафика.
 *
 *  Q: Как добавить приватность (файлы доступны только участникам тикета)?
 *  A: Два варианта:
 *     1. НЕ раздавай /uploads как статику. Вместо этого создай маршрут:
 *        app.get('/uploads/:filename', (req, res) => {
 *          // Проверь, что запрашивающий — участник тикета
 *          // Если да — отправь файл: res.sendFile(...)
 *          // Если нет — 403
 *        });
 *     2. Используй подписанные URL (HMAC), как в основном проекте.
 *
 *  Q: Как хранить файлы не на диске, а в памяти?
 *  A: Замени storage на multer.memoryStorage():
 *        const upload = multer({ storage: multer.memoryStorage(), ... });
 *     Файл будет в req.file.buffer (Buffer). Потом можешь отправить
 *     его в S3, другой сервис, или записать в базу.
 *
 *  Q: Что если нужно изменить URL картинок (другой порт, другой домен)?
 *  A: Формируй полный URL на сервере:
 *        message.imageUrl = `http://image-host:3001/uploads/${req.file.filename}`;
 *     Или на клиенте: подставляй baseUrl перед imageUrl.
 */

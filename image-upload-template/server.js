/**
 * ============================================================================
 *  ЗАГОТОВКА: Прикрепление изображений в чат на Express + Multer
 * ============================================================================
 *
 *  Что делает этот файл:
 *  1. Отдаёт статическую HTML-страницу с чатом
 *  2. Принимает загрузку изображений через multipart/form-data
 *  3. Сохраняет файлы на диск в папку /uploads
 *  4. Отдаёт сохранённые файлы по URL
 *  5. Хранит сообщения (текст + картинки) в памяти и раздаёт их через API
 *
 *  Как встроить в свой проект:
 *  — Скопируй multer-конфигурацию (шаг 1) и маршрут uploads (шаг 2)
 *  — Скопируй маршрут отправки сообщения с картинкой (шаг 3)
 *  — Добавь <input type="file"> в свой фронтенд (см. public/index.html)
 *  — Добавь CSS для .chat-image (см. public/index.html)
 *
 * ============================================================================
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.use(express.json());

// ============================================================================
//  ХРАНИЛИЩЕ СООБЩЕНИЙ (в памяти, для демонстрации)
//  В реальном проекте — база данных (PostgreSQL, MongoDB и т.д.)
// ============================================================================

const chatMessages = [];

// ============================================================================
//  ШАГ 1: Настройка Multer — библиотеки для загрузки файлов
//  Multer читает multipart/form-data, сохраняет файл на диск и кладёт
//  информацию о нём в req.file
// ============================================================================

const storage = multer.diskStorage({
  // cb = callback. cb(ошибка, результат)
  destination: (req, file, cb) => {
    // Файлы сохраняются в папку uploads/ (создай её заранее)
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя, чтобы не было коллизий
    // Оригинальное расширение сохраняем
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = crypto.randomBytes(8).toString('hex') + ext;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    // Максимальный размер файла (10 МБ). Если больше — Multer вернёт ошибку
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Разрешаем только картинки. Проверяем MIME-тип
    // JPEG, PNG, GIF, WebP
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Второй аргумент false = отклонить файл
      // Ошибка попадёт в err.multer в обработчике маршрута
      cb(new Error('Только изображения (JPEG, PNG, GIF, WebP)'));
    }
  },
});

// ============================================================================
//  ШАГ 2: Раздача папки uploads как статических файлов
//  После этого файл uploads/abc123.jpg доступен по URL /uploads/abc123.jpg
//
//  ⚠ ВАЖНО для продакшена: так файлы доступны ВСЕМ, кто знает URL.
//  Для приватности используй подписанные URL или отдельный сервис
//  (как реализовано в основном проекте).
//  Здесь это упрощено — фокус на механике прикрепления.
// ============================================================================

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================================
//  ШАГ 3: Маршрут отправки сообщения (текст + опционально картинка)
//
//  upload.single('image') — ожидает ОДИН файл с именем поля "image"
//  Если файл не отправлен — Multer НЕ выдаёт ошибку, req.file будет undefined
//
//  Формат запроса: multipart/form-data
//    - поле "text": текст сообщения (string)
//    - поле "image": файл (опционально)
//
//  Как добавить в свой роутер:
//    app.post('/api/your-chat/messages', upload.single('image'), (req, res) => { ... })
//    При этом req.body.text — текст, req.file — инфо о файле
// ============================================================================

app.post('/api/messages', upload.single('image'), (req, res) => {
  // req.body — текстовые поля формы
  const text = (req.body.text || '').trim();

  // req.file — информация о загруженном файле (ИЛИ undefined, если файл не отправлен)
  // Структура req.file при наличии файла:
  //   {
  //     fieldname: 'image',          — имя поля формы
  //     originalname: 'photo.jpg',  — оригинальное имя файла
  //     filename: 'a1b2c3d4.jpg',   — имя на диске (то, что сгенерировали в storage)
  //     path: '/abs/path/uploads/a1b2c3d4.jpg', — полный путь к файлу
  //     size: 245678,               — размер в байтах
  //     mimetype: 'image/jpeg',     — MIME-тип
  //   }
  const hasImage = !!req.file;

  if (!text && !hasImage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  const message = {
    id: crypto.randomBytes(4).toString('hex'),
    text,
    timestamp: Date.now(),
  };

  // Если картинка прикреплена — добавляем URL в сообщение
  if (hasImage) {
    // URL формируется как: /uploads/<filename>
    // filename — то имя, которое Multer дал файлу (из storage.filename)
    // На фронтенде этот URL подставляется в <img src="...">
    message.imageUrl = `/uploads/${req.file.filename}`;

    // Для встраивания в существующий проект:
    // Если у тебя сообщения хранят sender, ticketId и т.д. — добавь:
    //   message.sender = req.body.sender;
    //   message.ticketId = req.body.ticketId;
    // Или бери из сессии/токена авторизации
  }

  chatMessages.push(message);
  res.status(201).json(message);
});

// ============================================================================
//  ШАГ 4: Получение всех сообщений
//  В реальном проекте — пагинация, фильтр по тикету, и т.д.
// ============================================================================

app.get('/api/messages', (req, res) => {
  res.json(chatMessages);
});

// ============================================================================
//  Обработка ошибок Multer
//  Если файл слишком большой или неверный тип — Multer кинет ошибку
//  Этот middleware перехватит её и вернёт понятный JSON
// ============================================================================

app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Файл слишком большой (макс. 10 МБ)' });
  }
  if (err.message && err.message.includes('Только изображения')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

// ============================================================================
//  Статика (фронтенд)
// ============================================================================

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
//  Запуск
// ============================================================================

app.listen(3000, () => {
  console.log('Сервер запущен: http://localhost:3000');
  console.log('Папка с файлами: ' + path.join(__dirname, 'uploads'));
});

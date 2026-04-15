# Как добавить картинки в чат техподдержки

## Руководство для тех, кто плохо знает Node.js

---

## Как это работает в целом

```
┌──────────┐                          ┌──────────┐
│  БРАУЗЕР  │                          │  СЕРВЕР   │
│ (фронтенд)│                          │ (Node.js) │
└─────┬─────┘                          └─────┬─────┘
      │                                      │
      │  1. Пользователь выбирает файл       │
      │     <input type="file">              │
      │                                      │
      │  2. JavaScript берёт файл            │
      │     и кладёт в FormData              │
      │                                      │
      │  3. FormData отправляется ────────>  │
      │     через fetch('/api/messages')     │
      │                                      │
      │                              4. Сервер получает файл
      │                                 multer его сохраняет
      │                                 в папку /uploads/
      │                                 под именем a1b2c3.jpg
      │                                      │
      │                              5. Сервер создаёт сообщение
      │                                 imageUrl = "/uploads/a1b2c3.jpg"
      │                                 и отправляет обратно ──>
      │                                      │
      │  6. Браузер рисует <img>             │
      │     src="/uploads/a1b2c3.jpg"        │
      │                                      │
      │  7. Браузер запрашивает ─────────>   │
      │     эту картинку                     │
      │                                      │
      │                          8. Сервер отдаёт файл <──────
      │                             (express.static)
      │                                      │
      │  9. Картинка появляется в чате <──── │
```

**Три вещи, которые нужно сделать:**
1. Настроить сервер на приём файлов
2. Настроить сервер на раздачу файлов
3. Добавить кнопку загрузки на странице чата

---

## Что нужно установить

```bash
npm install multer
```

**Multer** — это пакет для Node.js, который умеет принимать файлы от браузера.
Без него Express не понимает файлы (он умеет только текст/JSON).

**Аналогия:** Express — это почтальон, который приносит только конверты.
Multer — это почтальон, который приносит ещё и посылки (файлы).

---

## ШАГ 1: Настроить сервер на сохранение файлов

### Где писать

В файле сервера (обычно `server.js` или `app.js`), в самом верху,
там где все `require(...)`.

### Что написать

```js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
```

> `multer` — сам пакет
> `path` — встроенный модуль Node для работы с путями файлов
> `crypto` — встроенный модуль Node для генерации случайных имён файлов

### Дальше — конфигурация

Эта настройка говорит Multer: «куда сохранять файлы» и «как их называть».

```js
const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    // КУДА сохранять — в папку uploads/ рядом с сервером
    callback(null, path.join(__dirname, 'uploads'));
  },
  filename: function (req, file, callback) {
    // КАК назвать файл — случайное имя + оригинальное расширение
    // Например: a1b2c3d4e5f6.jpg
    const ext = path.extname(file.originalname);  // ".jpg" или ".png"
    const randomName = crypto.randomBytes(8).toString('hex');
    callback(null, randomName + ext);
  },
});

const upload = multer({
  storage: storage,                        // используем настройку выше
  limits: { fileSize: 10 * 1024 * 1024 },  // макс. 10 мегабайт
  fileFilter: function (req, file, callback) {
    // Разрешаем только картинки
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      callback(null, true);   // разрешить
    } else {
      callback(new Error('Только картинки'));  // запретить
    }
  },
});
```

### Не забудь создать папку

Создай папку `uploads/` рядом с файлом сервера. Туда будут падать картинки.

```
твой-проект/
├── server.js
├── uploads/        <--- создай эту папку!
├── package.json
└── public/
```

---

## ШАГ 2: Настроить сервер на раздачу файлов

Когда браузер видит `<img src="/uploads/a1b2c3.jpg">`,
он делает запрос к серверу. Сервер должен уметь отдавать файлы из этой папки.

### Где писать

В файле сервера, ПОСЛЕ `app.use(express.json())` и ДО твоих маршрутов.

### Что написать

```js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

**Что это делает:**
- Когда браузер запрашивает `/uploads/что-то.jpg`
- Express ищет файл `что-то.jpg` в папке `uploads/` и отдаёт его
- Это ОДНА строка, больше ничего не нужно

> ⚠ Если у тебя несколько `app.use(express.static(...))` — поставь эту строку рядом с ними.

---

## ШАГ 3: Добавить маршрут приёма файла

Это URL, на который браузер отправит файл. У тебя уже есть маршрут
для отправки текстового сообщения — нужно сделать похожий, но для файла.

### Где писать

Там же, где остальные маршруты (app.post, app.get).

### Что написать

```js
// upload.single('image') — это middleware, который:
// 1. Берёт файл из запроса
// 2. Сохраняет его на диск (как мы настроили в ШАГЕ 1)
// 3. Кладёт информацию о файле в req.file
// 'image' — это имя поля формы (должно совпадать с фронтендом!)
app.post('/api/messages', upload.single('image'), function (req, res) {

  // req.body.text — текст сообщения (как обычно)
  var text = (req.body.text || '').trim();

  // req.file — информация о загруженном файле
  // Если файл НЕ отправляли — req.file будет undefined
  // Если отправляли — req.file будет объектом:
  //   {
  //     fieldname: 'image',
  //     originalname: 'photo.jpg',        — как файл назывался у пользователя
  //     filename: 'a1b2c3d4e5f6.jpg',     — как файл назвался на сервере
  //     size: 245678,                     — размер в байтах
  //     mimetype: 'image/jpeg',
  //   }
  var hasImage = !!req.file;

  if (!text && !hasImage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  // Создаём объект сообщения (как ты обычно делаешь)
  var message = {
    id: crypto.randomBytes(4).toString('hex'),
    text: text,
    timestamp: Date.now(),
    // ... добавь свои поля: sender, ticketId и т.д.
  };

  // КЛЮЧЕВАЯ ЧАСТЬ: добавляем URL картинки в сообщение
  if (hasImage) {
    // /uploads/ + имя файла на сервере = URL по которому картинка доступна
    message.imageUrl = '/uploads/' + req.file.filename;
  }

  // Дальше — сохраняй сообщение как обычно (в массив, в базу...)
  // messages.push(message);  // или что у тебя там
  res.status(201).json(message);
});
```

### Что если у тебя УЖЕ есть маршрут /api/messages?

Если у тебя уже есть маршрут отправки сообщения и ты не хочешь его менять,
можно сделать ОТДЕЛЬНЫЙ маршрут для картинок:

```js
// Отдельный маршрут для загрузки картинок
app.post('/api/upload-image', upload.single('image'), function (req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Нет файла' });
  }

  // Возвращаем URL — фронтенд сам вставит его в сообщение
  var imageUrl = '/uploads/' + req.file.filename;
  res.json({ imageUrl: imageUrl });
});
```

Тогда на фронтенде:
1. Сначала отправляешь файл на `/api/upload-image`
2. Получаешь обратно `{ imageUrl: "/uploads/abc.jpg" }`
3. Потом отправляешь обычное сообщение, но с этим imageUrl

---

## ШАГ 4: Добавить обработку ошибок

Если файл слишком большой или не картинка — Multer выдаст ошибку.
Нужно её перехватить, иначе сервер упадёт.

### Где писать

В самом конце файла сервера, ПОСЛЕ всех маршрутов.

### Что написать

```js
app.use(function (err, req, res, next) {
  // Файл слишком большой
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Файл слишком большой (макс. 10 МБ)' });
  }
  // Неправильный тип файла
  if (err.message && err.message.includes('Только картинки')) {
    return res.status(400).json({ error: err.message });
  }
  // Какая-то другая ошибка
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});
```

> У `app.use(function(err, req, res, next))` ЧЕТЫРЕ аргумента.
> Именно наличие всех четырёх говорит Express: «это обработчик ошибок».
> Если убрать `next` — Express подумает что это обычный middleware.

---

## ШАГ 5: Добавить кнопку загрузки на страницу чата (HTML)

### Где писать

В HTML-файле чата, в блоке ввода сообщений, ПЕРЕД полем textarea.

### Что добавить

```html
<!-- Кнопка-скрепка для выбора файла -->
<label class="btn-attach" title="Прикрепить картинку">
  📎
  <input type="file"
         accept="image/jpeg,image/png,image/gif,image/webp"
         id="file-input"
         onchange="showPreview()"
         hidden>
</label>
```

**Разбор по строкам:**

| Строка | Что делает |
|---|---|
| `<label class="btn-attach">` | Кнопка, по которой кликает пользователь (скрепка) |
| `<input type="file">` | Скрытый элемент выбора файла (native браузерный) |
| `accept="image/..."` | Ограничивает диалог выбора файла только картинками |
| `id="file-input"` | ID, чтобы JavaScript мог найти этот элемент |
| `onchange="showPreview()"` | Когда файл выбран — вызвать функцию showPreview() |
| `hidden` | Спрятать сам input — пользователь кликает по label |

> **Как это работает:** `<label>` обёртывает `<input>`.
> Когда пользователь кликает по label, браузер автоматически открывает
> диалог выбора файла для input внутри label. Пользователь не видит
> уродливый системный input — видит только красивую кнопку-скрепку.

---

## ШАГ 6: Добавить CSS для кнопки и картинок

### Где писать

В `<style>` в HTML-файле чата.

### Что добавить

```css
/* Кнопка-скрепка */
.btn-attach {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
}
.btn-attach:hover {
  background: #e2e8f0;
}

/* Картинка в чате */
.chat-image {
  max-width: 260px;    /* Не шире 260px в чате */
  max-height: 200px;   /* Не выше 200px в чате */
  border-radius: 6px;
  cursor: pointer;     /* Курсор-рука — значит можно нажать */
  display: block;
  margin-top: 4px;
}
```

---

## ШАГ 7: Добавить JavaScript для отправки файла

Это самая важная часть. Тут две функции: показать превью и отправить.

### Где писать

В JavaScript-файле чата (client.js, agent.js и т.п.).

### Функция 1: Показать превью выбранного файла

Когда пользователь выбрал файл, покажем ему миниатюру,
чтобы он понимал что именно отправляет.

```js
function showPreview() {
  // Берём элемент input
  var input = document.getElementById('file-input');

  // Если ничего не выбрали — выходим
  if (!input.files || !input.files[0]) return;

  var file = input.files[0];

  // Проверяем размер (на клиенте — для удобства,
  // на сервере — для безопасности)
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой (макс. 10 МБ)');
    input.value = '';  // сбрасываем выбор
    return;
  }

  // Показываем превью
  // URL.createObjectURL(file) создаёт временный URL
  // для локального файла — картинка появится БЕЗ загрузки на сервер
  // Этот URL живёт только в текущей вкладке браузера
  var preview = document.getElementById('preview-thumb');
  if (preview) {
    preview.src = URL.createObjectURL(file);
  }

  // Показываем имя файла
  var nameEl = document.getElementById('preview-name');
  if (nameEl) {
    nameEl.textContent = file.name;
  }

  // Показываем блок превью
  var bar = document.getElementById('preview-bar');
  if (bar) {
    bar.style.display = 'flex';
  }
}
```

> Эта функция опциональная. Если не хочешь показывать превью —
> можешь её не писать. Главное — функция отправки ниже.

### Функция 2: Отправка сообщения с файлом

```js
async function sendMessage() {
  // Находим элементы ввода
  var textInput = document.getElementById('msg-input');   // текстовое поле
  var fileInput = document.getElementById('file-input');  // поле файла
  var text = textInput.value.trim();
  var file = fileInput && fileInput.files && fileInput.files[0];

  // Если нет ни текста ни файла — ничего не делаем
  if (!text && !file) return;


  // ==========================================
  //  ВАЖНО: Есть два способа отправки
  //  С файлом и без файла — разные форматы!
  // ==========================================

  if (file) {
    // -------- ОТПРАВКА С ФАЙЛОМ --------

    // FormData — специальный объект для отправки файлов
    // Он формирует multipart/form-data (формат для файлов)
    // Это НЕ JSON! Это другой формат данных.
    var formData = new FormData();

    // Добавляем файл в FormData
    // 'image' — имя поля. Оно ДОЛЖНО совпадать с тем,
    // что написано на сервере: upload.single('image')
    formData.append('image', file);

    // Добавляем текст в ту же FormData
    formData.append('text', text);

    // Если у тебя есть другие поля — добавь их тоже:
    // formData.append('ticketId', ticketId);
    // formData.append('sessionId', sessionId);

    // Отправляем запрос
    // ⚠ ВНИМАНИЕ: НЕ ставь заголовок Content-Type!
    // Браузер сам поставит "multipart/form-data; boundary=..."
    // Если ты укажешь Content-Type вручную — файл не отправится!
    var res = await fetch('/api/messages', {
      method: 'POST',
      body: formData,          // ← FormData, НЕ JSON.stringify
      // headers: { ... }      // ← НЕ добавляй Content-Type!
      // Но можно добавить Authorization:
      // headers: { 'Authorization': 'Bearer ' + token }
    });

  } else {
    // -------- ОТПРАВКА БЕЗ ФАЙЛА (обычный текст) --------

    var res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });
  }

  // Проверяем ответ
  if (!res.ok) {
    var err = await res.json();
    alert(err.error || 'Ошибка');
    return;
  }

  // Очищаем поля ввода
  textInput.value = '';
  fileInput.value = '';

  // Скрываем превью (если было)
  var bar = document.getElementById('preview-bar');
  if (bar) bar.style.display = 'none';

  // Обновляем список сообщений (вызови свою функцию загрузки)
  // loadMessages();
}
```

### Главное правило отправки файлов

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   БЕЗ файла:     body: JSON.stringify({ text })        │
│                  headers: { 'Content-Type': 'application/json' }
│                                                         │
│   С файлом:      body: formData                        │
│                  БЕЗ заголовка Content-Type!            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## ШАГ 8: Показать картинку в чате

Когда сообщение содержит картинку, нужно нарисовать `<img>` вместо текста.

### Где писать

В функции отрисовки сообщений (renderMsg, renderChat и т.п.).

### Что изменить

Найди место где ты выводишь текст сообщения. Обычно это выглядит так:

```js
// БЫЛО — только текст:
content = escHtml(message.text);
```

Добавь проверку на imageUrl:

```js
// СТАЛО — текст + картинка:
var content = '';
if (message.text) {
  content = content + escHtml(message.text);
}
if (message.imageUrl) {
  // Рисуем картинку. src = URL, который пришёл с сервера
  content = content + '<img class="chat-image" src="' + message.imageUrl + '">';
}
```

Потом подставь `content` в HTML сообщения как обычно.

> `message.imageUrl` — это то самое поле, которое сервер добавил
> в ШАГЕ 3: `message.imageUrl = '/uploads/' + req.file.filename;`
> Браузер увидит `<img src="/uploads/abc.jpg">` и сам запросит картинку
> у сервера (который мы настроили в ШАГЕ 2).

---

## Что в итоге должно получиться

### На сервере (server.js)

```js
// Вверху — подключения
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Конфигурация Multer
const storage = multer.diskStorage({ ... });  // куда и как сохранять
const upload = multer({ storage, limits, fileFilter });  // настройки

// Раздача файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Маршрут с загрузкой
app.post('/api/messages', upload.single('image'), function (req, res) {
  ...
  if (req.file) message.imageUrl = '/uploads/' + req.file.filename;
  ...
});

// Обработка ошибок
app.use(function (err, req, res, next) { ... });
```

### На фронтенде (HTML + JS)

```html
<!-- Кнопка-скрепка перед textarea -->
<label class="btn-attach">📎
  <input type="file" id="file-input" accept="image/*" hidden>
</label>
<textarea id="msg-input"></textarea>
<button>Отправить</button>
```

```js
// Отправка с FormData если есть файл
if (file) {
  var formData = new FormData();
  formData.append('image', file);
  formData.append('text', text);
  fetch('/api/messages', { method: 'POST', body: formData });
}

// Отрисовка — <img> если есть imageUrl
if (message.imageUrl) {
  content += '<img class="chat-image" src="' + message.imageUrl + '">';
}
```

---

## Частые проблемы

### Картинка не появляется

1. Проверь что папка `uploads/` создана
2. Проверь что `app.use('/uploads', express.static(...))` написан
3. Открой URL картинки напрямую в браузере: `http://localhost:3000/uploads/имя-файла.jpg`
4. Если 404 — проблема с раздачей статики. Если файл не найден на диске — проблема с сохранением

### Ошибка "Multipart: Boundary not found"

Ты поставил `Content-Type: application/json` при отправке FormData.
Убери заголовок Content-Type — браузер сам поставит правильный.

### Ошибка на сервере "req.file is undefined"

1. Проверь что `upload.single('image')` добавлен в маршрут
2. Проверь что на клиенте имя поля совпадает: `formData.append('image', file)`
3. Оба имени должны быть `'image'` — одинаковыми!

### Файл слишком большой

Измени лимит в настройках Multer:
```js
limits: { fileSize: 20 * 1024 * 1024 }  // 20 МБ вместо 10
```

### Хочу отправлять через WebSocket, а не HTTP

WebSocket не умеет отправлять файлы напрямую. Варианты:

1. **Лучший вариант:** отправляй файл через HTTP POST (как описано),
   а потом отправь сообщение «файл загружен» через WebSocket.
   Так делает большинство чатов.

2. **Простой но медленный вариант:** на клиенте конвертируй файл в base64
   и отправь как строку через WebSocket:
   ```js
   var reader = new FileReader();
   reader.onload = function() {
     ws.send(JSON.stringify({
       type: 'message',
       content: '',         // текст
       imageBase64: reader.result   // "data:image/jpeg;base64,..."
     }));
   };
   reader.readAsDataURL(file);
   ```
   Минус: base64 на 33% больше по размеру.
   Минус: все данные проходят через WebSocket сервер, а не через отдельный сервис.

---

## Словарь терминов

| Термин | Что значит |
|---|---|
| **Multer** | Пакет для Node.js, который принимает файлы от браузера |
| **FormData** | Объект в JavaScript для отправки файлов на сервер |
| **multipart/form-data** | Формат HTTP-запроса для передачи файлов |
| **req.file** | Объект с информацией о файле (после Multer) |
| **req.body** | Текстовые поля формы |
| **express.static** | Функция Express для раздачи файлов из папки |
| **diskStorage** | Настройка Multer: сохранять файлы на диск |
| **memoryStorage** | Настройка Multer: хранить файлы в памяти (req.file.buffer) |

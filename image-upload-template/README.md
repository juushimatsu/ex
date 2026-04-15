# Как добавить загрузку картинок в свой чат

Это инструкция для тех, кто плохо разбирается в Node.js.
Каждый шаг объяснён простым языком: **что сделать**, **где именно** и **почему**.

---

## Что мы вообще делаем?

Сейчас твой чат умеет отправлять только текст. Мы добавим кнопку «скрепка»,
чтобы пользователь мог выбрать картинку на компьютере, и она появилась в чате.

Это работает так:

```
Пользователь нажал «скрепка»
  → Выбрал файл на компьютере
  → Нажал «Отправить»
  → Браузер отправил файл на сервер
  → Сервер сохранил файл в папку uploads/
  → Сервер вернул ответ с адресом файла
  → Браузер показал картинку в чате
```

---

## Что нужно установить

В терминале, в папке твоего проекта, выполни:

```
npm install multer
```

**Multer** — это библиотека (плагин) для Express, которая умеет принимать файлы
от браузера. Без неё Express не понимает, что делать с отправленным файлом.

---

## Нужно создать папку uploads

В папке твоего проекта создай папку `uploads`. Туда будут падать картинки.

Если папки не будет — сервер упадёт с ошибкой при попытке сохранить файл.

---

## ШАГ 1: Подключить multer на сервере

Открой свой файл сервера (обычно `server.js`).

Найди место, где у тебя написаны строки `const ... = require(...)` — это
самое начало файла, где подключаются библиотеки.

Там уже есть что-то вроде:
```js
const express = require('express');
```

**Добавь после всех таких строк:**

```js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
```

**Что это значит:**
- `multer` — та самая библиотека для приёма файлов
- `path` — встроенная в Node.js утилита для работы с путями к файлам
- `crypto` — встроенная утилита для генерации случайных имён файлов

---

## ШАГ 2: Настроить multer на сервере

Сразу после строк из Шага 1 добавь **целиком** этот блок:

```js
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(8).toString('hex');
    cb(null, randomName + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.indexOf(file.mimetype) !== -1) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения (JPEG, PNG, GIF, WebP)'));
    }
  },
});
```

**Что это значит простым языком:**

| Строка | Что делает |
|---|---|
| `destination: ...` | Куда сохранять файл — в папку `uploads/` |
| `filename: ...` | Под каким именем — генерируем случайное, чтобы файлы не перезаписывали друг друга. Расширение (.jpg, .png) сохраняется |
| `limits: { fileSize: 10 * 1024 * 1024 }` | Максимальный размер файла — 10 мегабайт. Если больше — будет ошибка |
| `fileFilter: ...` | Проверяем, что это именно картинка (не .exe, не .pdf). Разрешаем только JPEG, PNG, GIF, WebP |

---

## ШАГ 3: Разрешить серверу отдавать картинки

Когда картинка сохранена в папку `uploads/`, браузер должен как-то её получить.
Нужно сказать Express: «если кто-то просит файл из uploads/ — отдай его».

Найди в сервере строку:
```js
app.use(express.json());
```

**Добавь после неё:**

```js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

**Что это значит:** Если браузер запросит адрес вроде `/uploads/a1b2c3.jpg`,
Express автоматически найдёт этот файл в папке `uploads/` и отдаст его.
Нам не нужно писать отдельный маршрут для каждого файла.

---

## ШАГ 4: Добавить маршрут для отправки сообщения с картинкой

Это самый важный шаг. Нужно создать обработчик, который принимает и текст,
и файл одновременно.

Найди в своём сервере маршрут, где обрабатывается отправка сообщения.
Он выглядит примерно так:

```js
app.post('/api/messages', function (req, res) {
  // ...
});
```

**Замени его** на такой (или добавь, если такого нет):

```js
app.post('/api/messages', upload.single('image'), function (req, res) {
  //     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //     КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: добавили upload.single('image')
  //     Это говорит: "ожидай один файл в поле с именем 'image'"

  var text = (req.body.text || '').trim();
  var hasImage = !!req.file;   // req.file — информация о загруженном файле
                               // Если файл не отправили — req.file будет undefined

  if (!text && !hasImage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  var message = {
    id: crypto.randomBytes(4).toString('hex'),
    text: text,
    timestamp: Date.now(),
  };

  // Если картинка прикреплена — добавляем её адрес в сообщение
  if (hasImage) {
    // req.file.filename — это то самое случайное имя, которое сгенерировал multer
    // Например: "a1b2c3d4e5f6.jpg"
    // Адрес "/uploads/a1b2c3d4e5f6.jpg" браузер сможет загрузить как картинку
    message.imageUrl = '/uploads/' + req.file.filename;
  }

  // Сохрани message в свой массив/базу данных
  // chatMessages.push(message);   ← раскомментируй или замени на свой код

  res.status(201).json(message);
});
```

**Разбор полей `req.file`:**

Когда файл загружен, `req.file` содержит:

```
req.file = {
  fieldname:   'image',                  — имя поля формы
  originalname: 'скриншот проблемы.jpg',  — как файл назывался у пользователя
  filename:     'a1b2c3d4e5f6.jpg',       — имя файла на диске (сгенерированное)
  path:         '/полный/путь/uploads/a1b2c3d4e5f6.jpg',
  size:         245678,                    — размер в байтах
  mimetype:     'image/jpeg',             — тип файла
}
```

Нам нужен только `req.file.filename` — чтобы построить URL картинки.

---

## ШАГ 5: Обработка ошибок Multer

Если файл слишком большой или это не картинка — Multer выдаст ошибку.
Нужно её перехватить, иначе сервер упадёт.

**Добавь в конец файла сервера**, перед `app.listen(...)`:

```js
app.use(function (err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Файл слишком большой (макс. 10 МБ)' });
  }
  if (err.message && err.message.indexOf('Только изображения') !== -1) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});
```

**Что это значит:** В Express функция с 4 параметрами `(err, req, res, next)` —
это обработчик ошибок. Он вызывается, если что-то пошло не так.
Мы проверяем тип ошибки и возвращаем понятное сообщение.

---

## ШАГ 6: Добавить кнопку «скрепка» в HTML

Открой свой HTML-файл чата.

Найди место, где у тебя панель ввода сообщения. Обычно это выглядит так:

```html
<div class="chat-input">
  <textarea id="msg-input" placeholder="Введите сообщение..."></textarea>
  <button onclick="sendMessage()">Отправить</button>
</div>
```

**Добавь перед `<textarea>` кнопку-скрепку:**

```html
<div class="chat-input">
  <!-- КНОПКА ПРИКРЕПЛЕНИЯ — НАЧАЛО -->
  <label class="btn-attach" title="Прикрепить картинку">
    📎
    <input type="file"
           accept="image/jpeg,image/png,image/gif,image/webp"
           id="file-input"
           onchange="showPreview()"
           hidden>
  </label>
  <!-- КНОПКА ПРИКРЕПЛЕНИЯ — КОНЕЦ -->

  <textarea id="msg-input" placeholder="Введите сообщение..."></textarea>
  <button onclick="sendMessage()">Отправить</button>
</div>
```

**Разбор:**

| Атрибут | Зачем |
|---|---|
| `<label>` | Когда пользователь кликает на скрепку, срабатывает `<input>` внутри. `<label>` связывает клик с `<input>` |
| `type="file"` | Это стандартный элемент выбора файла. Обычно он некрасивый, поэтому мы его прячем |
| `accept="image/jpeg,..."` | Ограничиваем выбор только картинками. В окне выбора файла не будет .exe, .doc и прочего |
| `id="file-input"` | Чтобы JavaScript мог найти этот элемент и взять выбранный файл |
| `onchange="showPreview()"` | Когда файл выбран — вызывается функция showPreview() (напишем ниже) |
| `hidden` | Прячем стандартный некрасивый элемент. Пользователь видит только скрепку 📎 |

---

## ШАГ 7: Добавить CSS для скрепки и картинок

Открой свой CSS (или тег `<style>` в HTML).

**Добавь эти стили:**

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

/* Картинка внутри сообщения чата */
.chat-image {
  max-width: 260px;
  max-height: 200px;
  border-radius: 6px;
  cursor: pointer;
  display: block;
  margin-top: 4px;
}
```

---

## ШАГ 8: Добавить JavaScript — отправка файла

Открой свой JavaScript-файл (обычно `client.js` или скрипт прямо в HTML).

Найди функцию `sendMessage()` (ту, что вызывается при нажатии «Отправить»).

**Замени её целиком** на такую:

```js
async function sendMessage() {
  // Находим элементы ввода
  var textInput = document.getElementById('msg-input');   // Твой textarea
  var fileInput = document.getElementById('file-input');  // Наш <input type="file">
  var text = textInput.value.trim();
  var file = fileInput.files && fileInput.files[0];       // Выбранный файл (или undefined)

  if (!text && !file) return;   // Нечего отправлять

  if (file) {
    // =============================================
    //  ОТПРАВЛЯЕМ ФАЙЛ (с картинкой или без текста)
    // =============================================
    //
    // FormData — это специальный объект для отправки файлов.
    // Он формирует формат multipart/form-data —
    // единственный формат, через который браузер может
    // отправить файл на сервер.
    //
    var formData = new FormData();

    // Добавляем файл в FormData
    // 'image' — это имя поля. ОНО ДОЛЖНО СОВПАДАТЬ
    // с тем, что написано на сервере: upload.single('image')
    formData.append('image', file);

    // Текст тоже можно добавить в FormData
    formData.append('text', text);

    // Отправляем
    //
    // ⚠ ВАЖНО: НЕ добавляй Content-Type!
    // Браузер сам поставит правильный заголовок
    // с границей (boundary), которая нужна для
    // разделения частей в multipart/form-data
    //
    var res = await fetch('/api/messages', {
      method: 'POST',
      body: formData,          // ← FormData, НЕ JSON.stringify!
    });

    if (!res.ok) {
      var err = await res.json();
      alert(err.error || 'Ошибка отправки');
      return;
    }

  } else {
    // =============================================
    //  ОТПРАВЛЯЕМ ТОЛЬКО ТЕКСТ (без файла)
    // =============================================
    //
    // Это обычный JSON-запрос, как было раньше
    //
    var res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });

    if (!res.ok) {
      var err = await res.json();
      alert(err.error || 'Ошибка отправки');
      return;
    }
  }

  // Очищаем поля ввода
  textInput.value = '';
  fileInput.value = '';       // Сбрасываем выбранный файл

  // Обновляем список сообщений
  // loadMessages();   ← раскомментируй свою функцию загрузки
}
```

**Главное, что нужно понять:**

Есть **два способа** отправить данные на сервер:

| Способ | Когда | Content-Type |
|---|---|---|
| `JSON.stringify({text: "..."})` | Только текст | `application/json` |
| `new FormData()` | Есть файл | `multipart/form-data` (браузер ставит сам) |

Когда отправляешь через FormData — **не ставь `Content-Type` вручную**.
Браузер автоматически поставит `multipart/form-data` с правильной границей.
Если поставишь сам — граница не попадёт в заголовок, и сервер не сможет
разобрать запрос.

---

## ШАГ 9: Показать картинку в чате

Когда браузер получает список сообщений с сервера, в каждом сообщении
может быть поле `imageUrl` (адрес картинки). Нужно отобразить её.

Найди свою функцию, которая рисует одно сообщение в чате
(обычно называется `renderMsg` или что-то подобное).

Она, скорее всего, выглядит так:

```js
function renderMsg(m) {
  return '<div class="msg">' +
    esc(m.content) +
    '<div class="ts">' + fmtTime(m.timestamp) + '</div>' +
  '</div>';
}
```

**Замени на:**

```js
function renderMsg(m) {
  // Формируем содержимое сообщения
  var content = '';

  // Текст (если есть)
  if (m.content || m.text) {
    content += esc(m.content || m.text);
  }

  // Картинка (если есть)
  if (m.imageUrl) {
    content += '<img class="chat-image" src="' + m.imageUrl + '" alt="Изображение">';
  }

  return '<div class="msg ' + (m.sender || '') + '">' +
    '<div class="from">' + (m.sender === 'client' ? 'Вы' : 'Агент') + '</div>' +
    content +
    '<div class="ts">' + fmtTime(m.timestamp) + '</div>' +
  '</div>';
}
```

**Что происходит:**

1. Проверяем `m.imageUrl` — если сервер вернул адрес картинки
2. Рисуем тег `<img>` с этим адресом
3. Класс `chat-image` задаёт размер (260×200 макс) и скругление
4. Браузер автоматически запросит картинку по адресу `/uploads/...`
5. Express (из Шага 3) отдаст файл из папки

---

## ШАГ 10 (опциональный): Превью файла перед отправкой

Хорошая практика — показать пользователю, какой файл он выбрал,
до того как он нажмёт «Отправить».

**Добавь в HTML** (после панели ввода, но до закрывающего `</div>`):

```html
<div id="preview-bar" style="display:none; padding:8px 0; align-items:center; gap:10px; font-size:13px; color:#475569;">
  <img id="preview-thumb" src="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;">
  <span id="preview-name"></span>
  <span onclick="clearFile()" style="cursor:pointer;font-size:18px;color:#94a3b8;">✕</span>
</div>
```

**Добавь в JavaScript:**

```js
// Показать превью выбранного файла
function showPreview() {
  var input = document.getElementById('file-input');
  if (!input.files || !input.files[0]) return;

  var file = input.files[0];

  // Проверка размера (дублирует серверную, но даёт быструю обратную связь)
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой (макс. 10 МБ)');
    input.value = '';
    return;
  }

  // URL.createObjectURL создаёт временный адрес для файла в памяти браузера
  // Он работает только пока страница открыта
  document.getElementById('preview-thumb').src = URL.createObjectURL(file);
  document.getElementById('preview-name').textContent = file.name;
  document.getElementById('preview-bar').style.display = 'flex';
}

// Убрать превью (пользователь нажал ✕)
function clearFile() {
  document.getElementById('file-input').value = '';
  document.getElementById('preview-bar').style.display = 'none';
}
```

И в функции `sendMessage()` добавь очистку превью после отправки:

```js
  // (в конце функции sendMessage, после успешной отправки)
  document.getElementById('preview-bar').style.display = 'none';
```

---

## Итого: что куда добавлять

```
server.js
├── ШАГ 1: require('multer'), require('path'), require('crypto')    ← начало файла
├── ШАГ 2: const storage = ... ; const upload = ...                ← после Шага 1
├── ШАГ 3: app.use('/uploads', express.static(...))                ← после app.use(express.json())
├── ШАГ 4: app.post('/api/messages', upload.single('image'), ...)  ← маршруты
└── ШАГ 5: app.use(function(err, req, res, next) {...})            ← перед app.listen()

HTML файл
└── ШАГ 6: <label class="btn-attach"> с <input type="file">       ← перед textarea

CSS (или <style>)
├── .btn-attach { ... }                                            ← стили кнопки
└── .chat-image { ... }                                            ← стили картинки

JavaScript файл
├── ШАГ 8:  sendMessage() с FormData                               ← замена старой функции
├── ШАГ 9:  renderMsg() с <img>                                    ← замена старой функции
└── ШАГ 10: showPreview(), clearFile()                              ← новые функции
```

---

## Если что-то не работает

| Проблема | Причина | Решение |
|---|---|---|
| Ошибка «Папка не найдена» при загрузке | Нет папки `uploads/` | Создай папку `uploads` в корне проекта |
| Файл отправляется, но картинки нет в чате | Не проверяешь `m.imageUrl` в renderMsg | Добавь проверку из Шага 9 |
| Ошибка 500 при отправке файла | Забыл `upload.single('image')` в маршруте | Добавь из Шага 4 |
| Ошибка «Multipart: Boundary not found» | Поставил Content-Type вручную с FormData | Убери Content-Type из fetch с FormData |
| Картинка не отображается (сломанная иконка) | Не добавил `app.use('/uploads', ...)` | Добавь из Шага 3 |
| Файл не выбирается при клике на скрепку | `<input>` не внутри `<label>` | Положи `<input type="file">` внутрь `<label>` |
| req.file = undefined на сервере | В FormData другое имя поля | Проверь: `formData.append('image', file)` должно совпадать с `upload.single('image')` |

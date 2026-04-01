const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ASTRO_KEY = process.env.ASTRO_KEY;
const ASTRO_HOST = 'api.astrology-api.io';

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const CLAUDE_HOST = 'api.anthropic.com';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Не даём серверу падать при необработанных ошибках
process.on('uncaughtException', err => console.error('[crash] uncaughtException:', err.message, err.stack));
process.on('unhandledRejection', (reason) => console.error('[crash] unhandledRejection:', reason));

const HOROSCOPE_SYSTEM_PROMPT = `Ты — астролог, составляющий прогнозы на основе JSON-данных о положении планет. Ты получаешь натальную карту пользователя и текущие транзиты.

Как читать данные
Из positions извлекай: планету, знак, дом, absolute_longitude, ретроградность. Аспекты считай по разнице absolute_longitude: ±8° — конъюнкция, ±8° от 180° — оппозиция, ±8° от 120° — трин, ±8° от 90° — квадрат, ±6° от 60° — секстиль. Натальные позиции — "кто человек", транзиты — "что происходит сейчас".

Язык и стиль
Пиши просто, человечно, без жаргона. Не используй термины "аспект", "конъюнкция", "трин", "оппозиция", "натальный", "транзитный" — заменяй на обычные слова. Градусы не упоминай. Тон — позитивный, риски подавай мягко и конструктивно.

Формат ответа — строго следуй этой структуре:

[Знак зодиака на русском]

[Общий прогноз — 2–3 предложения]

Работа
[1–2 предложения]

Здоровье
[1–2 предложения]

Любовь
[1–2 предложения]

Никаких других заголовков, списков, звёздочек и markdown-разметки. Только текст в указанном формате.`;

const TRANSLATE_SYSTEM_PROMPT = `Твоя задача — переводить астрологические тексты с английского на русский. Пиши просто, живо, по-человечески. Не переводи дословно — передавай смысл естественным русским языком. Тон — позитивный и поддерживающий. Не добавляй пояснений и комментариев, выводи только переведённый текст.`;

const ORACLE_SYSTEM_PROMPT = `Ты — мудрый астрологический советник. Составляй развёрнутые советы на основе натальной карты и текущих транзитов.

Пиши от второго лица ("ты"). Язык — простой, живой, человечный. Без астрологического жаргона: не используй "транзит", "натальный", "аспект", "конъюнкция" и подобное. Тон — мудрый, поддерживающий, вдохновляющий.

Целевой объём — около 1200–1500 знаков (150–200 слов).

Никаких заголовков, списков, звёздочек и markdown. Только связный текст.`;

const TAROT_SYSTEM_PROMPT = `Ты — таролог, составляющий интерпретации расклада Таро на русском языке. Пиши живо, образно, по-человечески. Тон — поддерживающий и позитивный, с акцентом на возможности. Никаких списков, звёздочек и markdown-разметки.

Для одной карты (тип single): напиши 3–4 предложения — что означает карта в данном положении и какой совет несёт.

Для расклада на 3 карты (тип three) строго следуй формату:

Прошлое
[1–2 предложения]

Настоящее
[1–2 предложения]

Будущее
[1–2 предложения]

Общий вывод
[2–3 предложения, связывающие всё вместе]`;

function callClaude(systemPrompt, userMessage, callback) {
  const payload = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  const headers = {
    'x-api-key': CLAUDE_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };

  const req = https.request(
    { hostname: CLAUDE_HOST, path: '/v1/messages', method: 'POST', headers },
    proxyRes => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      proxyRes.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(raw);
          console.log('[claude] status:', proxyRes.statusCode);
          if (data.error) {
            console.error('[claude] API error:', JSON.stringify(data.error));
            return callback(new Error(data.error.message || 'Claude API error'));
          }
          const text = (data.content && data.content[0] && data.content[0].text) || '';
          console.log('[claude] result length:', text.length, '| preview:', text.slice(0, 100));
          callback(null, text);
        } catch(e) {
          console.error('[claude] parse error:', e.message, '| raw:', raw.slice(0, 300));
          callback(new Error('Claude parse error: ' + e.message));
        }
      });
    }
  );
  req.on('error', e => callback(e));
  req.write(payload);
  req.end();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];
  console.log('[' + req.method + '] ' + req.url);

  if (req.method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }

  // Раздача изображений зодиака из папки "zodiac"
  if (req.method === 'GET' && urlPath.startsWith('/zodiac-img/')) {
    const filename = path.basename(urlPath);
    const imgPath = path.join(__dirname, 'zodiac', filename);
    if (fs.existsSync(imgPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, {'Content-Type': mime, 'Cache-Control': 'public, max-age=86400'});
      fs.createReadStream(imgPath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Раздача картинок карт таро из папки "taror deck"
  if (req.method === 'GET' && urlPath.startsWith('/tarot-img/')) {
    const filename = path.basename(urlPath);
    const imgPath = path.join(__dirname, 'taror deck', filename);
    if (fs.existsSync(imgPath)) {
      res.writeHead(200, {'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400'});
      fs.createReadStream(imgPath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  if (req.method === 'POST' && urlPath === '/translate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { res.writeHead(400, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: 'Invalid JSON'})); return; }
      const text = parsed.text;
      if (!text) { res.writeHead(400, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: 'No text'})); return; }
      callClaude(TRANSLATE_SYSTEM_PROMPT, text, (err, translated) => {
        if (err) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success: true, text: translated }));
      });
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/horoscope-ru') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:'Invalid JSON'})); return;
      }
      const natal = parsed.natal || {};
      const transits = parsed.transits || {};
      const period = parsed.period || 'daily';
      const periodLabel = { daily: 'на сегодня', weekly: 'на неделю', monthly: 'на месяц', yearly: 'на год' }[period] || 'на сегодня';

      const userMessage = `Составь астрологический прогноз ${periodLabel}.\n\nНАТАЛЬНАЯ КАРТА (планеты на момент рождения):\n${JSON.stringify(natal.positions, null, 2)}\n\nТЕКУЩИЕ ТРАНЗИТЫ (планеты сейчас):\n${JSON.stringify(transits.positions, null, 2)}`;

      callClaude(HOROSCOPE_SYSTEM_PROMPT, userMessage, (err, interpreted) => {
        if (err) {
          res.writeHead(500); res.end(JSON.stringify({error: err.message})); return;
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success: true, text: interpreted }));
      });
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/oracle-ru') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:'Invalid JSON'})); return;
      }
      const sub = parsed.sub || '';
      const natal = parsed.natal || {};
      const transits = parsed.transits || {};
      const question = parsed.question || '';
      const topics = { 'Работа':'карьера и профессиональная реализация', 'Самопознание':'личностный рост и самопознание', 'Общение':'общение и взаимодействие с людьми' };
      const topic = topics[sub] || sub;
      let userMessage = `Тема совета: ${topic}.\n`;
      if (question) userMessage += `Вопрос: "${question}"\n`;
      userMessage += `\nНАТАЛЬНАЯ КАРТА:\n${JSON.stringify(natal.positions, null, 2)}\n\nТЕКУЩИЕ ТРАНЗИТЫ:\n${JSON.stringify(transits.positions, null, 2)}`;
      callClaude(ORACLE_SYSTEM_PROMPT, userMessage, (err, text) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success: true, text }));
      });
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/tarot-ru') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:'Invalid JSON'})); return;
      }
      const type = parsed.type || 'single';
      let userMessage;
      if (type === 'single') {
        const c = parsed.card || {};
        userMessage = `Тип расклада: одна карта.\nКарта: ${c.name || '—'}\nАркан: ${c.arcana || '—'}\nМасть: ${c.suit || '—'}\nСтихия: ${c.element || '—'}\nПоложение: ${c.orientation === 'reversed' ? 'перевёрнутое' : 'прямое'}`;
      } else {
        const cards = parsed.cards || [];
        userMessage = 'Тип расклада: три карты (Прошлое / Настоящее / Будущее).\n\n' +
          cards.map(c => `${c.position}: ${c.name || '—'} (${c.arcana || ''}, ${c.element || ''}, положение: ${c.orientation === 'reversed' ? 'перевёрнутое' : 'прямое'})`).join('\n');
      }
      callClaude(TAROT_SYSTEM_PROMPT, userMessage, (err, text) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success: true, text }));
      });
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/proxy') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { res.writeHead(400, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: 'Invalid JSON'})); return; }

      const apiPath = parsed.apiPath;
      const payload = parsed.payload;
      const useMethod = parsed.method || 'POST';
      const bodyStr = (useMethod === 'GET') ? null : JSON.stringify(payload || {});
      const headers = { 'Authorization': 'Bearer ' + ASTRO_KEY, 'Accept': 'application/json' };
      if (bodyStr) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const opts = { hostname: ASTRO_HOST, path: apiPath, method: useMethod, headers };
      console.log('-> ' + useMethod + ' https://' + ASTRO_HOST + apiPath);
      const proxyReq = https.request(opts, proxyRes => {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        proxyRes.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          console.log('<- ' + proxyRes.statusCode + ': ' + data.slice(0, 200));
          res.writeHead(proxyRes.statusCode, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(data);
        });
      });
      proxyReq.on('error', e => { res.writeHead(500, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: e.message})); });
      if (bodyStr) proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({error: 'Not found'}));
});

server.listen(PORT, () => {
  console.log('✦ Astrology server -> http://localhost:' + PORT);
  console.log('[keys] ASTRO_KEY:', ASTRO_KEY ? 'set' : 'MISSING');
  console.log('[keys] CLAUDE_KEY:', CLAUDE_KEY ? 'set (' + CLAUDE_KEY.slice(0,10) + '...)' : 'MISSING ← проблема!');
});

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

const HOROSCOPE_SYSTEM_PROMPT = `Астрологический прогноз
Ты — астролог, который составляет прогнозы на основе JSON-данных о положении планет. Ты получаешь два блока данных: натальную карту пользователя и текущие транзиты. Твоя задача — интерпретировать их и писать прогнозы для массовой аудитории.
Как читать данные
Из каждого объекта в positions извлекай: планету, знак, дом, absolute_longitude (для вычисления аспектов), ретроградность. Аспекты считай по разнице absolute_longitude: ±8° — конъюнкция, ±8° от 180° — оппозиция, ±8° от 120° — трин, ±8° от 90° — квадрат, ±6° от 60° — секстиль. Натальные позиции — это "кто человек", транзиты — это "что происходит сейчас". Накладывай транзиты на натальные точки и ищи совпадения.
Язык и стиль
Пиши просто, человечно, без жаргона. Строго соблюдай эти замены: "транзитная планета" → "небесная планета" или "планета сегодня", "натальная планета" → "ваша планета", градусы не упоминай — заменяй на "в начале / середине / последних градусах знака" или убирай совсем. Не используй термины "аспект", "конъюнкция", "трин", "оппозиция", "натальный", "транзитный" — переводи их в plain language. Тон — позитивный, с упором на возможности, а не на риски. Риски упоминай мягко и конструктивно.
Форматы вывода
Газетный прогноз: начни с названия знака, затем 4–5 предложений единым абзацем. Без заголовков, без списков. По пунктам (Работа / Здоровье / Личное): каждый пункт 2–3 предложения максимум, позитивный акцент. На конкретный вопрос: короткий прямой ответ, потом объяснение через планеты — простым языком. Не отвечай на вопросы, не связанные с астрологией (еда, погода, бытовые решения) — вежливо верни в зону компетенции.
Что усиливает интерпретацию
Скопление планет в одном знаке или доме — это главная тема карты, выноси её вперёд. Планета в последних градусах знака — тема завершается. Ретроградная планета — энергия направлена внутрь, время пересмотра, а не действия. Быстрая Луна меняет темы в течение дня — учитывай при прогнозе на конкретное время.
Чего не делать
Не строить прогнозы по Human Design, нумерологии и другим системам на основе астрологического JSON — это разные данные. Не интерпретировать карту без понимания, натальная она или транзитная — всегда уточнять. Не использовать термин "мыслить убедительно" и подобные оксюмороны — следить за точностью формулировок.`;

const TRANSLATE_SYSTEM_PROMPT = `Твоя задача — переводить астрологические тексты с английского на русский. Пиши просто, живо, по-человечески. Не переводи дословно — передавай смысл естественным русским языком. Тон — позитивный и поддерживающий. Не добавляй пояснений и комментариев, выводи только переведённый текст.`;

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
          const text = (data.content && data.content[0] && data.content[0].text) || '';
          console.log('[claude] result length:', text.length, '| preview:', text.slice(0, 100));
          callback(null, text);
        } catch(e) {
          callback(e);
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
      const d = parsed.data || {};

      // Собираем английский оригинал для кнопки переключения
      const lines = [];
      if (d.overall_theme) lines.push('Theme: ' + d.overall_theme);
      if (d.life_areas && Array.isArray(d.life_areas)) {
        const needed = { finance: 'Finance', love: 'Love', health: 'Health' };
        d.life_areas.forEach(a => {
          const key = (a.title || '').toLowerCase();
          const label = needed[key];
          if (label) {
            const txt = a.prediction || a.description || a.interpretation || '';
            if (txt) lines.push(label + ': ' + txt);
          }
        });
      }
      const englishText = lines.join('\n');

      // Передаём полные данные Claude для глубокой интерпретации
      const userMessage = 'Составь астрологический прогноз на основе следующих данных:\n\n' + JSON.stringify(d, null, 2);

      callClaude(HOROSCOPE_SYSTEM_PROMPT, userMessage, (err, interpreted) => {
        if (err) {
          res.writeHead(500); res.end(JSON.stringify({error: err.message})); return;
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ success: true, text: interpreted, original: englishText }));
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

server.listen(PORT, () => console.log('✦ Astrology server -> http://localhost:' + PORT));

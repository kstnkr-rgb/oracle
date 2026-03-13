const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ASTRO_KEY = process.env.ASTRO_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const ASTRO_HOST = 'api.astrology-api.io';
const OR_HOST = 'openrouter.ai';

const GROQ_KEY = process.env.GROQ_KEY;
const GROQ_HOST = 'api.groq.com';

function translateViaGroq(text, res) {
  const payload = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content: `Твоя задача — преобразовывать входящий текст прогноза на английском языке в понятный и живой текст прогноза на русском.

Правила работы:
1. Не переводить текст дословно. Смысл нужно сохранить, но формулировки должны звучать естественно для русского языка.
2. Текст должен читаться как прогноз, написанный человеком, а не машиной.
3. Избегай канцелярита, сложных конструкций и «ИИ-стиля».
4. Используй простые и естественные формулировки, как в современных медиа или блогах.
5. Сохраняй структуру прогноза, но при необходимости можешь слегка перефразировать предложения для лучшей читаемости.
6. Тон текста всегда должен быть позитивным и поддерживающим. Даже если прогноз сложный, подавай его мягко и конструктивно.
7. Не добавляй объяснений, комментариев или анализа — выводи только готовый текст прогноза.
8. Не упоминай, что текст был переведен или переписан.
9. Пиши плавно, избегая повторов и шаблонных фраз.
10. Используй литературный русский, но без излишней формальности.

Дополнительные требования:
- текст должен звучать живо
- предложения средней длины
- допускаются лёгкие разговорные элементы
- избегать штампов вроде «данный период», «следует ожидать», «в рамках»

Формат ответа: выводи только итоговый текст прогноза на русском языке.`
      },
      { role: 'user', content: text }
    ],
    max_tokens: 4000,
    temperature: 0.3
  });

  const headers = {
    'Authorization': 'Bearer ' + GROQ_KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };

  const req = https.request(
    { hostname: GROQ_HOST, path: '/openai/v1/chat/completions', method: 'POST', headers },
    proxyRes => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      proxyRes.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(raw);
          console.log('[translate] Groq status:', proxyRes.statusCode);
          console.log('[translate] Groq response:', JSON.stringify(data).slice(0, 300));
          const translated = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
          console.log('[translate] result length:', translated.length, '| preview:', translated.slice(0, 100));
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ success: true, text: translated }));
        } catch(e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
    }
  );
  req.on('error', e => {
    res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ success: false, error: e.message }));
  });
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
      translateViaGroq(text, res);
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
      // Собираем весь текст гороскопа в читаемый английский текст
      const lines = [];
      if (d.overall_theme) lines.push('Theme: ' + d.overall_theme);
      if (d.summary) lines.push('Summary: ' + d.summary);
      if (d.advice) lines.push('Advice: ' + d.advice);
      if (d.moon && d.moon.phase) lines.push('Moon: ' + d.moon.phase + (d.moon.sign ? ' in ' + d.moon.sign : '') + (d.moon.prediction ? '. ' + d.moon.prediction : ''));
      if (d.void_of_course_moon && d.void_of_course_moon.advice) lines.push('Moon warning: ' + d.void_of_course_moon.advice);
      if (d.life_areas && Array.isArray(d.life_areas)) {
        d.life_areas.forEach(a => {
          const txt = a.prediction || a.description || a.interpretation || '';
          if (txt) lines.push((a.title||'Area') + ': ' + txt);
        });
      }
      const tips = d.tips || d.daily_tips || [];
      if (tips.length) {
        const tipTexts = tips.map(t => typeof t === 'string' ? t : (t.text||t.tip||'')).filter(Boolean);
        if (tipTexts.length) lines.push('Tips: ' + tipTexts.join(' | '));
      }
      if (d.lucky_elements) {
        const le = d.lucky_elements;
        if (le.colors && le.colors.length) lines.push('Lucky colors: ' + le.colors.join(', '));
        if (le.stones && le.stones.length) lines.push('Lucky stones: ' + le.stones.join(', '));
        if (le.numbers && le.numbers.length) lines.push('Lucky numbers: ' + le.numbers.join(', '));
        if (le.hours && le.hours.length) lines.push('Lucky hours: ' + le.hours.join(', '));
      }

      const prompt = `Преобразуй этот гороскоп в живой русский текст. Пиши абзацами, без заголовков разделов. В самом конце — отдельными строками укажи элементы удачи если они есть: цвета, камни, числа, часы.\n\n` + lines.join('\n');

      translateViaGroq(prompt, res);
    });
    return;
  }


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

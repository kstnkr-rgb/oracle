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
        content: 'Your task is to transform incoming forecast text written in English into a natural and easy-to-read forecast in Russian. Do not translate the text word for word; instead, preserve the meaning while rewriting it so it sounds like it was originally written in Russian by a human. The wording should be simple, natural, and lively, similar to the style used in modern media or blogs. Avoid bureaucratic language, complex constructions, and typical "AI-style" phrasing. You may slightly rephrase sentences or adjust the structure if needed to improve readability, but the overall meaning of the forecast must remain the same. The tone must always stay positive and supportive: even if the forecast contains challenges, present them gently and constructively. Write smoothly, avoid repetition and cliché phrases, and keep sentences of moderate length. Use standard Russian without excessive formality, and light conversational elements are acceptable. Do not use phrases like "данный период", "следует ожидать", or "в рамках". Do not add explanations, comments, or analysis, and do not mention translation or rewriting. Output only the final forecast text in Russian.'
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
      // Собираем только нужные поля
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
      const prompt = `Translate the following forecast from English to Russian. Keep the structure exactly as is: translate each label before the colon and the text after it. One line per item. Each translated line (after the colon) must be no longer than 150 characters including spaces. Output only the translated text.\n\n` + englishText;

      // Переводим и возвращаем оба текста
      const origRes = { englishText };
      const payload2 = JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are a professional translator. Translate text from English to Russian accurately and naturally.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000,
        temperature: 0.3
      });
      const headers2 = {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload2)
      };
      const req2 = https.request(
        { hostname: GROQ_HOST, path: '/openai/v1/chat/completions', method: 'POST', headers: headers2 },
        proxyRes2 => {
          const chunks2 = [];
          proxyRes2.on('data', c => chunks2.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          proxyRes2.on('end', () => {
            try {
              const data2 = JSON.parse(Buffer.concat(chunks2).toString('utf8'));
              const translated = (data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content) || '';
              res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
              res.end(JSON.stringify({ success: true, text: translated, original: englishText }));
            } catch(e) {
              res.writeHead(500); res.end(JSON.stringify({error: e.message}));
            }
          });
        }
      );
      req2.on('error', e => { res.writeHead(500); res.end(JSON.stringify({error: e.message})); });
      req2.write(payload2);
      req2.end();
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

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ASTRO_KEY = process.env.ASTRO_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const ASTRO_HOST = 'api.astrology-api.io';
const OR_HOST = 'openrouter.ai';

function translateViaOpenRouter(text, res) {
  const payload = JSON.stringify({
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    messages: [
      {
        role: 'system',
        content: 'Ты профессиональный астролог и переводчик. Переведи текст с английского на русский язык.\nПравила:\n- Переводи точно, сохраняй смысл и астрологическую терминологию\n- Пиши живым, тёплым языком — как опытный астролог для клиента\n- Не добавляй ничего от себя, не сокращай и не расширяй текст\n- Верни ТОЛЬКО переведённый текст, без пояснений и предисловий'
      },
      { role: 'user', content: text }
    ],
    max_tokens: 2000
  });

  const headers = {
    'Authorization': 'Bearer ' + OPENROUTER_KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'HTTP-Referer': 'https://oracul.app',
    'X-Title': 'Oracul'
  };

  const req = https.request(
    { hostname: OR_HOST, path: '/api/v1/chat/completions', method: 'POST', headers },
    proxyRes => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      proxyRes.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(raw);
          console.log('[translate] status:', proxyRes.statusCode);
          console.log('[translate] OpenRouter response:', JSON.stringify(data).slice(0, 500));
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
      translateViaOpenRouter(text, res);
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

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ASTRO_KEY = process.env.ASTRO_KEY || 'ask_ab9c38a38bbaaf9a88931d74109449c6bb62b969533620d845e5fa4d605a8a33';
const CLAUDE_KEY = process.env.CLAUDE_KEY || '';
const ASTRO_HOST = 'astrology-api.io';
const CLAUDE_HOST = 'api.anthropic.com';

function postRequest(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve HTML
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Proxy to astrology-api.io
  if (req.method === 'POST' && req.url === '/proxy') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { apiPath, payload } = JSON.parse(body);
        console.log(`→ ASTRO POST ${apiPath}`);
        const r = await postRequest(ASTRO_HOST, apiPath,
          { 'Authorization': `Bearer ${ASTRO_KEY}` }, payload);
        console.log(`← ${r.status}`);
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(r.body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Claude interpretation
  if (req.method === 'POST' && req.url === '/interpret') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { positions, transits, name, sign, period } = JSON.parse(body);

        const apiKey = CLAUDE_KEY;
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'CLAUDE_KEY not set in environment' }));
          return;
        }

        const prompt = buildPrompt(positions, transits, name, sign, period);

        const r = await postRequest(CLAUDE_HOST, '/v1/messages', {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }, {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }]
        });

        const data = JSON.parse(r.body);
        const text = data.content?.[0]?.text || data.error?.message || 'Ошибка интерпретации';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function buildPrompt(positions, transits, name, sign, period) {
  const periodNames = { daily: 'на сегодня', weekly: 'на эту неделю', monthly: 'на этот месяц' };
  const periodLabel = periodNames[period] || 'на текущий период';

  let posStr = '';
  if (positions?.length) {
    posStr = '\nНатальные позиции:\n' + positions.map(p =>
      `  ${p.name}: ${p.sign} ${p.degree?.toFixed ? p.degree.toFixed(1) : p.degree}° дом ${p.house || '?'}${p.is_retrograde ? ' ℞' : ''}`
    ).join('\n');
  }

  let trStr = '';
  if (transits?.length) {
    trStr = '\nТекущие транзиты (активные планеты):\n' + transits.slice(0, 12).map(p =>
      `  ${p.name}: ${p.sign} ${p.degree?.toFixed ? p.degree.toFixed(1) : p.degree}°${p.is_retrograde ? ' ℞' : ''}`
    ).join('\n');
  }

  return `Ты опытный астролог. Составь персональный астрологический прогноз ${periodLabel} для ${name || 'человека'} (знак Солнца: ${sign || 'неизвестен'}).
${posStr}
${trStr}

Напиши прогноз на русском языке. Структура:
1. **Общая энергия периода** — 2-3 предложения об общем тоне и атмосфере
2. **Любовь и отношения** — что происходит в личной жизни
3. **Карьера и финансы** — рабочие и денежные темы  
4. **Здоровье и энергия** — физическое и эмоциональное состояние
5. **Совет периода** — одна конкретная рекомендация

Пиши живо, образно, без штампов. Опирайся на конкретные позиции планет из данных выше. Объём: 250-350 слов.`;
}

server.listen(PORT, () => console.log(`✦ Astrology server → http://localhost:${PORT}`));

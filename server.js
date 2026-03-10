const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ASTRO_KEY = process.env.ASTRO_KEY || 'ask_ab9c38a38bbaaf9a88931d74109449c6bb62b969533620d845e5fa4d605a8a33';
const ASTRO_HOST = 'astrology-api.io';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/proxy') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch(e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Invalid JSON'})); return; }

      const { apiPath, payload } = parsed;
      const bodyStr = JSON.stringify(payload);
      const opts = {
        hostname: ASTRO_HOST, path: apiPath, method: 'POST',
        headers: {
          'Authorization': `Bearer ${ASTRO_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      };
      console.log(`→ POST https://${ASTRO_HOST}${apiPath}`);
      const proxyReq = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', c => data += c);
        proxyRes.on('end', () => {
          console.log(`← ${proxyRes.statusCode}`);
          res.writeHead(proxyRes.statusCode, {'Content-Type':'application/json'});
          res.end(data);
        });
      });
      proxyReq.on('error', e => { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); });
      proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'Not found'}));
});

server.listen(PORT, () => console.log(`✦ Astrology server → http://localhost:${PORT}`));

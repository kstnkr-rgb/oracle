const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ASTRO_KEY = 'ask_ab9c38a38bbaaf9a88931d74109449c6bb62b969533620d845e5fa4d605a8a33';
const BASE_URL = 'api.astrology-api.io';

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Proxy API requests
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const apiPath = '/api/v3' + req.url.replace('/api', '');

      const options = {
        hostname: BASE_URL,
        path: apiPath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ASTRO_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      console.log(`→ Proxying POST https://${BASE_URL}${apiPath}`);

      const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          console.log(`← Response ${proxyRes.statusCode}`);
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      proxyReq.on('error', (e) => {
        console.error('Proxy error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✦ Astrology server running at http://localhost:${PORT}`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
});

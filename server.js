const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 8080
const ASTRO_KEY = process.env.ASTRO_KEY
const API_HOST = 'api.astrology-api.io'

const server = http.createServer((req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // serve frontend
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8'
    })

    res.end(html)
    return
  }

  // proxy
  if (req.method === 'POST' && req.url === '/proxy') {

    let body = ''

    req.on('data', chunk => body += chunk)

    req.on('end', () => {

      let parsed

      try {
        parsed = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      const { apiPath, payload, method } = parsed

      const reqMethod = method || 'POST'

      const bodyStr = JSON.stringify(payload || {})

const options = {
  hostname: API_HOST,
  path: apiPath,
  method: reqMethod,
  headers: {
    Authorization: `Bearer ${ASTRO_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr)
  }
}

      console.log(`→ ${reqMethod} https://${API_HOST}${apiPath}`)

      const proxyReq = https.request(options, proxyRes => {

        let data = ''

        proxyRes.on('data', chunk => data += chunk)

        proxyRes.on('end', () => {

          // если API вернул HTML ошибку — оборачиваем в JSON
          if (data.startsWith('<')) {
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              error: 'Astrology API returned HTML error',
              status: proxyRes.statusCode
            }))
            return
          }

          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' })
          res.end(data)
        })
      })

      proxyReq.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      })

if (reqMethod !== 'GET' && bodyStr) {
  proxyReq.write(bodyStr)
}

      proxyReq.end()

    })

    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))

})

/*
ВАЖНО
без 0.0.0.0 сервер доступен только внутри контейнера
*/

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Astrology server running on ${PORT}`)
})

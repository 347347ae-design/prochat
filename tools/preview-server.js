const http = require('http');
const fs = require('fs');
const path = require('path');

const roots = {
  '/__preview/': __dirname,
  '/': path.join(__dirname, '..', 'assets')
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const port = process.argv[2] ? Number(process.argv[2]) : 8765;

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  let root = roots['/'];
  let rel = p;
  if (p.startsWith('/__preview/')) {
    root = roots['/__preview/'];
    rel = p.slice('/__preview'.length);
  }
  const file = path.join(root, rel);
  if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log('preview on http://127.0.0.1:' + port));

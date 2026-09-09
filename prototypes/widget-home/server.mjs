import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const port = Number(process.env.EILO_PROTO_PORT || 41973);
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
  ['/layout.js', ['layout.js', 'text/javascript']], ['/hold.js', ['hold.js', 'text/javascript']], ['/fixtures.js', ['fixtures.js', 'text/javascript']],
  ['/assets/wallpaper.png', ['assets/wallpaper.png', 'image/png']],
]);
http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"prototype":true}'); }
  const file = files.get(path);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(new URL(file[0], root));
    res.writeHead(200, {
      'Content-Type': file[1] + (file[1].startsWith('text/') ? '; charset=utf-8' : ''),
      'Cache-Control': file[1].startsWith('image/') ? 'public, max-age=3600' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`eïlo widget prototype: http://127.0.0.1:${port}\nServing ${fileURLToPath(root)}\n`);
});

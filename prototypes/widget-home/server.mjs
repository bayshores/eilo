import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const port = Number(process.env.EILO_PROTO_PORT || 41973);
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
  ['/typography.css', ['typography.css', 'text/css']],
  ['/speech.css', ['speech.css','text/css']],
  ['/workspace-views.css', ['workspace-views.css','text/css']],
  ['/workspace-views.js', ['workspace-views.js','text/javascript']],
  ['/item-controls.css', ['item-controls.css','text/css']],
  ['/calendar-connection.css',['calendar-connection.css','text/css']],
  ['/calendar-connection.js',['calendar-connection.js','text/javascript']],
  ['/calendar-agenda.js',['calendar-agenda.js','text/javascript']],
  ['/item-controls.js', ['item-controls.js','text/javascript']],
  ['/task-edit.js', ['task-edit.js','text/javascript']],
  ['/goals-data.js', ['goals-data.js','text/javascript']],
  ['/home-data.js', ['home-data.js', 'text/javascript']],
  ['/home-client.js', ['home-client.js', 'text/javascript']],
  ['/home-live.js', ['home-live.js', 'text/javascript']],
  ['/home-live.css', ['home-live.css', 'text/css']],
  ['/assets/fonts/ibm-plex-sans.woff2', ['assets/fonts/ibm-plex-sans.woff2', 'font/woff2']],
  ['/layout.js', ['layout.js', 'text/javascript']], ['/hold.js', ['hold.js', 'text/javascript']], ['/fixtures.js', ['fixtures.js', 'text/javascript']],
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

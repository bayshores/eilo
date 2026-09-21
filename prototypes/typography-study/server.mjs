import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url),
  widgetRoot = new URL('../../web/', root);
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', widgetRoot), 'utf8'));
const contentTypes = {
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
  html: 'text/html',
};
const files = new Map([
  ['/', [new URL('index.html', root), 'text/html']],
  ...['study.css', 'typography.css', 'fonts.css'].map((name) => [
    '/' + name,
    [new URL(name, root), 'text/css'],
  ]),
  ...['study.js', 'frame.js'].map((name) => ['/' + name, [new URL(name, root), 'text/javascript']]),
  ...manifest.home.map((name) => [
    '/' + name,
    [new URL(name, widgetRoot), contentTypes[name.split('.').at(-1)]],
  ]),
  ['/styles.css', [new URL('baseline.css', root), 'text/css']],
  ...['source-sans-3', 'ibm-plex-sans', 'atkinson-next'].map((name) => [
    '/fonts/' + name + '.woff2',
    [new URL('fonts/' + name + '.woff2', root), 'font/woff2'],
  ]),
]);
http
  .createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    try {
      let body, mime;
      if (pathname === '/canvas') {
        body = (await readFile(new URL('baseline.html', root), 'utf8'))
          .replace('<html lang="en">', '<html lang="en" data-typography="a">')
          .replace(
            '</head>',
            '<link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/typography.css"><script type="module" src="/frame.js"></script></head>',
          );
        mime = 'text/html';
      } else {
        const file = files.get(pathname);
        if (!file) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        body = await readFile(file[0]);
        mime = file[1];
      }
      res.writeHead(200, {
        'Content-Type': mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end('The typography study could not load.');
    }
  })
  .listen(41974, '127.0.0.1', () =>
    process.stdout.write('felis typography study: http://127.0.0.1:41974/\n'),
  );

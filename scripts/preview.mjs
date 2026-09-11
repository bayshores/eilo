/** Dependency-free, sample-only Home preview. The live service owns all /api routes. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = new URL('../web/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', root), 'utf8'));
const assets = new Set([...manifest.home, ...Object.values(manifest.routes)]);
const port = Number(process.env.EILO_PREVIEW_PORT || process.env.EILO_PROTO_PORT || 41973);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('EILO_PREVIEW_PORT must be an integer between 1 and 65535.');
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

http
  .createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        request.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, prototype: true }),
      );
      return;
    }
    const asset =
      manifest.routes[pathname] || (pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!assets.has(asset)) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(new URL(asset, root));
      response.writeHead(200, {
        'Content-Type': mime[path.extname(asset)],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error(
        `Preview could not read manifest asset ${asset}: ${error.code ?? 'read error'}`,
      );
      response.writeHead(500).end('The preview could not load this asset.');
    }
  })
  .listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `eïlo sample Home: http://127.0.0.1:${port}\nServing ${fileURLToPath(root)}\n`,
    );
  });

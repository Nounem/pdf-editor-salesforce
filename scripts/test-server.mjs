import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const engine = await readFile('force-app/main/default/staticresources/lovePdfEngine.resource');
createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob:; img-src 'self' data: blob:; worker-src 'none'; connect-src 'self'");
    if (request.url === '/engine.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(engine); return; }
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>LovePdf engine test</title><script src="/engine.js" defer></script></head><body><canvas></canvas></body></html>'); return; }
    response.writeHead(404).end();
}).listen(4175, '127.0.0.1');

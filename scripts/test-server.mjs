import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const engine = await readFile('force-app/main/default/staticresources/lovePdfEngine.resource');
const harness = await build({ entryPoints: ['scripts/lws-test-harness.js'], bundle: true, format: 'iife', write: false });
createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob:; img-src 'self' data: blob:; worker-src 'none'; connect-src 'self'");
    if (request.url === '/engine.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(engine); return; }
    if (request.url === '/lws-harness.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(harness.outputFiles[0].text); return; }
    if (request.url === '/lws') {
        // LWS itself evaluates code in an isolated realm. Only this test page
        // permits eval and its same-origin frame; the native test retains its CSP.
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' blob:; img-src 'self' data: blob:; worker-src 'none'; connect-src 'self'; frame-src 'self'");
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>PDF LWS test</title><script src="/lws-harness.js" defer></script></head><body><canvas></canvas></body></html>');
        return;
    }
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>LovePdf engine test</title><script src="/engine.js" defer></script></head><body><canvas></canvas></body></html>'); return; }
    response.writeHead(404).end();
}).listen(4175, '127.0.0.1');

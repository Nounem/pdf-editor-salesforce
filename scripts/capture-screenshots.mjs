import { build } from 'esbuild';
import { transformSync } from '@lwc/compiler';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { mocks, componentNames } from './screenshots/lightning-mocks.mjs';
import { createDemoPdf } from './screenshots/fixture.mjs';

const root = process.cwd();
const output = path.join(root, 'docs/screenshots');
await mkdir(output, { recursive: true });
const componentRoot = path.join(root, 'force-app/main/default/lwc');
const bundle = await build({
    absWorkingDir: root, tsconfigRaw: {}, write: false, bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { contents: `import {createElement} from 'lwc';import PdfEditorApp from 'c/pdfEditorApp';const app=createElement('c-pdf-editor-app',{is:PdfEditorApp});document.querySelector('main').appendChild(app);`, resolveDir: root },
    plugins: [{ name: 'lwc-documentation-preview', setup(plugin) {
        plugin.onResolve({ filter: /^lwc$/ }, () => ({ path: path.join(root, 'node_modules/@lwc/engine-dom/dist/index.js') }));
        plugin.onResolve({ filter: /^c\// }, (args) => { const name = args.path.slice(2); return { path: path.join(componentRoot, name, `${name}.js`) }; });
        plugin.onResolve({ filter: /^lightning\// }, (args) => ({ path: `${args.path}.js`, namespace: 'preview' }));
        plugin.onResolve({ filter: /^@salesforce\/apex\// }, (args) => ({ path: `apex/${args.path.split('.').at(-1)}.js`, namespace: 'preview' }));
        plugin.onResolve({ filter: /^@salesforce\/resourceUrl\// }, () => ({ path: 'resource.js', namespace: 'preview' }));
        plugin.onResolve({ filter: /^@salesforce\/(user|schema)\// }, (args) => ({ path: `salesforce/${args.path.split('/').slice(1).join('-')}.js`, namespace: 'preview' }));
        plugin.onResolve({ filter: /^\.\//, namespace: 'preview' }, (args) => ({ path: path.posix.join(path.posix.dirname(args.importer), args.path), namespace: 'preview' }));
        plugin.onLoad({ filter: /.*/, namespace: 'preview' }, (args) => {
            const name = path.posix.basename(args.path).split('.')[0];
            const source = mocks[args.path];
            if (source === undefined) {
                if (args.path.includes('.scoped.css')) return { contents: 'export default undefined;', loader: 'js' };
                throw new Error(`Missing preview adapter: ${args.path}`);
            }
            return { contents: componentNames.has(name) ? transformSync(source, args.path, { namespace: 'lightning', name, apiVersion: 67 }).code : source, loader: 'js' };
        });
        plugin.onResolve({ filter: /\.scoped\.css/ }, () => ({ path: 'empty.scoped.css', namespace: 'preview' }));
        plugin.onLoad({ filter: /\.(js|html|css)$/ }, async (args) => {
            if (!args.path.startsWith(componentRoot)) return undefined;
            const name = path.basename(path.dirname(args.path));
            let source = await readFile(args.path, 'utf8');
            // Native shadow DOM in this preview does not inherit Salesforce's global utilities.
            if (name === 'pdfEditorApp' && args.path.endsWith('.css')) source += '\n.slds-m-bottom_medium{margin-bottom:16px}.slds-p-horizontal_medium{padding-inline:16px}.slds-p-bottom_medium{padding-bottom:16px}.slds-m-bottom_small{margin:0 0 12px}.slds-m-top_small{margin-top:12px}';
            return { contents: transformSync(source, args.path, { namespace: 'c', name, apiVersion: 67 }).code, loader: 'js', resolveDir: path.dirname(args.path) };
        });
    } }]
});
const pdf = await createDemoPdf();
const fixtureScript = `window.demoPdfBase64=${JSON.stringify(Buffer.from(pdf).toString('base64'))};window.demoPdf=Uint8Array.from(atob(window.demoPdfBase64),c=>c.charCodeAt(0));`;
const engine = await readFile('force-app/main/default/staticresources/lovePdfEngine.resource');
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>PDF Editor — démonstration locale</title><style>body{margin:0;background:#f3f3f3;color:#2e2e2e;font-family:Arial,sans-serif}header.demo{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:14px 30px;background:white;border-bottom:1px solid #c9c9c9;font-size:12px}header.demo strong{font-size:14px;color:#03234d}.demo span{color:#5c5c5c}main{margin:24px auto;max-width:1460px;padding:0 20px}h1,h2,p{margin:0}</style><script src="/engine.js" defer></script><script src="/fixture.js" defer></script><script src="/preview.js" defer></script></head><body><header class="demo"><strong>PDF Editor · Guide visuel</strong><span>Aperçu local · Contrôles Lightning simulés · Données fictives</span></header><main></main></body></html>`;
const routes = new Map([['/', ['text/html', html]], ['/engine.js', ['application/javascript', engine]], ['/fixture.js', ['application/javascript', fixtureScript]], ['/preview.js', ['application/javascript', bundle.outputFiles[0].contents]]]);
const server = createServer((request, response) => {
    const route = routes.get(request.url);
    if (!route) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', route[0]);
    response.end(route[1]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
let page;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1540, height: 900 }, deviceScaleFactor: 1 });
    const failures = [];
    page.on('pageerror', (error) => { failures.push(error.message); console.error(error.stack); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const ready = async () => {
        await page.locator('.loading').first().waitFor({ state: 'hidden' });
        await page.getByText('Préparation de l’aperçu…', { exact: true }).waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        const alerts = await page.getByRole('alert').allTextContents();
        if (alerts.length) throw new Error(alerts.join('\n'));
    };
    await page.getByRole('button', { name: 'Depuis mon ordinateur', exact: true }).waitFor();
    await ready();
    await page.screenshot({ path: path.join(output, '01-ouvrir-un-pdf.png'), fullPage: true });
    const initialChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Depuis mon ordinateur', exact: true }).click();
    await (await initialChooser).setFiles({ name: 'Devis Atelier Horizon.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    await page.getByRole('button', { name: 'Texte', exact: true }).waitFor();
    await ready();
    // « Ajuster à la largeur » is the default; a fixed zoom keeps the documentation captures stable.
    await page.getByLabel('Zoom', { exact: true }).selectOption('0.85');
    await ready();
    await page.getByRole('button', { name: 'Texte', exact: true }).click();
    await page.getByRole('button', { name: 'Placer l’outil au centre' }).click();
    await ready();
    const commitInput = async (label, value) => {
        const input = page.getByLabel(label, { exact: true });
        await input.fill(value);
        await input.press('Tab');
        await ready();
    };
    await commitInput('Texte (10 lignes au plus)', 'Bon pour accord');
    await commitInput('Position X (pt PDF)', '42');
    await commitInput('Position Y (pt PDF)', '177');
    await page.screenshot({ path: path.join(output, '02-ajouter-du-texte.png'), fullPage: true });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    if (!Buffer.concat(chunks).subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The local download is not a PDF');
    await ready();
    await page.getByLabel('Type d’objet', { exact: true }).selectOption('Compteur__c');
    await page.getByLabel('Enregistrement', { exact: true }).selectOption('demo-record');
    await page.getByRole('button', { name: 'Ouvrir l’enregistrement', exact: true }).waitFor();
    await ready();
    if (await page.getByRole('button', { name: 'Texte : Bon pour accord', exact: true }).count() !== 1) throw new Error('Local edits were lost when selecting a destination');
    const stamp = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 180;
        const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#bc502e'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 464, 164);
        ctx.fillStyle = '#bc502e'; ctx.textAlign = 'center'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('VALIDÉ', 240, 82);
        ctx.font = '22px sans-serif'; ctx.fillText('ATELIER HORIZON', 240, 129); return canvas.toDataURL('image/png').split(',')[1];
    });
    const imageChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Image', exact: true }).click();
    await (await imageChooserPromise).setFiles({ name: 'tampon-demo.png', mimeType: 'image/png', buffer: Buffer.from(stamp, 'base64') });
    await ready();
    await page.getByRole('button', { name: 'Placer l’outil au centre' }).click();
    await ready();
    await commitInput('Position X (pt PDF)', '345');
    await commitInput('Position Y (pt PDF)', '150');
    await page.screenshot({ path: path.join(output, '03-ajouter-une-image.png'), fullPage: true });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Nouveau fichier enregistré sur cet enregistrement.').waitFor();
    await ready();
    const saved = await page.evaluate(() => window.demoSavedRequest);
    if (!saved?.payload?.startsWith('JVBERi0')) throw new Error('No PDF was produced by the screenshot flow');
    // A Salesforce file is saved as a new version of itself by default.
    await page.getByLabel('PDF de cet enregistrement (50 plus récents)').selectOption('demo-version');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await ready();
    await page.getByRole('button', { name: 'Texte', exact: true }).click();
    await page.getByRole('button', { name: 'Placer l’outil au centre' }).click();
    await ready();
    await commitInput('Texte (10 lignes au plus)', ['Bon pour accord', 'Le 20/10/2026'].join(String.fromCharCode(10)));
    await commitInput('Position X (pt PDF)', '42');
    await commitInput('Position Y (pt PDF)', '170');
    await page.getByLabel('Gras', { exact: true }).check();
    await ready();
    // Lot 1 tools: stamp, check mark, highlight and a signature drawn with the mouse.
    const sheet = page.locator('canvas[aria-label="Aperçu du PDF modifié"]');
    const placeAt = async (x, y) => { await sheet.click({ position: { x, y } }); await ready(); };
    await page.getByRole('button', { name: 'Tampon ▾' }).click();
    await page.getByRole('menuitem', { name: 'Lu et approuvé', exact: true }).click();
    await placeAt(300, 520);
    await page.getByRole('button', { name: 'Case ▾' }).click();
    await page.getByRole('menuitem', { name: '✓ Coche', exact: true }).click();
    await placeAt(14, 266);
    await page.getByRole('button', { name: 'Surligner', exact: true }).click();
    await placeAt(330, 382);
    await page.getByRole('button', { name: 'Signature', exact: true }).click();
    const pad = await page.locator('canvas[aria-label="Zone de signature"]').boundingBox();
    const stroke = [[0.1, 0.6], [0.18, 0.3], [0.26, 0.72], [0.34, 0.35], [0.44, 0.66], [0.52, 0.38], [0.6, 0.58], [0.72, 0.44], [0.9, 0.52]];
    await page.mouse.move(pad.x + pad.width * stroke[0][0], pad.y + pad.height * stroke[0][1]);
    await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) await page.mouse.move(pad.x + pad.width * x, pad.y + pad.height * y, { steps: 6 });
    await page.mouse.up();
    await page.screenshot({ path: path.join(output, '05-signer.png'), fullPage: true });
    await page.getByRole('button', { name: 'Utiliser cette signature', exact: true }).click();
    await placeAt(300, 440);
    for (const name of ['Tampon : Lu et approuvé', 'Coche', 'Surlignage', 'Signature']) {
        if (await page.locator(`button.element[aria-label="${name}"]`).count() !== 1) throw new Error(`Missing addition: ${name}`);
    }
    await page.screenshot({ path: path.join(output, '06-tampons-et-cases.png'), fullPage: true });
    if (!await page.getByLabel('Nouvelle version du fichier').isChecked()) throw new Error('New version must be the default for a Salesforce file');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Nouvelle version enregistrée.', { exact: false }).waitFor();
    await ready();
    const version = await page.evaluate(() => window.demoVersionRequest);
    if (!version?.payload?.startsWith('JVBERi0') || version.sourceVersionId !== 'demo-version') throw new Error('No new version was produced by the screenshot flow');
    await page.screenshot({ path: path.join(output, '04-enregistrer-une-copie.png'), fullPage: true });
    await mkdir('.local', { recursive: true });
    await page.evaluate(async (payload) => {
        const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
        const canvas = document.createElement('canvas');
        canvas.id = 'export-check';
        document.body.appendChild(canvas);
        await (await window.LovePdfEngine.open(bytes)).render(0, canvas, 0.85, 0);
    }, version.payload);
    await page.locator('#export-check').screenshot({ path: '.local/export-check.png' });
    await page.evaluate(() => document.getElementById('export-check').remove());
    // Lot 2: insert a record value, append another PDF, extract a page.
    await page.getByRole('button', { name: 'Champ ▾' }).click();
    await page.getByRole('menuitem', { name: 'Montant : 1 700,00 EUR', exact: true }).click();
    await placeAt(300, 300);
    if (await page.locator('button.element[aria-label="Texte : 1 700,00 EUR"]').count() !== 1) throw new Error('The record value was not inserted');
    const mergeChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Ajouter un PDF', exact: true }).click();
    await (await mergeChooser).setFiles({ name: 'annexe.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    await ready();
    const merged = await page.locator('.page-panel strong').textContent();
    if (merged !== 'Page 3 sur 4') throw new Error(`Unexpected page after merging: ${merged}`);
    await page.screenshot({ path: path.join(output, '07-pages-et-champs.png'), fullPage: true });
    const extractPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Extraire cette page', exact: true }).click();
    const extracted = await extractPromise;
    if (!extracted.suggestedFilename().endsWith(' - page 3.pdf')) throw new Error(`Unexpected extract name: ${extracted.suggestedFilename()}`);
    await ready();
    // Check the second native file-picker button and narrow desktop layouts too.
    const localChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Depuis mon ordinateur', exact: true }).click();
    await (await localChooserPromise).setFiles({ name: 'document-local.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    await ready();
    for (const width of [1024, 640]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) throw new Error(`The editor overflows the page at ${width}px`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('Captured 7 screenshots from the actual LWC and PDF engine using local Salesforce adapters.');
} catch (error) {
    await mkdir('.local', { recursive: true });
    await page?.screenshot({ path: '.local/screenshot-debug.png', fullPage: true });
    console.error(await page?.locator('main').innerText());
    throw error;
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}

const { test, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');

async function fixture(rotation = 0) {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const first = document.addPage([400, 500]);
    first.drawText('Original confidentiel', { x: 40, y: 400, font, size: 16 });
    first.setRotation(degrees(rotation));
    document.addPage([300, 300]);
    return Array.from(await document.save());
}

for (const mode of ['native', 'LWS']) {
test.describe(mode, () => {
async function openEnginePage(page) {
    await page.goto(mode === 'LWS' ? '/lws' : '/');
    if (mode === 'LWS') await page.evaluate(() => window.pdfLwsReady);
}

test('renders, exports text and image, retains source and produces stable retry bytes', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openEnginePage(page);
    const original = await fixture();
    const result = await page.evaluate(async (source) => {
        const engine = window.LovePdfEngine;
        const bytes = new Uint8Array(source);
        const handle = await engine.open(bytes);
        const metrics = handle.measure('Été à Paris', 16);
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG2UAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
        const state = { pages: [{ id: 'p0', sourceIndex: 0, rotation: 90, elements: [
            { id: 'text', type: 'text', x: 60, y: 200, text: 'Été à Paris', fontSize: 16, color: '#18313c', ...metrics },
            { id: 'image', type: 'image', x: 20, y: 50, width: 50, height: 50, assetId: 'img' },
            { id: 'mask', type: 'mask', x: 40, y: 390, width: 200, height: 30 }
        ] }] };
        const assets = new Map([['img', { bytes: png, mime: 'image/png' }]]);
        const first = await engine.exportPdf(bytes, state, assets);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const retry = await engine.exportPdf(bytes, state, assets);
        const preview = await engine.open(first);
        const viewport = await preview.render(0, document.querySelector('canvas'), 1, 0);
        const canvas = document.querySelector('canvas');
        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const darkPixels = imageData.data.filter((value, index) => index % 4 === 0 && value < 80).length;
        await preview.destroy();
        await handle.destroy();
        return { output: Array.from(first), stable: first.every((value, index) => value === retry[index]) && first.length === retry.length, sourceIntact: bytes.every((value, index) => value === source[index]), width: viewport.width, height: viewport.height, darkPixels };
    }, original);
    expect(result.stable).toBe(true);
    expect(result.sourceIntact).toBe(true);
    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
    expect(result.darkPixels).toBeGreaterThan(50);
    const exported = await PDFDocument.load(new Uint8Array(result.output));
    expect(exported.getPageCount()).toBe(1);
    expect(exported.getPage(0).getRotation().angle).toBe(90);
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:4175/'))).toBe(true);
    await page.screenshot({ path: `test-results/pdf-engine-${mode}.png`, fullPage: true });
});

test('rotated PDF coordinates round-trip and unsupported inputs fail clearly', async ({ page }) => {
    await openEnginePage(page);
    const outcome = await page.evaluate(async (source) => {
        const engine = window.LovePdfEngine;
        const handle = await engine.open(new Uint8Array(source));
        const viewport = await handle.viewport(0, 1.25, 90);
        const screen = viewport.convertToViewportPoint(72, 120);
        const pdfPoint = viewport.convertToPdfPoint(...screen);
        let invalid;
        try { await engine.open(new Uint8Array([1, 2, 3])); } catch (error) { invalid = error.message; }
        let unicode;
        try { handle.measure('😊', 16); } catch (error) { unicode = error.message; }
        await handle.destroy();
        return { pdfPoint, invalid, unicode };
    }, await fixture(90));
    expect(outcome.pdfPoint).toEqual([72, 120]);
    expect(outcome.invalid).toContain('signature PDF');
    expect(outcome.unicode).toContain('caractère');
});

test('interactive PDFs are rejected before reconstruction', async ({ page }) => {
    const document = await PDFDocument.create();
    const pdfPage = document.addPage();
    document.getForm().createTextField('Client').addToPage(pdfPage);
    const source = Array.from(await document.save());
    await openEnginePage(page);
    const error = await page.evaluate(async (bytes) => {
        try { await window.LovePdfEngine.open(new Uint8Array(bytes)); return ''; }
        catch (failure) { return failure.message; }
    }, source);
    expect(error).toContain('formulaires interactifs');
});
});
}

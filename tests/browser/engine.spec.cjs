const { test, expect } = require('@playwright/test');
const { PDFDocument, PDFName, PDFString, StandardFonts, degrees } = require('pdf-lib');

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

test('PDFs with links open, and the copy drops the links but keeps rotated additions', async ({ page }) => {
    const document = await PDFDocument.create();
    const pdfPage = document.addPage([400, 500]);
    const link = document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
        A: { S: 'URI', URI: PDFString.of('https://example.invalid') } });
    pdfPage.node.set(PDFName.of('Annots'), document.context.obj([document.context.register(link)]));
    const source = Array.from(await document.save());
    await openEnginePage(page);
    const result = await page.evaluate(async (bytes) => {
        const engine = window.LovePdfEngine;
        const handle = await engine.open(new Uint8Array(bytes));
        const metrics = handle.measure('Bon pour accord', 14);
        const state = { pages: [{ id: 'p0', sourceIndex: 0, rotation: 90, elements: [
            { id: 't', type: 'text', x: 200, y: 100, rotation: 90, text: 'Bon pour accord', fontSize: 14, color: '#000000', ...metrics },
            { id: 'm', type: 'mask', x: 300, y: 100, rotation: 90, width: 60, height: 20 }
        ] }] };
        const output = await engine.exportPdf(new Uint8Array(bytes), state, new Map());
        await handle.destroy();
        return { annotations: handle.annotations, output: Array.from(output) };
    }, source);
    expect(result.annotations).toBe(true);
    const exported = await PDFDocument.load(new Uint8Array(result.output));
    expect(exported.getPage(0).node.Annots()?.size() || 0).toBe(0);
    expect(exported.getPage(0).getRotation().angle).toBe(90);
});

test('exports multi-line text in three fonts, stamps, highlights and check marks', async ({ page }) => {
    await openEnginePage(page);
    const result = await page.evaluate(async (source) => {
        const engine = window.LovePdfEngine;
        const bytes = new Uint8Array(source);
        const handle = await engine.open(bytes);
        const twoLines = handle.measure('Bon pour accord\nLe 20/10/2026', 14, { font: 'Times', bold: true });
        const oneLine = handle.measure('Bon pour accord', 14, { font: 'Times', bold: true });
        const courier = handle.measure('iiii', 10, { font: 'Courier' });
        const mmmm = handle.measure('MMMM', 10, { font: 'Courier' });
        const stamp = handle.measure('PAYÉ', 14, { bold: true });
        const state = { pages: [{ id: 'p0', sourceIndex: 0, rotation: 0, elements: [
            { id: 't', type: 'text', x: 40, y: 300, text: 'Bon pour accord\nLe 20/10/2026', fontSize: 14, color: '#000000', font: 'Times', bold: true, ...twoLines },
            { id: 's', type: 'stamp', x: 40, y: 200, text: 'PAYÉ', fontSize: 14, color: '#c23934', width: stamp.width + 11.2, height: 21 },
            { id: 'h', type: 'highlight', x: 200, y: 200, width: 120, height: 16 },
            { id: 'c', type: 'check', mark: 'check', x: 40, y: 120, width: 30, height: 30, color: '#000000' },
            { id: 'x', type: 'check', mark: 'cross', x: 100, y: 120, width: 30, height: 30, color: '#000000' }
        ] }] };
        const output = await engine.exportPdf(bytes, state, new Map());
        const preview = await engine.open(output);
        const canvas = document.querySelector('canvas');
        await preview.render(0, canvas, 1, 0);
        const context = canvas.getContext('2d');
        const ratio = canvas.width / 400;
        const pixels = (x, y, w, h, test) => {
            const data = context.getImageData(x * ratio, (500 - y - h) * ratio, w * ratio, h * ratio).data;
            let count = 0;
            for (let i = 0; i < data.length; i += 4) if (test(data[i], data[i + 1], data[i + 2])) count += 1;
            return count;
        };
        const dark = (r, g, b) => r < 90 && g < 90 && b < 90;
        const result = {
            secondLine: twoLines.height > oneLine.height * 1.8,
            monospace: Math.abs(courier.width - mmmm.width) < 0.01,
            textInk: pixels(40, 280, 140, 40, dark),
            stampRed: pixels(40, 200, 60, 21, (r, g, b) => r > 150 && g < 90 && b < 90),
            highlightYellow: pixels(200, 200, 120, 16, (r, g, b) => r > 200 && g > 180 && b < 160),
            checkInk: pixels(40, 120, 30, 30, dark),
            crossInk: pixels(100, 120, 30, 30, dark)
        };
        await preview.destroy();
        await handle.destroy();
        return result;
    }, await fixture());
    expect(result.secondLine).toBe(true);
    expect(result.monospace).toBe(true);
    for (const key of ['textInk', 'stampRed', 'highlightYellow', 'checkInk', 'crossInk']) expect(result[key], key).toBeGreaterThan(20);
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

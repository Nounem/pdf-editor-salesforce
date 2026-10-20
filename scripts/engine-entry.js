import { getDocument, version } from 'pdfjs-dist/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { LineCapStyle, PDFDocument, PDFName, PDFSignature, StandardFontEmbedder, StandardFonts, degrees, rgb } from 'pdf-lib';

// Deliberately use PDF.js' in-process worker for this small-file prototype.
// No blob worker URL, runtime import or CDN is required inside LWS.
globalThis.pdfjsWorker = { WorkerMessageHandler };

const MAX_BYTES = 1000000;
const MAX_PAGES = 20;
// Shared with the editor overlays (pdfEditor.js): keep both sides in sync.
const LINE_HEIGHT = 1.2;
const STAMP_PADDING = 0.4;
const STAMP_BASELINE = 0.4;
const FONTS = {
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
    Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold]
};
// Check and cross marks as segments in a unit square, y pointing up.
const MARKS = {
    check: [[[0.15, 0.5], [0.4, 0.25]], [[0.4, 0.25], [0.85, 0.8]]],
    cross: [[[0.2, 0.2], [0.8, 0.8]], [[0.2, 0.8], [0.8, 0.2]]]
};

function fontName(family, bold) {
    return (FONTS[family] || FONTS.Helvetica)[bold ? 1 : 0];
}

// Metrics of a standard font, decoded on first use and kept for the session.
const metricsCache = new Map();
function fontMetrics(name) {
    if (!metricsCache.has(name)) metricsCache.set(name, StandardFontEmbedder.for(name));
    return metricsCache.get(name);
}

function fontCache(document) {
    const cache = new Map();
    return async (family, bold) => {
        const name = fontName(family, bold);
        if (!cache.has(name)) cache.set(name, await document.embedFont(name));
        return cache.get(name);
    };
}

// Point at (a, b) in the element's own frame, which is turned by its rotation.
function along(element, a, b) {
    const angle = ((element.rotation || 0) * Math.PI) / 180;
    return {
        x: element.x + a * Math.cos(angle) - b * Math.sin(angle),
        y: element.y + a * Math.sin(angle) + b * Math.cos(angle)
    };
}

// Bytes from the page (a file, a canvas…) can reach the engine as objects of another realm.
// Under Lightning Web Security each read of such an object crosses the security boundary, and
// PDF parsing reads every byte many times: copy them once into an engine-owned buffer.
function ownBytes(bytes) {
    const length = bytes.length;
    const copy = new Uint8Array(length);
    const chunk = 65536;
    for (let offset = 0; offset < length; offset += chunk) {
        copy.set(Array.prototype.slice.call(bytes, offset, Math.min(offset + chunk, length)), offset);
    }
    return copy;
}

async function inspect(bytes) {
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Le PDF est limité à 1 Mo dans ce prototype.');
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Le fichier ne possède pas une signature PDF valide.');
    let document;
    try {
        // Real-world PDFs often contain minor invalid objects; pdf-lib keeps them as-is.
        document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: false, updateMetadata: false });
    } catch (error) {
        if (/encrypt/i.test(error.message)) throw new Error('Les PDF chiffrés ne sont pas pris en charge.');
        throw new Error('Ce PDF ne peut pas être ouvert de façon fiable.');
    }
    if (document.getPageCount() < 1 || document.getPageCount() > MAX_PAGES) throw new Error('Le PDF est limité à 20 pages.');
    const form = document.getForm();
    if (form.hasXFA()) throw new Error('Les formulaires XFA ne sont pas pris en charge.');
    const signed = document.catalog.has(PDFName.of('Perms')) ||
        form.getFields().some((field) => field instanceof PDFSignature) ||
        document.context.enumerateIndirectObjects().some(([, object]) =>
            typeof object.has === 'function' && object.has(PDFName.of('ByteRange')));
    if (signed) throw new Error('Les PDF signés ou contenant un champ de signature ne sont pas modifiables dans ce prototype.');
    if (form.getFields().length) throw new Error('Les formulaires interactifs sont exclus de cette première version.');
    return document;
}

function hasAnnotations(document) {
    return document.getPages().some((page) => page.node.Annots()?.size() > 0);
}

function color(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Couleur invalide.');
    return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function point(viewport, x, y) {
    return viewport.convertToPdfPoint(x, y);
}

// `source` is the opened PDF, or an array of PDFs when others were appended to it:
// each page refers to its PDF by `source` (0 when absent) and to its page by `sourceIndex`.
// `maxBytes` caps the result: 1 MB by default for Salesforce saves; downloads may allow more.
async function exportPdf(source, state, assets, { maxBytes = MAX_BYTES } = {}) {
    const sources = (Array.isArray(source) ? source : [source]).map(ownBytes);
    if (!state.pages.length || state.pages.length > MAX_PAGES) throw new Error('Nombre de pages invalide.');
    const originals = [];
    for (const bytes of sources) {
        const document = await inspect(bytes);
        // Page reconstruction cannot preserve links and comments reliably: they are
        // dropped from the copy, and the editor tells the user when it opens the file.
        for (const page of document.getPages()) page.node.delete(PDFName.of('Annots'));
        originals.push(document);
    }
    const original = originals[0];
    const output = await PDFDocument.create();
    // Stable bytes are required when retrying an idempotent save after a lost response.
    output.setCreationDate(original.getCreationDate() || new Date(0));
    output.setModificationDate(original.getModificationDate() || new Date(0));
    const font = fontCache(output);
    const imageCache = new Map();
    // Copy all pages of a source in one call: fonts and images shared between pages are then
    // copied once. Page by page, a 147 kB file with a shared image grew to 874 kB.
    const copies = new Map();
    for (const [index, document] of originals.entries()) {
        const wanted = [...new Set(state.pages.filter((item) => (item.source || 0) === index).map((item) => item.sourceIndex))];
        if (wanted.some((pageIndex) => pageIndex >= document.getPageCount())) throw new Error('Page source introuvable.');
        const pages = wanted.length ? await output.copyPages(document, wanted) : [];
        wanted.forEach((pageIndex, position) => copies.set(`${index}:${pageIndex}`, pages[position]));
    }
    for (const item of state.pages) {
        const key = `${item.source || 0}:${item.sourceIndex}`;
        const page = copies.get(key);
        if (!page) throw new Error('Page source introuvable.');
        // A page object can only be placed once.
        copies.delete(key);
        output.addPage(page);
        page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
        for (const element of item.elements) {
            // Elements are created upright for the page orientation shown at that time.
            const rotate = degrees(element.rotation || 0);
            const { width, height } = element;
            if (element.type === 'text') {
                // (x, y) is the bottom of the block: the first baseline sits above the other lines.
                const size = element.fontSize;
                const lines = element.text.split('\n');
                page.drawText(element.text, { ...along(element, 0, (lines.length - 1) * LINE_HEIGHT * size), size,
                    font: await font(element.font, element.bold), color: color(element.color), rotate, lineHeight: LINE_HEIGHT * size });
            } else if (element.type === 'stamp') {
                const size = element.fontSize;
                const ink = color(element.color);
                page.drawRectangle({ x: element.x, y: element.y, width, height, borderColor: ink, borderWidth: Math.max(1, size * 0.1), rotate });
                page.drawText(element.text, { ...along(element, STAMP_PADDING * size, STAMP_BASELINE * size), size,
                    font: await font('Helvetica', true), color: ink, rotate });
            } else if (element.type === 'highlight') {
                page.drawRectangle({ x: element.x, y: element.y, width, height, color: rgb(1, 0.87, 0), opacity: 0.4, rotate });
            } else if (element.type === 'check') {
                for (const [from, to] of MARKS[element.mark] || MARKS.check) {
                    page.drawLine({ start: along(element, from[0] * width, from[1] * height), end: along(element, to[0] * width, to[1] * height),
                        thickness: Math.max(1, width * 0.12), color: color(element.color), lineCap: LineCapStyle.Round });
                }
            } else if (element.type === 'mask') {
                page.drawRectangle({ x: element.x, y: element.y, width, height, color: rgb(1, 1, 1), rotate });
            } else if (element.type === 'image') {
                if (!imageCache.has(element.assetId)) {
                    const asset = assets.get(element.assetId);
                    if (!asset) throw new Error('Image introuvable.');
                    imageCache.set(element.assetId, asset.mime === 'image/png' ? await output.embedPng(asset.bytes) : await output.embedJpg(asset.bytes));
                }
                page.drawImage(imageCache.get(element.assetId), { x: element.x, y: element.y, width, height, rotate });
            }
        }
    }
    output.setProducer('LovePdfSales — prototype');
    output.setCreator('LovePdfSales');
    const bytes = await output.save();
    if (bytes.length > maxBytes) {
        throw new Error(`Le résultat dépasse ${Math.round(maxBytes / 1000000)} Mo. Réduisez les images ou les ajouts avant de réessayer.`);
    }
    return bytes;
}

async function open(input) {
    const bytes = ownBytes(input);
    // Kept on the handle to diagnose slow opening in an org (milliseconds per step).
    const timings = {};
    let started = performance.now();
    const inspected = await inspect(bytes);
    timings.checks = Math.round(performance.now() - started);
    started = performance.now();
    const task = getDocument({
        data: bytes.slice(), isEvalSupported: false, enableXfa: false,
        useSystemFonts: true, disableFontFace: false, isOffscreenCanvasSupported: false,
        useWasm: false, isImageDecoderSupported: false, stopAtErrors: true
    });
    const pdf = await task.promise;
    timings.parse = Math.round(performance.now() - started);
    return {
        pageCount: pdf.numPages,
        annotations: hasAnnotations(inspected),
        timings,
        async viewport(index, scale, rotation) {
            const page = await pdf.getPage(index + 1);
            return page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        },
        async render(index, canvas, scale, rotation) {
            const page = await pdf.getPage(index + 1);
            const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
            const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
            if (viewport.width * viewport.height * ratio * ratio > 12000000) {
                throw new Error('Page trop grande pour ce niveau de zoom. Diminuez le zoom.');
            }
            canvas.width = Math.ceil(viewport.width * ratio);
            canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: 0 }).promise;
            return viewport;
        },
        // Width of the longest line and height of the block, from the top of the first line to the last baseline.
        measure(text, size, { font: family, bold } = {}) {
            const lines = String(text).split('\n');
            if (!String(text).trim() || lines.length > 10 || lines.some((line) => line.length > 200) || /\r/.test(text)) {
                throw new Error('Saisissez de 1 à 10 lignes de 200 caractères maximum.');
            }
            const metrics = fontMetrics(fontName(family, bold));
            try {
                return {
                    width: Math.max(...lines.map((line) => metrics.widthOfTextAtSize(line, size))),
                    height: metrics.heightOfFontAtSize(size, { descender: false }) + (lines.length - 1) * LINE_HEIGHT * size
                };
            } catch {
                throw new Error('Ce caractère n’est pas pris en charge. Utilisez du texte latin dans cette version.');
            }
        },
        point,
        async destroy() { await task.destroy(); }
    };
}

globalThis.LovePdfEngine = { open, exportPdf, version: `pdfjs-${version}_pdf-lib-1.17.1` };

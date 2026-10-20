import { getDocument, version } from 'pdfjs-dist/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { LineCapStyle, PDFDocument, PDFName, PDFSignature, StandardFonts, degrees, rgb } from 'pdf-lib';

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
async function exportPdf(source, state, assets) {
    const sources = Array.isArray(source) ? source : [source];
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
    for (const item of state.pages) {
        const from = originals[item.source || 0];
        if (!from || item.sourceIndex >= from.getPageCount()) throw new Error('Page source introuvable.');
        const [page] = await output.copyPages(from, [item.sourceIndex]);
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
    if (bytes.length > MAX_BYTES) throw new Error('Le résultat dépasse 1 Mo. Réduisez les images ou les ajouts avant de réessayer.');
    return bytes;
}

async function open(bytes) {
    const inspected = await inspect(bytes);
    const task = getDocument({
        data: bytes.slice(), isEvalSupported: false, enableXfa: false,
        useSystemFonts: true, disableFontFace: false, isOffscreenCanvasSupported: false,
        useWasm: false, isImageDecoderSupported: false, stopAtErrors: true
    });
    const pdf = await task.promise;
    // Standard fonts carry no file data: embedding all six only loads their metrics.
    const fonts = new Map();
    for (const pair of Object.values(FONTS)) {
        for (const name of pair) fonts.set(name, await inspected.embedFont(name));
    }
    return {
        pageCount: pdf.numPages,
        annotations: hasAnnotations(inspected),
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
            const metrics = fonts.get(fontName(family, bold));
            try {
                return {
                    width: Math.max(...lines.map((line) => metrics.widthOfTextAtSize(line, size))),
                    height: metrics.heightAtSize(size, { descender: false }) + (lines.length - 1) * LINE_HEIGHT * size
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

import { getDocument, version } from 'pdfjs-dist/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { PDFDocument, PDFName, PDFSignature, StandardFonts, degrees, rgb } from 'pdf-lib';

// Deliberately use PDF.js' in-process worker for this small-file prototype.
// No blob worker URL, runtime import or CDN is required inside LWS.
globalThis.pdfjsWorker = { WorkerMessageHandler };

const MAX_BYTES = 1000000;
const MAX_PAGES = 20;

async function inspect(bytes) {
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Le PDF est limité à 1 Mo dans ce prototype.');
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Le fichier ne possède pas une signature PDF valide.');
    let document;
    try {
        document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
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
    // Page reconstruction does not preserve all interactive structures.
    if (document.getPages().some((page) => page.node.Annots()?.size() > 0)) {
        throw new Error('Ce PDF contient des annotations ou des liens interactifs non pris en charge dans ce prototype.');
    }
    return document;
}

function color(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Couleur invalide.');
    return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function point(viewport, x, y) {
    return viewport.convertToPdfPoint(x, y);
}

async function exportPdf(source, state, assets) {
    const original = await inspect(source);
    if (!state.pages.length || state.pages.length > MAX_PAGES) throw new Error('Nombre de pages invalide.');
    const output = await PDFDocument.create();
    // Stable bytes are required when retrying an idempotent save after a lost response.
    output.setCreationDate(original.getCreationDate() || new Date(0));
    output.setModificationDate(original.getModificationDate() || new Date(0));
    const font = await output.embedFont(StandardFonts.Helvetica);
    const imageCache = new Map();
    for (const item of state.pages) {
        const [page] = await output.copyPages(original, [item.sourceIndex]);
        output.addPage(page);
        page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
        for (const element of item.elements) {
            if (element.type === 'text') {
                page.drawText(element.text, { x: element.x, y: element.y, size: element.fontSize, font, color: color(element.color) });
            } else if (element.type === 'mask') {
                page.drawRectangle({ x: element.x, y: element.y, width: element.width, height: element.height, color: rgb(1, 1, 1) });
            } else if (element.type === 'image') {
                if (!imageCache.has(element.assetId)) {
                    const asset = assets.get(element.assetId);
                    if (!asset) throw new Error('Image introuvable.');
                    imageCache.set(element.assetId, asset.mime === 'image/png' ? await output.embedPng(asset.bytes) : await output.embedJpg(asset.bytes));
                }
                page.drawImage(imageCache.get(element.assetId), { x: element.x, y: element.y, width: element.width, height: element.height });
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
    const font = await inspected.embedFont(StandardFonts.Helvetica);
    return {
        pageCount: pdf.numPages,
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
        measure(text, size) {
            if (!text.trim() || text.length > 200 || /[\r\n]/.test(text)) throw new Error('Saisissez une ligne de 1 à 200 caractères.');
            try {
                return { width: font.widthOfTextAtSize(text, size), height: font.heightAtSize(size, { descender: false }) };
            } catch {
                throw new Error('Ce caractère n’est pas pris en charge. Utilisez du texte latin dans cette version.');
            }
        },
        point,
        async destroy() { await task.destroy(); }
    };
}

globalThis.LovePdfEngine = { open, exportPdf, version: `pdfjs-${version}_pdf-lib-1.17.1` };

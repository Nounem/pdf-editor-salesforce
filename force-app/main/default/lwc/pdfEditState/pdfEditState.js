export const MAX_BYTES = 1000000;
export const MAX_PAGES = 20;
export const MAX_ELEMENTS = 100;
export const MAX_IMAGE_BYTES = 500000;
export const MAX_IMAGE_PIXELS = 8000000;

export function createState(pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
        throw new Error(`Le PDF doit contenir de 1 à ${MAX_PAGES} pages.`);
    }
    return {
        pages: Array.from({ length: pageCount }, (_, index) => ({
            id: `page-${index}`, sourceIndex: index, rotation: 0, elements: []
        }))
    };
}

export function copyState(state) {
    return JSON.parse(JSON.stringify(state));
}

// Keep commands independent from LWC and PDF engines so they can be tested.
export function applyChange(state, change) {
    const next = copyState(state);
    const page = next.pages.find((item) => item.id === change.pageId);
    if (!page) throw new Error('Page introuvable.');
    switch (change.type) {
        case 'add':
            if (next.pages.reduce((sum, item) => sum + item.elements.length, 0) >= MAX_ELEMENTS) {
                throw new Error(`Maximum ${MAX_ELEMENTS} ajouts par document.`);
            }
            if (next.pages.some((item) => item.elements.some((element) => element.id === change.element.id))) {
                throw new Error('Identifiant déjà utilisé.');
            }
            page.elements.push({ ...change.element });
            break;
        case 'update': {
            const element = page.elements.find((item) => item.id === change.elementId);
            if (!element) throw new Error('Ajout introuvable.');
            Object.assign(element, change.patch, { id: element.id, type: element.type });
            break;
        }
        case 'remove':
            page.elements = page.elements.filter((item) => item.id !== change.elementId);
            break;
        case 'rotate':
            page.rotation = (page.rotation + 90) % 360;
            break;
        case 'deletePage':
            if (next.pages.length === 1) throw new Error('Conservez au moins une page.');
            next.pages = next.pages.filter((item) => item.id !== page.id);
            break;
        default:
            throw new Error('Commande inconnue.');
    }
    return next;
}

export function createHistory(state) {
    return { past: [], present: copyState(state), future: [] };
}

export function commit(history, change) {
    return {
        past: [...history.past.slice(-49), history.present],
        present: applyChange(history.present, change), future: []
    };
}

export function undo(history) {
    if (!history.past.length) return history;
    return { past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future] };
}

export function redo(history) {
    if (!history.future.length) return history;
    return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

// Corners in PDF space of an element drawn from (x, y), turned counter-clockwise by its rotation.
export function elementCorners(element) {
    const angle = ((element.rotation || 0) * Math.PI) / 180;
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    const [vx, vy] = [-uy, ux];
    const { x, y, width, height } = element;
    return [[x, y], [x + width * ux, y + width * uy], [x + height * vx, y + height * vy],
        [x + width * ux + height * vx, y + width * uy + height * vy]];
}

// Screen rectangle covering an element, whatever the page and element rotations.
export function screenBox(element, toScreen) {
    const points = elementCorners(element).map(([x, y]) => toScreen(x, y));
    const xs = points.map((item) => item[0]);
    const ys = points.map((item) => item[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

// Clockwise angle at which an element appears on screen.
export function visualAngle(pageRotation, elementRotation) {
    return (((pageRotation || 0) - (elementRotation || 0)) % 360 + 360) % 360;
}

export function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
}

export function fromBase64(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function boundedNumber(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new Error(`Saisissez un nombre entre ${minimum} et ${maximum}.`);
    }
    return number;
}

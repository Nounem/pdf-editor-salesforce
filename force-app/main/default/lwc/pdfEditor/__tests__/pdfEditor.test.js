import { createElement } from 'lwc';
import PdfEditor from 'c/pdfEditor';
import { loadScript } from 'lightning/platformResourceLoader';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';
import loadSmallPdf from '@salesforce/apex/PdfEditorController.loadSmallPdf';
import saveCopy from '@salesforce/apex/PdfEditorController.saveCopy';

jest.mock('lightning/platformResourceLoader', () => ({ loadScript: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordPdfs', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.loadSmallPdf', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveCopy', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const viewport = { width: 400, height: 500, convertToPdfPoint: (x, y) => [x, 500 - y], convertToViewportRectangle: (rect) => [rect[0], 500 - rect[1], rect[2], 500 - rect[3]] };
const makeHandle = () => ({ pageCount: 1, destroy: jest.fn().mockResolvedValue(), render: jest.fn().mockResolvedValue(viewport), measure: () => ({ width: 100, height: 16 }) });

beforeEach(() => {
    loadScript.mockResolvedValue();
    listRecordPdfs.mockResolvedValue([{ title: 'Contrat', size: 120, versionId: '068source' }]);
    loadSmallPdf.mockResolvedValue({ title: 'Contrat', versionId: '068source', base64: btoa('%PDF-1.4') });
    window.LovePdfEngine = { open: jest.fn().mockImplementation(async () => makeHandle()), exportPdf: jest.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])) };
    if (!global.crypto.randomUUID) global.crypto.randomUUID = jest.fn(() => '00000000-0000-0000-0000-000000000001');
});
afterEach(() => { while (document.body.firstChild) document.body.removeChild(document.body.firstChild); jest.clearAllMocks(); });

async function mountAndOpen() {
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    element.recordId = '001record';
    document.body.appendChild(element);
    await flush(); await flush();
    element.shadowRoot.querySelector('lightning-combobox').dispatchEvent(new CustomEvent('change', { detail: { value: '068source' } }));
    await flush();
    [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Ouvrir').click();
    await flush(); await flush(); await flush();
    return element;
}

it('loads the record file and saves a copy, retaining request id after a network failure', async () => {
    saveCopy.mockRejectedValueOnce({ body: { message: 'Réseau indisponible' } }).mockResolvedValueOnce({ documentId: '069copy', versionId: '068copy' });
    const element = await mountAndOpen();
    const save = () => [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Enregistrer une copie');
    expect(loadSmallPdf).toHaveBeenCalledWith({ recordId: '001record', versionId: '068source' });
    save().click(); await flush(); await flush();
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Réseau indisponible');
    save().click(); await flush(); await flush();
    expect(saveCopy).toHaveBeenCalledTimes(2);
    expect(saveCopy.mock.calls[0][0].requestId).toEqual(saveCopy.mock.calls[1][0].requestId);
    expect(saveCopy.mock.calls[1][0].sourceVersionId).toEqual('068source');
    expect(element.shadowRoot.querySelector('.success').textContent).toContain('enregistrée');
    expect(save().disabled).toBe(true);
});

it('surfaces server access errors without opening an editor', async () => {
    loadSmallPdf.mockRejectedValue({ body: { message: 'PDF inaccessible.' } });
    const element = await mountAndOpen();
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('PDF inaccessible');
    expect(element.shadowRoot.querySelector('canvas')).toBeNull();
});

it('reports engine loading failures', async () => {
    loadScript.mockRejectedValue(new Error('Bibliothèque indisponible'));
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    document.body.appendChild(element);
    await flush();
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Bibliothèque indisponible');
});

it('adds text, commits property edits and undoes deletion', async () => {
    const element = await mountAndOpen();
    const button = (label) => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
    button('Texte').click(); await flush();
    button('Placer l’outil au centre').click(); await flush(); await flush(); await flush();
    expect(element.shadowRoot.querySelectorAll('.element')).toHaveLength(1);
    const text = element.shadowRoot.querySelector('[data-property="text"]');
    text.value = 'Bon pour accord';
    text.dispatchEvent(new CustomEvent('commit'));
    await flush(); await flush();
    expect(element.shadowRoot.querySelector('.element').getAttribute('aria-label')).toContain('Bon pour accord');
    button('Supprimer cet ajout').click(); await flush(); await flush();
    expect(element.shadowRoot.querySelectorAll('.element')).toHaveLength(0);
    [...element.shadowRoot.querySelectorAll('lightning-button-icon')].find((item) => item.alternativeText === 'Annuler').click();
    await flush(); await flush();
    expect(element.shadowRoot.querySelectorAll('.element')).toHaveLength(1);
});

it('prevents saving an open document to a different record after navigation', async () => {
    const element = await mountAndOpen();
    element.recordId = '001other';
    await flush(); await flush();
    const save = [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Enregistrer une copie');
    expect(save.disabled).toBe(true);
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('enregistrement a changé');
});

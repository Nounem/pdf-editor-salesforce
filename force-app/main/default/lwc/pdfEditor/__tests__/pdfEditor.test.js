import { createElement } from 'lwc';
import PdfEditor from 'c/pdfEditor';
import { loadScript } from 'lightning/platformResourceLoader';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';
import loadSmallPdf from '@salesforce/apex/PdfEditorController.loadSmallPdf';
import saveCopy from '@salesforce/apex/PdfEditorController.saveCopy';
import saveNewVersion from '@salesforce/apex/PdfEditorController.saveNewVersion';
import LightningConfirm from 'lightning/confirm';

jest.mock('lightning/platformResourceLoader', () => ({ loadScript: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordPdfs', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.loadSmallPdf', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveCopy', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveNewVersion', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('lightning/confirm', () => ({ __esModule: true, default: { open: jest.fn() } }), { virtual: true });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const viewport = { width: 400, height: 500, convertToPdfPoint: (x, y) => [x, 500 - y], convertToViewportPoint: (x, y) => [x, 500 - y] };
const makeHandle = () => ({ pageCount: 1, destroy: jest.fn().mockResolvedValue(), render: jest.fn().mockResolvedValue(viewport), measure: () => ({ width: 100, height: 16 }) });

beforeEach(() => {
    loadScript.mockResolvedValue();
    listRecordPdfs.mockResolvedValue([{ title: 'Contrat', size: 120, versionId: '068source' }]);
    loadSmallPdf.mockResolvedValue({ title: 'Contrat', versionId: '068source', base64: btoa('%PDF-1.4') });
    window.LovePdfEngine = { open: jest.fn().mockImplementation(async () => makeHandle()), exportPdf: jest.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])) };
    if (!global.crypto.randomUUID) global.crypto.randomUUID = jest.fn(() => '00000000-0000-0000-0000-000000000001');
});
afterEach(() => { while (document.body.firstChild) document.body.removeChild(document.body.firstChild); jest.clearAllMocks(); });

const button = (element, label) => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
async function addElement(element, tool = 'Texte') {
    button(element, tool).click(); await flush();
    button(element, 'Placer l’outil au centre').click(); await flush(); await flush();
}

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

it('saves a Salesforce file as a new version by default, retaining request id after a network failure', async () => {
    saveNewVersion.mockRejectedValueOnce({ body: { message: 'Réseau indisponible' } }).mockResolvedValueOnce({ documentId: '069source', versionId: '068next' });
    const element = await mountAndOpen();
    const save = () => [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Enregistrer');
    expect(loadSmallPdf).toHaveBeenCalledWith({ recordId: '001record', versionId: '068source' });
    save().click(); await flush(); await flush();
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Réseau indisponible');
    save().click(); await flush(); await flush();
    expect(saveNewVersion).toHaveBeenCalledTimes(2);
    expect(saveNewVersion.mock.calls[0][0].requestId).toEqual(saveNewVersion.mock.calls[1][0].requestId);
    expect(saveNewVersion.mock.calls[1][0].sourceVersionId).toEqual('068source');
    expect(saveCopy).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('.success').textContent).toContain('Nouvelle version');
    expect(save().disabled).toBe(true);
});

it('saves a new file with its name when the user chooses it', async () => {
    saveCopy.mockResolvedValue({ documentId: '069copy', versionId: '068copy' });
    const element = await mountAndOpen();
    element.shadowRoot.querySelector('lightning-radio-group').dispatchEvent(new CustomEvent('change', { detail: { value: 'copy' } }));
    await flush();
    const name = [...element.shadowRoot.querySelectorAll('lightning-input')].find((item) => item.label === 'Nom du nouveau fichier');
    expect(name.value).toBe('Contrat — copie');
    [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === 'Enregistrer').click();
    await flush(); await flush();
    expect(saveCopy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Contrat — copie', sourceVersionId: '068source' }));
    expect(saveNewVersion).not.toHaveBeenCalled();
});

it('builds the next version on the version just saved', async () => {
    saveNewVersion.mockResolvedValueOnce({ documentId: '069source', versionId: '068next' }).mockResolvedValueOnce({ documentId: '069source', versionId: '068third' });
    const element = await mountAndOpen();
    const save = () => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === 'Enregistrer');
    save().click(); await flush(); await flush();
    await addElement(element);
    save().click(); await flush(); await flush();
    expect(saveNewVersion.mock.calls[1][0].sourceVersionId).toBe('068next');
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

it('identifies script load failures without a message and allows a retry', async () => {
    loadScript.mockRejectedValueOnce(new Event('error')).mockResolvedValue();
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    document.body.appendChild(element);
    await flush();
    const button = (label) => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Impossible de charger le moteur PDF');
    expect(button('Depuis mon ordinateur').disabled).toBe(true);
    button('Réessayer le chargement').click();
    await flush(); await flush();
    expect(button('Depuis mon ordinateur').disabled).toBe(false);
    expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull();
});

it('keeps local editing available after a file listing failure and retries the query', async () => {
    listRecordPdfs.mockRejectedValueOnce({ body: [{ message: 'Accès refusé' }] }).mockResolvedValue([]);
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    element.recordId = '001record';
    document.body.appendChild(element);
    await flush(); await flush();
    const button = (label) => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Impossible de lire les PDF');
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Accès refusé');
    expect(button('Depuis mon ordinateur').disabled).toBe(false);
    button('Réessayer la recherche des PDF').click();
    await flush(); await flush();
    expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull();
    expect(listRecordPdfs).toHaveBeenCalledTimes(2);
});

it('ignores obsolete listing failures after changing records', async () => {
    let rejectOldRequest;
    listRecordPdfs.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOldRequest = reject; })).mockResolvedValue([]);
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    element.recordId = '001old';
    document.body.appendChild(element);
    await flush();
    element.recordId = '001new';
    await flush(); await flush();
    rejectOldRequest({ body: { message: 'Erreur ancien compte' } });
    await flush(); await flush();
    expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull();
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
    const save = [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Enregistrer');
    expect(save.disabled).toBe(true);
    expect(element.shadowRoot.querySelector('[role="alert"]').textContent).toContain('enregistrement a changé');
});

it('asks before closing unsaved work and prevents closing during a save', async () => {
    const element = await mountAndOpen();
    await addElement(element);
    LightningConfirm.open.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(element.confirmClose()).resolves.toBe(false);
    await expect(element.confirmClose()).resolves.toBe(true);
    let finishSave;
    saveNewVersion.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    [...element.shadowRoot.querySelectorAll('lightning-button')].find((button) => button.label === 'Enregistrer').click();
    await flush();
    await expect(element.confirmClose()).rejects.toThrow('Attendez la fin du traitement');
    finishSave({ documentId: '069copy', versionId: '068copy' });
    await flush(); await flush();
    await expect(element.confirmClose()).resolves.toBe(true);
    expect(LightningConfirm.open).toHaveBeenCalledTimes(2);
});

async function mountLocalPdf() {
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    document.body.appendChild(element);
    await flush(); await flush();
    const input = element.shadowRoot.querySelector('.local-file');
    Object.defineProperty(input, 'files', { value: [{ name: 'local.pdf', size: 8, arrayBuffer: async () => new Uint8Array([37,80,68,70]).buffer }] });
    input.dispatchEvent(new CustomEvent('change'));
    await flush(); await flush(); await flush();
    return element;
}

it('keeps local edits when assigning a destination later, and saves only to that destination', async () => {
    const element = await mountLocalPdf();
    const button = (label) => [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
    expect(button('Enregistrer').disabled).toBe(true);
    button('Texte').click(); await flush();
    button('Placer l’outil au centre').click(); await flush(); await flush(); await flush();
    expect(element.shadowRoot.querySelectorAll('.element')).toHaveLength(1);
    await expect(element.prepareRecordChange('006opportunity')).resolves.toBe(true);
    element.recordId = '006opportunity';
    await flush(); await flush();
    expect(element.shadowRoot.querySelectorAll('.element')).toHaveLength(1);
    expect(LightningConfirm.open).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('lightning-radio-group')).toBeNull();
    saveCopy.mockResolvedValue({ documentId:'069copy', versionId:'068copy' });
    button('Enregistrer').click(); await flush(); await flush();
    expect(saveCopy).toHaveBeenCalledWith(expect.objectContaining({recordId:'006opportunity',sourceVersionId:null}));
});

it('downloads an edited local PDF without calling Salesforce save', async () => {
    const element = await mountLocalPdf();
    URL.createObjectURL = jest.fn(() => 'blob:local-pdf');
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    [...element.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === 'Télécharger le PDF').click();
    await flush(); await flush();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('.download-link').download).toBe('local — copie.pdf');
    expect(saveCopy).not.toHaveBeenCalled();
    click.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-pdf');
});

it('requires confirmation and resets a Salesforce document before switching to another record', async () => {
    const element = await mountAndOpen();
    await addElement(element);
    LightningConfirm.open.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(element.prepareRecordChange('006other')).resolves.toBe(false);
    expect(element.shadowRoot.querySelector('canvas')).not.toBeNull();
    await expect(element.prepareRecordChange('006other')).resolves.toBe(true);
    element.recordId = '006other';
    await flush(); await flush();
    expect(element.shadowRoot.querySelector('canvas')).toBeNull();
});

it('treats a freshly opened document as unchanged', async () => {
    const element = await mountAndOpen();
    expect(element.shadowRoot.querySelector('.document-status').textContent).toBe('Aucune modification');
    await expect(element.confirmClose()).resolves.toBe(true);
    expect(LightningConfirm.open).not.toHaveBeenCalled();
});

it('lets the user choose a record even when the engine failed to load', async () => {
    loadScript.mockRejectedValue(new Error('Bibliothèque indisponible'));
    const element = createElement('c-pdf-editor', { is: PdfEditor });
    document.body.appendChild(element);
    await flush();
    await expect(element.prepareRecordChange('001record')).resolves.toBe(true);
});

it('shows additions live without rebuilding or re-rendering the PDF', async () => {
    const element = await mountAndOpen();
    const handle = await window.LovePdfEngine.open.mock.results[0].value;
    expect(handle.render).toHaveBeenCalledTimes(1);
    await addElement(element);
    expect(element.shadowRoot.querySelector('.text-content').textContent).toBe('Votre texte');
    expect(handle.render).toHaveBeenCalledTimes(1);
    expect(window.LovePdfEngine.exportPdf).not.toHaveBeenCalled();
    expect(button(element, 'Texte').disabled).toBe(false);
    button(element, 'Tourner de 90°').click(); await flush(); await flush();
    expect(handle.render).toHaveBeenCalledTimes(2);
    expect(handle.render).toHaveBeenLastCalledWith(0, expect.anything(), 0.85, 90);
});

it('resizes a mask with its handle', async () => {
    HTMLElement.prototype.setPointerCapture = jest.fn();
    const element = await mountAndOpen();
    await addElement(element, 'Masquer visuellement');
    const handle = element.shadowRoot.querySelector('.resize-handle');
    const pointer = (type, x, y) => handle.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true }));
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 120);
    pointer('pointerup', 140, 120);
    await flush();
    expect(Number(element.shadowRoot.querySelector('[data-property="width"]').value)).toBeGreaterThan(140);
    expect(Number(element.shadowRoot.querySelector('[data-property="height"]').value)).toBeGreaterThan(32);
});

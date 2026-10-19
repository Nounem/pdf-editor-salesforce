import { createElement } from 'lwc';
import PdfEditorApp from 'c/pdfEditorApp';
import { CurrentPageReference } from 'lightning/navigation';
import listRecordObjects from '@salesforce/apex/PdfEditorController.listRecordObjects';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';

jest.mock('lightning/platformResourceLoader', () => ({ loadScript: jest.fn().mockResolvedValue() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordPdfs', () => ({ default: jest.fn().mockResolvedValue([]) }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.loadSmallPdf', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveCopy', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveNewVersion', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (app, label) => [...app.shadowRoot.querySelectorAll('lightning-button')].find((item) => item.label === label);
beforeEach(() => {
    window.LovePdfEngine = {};
    listRecordObjects.mockResolvedValue([{label:'Compte',value:'Account'},{label:'Opportunité',value:'Opportunity'},{label:'Compteur',value:'Compteur__c'}]);
});
afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
});
async function mount() {
    const app = createElement('c-pdf-editor-app', { is: PdfEditorApp });
    document.body.appendChild(app);
    await flush(); await flush();
    return app;
}
async function pick(app, recordId = '006record') {
    app.shadowRoot.querySelector('lightning-record-picker').dispatchEvent(new CustomEvent('change', { detail: { recordId } }));
    await flush(); await flush();
}
const editorOf = (app) => app.shadowRoot.querySelector('c-pdf-editor');

it('makes local PDF editing available without a record, including when object discovery fails', async () => {
    listRecordObjects.mockRejectedValueOnce(new Error('offline'));
    const app = await mount();
    const editor = editorOf(app);
    expect(editor.recordId).toBeUndefined();
    expect(button(editor, 'Depuis mon ordinateur').disabled).toBe(false);
    expect(listRecordPdfs).not.toHaveBeenCalled();
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('PDF');
});

it('preselects opportunities and applies a picked record at once', async () => {
    const app = await mount();
    expect(app.shadowRoot.querySelector('lightning-combobox').value).toBe('Opportunity');
    expect(button(app, 'Utiliser cet enregistrement')).toBeUndefined();
    await pick(app);
    expect(editorOf(app).recordId).toBe('006record');
    expect(listRecordPdfs).toHaveBeenCalledWith({ recordId: '006record' });
    expect(button(app, 'Ouvrir l’enregistrement')).toBeDefined();
});

it('offers custom objects and clears the search when changing object, keeping the destination', async () => {
    const app = await mount();
    await pick(app);
    const objects = app.shadowRoot.querySelector('lightning-combobox');
    expect(objects.options.some((item) => item.value === 'Compteur__c')).toBe(true);
    objects.dispatchEvent(new CustomEvent('change', { detail: { value: 'Compteur__c' } }));
    await flush();
    expect(app.shadowRoot.querySelector('lightning-record-picker').value).toBeNull();
    expect(editorOf(app).recordId).toBe('006record');
    await pick(app, 'a00meter');
    expect(editorOf(app).recordId).toBe('a00meter');
});

it('keeps the previous destination if the user refuses to discard changes', async () => {
    const app = await mount();
    await pick(app);
    const editor = editorOf(app);
    jest.spyOn(editor, 'prepareRecordChange').mockResolvedValue(false);
    await pick(app, '006other');
    expect(editor.recordId).toBe('006record');
    expect(app.shadowRoot.querySelector('lightning-record-picker').value).toBe('006record');
});

it('shows why a record cannot be applied during a treatment', async () => {
    const app = await mount();
    jest.spyOn(editorOf(app), 'prepareRecordChange').mockRejectedValue(new Error('Attendez la fin du traitement.'));
    await pick(app);
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Attendez');
    expect(editorOf(app).recordId).toBeUndefined();
});

it('opens directly on the record sent by the « Modifier un PDF » action', async () => {
    const app = await mount();
    CurrentPageReference.emit({ type: 'standard__navItemPage', attributes: { apiName: 'PDF_Editor' }, state: { c__recordId: '006fromAction', c__objectApiName: 'Opportunity' } });
    await flush(); await flush(); await flush();
    expect(editorOf(app).recordId).toBe('006fromAction');
    expect(app.shadowRoot.querySelector('lightning-record-picker').value).toBe('006fromAction');
    expect(listRecordPdfs).toHaveBeenCalledWith({ recordId: '006fromAction' });
});

it('keeps local editing available after a picker error', async () => {
    const app = await mount();
    await pick(app);
    app.shadowRoot.querySelector('lightning-record-picker').dispatchEvent(new CustomEvent('error'));
    await flush();
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('indisponible');
    expect(editorOf(app).recordId).toBe('006record');
    expect(button(editorOf(app), 'Depuis mon ordinateur').disabled).toBe(false);
});

import { createElement } from 'lwc';
import PdfEditorApp from 'c/pdfEditorApp';
import listRecordObjects from '@salesforce/apex/PdfEditorController.listRecordObjects';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';

jest.mock('lightning/platformResourceLoader', () => ({ loadScript: jest.fn().mockResolvedValue() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordPdfs', () => ({ default: jest.fn().mockResolvedValue([]) }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.loadSmallPdf', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveCopy', () => ({ default: jest.fn() }), { virtual: true });

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
async function select(app, recordId = '001record') {
    const picker = app.shadowRoot.querySelector('lightning-record-picker');
    picker.checkValidity = jest.fn().mockReturnValue(true);
    picker.reportValidity = jest.fn();
    picker.dispatchEvent(new CustomEvent('change', {detail:{recordId}}));
    await flush();
    return picker;
}
async function apply(app) {
    button(app, 'Utiliser cet enregistrement').click();
    await flush(); await flush();
}

it('makes local PDF editing available without a record, including when object discovery fails', async () => {
    listRecordObjects.mockRejectedValueOnce(new Error('offline'));
    const app = await mount();
    const editor = app.shadowRoot.querySelector('c-pdf-editor');
    expect(editor).not.toBeNull();
    expect(editor.recordId).toBeUndefined();
    expect(button(editor, 'Depuis mon ordinateur').disabled).toBe(false);
    expect(listRecordPdfs).not.toHaveBeenCalled();
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('PDF');
});

it('offers custom objects, clears an old record when changing object and applies its context', async () => {
    const app = await mount();
    await select(app);
    const objects = app.shadowRoot.querySelector('lightning-combobox');
    expect(objects.options.some((item) => item.value === 'Compteur__c')).toBe(true);
    objects.dispatchEvent(new CustomEvent('change', {detail:{value:'Compteur__c'}}));
    await flush();
    expect(app.shadowRoot.querySelector('lightning-record-picker').value).toBeNull();
    expect(button(app, 'Utiliser cet enregistrement').disabled).toBe(true);
    await select(app, 'a00meter');
    await apply(app);
    expect(app.shadowRoot.querySelector('c-pdf-editor').recordId).toBe('a00meter');
    expect(listRecordPdfs).toHaveBeenCalledWith({recordId:'a00meter'});
});

it('keeps the same editor instance when assigning a record and when cancelling a new selection', async () => {
    const app = await mount();
    const editor = app.shadowRoot.querySelector('c-pdf-editor');
    await select(app); await apply(app);
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBe(editor);
    button(app, 'Changer d’enregistrement').click(); await flush();
    expect(editor.contextPending).toBe(true);
    await select(app, '001other');
    button(app, 'Annuler le changement').click(); await flush();
    expect(editor.recordId).toBe('001record');
    expect(editor.contextPending).toBe(false);
    expect(app.shadowRoot.querySelector('lightning-record-picker').value).toBe('001record');
});

it('preserves the old destination if document-discard confirmation is cancelled', async () => {
    const app = await mount();
    await select(app); await apply(app);
    const editor = app.shadowRoot.querySelector('c-pdf-editor');
    button(app, 'Changer d’enregistrement').click(); await flush();
    await select(app, '001other');
    jest.spyOn(editor, 'prepareRecordChange').mockResolvedValue(false);
    await apply(app);
    expect(editor.recordId).toBe('001record');
    expect(editor.contextPending).toBe(true);
});

it('does not apply an invalid picker selection or switch during a treatment', async () => {
    const app = await mount();
    const picker = await select(app);
    picker.checkValidity.mockReturnValue(false);
    await apply(app);
    expect(app.shadowRoot.querySelector('c-pdf-editor').recordId).toBeUndefined();
    expect(picker.reportValidity).toHaveBeenCalled();
    picker.checkValidity.mockReturnValue(true);
    jest.spyOn(app.shadowRoot.querySelector('c-pdf-editor'), 'prepareRecordChange').mockRejectedValue(new Error('Attendez le traitement.'));
    await apply(app);
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Attendez');
});

it('blocks Salesforce saving after a picker error while keeping local editing available', async () => {
    const app = await mount();
    await select(app); await apply(app);
    const editor = app.shadowRoot.querySelector('c-pdf-editor');
    app.shadowRoot.querySelector('lightning-record-picker').dispatchEvent(new CustomEvent('error'));
    await flush();
    expect(editor.recordId).toBe('001record');
    expect(editor.contextPending).toBe(true);
    expect(button(app, 'Utiliser cet enregistrement').disabled).toBe(true);
    expect(button(editor, 'Depuis mon ordinateur').disabled).toBe(false);
});

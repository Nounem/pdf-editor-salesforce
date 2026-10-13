import { createElement } from 'lwc';
import PdfEditorApp from 'c/pdfEditorApp';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';

jest.mock('lightning/platformResourceLoader', () => ({ loadScript: jest.fn().mockResolvedValue() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.listRecordPdfs', () => ({ default: jest.fn().mockResolvedValue([]) }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.loadSmallPdf', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/PdfEditorController.saveCopy', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => { window.LovePdfEngine = {}; });
afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
});

async function mount() {
    const app = createElement('c-pdf-editor-app', { is: PdfEditorApp });
    document.body.appendChild(app);
    await flush();
    const picker = app.shadowRoot.querySelector('lightning-record-picker');
    picker.checkValidity = jest.fn().mockReturnValue(true);
    picker.reportValidity = jest.fn();
    return { app, picker };
}
async function open(app, picker) {
    picker.dispatchEvent(new CustomEvent('change', { detail: { recordId: '001record' } }));
    await flush();
    app.shadowRoot.querySelector('lightning-button').click();
    await flush(); await flush();
    return app.shadowRoot.querySelector('c-pdf-editor');
}

it('requires a valid record before opening the editor and passing its context', async () => {
    const { app, picker } = await mount();
    expect(app.shadowRoot.querySelector('lightning-button').disabled).toBe(true);
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBeNull();
    const editor = await open(app, picker);
    expect(editor.recordId).toBe('001record');
    expect(listRecordPdfs).toHaveBeenCalledWith({ recordId: '001record' });
    expect(picker.disabled).toBe(true);
    picker.dispatchEvent(new CustomEvent('change', { detail: { recordId: '001other' } }));
    await flush();
    expect(editor.recordId).toBe('001record');
});

it('does not open the editor if the picker reports an error', async () => {
    const { app, picker } = await mount();
    picker.checkValidity.mockReturnValue(false);
    await open(app, picker);
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBeNull();
    expect(picker.reportValidity).toHaveBeenCalled();
});

it('keeps the editing session on cancel, then clears it after confirmation', async () => {
    const { app, picker } = await mount();
    const editor = await open(app, picker);
    const close = jest.spyOn(editor, 'confirmClose').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    app.shadowRoot.querySelector('lightning-button').click();
    await flush();
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBe(editor);
    expect(picker.disabled).toBe(true);
    app.shadowRoot.querySelector('lightning-button').click();
    await flush();
    expect(close).toHaveBeenCalledTimes(2);
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBeNull();
    expect(picker.value).toBeNull();
    expect(picker.disabled).toBe(false);
});

it('preserves the editor and shows an explanation when a treatment is running', async () => {
    const { app, picker } = await mount();
    const editor = await open(app, picker);
    jest.spyOn(editor, 'confirmClose').mockRejectedValue(new Error('Attendez la fin du traitement.'));
    app.shadowRoot.querySelector('lightning-button').click();
    await flush();
    expect(app.shadowRoot.querySelector('c-pdf-editor')).toBe(editor);
    expect(app.shadowRoot.querySelector('[role="alert"]').textContent).toContain('Attendez');
});

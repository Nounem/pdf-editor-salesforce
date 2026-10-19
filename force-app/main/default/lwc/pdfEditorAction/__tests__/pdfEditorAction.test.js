import { createElement } from 'lwc';
import PdfEditorAction from 'c/pdfEditorAction';

const mockNavigate = jest.fn();
jest.mock('lightning/navigation', () => {
    const Navigate = Symbol('Navigate');
    const NavigationMixin = (Base) => class extends Base { [Navigate](reference) { mockNavigate(reference); } };
    NavigationMixin.Navigate = Navigate;
    return { NavigationMixin };
}, { virtual: true });

it('opens the editor tab on the current record', () => {
    const element = createElement('c-pdf-editor-action', { is: PdfEditorAction });
    element.recordId = '006record';
    element.objectApiName = 'Opportunity';
    document.body.appendChild(element);
    element.invoke();
    expect(mockNavigate).toHaveBeenCalledWith({
        type: 'standard__navItemPage',
        attributes: { apiName: 'PDF_Editor' },
        state: { c__recordId: '006record', c__objectApiName: 'Opportunity' }
    });
});

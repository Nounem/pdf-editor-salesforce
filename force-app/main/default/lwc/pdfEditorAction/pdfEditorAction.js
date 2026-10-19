import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

// Headless record action: the editor needs the full page width, so it opens in its tab
// with the record preselected instead of a narrow modal.
export default class PdfEditorAction extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    @api invoke() {
        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: { apiName: 'PDF_Editor' },
            state: { c__recordId: this.recordId, c__objectApiName: this.objectApiName }
        });
    }
}

import { LightningElement, api } from 'lwc';

export default class PdfEditorApp extends LightningElement {
    @api objectApiName = 'Account';
    @api pickerLabel = 'Compte';
    selectedRecordId;
    activeRecordId;
    switching = false;
    message = '';

    get pickerDisabled() { return Boolean(this.activeRecordId) || this.switching; }
    get openDisabled() { return !this.selectedRecordId || this.switching; }

    handleRecordChange(event) {
        if (this.pickerDisabled) return;
        this.selectedRecordId = event.detail.recordId;
        this.message = '';
    }

    handleOpen() {
        if (this.openDisabled || this.activeRecordId) return;
        const picker = this.template.querySelector('lightning-record-picker');
        if (!picker.checkValidity()) {
            picker.reportValidity();
            return;
        }
        this.activeRecordId = this.selectedRecordId;
    }

    async handleChangeRecord() {
        if (this.switching) return;
        this.switching = true;
        this.message = '';
        try {
            const editor = this.template.querySelector('c-pdf-editor');
            if (!editor || !await editor.confirmClose()) return;
            this.activeRecordId = null;
            this.selectedRecordId = null;
        } catch (error) {
            this.message = error.message || 'Impossible de changer d’enregistrement pour le moment.';
        } finally {
            this.switching = false;
        }
    }
}

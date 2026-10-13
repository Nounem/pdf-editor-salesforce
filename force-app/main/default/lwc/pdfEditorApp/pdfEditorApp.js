import { LightningElement, api } from 'lwc';
import listRecordObjects from '@salesforce/apex/PdfEditorController.listRecordObjects';

export default class PdfEditorApp extends LightningElement {
    @api objectApiName = 'Account';
    @api pickerLabel = 'Enregistrement';
    objects = [];
    objectFilter = '';
    selectedObject;
    selectedRecordId;
    activeRecordId;
    activeObject;
    choosing = true;
    switching = false;
    loadingObjects = false;
    message = '';

    connectedCallback() { this.loadObjects(); }

    async loadObjects() {
        this.loadingObjects = true;
        this.message = '';
        try {
            this.objects = [...await listRecordObjects()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
            this.selectedObject = this.objects.some((item) => item.value === this.objectApiName)
                ? this.objectApiName : this.objects[0]?.value;
            if (!this.objects.length) this.message = 'Aucun objet disponible pour la recherche avec vos droits actuels. L’ouverture d’un PDF local reste disponible.';
        } catch {
            this.message = 'La recherche Salesforce est indisponible. Vous pouvez toujours ouvrir un PDF depuis votre ordinateur.';
        } finally { this.loadingObjects = false; }
    }

    get pickerDisabled() { return !this.choosing || this.switching || this.loadingObjects; }
    get openDisabled() { return !this.selectedRecordId || this.pickerDisabled; }
    get contextPending() { return this.choosing && Boolean(this.activeRecordId); }
    get objectOptions() {
        const query = this.objectFilter.trim().toLocaleLowerCase('fr');
        return this.objects.filter((item) => item.value === this.selectedObject || `${item.label} ${item.value}`.toLocaleLowerCase('fr').includes(query));
    }
    // Remount the native picker when its object changes to clear its cached selection.
    get pickerObjects() { return this.selectedObject ? [{ value: this.selectedObject }] : []; }

    handleObjectFilter(event) { this.objectFilter = event.target.value; }
    handleObjectChange(event) {
        if (this.pickerDisabled) return;
        this.selectedObject = event.detail.value;
        this.selectedRecordId = null;
        this.message = '';
    }
    handleRecordChange(event) {
        if (this.pickerDisabled || event.currentTarget.dataset.object !== this.selectedObject) return;
        this.selectedRecordId = event.detail.recordId;
        this.message = '';
    }
    handlePickerError(event) {
        if (event.currentTarget.dataset.object !== this.selectedObject) return;
        this.choosing = true;
        this.selectedRecordId = null;
        this.message = 'La recherche sur cet objet est indisponible. Vérifiez vos droits ou choisissez un autre objet. Vous pouvez aussi ouvrir un PDF local.';
    }

    async handleOpen() {
        if (this.openDisabled) return;
        const picker = this.template.querySelector('lightning-record-picker');
        if (!picker.checkValidity()) { picker.reportValidity(); return; }
        this.switching = true;
        this.message = '';
        try {
            const editor = this.template.querySelector('c-pdf-editor');
            if (!await editor.prepareRecordChange(this.selectedRecordId)) return;
            this.activeRecordId = this.selectedRecordId;
            this.activeObject = this.selectedObject;
            this.choosing = false;
        } catch (error) {
            this.message = error.message || 'Impossible de changer d’enregistrement pour le moment.';
        } finally { this.switching = false; }
    }

    handleChangeRecord() { this.choosing = true; this.message = ''; }
    handleCancel() {
        this.selectedObject = this.activeObject;
        this.selectedRecordId = this.activeRecordId;
        this.objectFilter = '';
        this.choosing = false;
        this.message = '';
    }
}

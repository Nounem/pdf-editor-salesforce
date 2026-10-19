import { LightningElement, api, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import listRecordObjects from '@salesforce/apex/PdfEditorController.listRecordObjects';

export default class PdfEditorApp extends NavigationMixin(LightningElement) {
    @api objectApiName = 'Opportunity';
    @api pickerLabel = 'Enregistrement';
    objects = [];
    selectedObject;
    selectedRecordId;
    activeRecordId;
    pendingRecordId;
    switching = false;
    loadingObjects = false;
    message = '';

    // The « Modifier un PDF » record action opens this page with the record in its URL state.
    @wire(CurrentPageReference)
    setPageReference(reference) {
        const { c__recordId: recordId, c__objectApiName: objectApiName } = reference?.state || {};
        if (!recordId || recordId === this.activeRecordId) return;
        if (objectApiName) {
            this.selectedObject = objectApiName;
            if (this.objects.length && !this.objects.some((item) => item.value === objectApiName)) {
                this.objects = [{ label: objectApiName, value: objectApiName }, ...this.objects];
            }
        }
        this.selectedRecordId = recordId;
        this.pendingRecordId = recordId;
    }

    connectedCallback() { this.loadObjects(); }

    renderedCallback() {
        if (this.pendingRecordId && !this.switching) {
            const recordId = this.pendingRecordId;
            this.pendingRecordId = null;
            this.applyRecord(recordId);
        }
    }

    async loadObjects() {
        this.loadingObjects = true;
        this.message = '';
        try {
            this.objects = [...await listRecordObjects()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
            if (this.selectedObject && !this.objects.some((item) => item.value === this.selectedObject)) {
                // An object opened from a record action stays usable even if it is not in the list.
                this.objects = [{ label: this.selectedObject, value: this.selectedObject }, ...this.objects];
            }
            if (!this.selectedObject) {
                this.selectedObject = this.objects.some((item) => item.value === this.objectApiName)
                    ? this.objectApiName : this.objects[0]?.value;
            }
            if (!this.objects.length) this.message = 'Aucun objet disponible pour la recherche avec vos droits actuels. L’ouverture d’un PDF local reste disponible.';
        } catch {
            this.message = 'La recherche Salesforce est indisponible. Vous pouvez toujours ouvrir un PDF depuis votre ordinateur.';
        } finally { this.loadingObjects = false; }
    }

    get pickerDisabled() { return this.switching || this.loadingObjects; }
    get objectOptions() { return this.objects; }
    // Remount the native picker when its object changes to clear its cached selection.
    get pickerObjects() { return this.selectedObject ? [{ value: this.selectedObject }] : []; }

    handleObjectChange(event) {
        if (this.pickerDisabled) return;
        this.selectedObject = event.detail.value;
        this.selectedRecordId = null;
        this.message = '';
    }

    // A picked record applies at once: no separate confirmation button.
    handleRecordChange(event) {
        if (this.pickerDisabled || event.currentTarget.dataset.object !== this.selectedObject) return;
        const recordId = event.detail.recordId;
        // Clearing the search keeps the current destination.
        if (!recordId || recordId === this.activeRecordId) return;
        this.selectedRecordId = recordId;
        this.applyRecord(recordId);
    }

    handlePickerError(event) {
        if (event.currentTarget.dataset.object !== this.selectedObject) return;
        this.message = 'La recherche sur cet objet est indisponible. Vérifiez vos droits ou choisissez un autre objet. Vous pouvez aussi ouvrir un PDF local.';
    }

    async applyRecord(recordId) {
        this.switching = true;
        this.message = '';
        try {
            const editor = this.template.querySelector('c-pdf-editor');
            if (await editor.prepareRecordChange(recordId)) this.activeRecordId = recordId;
            else this.selectedRecordId = this.activeRecordId;
        } catch (error) {
            this.selectedRecordId = this.activeRecordId;
            this.message = error.message || 'Impossible de changer d’enregistrement pour le moment.';
        } finally { this.switching = false; }
    }

    handleViewRecord() {
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: this.activeRecordId, actionName: 'view' } });
    }
}

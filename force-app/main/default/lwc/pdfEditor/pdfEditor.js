import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import LightningConfirm from 'lightning/confirm';
import { NavigationMixin } from 'lightning/navigation';
import engineResource from '@salesforce/resourceUrl/lovePdfEngine';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';
import loadSmallPdf from '@salesforce/apex/PdfEditorController.loadSmallPdf';
import saveCopy from '@salesforce/apex/PdfEditorController.saveCopy';
import { MAX_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, createState, createHistory, commit, undo, redo, fromBase64, toBase64, boundedNumber } from 'c/pdfEditState';

export default class PdfEditor extends NavigationMixin(LightningElement) {
    @api recordId;
    initialized = false;
    ready = false;
    busy = false;
    rendering = false;
    message = '';
    success = '';
    files = [];
    selectedFile = '';
    history;
    pageIndex = 0;
    zoom = 0.85;
    tool = 'select';
    selectedId;
    title = '';
    sourceVersionId = null;
    sourceBytes;
    sourceHandle;
    previewHandle;
    viewport;
    engine;
    assets = new Map();
    pendingImage;
    savedSnapshot = '';
    savedTitle = '';
    saveRequestId;
    savedDocumentId;
    documentRecordId;
    filesRecordId;
    renderRevision = 0;
    renderedRevision = -1;
    renderTimer;
    disconnected = false;
    drag;
    beforeUnload = (event) => {
        if (this.dirty) { event.preventDefault(); event.returnValue = ''; }
    };

    connectedCallback() {
        this.disconnected = false;
        window.addEventListener('beforeunload', this.beforeUnload);
    }

    renderedCallback() {
        if (!this.initialized) {
            this.initialized = true;
            this.initialize();
        }
        if (this.ready && this.filesRecordId !== this.recordId) this.refreshFiles();
        if (this.history && !this.rendering && this.renderedRevision !== this.renderRevision) this.renderPage();
    }

    disconnectedCallback() {
        this.disconnected = true;
        clearTimeout(this.renderTimer);
        window.removeEventListener('beforeunload', this.beforeUnload);
        // A running render owns its handle until it completes.
        if (!this.rendering) this.previewHandle?.destroy();
        this.sourceHandle?.destroy();
        this.assets.clear();
        this.sourceBytes = null;
    }

    async initialize() {
        this.busy = true;
        try {
            await loadScript(this, engineResource);
            this.engine = window.LovePdfEngine;
            if (!this.engine) throw new Error('Le moteur PDF n’a pas pu être initialisé.');
            this.ready = true;
            await this.refreshFiles();
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    async refreshFiles() {
        const recordId = this.recordId;
        this.filesRecordId = recordId;
        this.selectedFile = '';
        if (!recordId) { this.files = []; return; }
        try {
            const files = await listRecordPdfs({ recordId });
            if (recordId !== this.recordId) return;
            this.files = files.map((file) => ({ label: `${file.title} · ${Math.ceil(file.size / 1000)} ko`, value: file.versionId }));
        } catch (error) { this.fail(error); }
    }

    get hasDocument() { return Boolean(this.history); }
    get noDocument() { return !this.hasDocument; }
    get disabled() { return this.busy || this.rendering || !this.ready; }
    get openDisabled() { return this.disabled || !this.selectedFile; }
    get saveDisabled() { return this.disabled || !this.history || !this.recordId || this.contextChanged || !this.dirty; }
    get contextChanged() { return this.hasDocument && this.documentRecordId !== this.recordId; }
    get missingRecord() { return !this.recordId; }
    get undoDisabled() { return this.disabled || !this.history?.past.length; }
    get redoDisabled() { return this.disabled || !this.history?.future.length; }
    get previousDisabled() { return this.disabled || this.pageIndex === 0; }
    get nextDisabled() { return this.disabled || this.pageIndex >= (this.history?.present.pages.length || 0) - 1; }
    get deletePageDisabled() { return this.disabled || this.history?.present.pages.length === 1; }
    get page() { return this.history?.present.pages[this.pageIndex]; }
    get selected() { return this.page?.elements.find((element) => element.id === this.selectedId); }
    get selectedIsText() { return this.selected?.type === 'text'; }
    get selectedHasSize() { return this.selected && this.selected.type !== 'text'; }
    get pageLabel() { return `Page ${this.pageIndex + 1} sur ${this.history?.present.pages.length || 0}`; }
    get zoomLabel() { return `${Math.round(this.zoom * 100)} %`; }
    get stageStyle() { return this.viewport ? `width:${this.viewport.width}px;height:${this.viewport.height}px;` : ''; }
    get dirty() { return Boolean(this.history) && (JSON.stringify(this.history.present) !== this.savedSnapshot || this.title !== this.savedTitle); }
    get status() { return this.dirty ? 'Modifications non enregistrées' : 'Copie enregistrée'; }
    get selectVariant() { return this.tool === 'select' ? 'brand' : 'neutral'; }
    get textVariant() { return this.tool === 'text' ? 'brand' : 'neutral'; }
    get maskVariant() { return this.tool === 'mask' ? 'brand' : 'neutral'; }
    get placementHint() {
        if (this.pendingImage) return 'Cliquez sur la page pour placer votre image.';
        if (this.tool === 'text') return 'Cliquez sur la page pour ajouter une ligne de texte.';
        if (this.tool === 'mask') return 'Cliquez sur la page pour masquer une zone. Le contenu reste récupérable.';
        return 'Sélectionnez un ajout pour le déplacer ou modifier ses propriétés.';
    }
    get overlays() {
        if (!this.viewport || !this.page) return [];
        return this.page.elements.map((element) => {
            const item = this.drag?.id === element.id ? { ...element, x: this.drag.x, y: this.drag.y } : element;
            const rectangle = [
                ...this.viewport.convertToViewportPoint(item.x, item.y),
                ...this.viewport.convertToViewportPoint(item.x + item.width, item.y + item.height)
            ];
            const left = Math.min(rectangle[0], rectangle[2]);
            const top = Math.min(rectangle[1], rectangle[3]);
            return {
                id: item.id,
                label: item.type === 'text' ? `Texte : ${item.text}` : item.type === 'image' ? 'Image ajoutée' : 'Masquage visuel',
                style: `left:${left}px;top:${top}px;width:${Math.max(16, Math.abs(rectangle[2] - rectangle[0]))}px;height:${Math.max(16, Math.abs(rectangle[3] - rectangle[1]))}px;`,
                className: item.id === this.selectedId ? 'element selected' : 'element',
                pressed: item.id === this.selectedId
            };
        });
    }

    fail(error) {
        this.message = error?.body?.message || error?.message || 'Une erreur est survenue. Réessayez.';
        this.success = '';
    }

    handleFileSelection(event) { this.selectedFile = event.detail.value; }
    handleChooseLocalFile() {
        if (!this.disabled) this.template.querySelector('.local-file').click();
    }
    handleChooseImage() {
        if (!this.disabled) this.template.querySelector('.image-file').click();
    }
    async handleOpenSalesforce() {
        if (this.disabled || !await this.confirmDiscard()) return;
        this.busy = true;
        this.message = '';
        try {
            const recordId = this.recordId;
            const file = await loadSmallPdf({ recordId, versionId: this.selectedFile });
            await this.openBytes(fromBase64(file.base64), file.title, file.versionId, recordId);
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    async handleLocalFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || this.disabled || !await this.confirmDiscard()) return;
        this.busy = true;
        this.message = '';
        try {
            if (file.size > MAX_BYTES) throw new Error('Le fichier dépasse 1 Mo.');
            const recordId = this.recordId;
            await this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pdf$/i, ''), null, recordId);
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    async confirmDiscard() {
        return !this.dirty || LightningConfirm.open({ label: 'Changer de document', message: 'Abandonner les modifications non enregistrées ?', theme: 'warning' });
    }

    async openBytes(bytes, name, sourceVersionId, recordId) {
        const handle = await this.engine.open(bytes);
        await this.sourceHandle?.destroy();
        await this.previewHandle?.destroy();
        this.previewHandle = null;
        this.sourceHandle = handle;
        this.sourceBytes = bytes;
        this.sourceVersionId = sourceVersionId;
        this.documentRecordId = recordId;
        this.title = `${name.slice(0, 85)} — copie`;
        this.history = createHistory(createState(handle.pageCount));
        this.assets = new Map();
        this.selectedId = null;
        this.pendingImage = null;
        this.pageIndex = 0;
        this.viewport = null;
        this.tool = 'select';
        this.savedSnapshot = '';
        this.savedTitle = '';
        this.success = '';
        this.saveRequestId = null;
        this.savedDocumentId = null;
        this.scheduleRender();
    }

    scheduleRender() {
        this.renderRevision += 1;
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => {
            if (!this.disconnected && !this.rendering) this.renderPage();
        }, 0);
    }

    async renderPage() {
        const canvas = this.template.querySelector('canvas');
        if (!canvas || !this.sourceBytes || this.rendering || this.disconnected) return;
        const revision = this.renderRevision;
        this.rendering = true;
        try {
            // Rendering the actual exported bytes keeps the preview faithful to the saved PDF.
            const bytes = await this.engine.exportPdf(this.sourceBytes, this.history.present, this.assets);
            await this.previewHandle?.destroy();
            this.previewHandle = await this.engine.open(bytes);
            if (this.disconnected) return;
            this.viewport = await this.previewHandle.render(this.pageIndex, canvas, this.zoom, 0);
        } catch (error) { this.fail(error); }
        finally {
            this.renderedRevision = revision;
            this.rendering = false;
            if (this.disconnected) {
                await this.previewHandle?.destroy();
            } else if (revision !== this.renderRevision) {
                this.renderTimer = setTimeout(() => this.renderPage(), 0);
            }
        }
    }

    change(command) {
        try {
            this.history = commit(this.history, command);
            this.pageIndex = Math.min(this.pageIndex, this.history.present.pages.length - 1);
            this.saveRequestId = null;
            this.savedDocumentId = null;
            this.message = '';
            this.success = '';
            this.scheduleRender();
        } catch (error) { this.fail(error); }
    }

    handleTool(event) { this.tool = event.currentTarget.dataset.tool; this.pendingImage = null; }
    handleTitle(event) { this.title = event.target.value; this.saveRequestId = null; this.success = ''; }
    handlePrevious() { if (!this.previousDisabled) { this.pageIndex -= 1; this.selectedId = null; this.scheduleRender(); } }
    handleNext() { if (!this.nextDisabled) { this.pageIndex += 1; this.selectedId = null; this.scheduleRender(); } }
    handleZoom(event) { this.zoom = Number(event.detail.value); this.scheduleRender(); }
    get zoomOptions() { return [{ label: '60 %', value: '0.6' }, { label: '85 %', value: '0.85' }, { label: '100 %', value: '1' }, { label: '125 %', value: '1.25' }]; }
    get zoomValue() { return String(this.zoom); }
    handleUndo() { if (!this.undoDisabled) { this.history = undo(this.history); this.afterHistory(); } }
    handleRedo() { if (!this.redoDisabled) { this.history = redo(this.history); this.afterHistory(); } }
    afterHistory() {
        this.pageIndex = Math.min(this.pageIndex, this.history.present.pages.length - 1);
        this.selectedId = null;
        this.saveRequestId = null;
        this.success = '';
        this.message = '';
        this.scheduleRender();
    }
    handleRotate() { this.change({ type: 'rotate', pageId: this.page.id }); }
    async handleDeletePage() {
        if (this.deletePageDisabled) return;
        if (await LightningConfirm.open({ label: 'Supprimer cette page', message: 'Retirer cette page de la copie ? L’original sera conservé.', theme: 'warning' })) {
            this.change({ type: 'deletePage', pageId: this.page.id });
            this.selectedId = null;
        }
    }

    async handleImage(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || this.disabled) return;
        this.busy = true;
        try {
            if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_IMAGE_BYTES) throw new Error('Choisissez une image PNG ou JPEG de 500 ko maximum.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            const bitmap = await createImageBitmap(file);
            const { width, height } = bitmap;
            bitmap.close();
            if (width * height > MAX_IMAGE_PIXELS) throw new Error('L’image dépasse 8 millions de pixels.');
            this.pendingImage = { bytes, mime: file.type, width, height };
            this.tool = 'image';
            this.message = '';
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    handleStageClick(event) {
        if (this.disabled || !this.viewport || event.target.dataset.elementId || this.tool === 'select') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const [x, y] = this.viewport.convertToPdfPoint(event.clientX - bounds.left, event.clientY - bounds.top);
        this.addAt(x, y);
    }

    handleAddCentered() {
        if (this.disabled || !this.viewport || this.tool === 'select') return;
        const [x, y] = this.viewport.convertToPdfPoint(this.viewport.width / 3, this.viewport.height / 2);
        this.addAt(x, y);
    }

    addAt(x, y) {
        try {
            const id = crypto.randomUUID();
            let element;
            if (this.tool === 'text') {
                const metrics = this.sourceHandle.measure('Votre texte', 16);
                element = { id, type: 'text', x, y, text: 'Votre texte', fontSize: 16, color: '#182c37', ...metrics };
            } else if (this.tool === 'mask') {
                element = { id, type: 'mask', x, y, width: 140, height: 32 };
            } else if (this.pendingImage) {
                this.assets.set(id, this.pendingImage);
                element = { id, type: 'image', x, y, assetId: id, width: 160, height: 160 * this.pendingImage.height / this.pendingImage.width };
                this.pendingImage = null;
            }
            if (!element) return;
            this.change({ type: 'add', pageId: this.page.id, element });
            this.selectedId = id;
            this.tool = 'select';
        } catch (error) { this.fail(error); }
    }

    handleSelect(event) { event.stopPropagation(); this.selectedId = event.currentTarget.dataset.elementId; }
    handleProperty(event) {
        if (!this.selected || this.disabled) return;
        try {
            const key = event.target.dataset.property;
            let value = event.target.value;
            if (key === 'fontSize') value = boundedNumber(value, 6, 96);
            if (key === 'x' || key === 'y') value = boundedNumber(value, -10000, 10000);
            if (key === 'width' || key === 'height') value = boundedNumber(value, 1, 2000);
            const patch = { [key]: value };
            if (this.selected.type === 'text') Object.assign(patch, this.sourceHandle.measure(patch.text ?? this.selected.text, patch.fontSize ?? this.selected.fontSize));
            this.change({ type: 'update', pageId: this.page.id, elementId: this.selectedId, patch });
        } catch (error) { this.fail(error); }
    }

    handleRemove() {
        if (!this.selected || this.disabled) return;
        this.change({ type: 'remove', pageId: this.page.id, elementId: this.selectedId });
        this.selectedId = null;
    }

    handleElementKey(event) {
        this.selectedId = event.currentTarget.dataset.elementId;
        if (this.disabled) return;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.handleRemove(); return; }
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key]) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const [dx, dy] = directions[event.key];
        this.moveSelected(dx * step, dy * step);
    }

    moveSelected(dx, dy) {
        const zero = this.viewport.convertToPdfPoint(0, 0);
        const offset = this.viewport.convertToPdfPoint(dx, dy);
        this.change({ type: 'update', pageId: this.page.id, elementId: this.selectedId,
            patch: { x: this.selected.x + offset[0] - zero[0], y: this.selected.y + offset[1] - zero[1] } });
    }

    handlePointerDown(event) {
        if (this.disabled || event.button !== 0 || this.tool !== 'select') return;
        this.selectedId = event.currentTarget.dataset.elementId;
        event.currentTarget.setPointerCapture(event.pointerId);
        this.drag = { id: this.selectedId, startX: event.clientX, startY: event.clientY, originalX: this.selected.x, originalY: this.selected.y, x: this.selected.x, y: this.selected.y };
    }
    handlePointerMove(event) {
        if (!this.drag) return;
        const zero = this.viewport.convertToPdfPoint(0, 0);
        const offset = this.viewport.convertToPdfPoint(event.clientX - this.drag.startX, event.clientY - this.drag.startY);
        this.drag = { ...this.drag, x: this.drag.originalX + offset[0] - zero[0], y: this.drag.originalY + offset[1] - zero[1] };
    }
    handlePointerUp() {
        if (!this.drag) return;
        const drag = this.drag;
        this.drag = null;
        if (drag.x !== drag.originalX || drag.y !== drag.originalY) this.change({ type: 'update', pageId: this.page.id, elementId: drag.id, patch: { x: drag.x, y: drag.y } });
    }
    handlePointerCancel() { this.drag = null; }

    async handleSave() {
        if (this.saveDisabled) return;
        this.busy = true;
        this.message = '';
        try {
            if (!this.title.trim() || this.title.length > 100) throw new Error('Saisissez un titre de 1 à 100 caractères.');
            const bytes = await this.engine.exportPdf(this.sourceBytes, this.history.present, this.assets);
            this.saveRequestId = this.saveRequestId || crypto.randomUUID();
            const result = await saveCopy({ recordId: this.recordId, sourceVersionId: this.sourceVersionId,
                title: this.title, payload: toBase64(bytes), requestId: this.saveRequestId });
            this.savedSnapshot = JSON.stringify(this.history.present);
            this.savedTitle = this.title;
            this.savedDocumentId = result.documentId;
            this.success = 'Votre copie a été enregistrée dans les fichiers de cet enregistrement.';
            await this.refreshFiles();
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    handleViewSaved() {
        this[NavigationMixin.Navigate]({ type: 'standard__namedPage', attributes: { pageName: 'filePreview' }, state: { selectedRecordId: this.savedDocumentId } });
    }
}

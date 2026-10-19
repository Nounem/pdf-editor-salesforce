import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import LightningConfirm from 'lightning/confirm';
import { NavigationMixin } from 'lightning/navigation';
import engineResource from '@salesforce/resourceUrl/lovePdfEngine';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';
import loadSmallPdf from '@salesforce/apex/PdfEditorController.loadSmallPdf';
import saveCopy from '@salesforce/apex/PdfEditorController.saveCopy';
import saveNewVersion from '@salesforce/apex/PdfEditorController.saveNewVersion';
import { MAX_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, createState, createHistory, commit, undo, redo, fromBase64, toBase64, boundedNumber, screenBox, visualAngle } from 'c/pdfEditState';

const BUSY_MESSAGE = 'Attendez la fin du traitement avant de changer d’enregistrement.';
const MIN_RESIZE_PIXELS = 8;

export default class PdfEditor extends NavigationMixin(LightningElement) {
    @api recordId;
    initialized = false;
    ready = false;
    initializationFailed = false;
    filesFailed = false;
    busy = false;
    rendering = false;
    message = '';
    success = '';
    notice = '';
    files = [];
    selectedFile = '';
    history;
    pageIndex = 0;
    zoom = 0.85;
    tool = 'select';
    selectedId;
    title = '';
    sourceVersionId = null;
    sourceTitle = '';
    saveMode = 'copy';
    sourceBytes;
    sourceHandle;
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
    renderedKey;
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
        this.sourceHandle?.destroy();
        this.assets.clear();
        this.sourceBytes = null;
    }

    async initialize() {
        this.busy = true;
        this.initializationFailed = false;
        this.message = '';
        try {
            await loadScript(this, engineResource);
            this.engine = window.LovePdfEngine;
            if (!this.engine) throw new Error('Le moteur PDF n’a pas pu être initialisé.');
            this.ready = true;
            await this.refreshFiles();
        } catch (error) {
            this.initializationFailed = true;
            this.fail(error, 'Impossible de charger le moteur PDF. Vérifiez avec votre administrateur que Lightning Web Security (LWS) est activé, puis réessayez le chargement.');
        }
        finally { this.busy = false; }
    }

    handleRetryEngine() { if (!this.busy) this.initialize(); }
    handleRetryFiles() { if (!this.disabled) { this.message = ''; this.refreshFiles(); } }

    async refreshFiles() {
        const recordId = this.recordId;
        this.filesRecordId = recordId;
        this.selectedFile = '';
        this.files = [];
        this.filesFailed = false;
        if (!recordId) return;
        try {
            const files = await listRecordPdfs({ recordId });
            if (recordId !== this.recordId) return;
            this.files = files.map((file) => ({ label: `${file.title} · ${Math.ceil(file.size / 1000)} ko`, value: file.versionId }));
        } catch (error) {
            if (recordId !== this.recordId) return;
            this.filesFailed = true;
            this.fail(error, 'Impossible de lire les PDF de cet enregistrement. Réessayez ou ouvrez un PDF depuis votre ordinateur.');
        }
    }

    get hasDocument() { return Boolean(this.history); }
    get noDocument() { return !this.hasDocument; }
    // Rendering the preview never blocks the controls: only loading, saving and exporting do.
    get disabled() { return this.busy || !this.ready; }
    get openDisabled() { return this.disabled || !this.selectedFile; }
    get saveDisabled() {
        return this.disabled || !this.history || !this.recordId || this.contextChanged
            || (!this.dirty && Boolean(this.savedDocumentId));
    }
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
    // A Salesforce source is updated in place by default; its version history keeps the original.
    get canSaveVersion() { return Boolean(this.sourceVersionId); }
    get saveAsVersion() { return this.canSaveVersion && this.saveMode === 'version'; }
    get saveAsCopy() { return !this.saveAsVersion; }
    get saveModeOptions() {
        return [{ label: 'Nouvelle version du fichier', value: 'version' }, { label: 'Nouveau fichier', value: 'copy' }];
    }
    get versionHint() { return `« ${this.sourceTitle} » recevra une nouvelle version. Les versions précédentes restent disponibles dans Salesforce Files.`; }
    get status() {
        if (this.dirty) return 'Modifications non enregistrées';
        return this.savedDocumentId ? 'Enregistré' : 'Aucune modification';
    }
    get selectVariant() { return this.tool === 'select' ? 'brand' : 'neutral'; }
    get textVariant() { return this.tool === 'text' ? 'brand' : 'neutral'; }
    get maskVariant() { return this.tool === 'mask' ? 'brand' : 'neutral'; }
    get placementHint() {
        if (this.pendingImage) return 'Cliquez sur la page pour placer votre image.';
        if (this.tool === 'text') return 'Cliquez sur la page pour ajouter une ligne de texte.';
        if (this.tool === 'mask') return 'Cliquez sur la page pour masquer une zone. Le contenu reste récupérable.';
        return 'Sélectionnez un ajout pour le déplacer, le redimensionner ou modifier ses propriétés.';
    }
    get pageRotation() { return this.viewport?.rotation || 0; }
    toScreen = (x, y) => this.viewport.convertToViewportPoint(x, y);

    // Additions are drawn live over the original page; the PDF is only built on download or save.
    get overlays() {
        if (!this.viewport || !this.page) return [];
        return this.page.elements.map((element) => {
            const item = this.drag?.id === element.id ? { ...element, ...this.drag.patch } : element;
            const box = screenBox(item, this.toScreen);
            const selected = item.id === this.selectedId;
            const color = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#000000';
            return {
                id: item.id,
                label: item.type === 'text' ? `Texte : ${item.text}` : item.type === 'image' ? 'Image ajoutée' : 'Masquage visuel',
                style: `left:${box.left}px;top:${box.top}px;width:${Math.max(16, box.width)}px;height:${Math.max(16, box.height)}px;`,
                contentStyle: `width:${item.width * this.zoom}px;height:${item.height * this.zoom}px;transform:translate(-50%,-50%) rotate(${visualAngle(this.pageRotation, item.rotation)}deg);`,
                textStyle: item.type === 'text' ? `font-size:${item.fontSize * this.zoom}px;color:${color};` : '',
                text: item.text,
                imageUrl: this.assets.get(item.assetId)?.url,
                isText: item.type === 'text',
                isImage: item.type === 'image',
                resizable: selected && item.type !== 'text',
                className: selected ? 'element selected' : 'element',
                pressed: selected
            };
        });
    }

    fail(error, context = '') {
        const detail = (Array.isArray(error?.body) ? error.body.map((item) => item.message).filter(Boolean).join(' ') : error?.body?.message)
            || error?.message || (typeof error === 'string' ? error : '');
        this.message = [context, detail].filter(Boolean).join(' ') || 'Une erreur est survenue. Réessayez.';
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

    @api
    async confirmClose() {
        if (this.busy) throw new Error(BUSY_MESSAGE);
        const confirmed = await this.confirmDiscard();
        if (this.busy) throw new Error(BUSY_MESSAGE);
        return confirmed;
    }

    // Only a running load, export or save blocks a record change; a missing engine does not.
    @api
    async prepareRecordChange(nextRecordId) {
        if (this.busy) throw new Error(BUSY_MESSAGE);
        if (this.recordId === nextRecordId) return true;
        const linkedDocument = this.hasDocument && this.sourceVersionId;
        if (linkedDocument && !await this.confirmClose()) return false;
        this.busy = true;
        try {
            if (linkedDocument) {
                // A Salesforce source belongs to its original record. Never silently relink it.
                clearTimeout(this.renderTimer);
                await this.sourceHandle?.destroy();
                this.sourceHandle = null;
                this.sourceBytes = null;
                this.sourceVersionId = null;
                this.history = null;
                this.viewport = null;
                this.renderedKey = null;
                this.assets.clear();
                this.pendingImage = null;
                this.selectedId = null;
                this.drag = null;
                this.notice = '';
            }
            // Local PDFs keep their edits when the user explicitly chooses a destination.
            this.documentRecordId = nextRecordId;
            this.saveRequestId = null;
            this.savedDocumentId = null;
            this.success = '';
            this.message = '';
            return true;
        } finally { this.busy = false; }
    }

    async handleDownload() {
        if (this.disabled || !this.hasDocument) return;
        this.busy = true;
        this.message = '';
        let url;
        try {
            const bytes = await this.engine.exportPdf(this.sourceBytes, this.history.present, this.assets);
            url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            const link = this.template.querySelector('.download-link');
            link.href = url;
            link.download = `${(this.title.trim() || 'Document').replace(/[\\/]/g, '_').replace(/\.pdf$/i, '')}.pdf`;
            link.click();
            link.removeAttribute('href');
        } catch (error) { this.fail(error); }
        finally {
            this.busy = false;
            if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    async openBytes(bytes, name, sourceVersionId, recordId) {
        const handle = await this.engine.open(bytes);
        await this.sourceHandle?.destroy();
        this.sourceHandle = handle;
        this.sourceBytes = bytes;
        this.sourceVersionId = sourceVersionId;
        this.sourceTitle = name;
        this.saveMode = sourceVersionId ? 'version' : 'copy';
        this.documentRecordId = recordId;
        this.title = `${name.slice(0, 85)} — copie`;
        this.history = createHistory(createState(handle.pageCount));
        this.assets = new Map();
        this.selectedId = null;
        this.pendingImage = null;
        this.pageIndex = 0;
        this.viewport = null;
        this.renderedKey = null;
        this.tool = 'select';
        // A freshly opened document has no unsaved changes.
        this.savedSnapshot = JSON.stringify(this.history.present);
        this.savedTitle = this.title;
        this.success = '';
        this.notice = handle.annotations ? 'Les liens et commentaires de ce PDF ne seront pas repris dans la copie.' : '';
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

    // Renders the original page only. Additions are HTML overlays, so most edits need no render.
    async renderPage() {
        const canvas = this.template.querySelector('canvas');
        if (!canvas || !this.sourceHandle || !this.page || this.rendering || this.disconnected) return;
        const revision = this.renderRevision;
        const key = `${this.page.sourceIndex}:${this.page.rotation}:${this.zoom}`;
        if (key === this.renderedKey) { this.renderedRevision = revision; return; }
        this.rendering = true;
        try {
            this.viewport = await this.sourceHandle.render(this.page.sourceIndex, canvas, this.zoom, this.page.rotation);
            this.renderedKey = key;
        } catch (error) { this.fail(error); }
        finally {
            this.renderedRevision = revision;
            this.rendering = false;
            if (!this.disconnected && revision !== this.renderRevision) {
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
    handleSaveMode(event) { this.saveMode = event.detail.value; this.saveRequestId = null; this.savedDocumentId = null; this.success = ''; }
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
            this.pendingImage = { bytes, mime: file.type, width, height, url: `data:${file.type};base64,${toBase64(bytes)}` };
            this.tool = 'image';
            this.message = '';
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    handleStageClick(event) {
        if (this.disabled || this.rendering || !this.viewport || event.target.dataset.elementId || this.tool === 'select') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        this.addAt(event.clientX - bounds.left, event.clientY - bounds.top);
    }

    handleAddCentered() {
        if (this.disabled || this.rendering || !this.viewport || this.tool === 'select') return;
        this.addAt(this.viewport.width / 3, this.viewport.height / 2);
    }

    // Converts a screen offset into the matching PDF offset, whatever the page rotation.
    pdfOffset(dx, dy) {
        const zero = this.viewport.convertToPdfPoint(0, 0);
        const point = this.viewport.convertToPdfPoint(dx, dy);
        return [point[0] - zero[0], point[1] - zero[1]];
    }

    // Moves an element so that its top-left corner on screen lands at (left, top).
    alignTopLeft(element, left, top) {
        const box = screenBox(element, this.toScreen);
        const [dx, dy] = this.pdfOffset(left - box.left, top - box.top);
        return { x: element.x + dx, y: element.y + dy };
    }

    addAt(left, top) {
        try {
            const id = crypto.randomUUID();
            // New additions are upright for the orientation the user currently sees.
            const [x, y] = this.viewport.convertToPdfPoint(left, top);
            const base = { id, x, y, rotation: this.pageRotation };
            let element;
            if (this.tool === 'text') {
                const metrics = this.sourceHandle.measure('Votre texte', 16);
                element = { ...base, type: 'text', text: 'Votre texte', fontSize: 16, color: '#182c37', ...metrics };
            } else if (this.tool === 'mask') {
                element = { ...base, type: 'mask', width: 140, height: 32 };
            } else if (this.pendingImage) {
                this.assets.set(id, this.pendingImage);
                element = { ...base, type: 'image', assetId: id, width: 160, height: 160 * this.pendingImage.height / this.pendingImage.width };
                this.pendingImage = null;
            }
            if (!element) return;
            Object.assign(element, this.alignTopLeft(element, left, top));
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
        const [offsetX, offsetY] = this.pdfOffset(dx, dy);
        this.change({ type: 'update', pageId: this.page.id, elementId: this.selectedId,
            patch: { x: this.selected.x + offsetX, y: this.selected.y + offsetY } });
    }

    handlePointerDown(event) {
        if (this.disabled || event.button !== 0 || this.tool !== 'select') return;
        this.selectedId = event.currentTarget.dataset.elementId;
        event.currentTarget.setPointerCapture(event.pointerId);
        this.drag = { mode: 'move', id: this.selectedId, startX: event.clientX, startY: event.clientY, original: { ...this.selected }, patch: {} };
    }

    handleResizeStart(event) {
        event.stopPropagation();
        if (this.disabled || event.button !== 0 || !this.selected) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const original = { ...this.selected };
        this.drag = { mode: 'resize', id: original.id, startX: event.clientX, startY: event.clientY, original, box: screenBox(original, this.toScreen), patch: {} };
    }

    handlePointerMove(event) {
        if (!this.drag) return;
        const dx = event.clientX - this.drag.startX;
        const dy = event.clientY - this.drag.startY;
        const patch = this.drag.mode === 'resize' ? this.resizePatch(dx, dy) : this.movePatch(dx, dy);
        this.drag = { ...this.drag, patch };
    }

    movePatch(dx, dy) {
        const [offsetX, offsetY] = this.pdfOffset(dx, dy);
        return { x: this.drag.original.x + offsetX, y: this.drag.original.y + offsetY };
    }

    // Resizes from the bottom-right handle while the top-left corner stays in place on screen.
    resizePatch(dx, dy) {
        const { original, box } = this.drag;
        let screenWidth = Math.max(MIN_RESIZE_PIXELS, box.width + dx);
        let screenHeight = Math.max(MIN_RESIZE_PIXELS, box.height + dy);
        if (original.type === 'image') {
            const factor = Math.max(screenWidth / box.width, screenHeight / box.height);
            screenWidth = box.width * factor;
            screenHeight = box.height * factor;
        }
        const sideways = visualAngle(this.pageRotation, original.rotation) % 180 !== 0;
        const clamp = (value) => Math.min(2000, Math.max(1, value / this.zoom));
        const width = clamp(sideways ? screenHeight : screenWidth);
        const height = clamp(sideways ? screenWidth : screenHeight);
        return { width, height, ...this.alignTopLeft({ ...original, width, height }, box.left, box.top) };
    }

    handlePointerUp() {
        if (!this.drag) return;
        const { id, patch } = this.drag;
        this.drag = null;
        if (Object.keys(patch).length) this.change({ type: 'update', pageId: this.page.id, elementId: id, patch });
    }
    handlePointerCancel() { this.drag = null; }

    async handleSave() {
        if (this.saveDisabled) return;
        this.busy = true;
        this.message = '';
        try {
            const asVersion = this.saveAsVersion;
            if (!asVersion && (!this.title.trim() || this.title.length > 100)) throw new Error('Saisissez un nom de 1 à 100 caractères.');
            const bytes = await this.engine.exportPdf(this.sourceBytes, this.history.present, this.assets);
            this.saveRequestId = this.saveRequestId || crypto.randomUUID();
            const request = { recordId: this.recordId, sourceVersionId: this.sourceVersionId, payload: toBase64(bytes), requestId: this.saveRequestId };
            const result = asVersion ? await saveNewVersion(request) : await saveCopy({ ...request, title: this.title });
            this.savedSnapshot = JSON.stringify(this.history.present);
            this.savedTitle = this.title;
            this.savedDocumentId = result.documentId;
            // Further saves build on the version just created.
            if (asVersion) this.sourceVersionId = result.versionId;
            this.success = asVersion
                ? 'Nouvelle version enregistrée. Les versions précédentes restent disponibles dans le fichier.'
                : 'Nouveau fichier enregistré sur cet enregistrement.';
            await this.refreshFiles();
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    handleViewSaved() {
        this[NavigationMixin.Navigate]({ type: 'standard__namedPage', attributes: { pageName: 'filePreview' }, state: { selectedRecordId: this.savedDocumentId } });
    }
}

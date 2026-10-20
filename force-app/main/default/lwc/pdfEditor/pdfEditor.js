import { LightningElement, api, wire } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import LightningConfirm from 'lightning/confirm';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_ID from '@salesforce/user/Id';
import USER_NAME from '@salesforce/schema/User.Name';
import engineResource from '@salesforce/resourceUrl/lovePdfEngine';
import listRecordPdfs from '@salesforce/apex/PdfEditorController.listRecordPdfs';
import loadSmallPdf from '@salesforce/apex/PdfEditorController.loadSmallPdf';
import saveCopy from '@salesforce/apex/PdfEditorController.saveCopy';
import saveNewVersion from '@salesforce/apex/PdfEditorController.saveNewVersion';
import { MAX_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, createState, createHistory, commit, undo, redo, fromBase64, toBase64, boundedNumber, screenBox, visualAngle } from 'c/pdfEditState';

const BUSY_MESSAGE = 'Attendez la fin du traitement avant de changer d’enregistrement.';
const ENGINE_MESSAGE = 'Impossible de charger le moteur PDF. Vérifiez avec votre administrateur que Lightning Web Security (LWS) est activé, puis réessayez le chargement.';
const MIN_RESIZE_PIXELS = 8;
// Shared with the PDF engine (scripts/engine-entry.js): keep both sides in sync.
const STAMP_PADDING = 0.4;
const STAMP_HEIGHT = 1.5;
const FONT_FAMILIES = {
    Helvetica: 'Helvetica, Arial, sans-serif',
    Times: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace'
};
// Same marks as the engine, in a 100 × 100 SVG box with y pointing down.
const MARK_PATHS = { check: 'M15 50 L40 75 L85 20', cross: 'M20 20 L80 80 M20 80 L80 20' };
const RESIZABLE = new Set(['image', 'mask', 'highlight', 'check']);
const KEEP_RATIO = new Set(['image', 'check']);
const EDITABLE_TARGETS = /^(INPUT|TEXTAREA|SELECT|LIGHTNING-INPUT|LIGHTNING-TEXTAREA|LIGHTNING-COMBOBOX)$/;

export default class PdfEditor extends NavigationMixin(LightningElement) {
    @api recordId;
    initializationFailed = false;
    loadingEngine = false;
    enginePromise;
    filesFailed = false;
    busy = false;
    rendering = false;
    painting = false;
    message = '';
    success = '';
    notice = '';
    files = [];
    selectedFile = '';
    history;
    pageIndex = 0;
    zoom = 0.85;
    zoomChoice = 'fit';
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
    pendingStamp = '';
    pendingMark = 'check';
    showSignaturePad = false;
    hasInk = false;
    inkBounds;
    signing = false;
    savedSignature;
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
    resizeTimer;
    disconnected = false;
    drag;
    beforeUnload = (event) => {
        if (this.dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    windowResize = () => {
        if (this.zoomChoice !== 'fit' || !this.history) return;
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.scheduleRender(), 200);
    };

    @wire(getRecord, { recordId: USER_ID, fields: [USER_NAME] }) user;
    get userName() { return this.user?.data ? getFieldValue(this.user.data, USER_NAME) : ''; }

    connectedCallback() {
        this.disconnected = false;
        window.addEventListener('beforeunload', this.beforeUnload);
        window.addEventListener('resize', this.windowResize);
    }

    renderedCallback() {
        if (this.filesRecordId !== this.recordId) this.refreshFiles();
        if (this.history && !this.rendering && this.renderedRevision !== this.renderRevision) this.renderPage();
    }

    disconnectedCallback() {
        this.disconnected = true;
        clearTimeout(this.renderTimer);
        clearTimeout(this.resizeTimer);
        window.removeEventListener('beforeunload', this.beforeUnload);
        window.removeEventListener('resize', this.windowResize);
        this.sourceHandle?.destroy();
        this.assets.clear();
        this.sourceBytes = null;
    }

    // The 2 MB engine takes seconds to start under LWS: load it only when a PDF is about to be
    // opened, so record pages and the app page stay fast for users who do not edit a PDF.
    ensureEngine() {
        if (!this.enginePromise) {
            this.loadingEngine = true;
            this.initializationFailed = false;
            this.enginePromise = loadScript(this, engineResource).then(() => {
                if (!window.LovePdfEngine) throw new Error('Le moteur PDF n’a pas pu être initialisé.');
                this.engine = window.LovePdfEngine;
                if (this.message.startsWith(ENGINE_MESSAGE)) this.message = '';
                return this.engine;
            }).catch((error) => {
                this.enginePromise = null;
                this.initializationFailed = true;
                this.fail(error, ENGINE_MESSAGE);
                throw error;
            }).finally(() => { this.loadingEngine = false; });
        }
        return this.enginePromise;
    }

    // Starts loading in the background as soon as the user heads for an open button.
    handlePrefetchEngine() { if (!this.engine && !this.initializationFailed) this.ensureEngine().catch(() => {}); }
    handleRetryEngine() {
        if (this.busy) return;
        this.message = '';
        this.ensureEngine().catch(() => {});
    }
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
    get disabled() { return this.busy; }
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
    get selectedIsStamp() { return this.selected?.type === 'stamp'; }
    get selectedIsCheck() { return this.selected?.type === 'check'; }
    get selectedHasFont() { return this.selectedIsText || this.selectedIsStamp; }
    get selectedHasSize() { return ['image', 'mask', 'highlight'].includes(this.selected?.type); }
    // Positions and sizes are shown to one decimal; the model keeps full precision.
    get selectedView() {
        const round = (value) => Math.round(value * 10) / 10;
        const { x = 0, y = 0, width = 0, height = 0 } = this.selected || {};
        return { x: round(x), y: round(y), width: round(width), height: round(height) };
    }
    get selectedFont() { return this.selected?.font || 'Helvetica'; }
    get selectedBold() { return Boolean(this.selected?.bold); }
    get fontOptions() {
        return [{ label: 'Helvetica (sans empattement)', value: 'Helvetica' }, { label: 'Times (avec empattement)', value: 'Times' }, { label: 'Courier (chasse fixe)', value: 'Courier' }];
    }
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
    get selectVariant() { return this.tool === 'select' && !this.showSignaturePad ? 'brand' : 'neutral'; }
    get textVariant() { return this.tool === 'text' ? 'brand' : 'neutral'; }
    get maskVariant() { return this.tool === 'mask' ? 'brand' : 'neutral'; }
    get highlightVariant() { return this.tool === 'highlight' ? 'brand' : 'neutral'; }
    get signatureVariant() { return this.showSignaturePad || this.pendingImage?.kind === 'signature' ? 'brand' : 'neutral'; }
    get stampOptions() {
        const today = new Date().toLocaleDateString('fr-FR');
        const labels = ['Bon pour accord', 'Lu et approuvé', 'Copie conforme', 'Payé', `Le ${today}`];
        if (this.userName) labels.push(this.userName, `${this.userName} — ${today}`);
        return labels.map((label) => ({ label, value: label }));
    }
    get placementHint() {
        if (this.showSignaturePad) return 'Dessinez votre signature, puis cliquez sur « Utiliser cette signature ».';
        if (this.pendingImage) return this.pendingImage.kind === 'signature' ? 'Cliquez sur la page pour placer votre signature.' : 'Cliquez sur la page pour placer votre image.';
        if (this.tool === 'text') return 'Cliquez sur la page pour ajouter du texte.';
        if (this.tool === 'stamp') return `Cliquez sur la page pour apposer le tampon « ${this.pendingStamp} ».`;
        if (this.tool === 'check') return 'Cliquez sur la page pour placer la case.';
        if (this.tool === 'highlight') return 'Cliquez sur la page pour surligner une zone, puis ajustez sa taille.';
        if (this.tool === 'mask') return 'Cliquez sur la page pour masquer une zone. Le contenu reste récupérable.';
        return 'Sélectionnez un ajout pour le déplacer, le redimensionner ou modifier ses propriétés.';
    }
    get pageRotation() { return this.viewport?.rotation || 0; }
    get signatureEmpty() { return !this.hasInk; }
    toScreen = (x, y) => this.viewport.convertToViewportPoint(x, y);

    describe(item) {
        if (item.type === 'text') return `Texte : ${item.text.split('\n')[0]}`;
        if (item.type === 'stamp') return `Tampon : ${item.text}`;
        if (item.type === 'image') return item.kind === 'signature' ? 'Signature' : 'Image ajoutée';
        if (item.type === 'check') return item.mark === 'cross' ? 'Croix' : 'Coche';
        if (item.type === 'highlight') return 'Surlignage';
        return 'Masquage visuel';
    }

    // Additions are drawn live over the original page; the PDF is only built on download or save.
    get overlays() {
        if (!this.viewport || !this.page) return [];
        return this.page.elements.map((element) => {
            const item = this.drag?.id === element.id ? { ...element, ...this.drag.patch } : element;
            const box = screenBox(item, this.toScreen);
            const selected = item.id === this.selectedId;
            const color = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#000000';
            const size = (item.fontSize || 0) * this.zoom;
            let textStyle = '';
            if (item.type === 'text') {
                textStyle = `font-size:${size}px;color:${color};font-family:${FONT_FAMILIES[item.font] || FONT_FAMILIES.Helvetica};font-weight:${item.bold ? 700 : 400};`;
            } else if (item.type === 'stamp') {
                textStyle = `font-size:${size}px;color:${color};border:${Math.max(1, item.fontSize * 0.1) * this.zoom}px solid ${color};`;
            }
            return {
                id: item.id,
                label: this.describe(item),
                style: `left:${box.left}px;top:${box.top}px;width:${Math.max(16, box.width)}px;height:${Math.max(16, box.height)}px;`,
                contentStyle: `width:${item.width * this.zoom}px;height:${item.height * this.zoom}px;transform:translate(-50%,-50%) rotate(${visualAngle(this.pageRotation, item.rotation)}deg);`,
                textStyle,
                text: item.text,
                imageUrl: this.assets.get(item.assetId)?.url,
                checkPath: MARK_PATHS[item.mark] || MARK_PATHS.check,
                checkStyle: `stroke:${color};`,
                isText: item.type === 'text',
                isStamp: item.type === 'stamp',
                isImage: item.type === 'image',
                isCheck: item.type === 'check',
                isHighlight: item.type === 'highlight',
                resizable: selected && RESIZABLE.has(item.type),
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
            // Download the file while the engine starts.
            const [file] = await Promise.all([loadSmallPdf({ recordId, versionId: this.selectedFile }), this.ensureEngine()]);
            await this.openBytes(fromBase64(file.base64), file.title, file.versionId, recordId);
        } catch (error) { if (!this.initializationFailed) this.fail(error); }
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
            await this.ensureEngine();
            const recordId = this.recordId;
            await this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pdf$/i, ''), null, recordId);
        } catch (error) { if (!this.initializationFailed) this.fail(error); }
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
                this.resetTool();
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
        this.resetTool();
        this.pageIndex = 0;
        this.viewport = null;
        this.renderedKey = null;
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

    // Fits the page to the available width, between 40 % and 200 %.
    async fitZoom() {
        const available = (this.template.querySelector('.canvas-scroll')?.clientWidth || 0) - 32;
        if (available <= 0 || !this.sourceHandle.viewport) return this.zoom;
        const base = await this.sourceHandle.viewport(this.page.sourceIndex, 1, this.page.rotation);
        return Math.min(2, Math.max(0.4, Math.floor((available / base.width) * 100) / 100));
    }

    // Renders the original page only. Additions are HTML overlays, so most edits need no render.
    async renderPage() {
        const canvas = this.template.querySelector('.page-canvas');
        if (!canvas || !this.sourceHandle || !this.page || this.rendering || this.disconnected) return;
        const revision = this.renderRevision;
        this.rendering = true;
        try {
            if (this.zoomChoice === 'fit') this.zoom = await this.fitZoom();
            const key = `${this.page.sourceIndex}:${this.page.rotation}:${this.zoom}`;
            if (key !== this.renderedKey) {
                this.painting = true;
                this.viewport = await this.sourceHandle.render(this.page.sourceIndex, canvas, this.zoom, this.page.rotation);
                this.renderedKey = key;
            }
        } catch (error) { this.fail(error); }
        finally {
            this.renderedRevision = revision;
            this.rendering = false;
            this.painting = false;
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

    resetTool() {
        this.tool = 'select';
        this.pendingImage = null;
        this.showSignaturePad = false;
    }

    handleTool(event) { this.resetTool(); this.tool = event.currentTarget.dataset.tool; }
    handleStampSelect(event) { this.resetTool(); this.pendingStamp = event.detail.value; this.tool = 'stamp'; }
    handleCheckSelect(event) { this.resetTool(); this.pendingMark = event.detail.value; this.tool = 'check'; }
    handleSaveMode(event) { this.saveMode = event.detail.value; this.saveRequestId = null; this.savedDocumentId = null; this.success = ''; }
    handleTitle(event) { this.title = event.target.value; this.saveRequestId = null; this.success = ''; }
    handlePrevious() { if (!this.previousDisabled) { this.pageIndex -= 1; this.selectedId = null; this.scheduleRender(); } }
    handleNext() { if (!this.nextDisabled) { this.pageIndex += 1; this.selectedId = null; this.scheduleRender(); } }
    handleZoom(event) {
        this.zoomChoice = event.detail.value;
        if (this.zoomChoice !== 'fit') this.zoom = Number(this.zoomChoice);
        this.scheduleRender();
    }
    get zoomOptions() {
        return [{ label: 'Ajuster à la largeur', value: 'fit' }, { label: '60 %', value: '0.6' }, { label: '85 %', value: '0.85' },
            { label: '100 %', value: '1' }, { label: '125 %', value: '1.25' }, { label: '150 %', value: '1.5' }];
    }
    get zoomValue() { return this.zoomChoice; }
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

    // Ctrl+Z / Ctrl+Y / Suppr / Échap anywhere in the editor, except while typing in a field.
    handleShortcut(event) {
        if (event.defaultPrevented || !this.hasDocument || this.disabled || EDITABLE_TARGETS.test(event.target.tagName)) return;
        const key = event.key.toLowerCase();
        const command = event.ctrlKey || event.metaKey;
        if (command && key === 'z' && !event.shiftKey) { event.preventDefault(); this.handleUndo(); }
        else if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); this.handleRedo(); }
        else if ((key === 'delete' || key === 'backspace') && this.selected) { event.preventDefault(); this.handleRemove(); }
        else if (key === 'escape') { this.resetTool(); this.selectedId = null; }
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
            this.resetTool();
            this.pendingImage = { bytes, mime: file.type, width, height, url: `data:${file.type};base64,${toBase64(bytes)}` };
            this.tool = 'image';
            this.message = '';
        } catch (error) { this.fail(error); }
        finally { this.busy = false; }
    }

    // Signature pad: drawn on a canvas, cropped to the ink, then placed as a PNG image.
    handleSignature() {
        if (this.disabled) return;
        this.resetTool();
        this.showSignaturePad = true;
        this.hasInk = false;
        this.inkBounds = null;
    }
    signatureContext() {
        const canvas = this.template.querySelector('.signature-canvas');
        const context = canvas?.getContext('2d');
        if (!context) return null;
        context.lineWidth = 5;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = '#1b2a4a';
        return context;
    }
    signaturePoint(event) {
        const canvas = event.currentTarget;
        const bounds = canvas.getBoundingClientRect();
        return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) };
    }
    extendInk({ x, y }) {
        const bounds = this.inkBounds || { minX: x, minY: y, maxX: x, maxY: y };
        this.inkBounds = { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) };
        if (!this.hasInk) this.hasInk = true;
    }
    handleSignStart(event) {
        const context = this.signatureContext();
        if (!context || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = this.signaturePoint(event);
        this.signing = true;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + 0.1, point.y);
        context.stroke();
        this.extendInk(point);
    }
    handleSignMove(event) {
        if (!this.signing) return;
        const context = this.signatureContext();
        const point = this.signaturePoint(event);
        context.lineTo(point.x, point.y);
        context.stroke();
        this.extendInk(point);
    }
    handleSignEnd() { this.signing = false; }
    handleSignClear() {
        const canvas = this.template.querySelector('.signature-canvas');
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        this.hasInk = false;
        this.inkBounds = null;
    }
    handleSignCancel() { this.resetTool(); }
    handleSignReuse() { this.placeSignature(this.savedSignature); }
    handleSignUse() {
        if (!this.hasInk) return;
        try {
            const source = this.template.querySelector('.signature-canvas');
            const margin = 8;
            const left = Math.max(0, Math.floor(this.inkBounds.minX - margin));
            const top = Math.max(0, Math.floor(this.inkBounds.minY - margin));
            const width = Math.min(source.width, Math.ceil(this.inkBounds.maxX + margin)) - left;
            const height = Math.min(source.height, Math.ceil(this.inkBounds.maxY + margin)) - top;
            const cropped = document.createElement('canvas');
            cropped.width = width;
            cropped.height = height;
            cropped.getContext('2d').drawImage(source, left, top, width, height, 0, 0, width, height);
            const url = cropped.toDataURL('image/png');
            // Kept for the session so the next signature is one click away.
            this.savedSignature = { bytes: fromBase64(url.split(',')[1]), mime: 'image/png', width, height, url, kind: 'signature' };
            this.placeSignature(this.savedSignature);
        } catch (error) { this.fail(error); }
    }
    placeSignature(signature) {
        this.resetTool();
        this.pendingImage = signature;
        this.tool = 'image';
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

    // Text and stamps take their size from their content.
    metricsFor(element) {
        if (element.type === 'text') return this.sourceHandle.measure(element.text, element.fontSize, { font: element.font, bold: element.bold });
        if (element.type === 'stamp') {
            if (!element.text.trim() || element.text.includes('\n') || element.text.length > 60) throw new Error('Un tampon tient sur une ligne de 60 caractères maximum.');
            const { width } = this.sourceHandle.measure(element.text, element.fontSize, { bold: true });
            return { width: width + 2 * STAMP_PADDING * element.fontSize, height: STAMP_HEIGHT * element.fontSize };
        }
        return {};
    }

    addAt(left, top) {
        try {
            const id = crypto.randomUUID();
            // New additions are upright for the orientation the user currently sees.
            const [x, y] = this.viewport.convertToPdfPoint(left, top);
            const base = { id, x, y, rotation: this.pageRotation };
            let element;
            if (this.tool === 'text') {
                element = { ...base, type: 'text', text: 'Votre texte', fontSize: 16, color: '#182c37', font: 'Helvetica', bold: false };
            } else if (this.tool === 'stamp') {
                element = { ...base, type: 'stamp', text: this.pendingStamp, fontSize: 14, color: '#c23934' };
            } else if (this.tool === 'check') {
                element = { ...base, type: 'check', mark: this.pendingMark, width: 18, height: 18, color: '#182c37' };
            } else if (this.tool === 'highlight') {
                element = { ...base, type: 'highlight', width: 140, height: 16 };
            } else if (this.tool === 'mask') {
                element = { ...base, type: 'mask', width: 140, height: 32 };
            } else if (this.pendingImage) {
                const image = this.pendingImage;
                const width = image.kind === 'signature' ? 150 : 160;
                this.assets.set(id, image);
                element = { ...base, type: 'image', assetId: id, kind: image.kind, width, height: width * image.height / image.width };
            }
            if (!element) return;
            Object.assign(element, this.metricsFor(element));
            Object.assign(element, this.alignTopLeft(element, left, top));
            this.change({ type: 'add', pageId: this.page.id, element });
            this.selectedId = id;
            this.resetTool();
        } catch (error) { this.fail(error); }
    }

    handleSelect(event) { event.stopPropagation(); this.selectedId = event.currentTarget.dataset.elementId; }
    handleProperty(event) {
        if (!this.selected || this.disabled) return;
        try {
            const key = event.target.dataset.property;
            let value = event.target.type === 'checkbox' ? event.target.checked : (event.detail?.value ?? event.target.value);
            if (key === 'text') value = String(value).replace(/\r\n?/g, '\n');
            if (key === 'fontSize') value = boundedNumber(value, 6, 96);
            if (key === 'x' || key === 'y') value = boundedNumber(value, -10000, 10000);
            if (key === 'width' || key === 'height') value = boundedNumber(value, 1, 2000);
            if (key !== 'size' && value === this.selected[key]) return;
            const patch = key === 'size' ? { width: boundedNumber(value, 6, 200), height: boundedNumber(value, 6, 200) } : { [key]: value };
            Object.assign(patch, this.metricsFor({ ...this.selected, ...patch }));
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
        if (KEEP_RATIO.has(original.type)) {
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, createHistory, commit, undo, redo, applyChange, fromBase64, toBase64, screenBox, visualAngle } from '../force-app/main/default/lwc/pdfEditState/pdfEditState.js';

const round = (box) => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));

test('screen box follows the element rotation on unrotated and rotated pages', () => {
    const flip = (x, y) => [x, 500 - y];
    assert.deepEqual(round(screenBox({ x: 10, y: 20, width: 100, height: 30 }, flip)), { left: 10, top: 450, width: 100, height: 30 });
    // Created upright on a page shown at 90°: drawn turned 90° counter-clockwise in PDF space.
    const element = { x: 100, y: 100, width: 80, height: 20, rotation: 90 };
    assert.deepEqual(round(screenBox(element, flip)), { left: 80, top: 320, width: 20, height: 80 });
    assert.equal(visualAngle(90, 90), 0);
    assert.equal(visualAngle(0, 90), 270);
    assert.equal(visualAngle(270, 0), 270);
});

test('undo and redo preserve source, page rotation and elements', () => {
    const state = createState(2);
    const first = commit(createHistory(state), { type: 'add', pageId: 'page-0', element: { id: 'one', type: 'text', x: 72, y: 72, text: 'été' } });
    const rotated = commit(first, { type: 'rotate', pageId: 'page-0' });
    assert.equal(state.pages[0].elements.length, 0);
    assert.equal(undo(rotated).present.pages[0].rotation, 0);
    assert.deepEqual(redo(undo(rotated)).present, rotated.present);
    const changed = commit(undo(rotated), { type: 'remove', pageId: 'page-0', elementId: 'one' });
    assert.equal(changed.future.length, 0);
    assert.equal(changed.present.pages[0].elements.length, 0);
});

test('removing a page removes its elements and can be undone', () => {
    let history = createHistory(createState(2));
    history = commit(history, { type: 'add', pageId: 'page-0', element: { id: 'one', type: 'mask' } });
    history = commit(history, { type: 'deletePage', pageId: 'page-0' });
    assert.equal(history.present.pages[0].sourceIndex, 1);
    assert.equal(undo(history).present.pages[0].elements.length, 1);
    assert.throws(() => applyChange(history.present, { type: 'deletePage', pageId: 'page-1' }), /au moins une page/);
});

test('cannot reuse element identifiers or exceed page envelope', () => {
    const state = applyChange(createState(1), { type: 'add', pageId: 'page-0', element: { id: 'one', type: 'text' } });
    assert.throws(() => applyChange(state, { type: 'add', pageId: 'page-0', element: { id: 'one' } }), /déjà utilisé/);
    assert.throws(() => createState(21), /20 pages/);
    assert.throws(() => createState(0), /20 pages/);
});

test('pages can be moved and PDFs appended within the page limit, with undo', () => {
    let history = createHistory(createState(3));
    history = commit(history, { type: 'movePage', pageId: 'page-2', offset: -2 });
    assert.deepEqual(history.present.pages.map((page) => page.id), ['page-2', 'page-0', 'page-1']);
    assert.throws(() => applyChange(history.present, { type: 'movePage', pageId: 'page-2', offset: -1 }), /plus loin/);
    history = commit(history, { type: 'appendPages', pages: createState(2, 1).pages });
    assert.deepEqual(history.present.pages.slice(3).map((page) => [page.id, page.source, page.sourceIndex]), [['page-1-0', 1, 0], ['page-1-1', 1, 1]]);
    assert.throws(() => applyChange(history.present, { type: 'appendPages', pages: createState(16, 2).pages }), /20 pages au total/);
    assert.equal(undo(history).present.pages.length, 3);
});

test('binary round trip handles zero bytes and non-ASCII values without argument overflow', () => {
    const bytes = Uint8Array.from({ length: 1000000 }, (_, i) => i % 256);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

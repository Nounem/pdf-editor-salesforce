import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, createHistory, commit, undo, redo, applyChange, fromBase64, toBase64 } from '../force-app/main/default/lwc/pdfEditState/pdfEditState.js';

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

test('binary round trip handles zero bytes and non-ASCII values without argument overflow', () => {
    const bytes = Uint8Array.from({ length: 1000000 }, (_, i) => i % 256);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

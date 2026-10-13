import { serialize, deserialize } from '@ungap/structured-clone';

// PDF.js runs in-process: copy its messages inside the same JavaScript realm.
// Native structuredClone crosses the LWS membrane and can lose transferred
// message properties or reject proxied values. No global API is modified.
// Transfer lists are intentionally ignored; these small PDFs do not use a worker.
export function structuredClone(value) {
    return deserialize(serialize(value));
}

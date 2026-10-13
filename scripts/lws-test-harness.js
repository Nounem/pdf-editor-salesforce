import { evaluateInSandbox } from '@locker/sandbox';

// Test-only harness using Salesforce's published sandbox implementation.
// It is not bundled or deployed in the Salesforce Static Resource.
window.pdfLwsReady = (async () => {
    const source = await (await fetch('/engine.js')).text();
    evaluateInSandbox('pdfeditor', source);
    evaluateInSandbox('pdfeditor', '$lockerEvalContext$(globalThis.LovePdfEngine)', (engine) => {
        window.LovePdfEngine = engine;
    });
})();

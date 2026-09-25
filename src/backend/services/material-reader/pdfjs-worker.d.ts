// pdf.js ships no types for its worker module; the reader only hands it to
// pdf.js as `globalThis.pdfjsWorker` (read.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';

'use strict';
/**
 * Phase 31 §7.6 — our driver for the conversion engine.
 *
 * Loads LibreOffice's WebAssembly build and converts one document at a time
 * to PDF through LibreOfficeKit. It runs only inside the engine's own
 * process (src/backend/services/rendition/child/main.ts), which is already
 * confined by the permission model, has no environment, and cannot load
 * network or process modules.
 *
 * Nothing global is patched: the engine binary and its filesystem image are
 * read from this directory and handed to Emscripten directly (`wasmBinary`,
 * `getPreloadedPackage`), so the glue never fetches anything. The document
 * lives only in the engine's in-memory filesystem, and is removed after.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Start the engine. The glue is either an ES module factory (`soffice.mjs`,
 * MODULARIZE) or a classic script (`soffice.cjs`) that reads its settings
 * from a global `Module`; both get the same settings object.
 */
async function load(dir) {
  const wasm = fs.readFileSync(path.join(dir, 'soffice.wasm'));
  const data = fs.readFileSync(path.join(dir, 'soffice.data'));
  const quiet = () => {};
  let ready;
  let failed;
  const started = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
  const Module = {
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    locateFile: (file) => path.join(dir, path.basename(file)),
    print: quiet,
    printErr: quiet,
    onRuntimeInitialized: () => {
      // Read by LibreOffice when it starts, which is after this and before
      // the first document.
      //  - Its diagnostics, off.
      //  - XML parsed on the calling thread. Its threaded parser hands file
      //    reads to a worker, which Emscripten proxies back to this thread —
      //    the one blocked waiting for it — and a load stalled for ~80s
      //    about one time in two until a timeout broke the wait.
      Module.ENV.SAL_LOG = '-INFO-WARN';
      Module.ENV.SAX_DISABLE_THREADS = '1';
      ready(Module);
    },
    onAbort: (what) => failed(new Error(`the engine aborted: ${what}`)),
  };
  const esm = path.join(dir, 'soffice.mjs');
  if (fs.existsSync(esm)) {
    const factory = (await import(pathToFileURL(esm).href)).default;
    await factory(Module);
  } else {
    global.Module = Module;
    require(path.join(dir, 'soffice.cjs'));
  }
  return started;
}

exports.create = async ({ dir }) => {
  const M = await load(dir);
  const FS = M.FS;
  for (const d of ['/instdir/user', '/instdir/user/temp', '/instdir/user/registry', '/instdir/user/registry/data', '/tmp/in', '/tmp/out']) {
    try { FS.mkdirTree ? FS.mkdirTree(d) : FS.mkdir(d); } catch { /* exists */ }
  }

  // Strings go in through ccall, which marshals them on the engine's stack;
  // nothing here touches engine memory directly.
  const call = (name, args) => M.ccall(name, 'number', args.map((a) => (typeof a === 'string' ? 'string' : 'number')), args);

  const lok = call('libreofficekit_hook', ['/instdir/program']);
  if (!lok) throw new Error('LibreOfficeKit did not start');
  // Not "sync events" (Unipoll): that mode expects the host to pump
  // LibreOffice's loop, and without it a load can stall for over a minute.

  const lastError = () => {
    const p = call('lok_getError', [lok]);
    return p ? M.UTF8ToString(p) : '';
  };

  return {
    async convert(bytes, ext) {
      if (!/^[a-z]{2,5}$/.test(ext)) throw new Error('unsupported extension');
      const input = `/tmp/in/document.${ext}`;
      const output = '/tmp/out/document.pdf';
      FS.writeFile(input, bytes);
      let doc = 0;
      try {
        doc = call('lok_documentLoad', [lok, `file://${input}`]);
        if (!doc) throw new Error(lastError() || 'the document could not be opened');
        call('lok_documentSaveAs', [doc, `file://${output}`, 'pdf', '']);
        const pdf = FS.readFile(output);
        if (!pdf || pdf.length === 0) throw new Error(lastError() || 'the conversion produced nothing');
        return new Uint8Array(pdf);
      } finally {
        if (doc) call('lok_documentDestroy', [doc]);
        for (const f of [input, output]) { try { FS.unlink(f); } catch { /* not written */ } }
      }
    },
  };
};

/**
 * validation-worker.js — Web Worker for GWAS summary statistics validation.
 *
 * Loads Pyodide (Python → WebAssembly) in a dedicated worker thread so
 * that all heavy processing — file I/O, gzip decompression, Pydantic
 * validation — happens off the main thread.  The browser UI stays
 * responsive even for ~1 GB input files.
 *
 * Message protocol (main → worker):
 *
 *   { type: "upload",   id, data: ArrayBuffer }   (Transferable)
 *   { type: "validate", id, configJson: string }
 *   { type: "download", id }
 *   { type: "cleanup",  id }
 *
 * Response protocol (worker → main):
 *
 *   { type: "ready" }                           — Pyodide initialised
 *   { type: "done",  id, result? }              — success
 *   { type: "error", id, error: string }        — failure
 */

"use strict";

// Pyodide CDN — update if a newer version is required
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

// VFS paths — must match _UPLOAD_PATH / _OUTPUT_PATH in validate.py
const UPLOAD_PATH = "/tmp/sumstat_upload";
const OUTPUT_PATH = "/tmp/sumstat_validated.tsv.gz";

let pyodide = null;

// ── Initialisation ───────────────────────────────────────────────

async function init() {
  pyodide = await loadPyodide();

  // Install pydantic from Pyodide's pre-built index, then the local wheel
  // via micropip (which resolves URLs relative to the worker script).
  await pyodide.loadPackage(["pydantic", "micropip"]);
  const micropip = pyodide.pyimport("micropip");

  // Dynamically discover the current wheel filename to avoid breakage when versions change
  const wheelResp = await fetch(`./dist/wheel.txt?_=${Date.now()}`);
  if (!wheelResp.ok) {
    throw new Error(`Failed to fetch wheel.txt: ${wheelResp.statusText}`);
  }
  const wheelName = (await wheelResp.text()).trim();

  await micropip.install(`./dist/${wheelName}`);
  micropip.destroy();

  // Fetch and execute validate.py to define validate_file() in globals
  const resp = await fetch("validate.py");
  const source = await resp.text();
  pyodide.runPython(source);

  const version = pyodide.runPython(
    "import gwascatalog.sumstatlib; gwascatalog.sumstatlib.__version__"
  );

  self.postMessage({ type: "ready", version });
}

// ── Message handler ──────────────────────────────────────────────

self.onmessage = async ({ data: msg }) => {
  const { type, id } = msg;

  try {
    switch (type) {
      case "upload": {
        // Clean up any previous session
        try { pyodide.FS.unlink(UPLOAD_PATH); } catch (_) { /* ok */ }
        try { pyodide.FS.unlink(OUTPUT_PATH); } catch (_) { /* ok */ }

        // Write uploaded bytes to Emscripten VFS in one call
        pyodide.FS.writeFile(UPLOAD_PATH, new Uint8Array(msg.data));
        self.postMessage({ type: "done", id });
        break;
      }

      case "validate": {
        const fn = pyodide.globals.get("validate_file");
        const resultJson = fn(msg.configJson);
        fn.destroy();
        self.postMessage({ type: "done", id, result: resultJson });
        break;
      }

      case "download": {
        const bytes = pyodide.FS.readFile(OUTPUT_PATH);
        // Copy out of Wasm linear memory into a transferable buffer
        const buffer = new Uint8Array(bytes).buffer;
        self.postMessage({ type: "done", id, result: buffer }, [buffer]);
        break;
      }

      case "cleanup": {
        try { pyodide.FS.unlink(UPLOAD_PATH); } catch (_) { /* ok */ }
        try { pyodide.FS.unlink(OUTPUT_PATH); } catch (_) { /* ok */ }
        self.postMessage({ type: "done", id });
        break;
      }

      default:
        self.postMessage({
          type: "error",
          id,
          error: `Unknown message type: ${type}`,
        });
    }
  } catch (err) {
    // Emscripten FS.ErrnoError may be a plain object (not extending Error),
    // so String(err) can return "[object Object]".  Extract something useful.
    let message;
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    } else if (typeof err === "object" && err !== null) {
      message = err.message || err.name || JSON.stringify(err);
    } else {
      message = String(err);
    }
    self.postMessage({
      type: "error",
      id,
      error: message,
    });
  }
};

init().catch((err) => {
  self.postMessage({
    type: "error",
    id: 0,
    error: "Failed to initialise Python: " + (err.message || String(err)),
  });
});

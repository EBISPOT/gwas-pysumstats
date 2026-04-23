/**
 * wizard.js — Minimal wizard navigation and PyScript bridge.
 *
 * This is the only JavaScript in the application. All validation logic lives
 * in Python (validate.py) running via PyScript/Pyodide.
 *
 * Interface (modelled on the pandoc wasm app):
 *
 *   validateFile()   — read wizard config + file, call Python, display results
 *   downloadOutput() — trigger standard file download of validated output
 *
 * Responsibilities:
 *   1. Wizard step navigation (show/hide sections via hidden attribute)
 *   2. Form state management (enable/disable Next based on input)
 *   3. Streaming file upload to Emscripten VFS (via FS API, no Python bridge)
 *   4. Bridge to Python validate_file(config_json) — file lives in VFS
 *   5. Display structured validation results returned by Python
 *   6. Download of validated output from VFS (via FS API, no Python bridge)
 */

"use strict";

// ── Constants ────────────────────────────────────────────────────
const STEPS = [
  "welcome",
  "variation",
  "rowcount",
  "columns",
  "threshold",
  "file",
  "validate",
];

const LOADING_MESSAGE =  "Validating summary statistics in your browser. Nothing is being sent to the server."

let currentStep = 0;
let hasValidatedOutput = false; // Whether validated output exists in VFS

// ── Web Worker (Pyodide runs off the main thread) ────────────────

let worker = null;
let workerReady = false;
let _nextId = 0;
const _pending = new Map();

/** Send a message to the validation worker and return a promise for the result. */
function callWorker(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++_nextId;
    _pending.set(id, { resolve, reject });
    worker.postMessage({ type, id, ...payload }, transfer);
  });
}

// ── Wizard navigation ────────────────────────────────────────────

function goToStep(index) {
  STEPS.forEach((id, i) => {
    const el = document.getElementById(`step-${id}`);
    if (el) el.hidden = i !== index;
  });
  currentStep = index;
  updateProgress();

  if (STEPS[currentStep] === "validate") populateSummary();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function next() {
  if (currentStep < STEPS.length - 1) goToStep(currentStep + 1);
}

function clearValidationResult() {
  const heading = document.getElementById("result-heading");
  const summary = document.getElementById("result-summary");
  if (heading) { heading.textContent = ""; heading.className = ""; }
  if (summary) summary.textContent = "";
  const list = document.getElementById("error-list");
  if (list) list.innerHTML = "";
  const checksumPanel = document.getElementById("checksum-panel");
  if (checksumPanel) checksumPanel.hidden = true;
  document.getElementById("btn-download").hidden = true;
  hasValidatedOutput = false;
}

function prev() {
  if (STEPS[currentStep] === "validate") clearValidationResult();
  if (currentStep > 0) goToStep(currentStep - 1);
}

function updateProgress() {
  document.querySelectorAll("#wizard-progress li").forEach((li, i) => {
    li.classList.toggle("completed", i < currentStep);
    li.classList.toggle("active", i === currentStep);
  });
}

// ── Form state (read via FormData — no manual state object) ──────

function readConfig() {
  const data = new FormData(document.getElementById("wizard"));
  const variationType = data.get("variation_type");

  let effectSizes;
  let primaryEffectSize;
  if (variationType === "CNV") {
    effectSizes = data.getAll("effect_size");
    primaryEffectSize = data.get("primary_effect_cnv") || (effectSizes.length === 1 ? effectSizes[0] : null);
  } else {
    effectSizes = data.getAll("gene_effect_size");
    primaryEffectSize = data.get("primary_effect_gene") || (effectSizes.length === 1 ? effectSizes[0] : null);
  }

  return {
    variationType,
    assembly: data.get("assembly"),
    effectSizes,
    primaryEffectSize: primaryEffectSize || "none",
    // Legacy single value for validation bridge
    effectSize: primaryEffectSize || (effectSizes.length > 0 ? effectSizes[0] : "none"),
    pValueType: data.get("p_value_type"),
    allowZeroPvalues: data.get("zero_pvalues") === "yes",
  };
}

// ── Conditional UI logic ─────────────────────────────────────────

function handleVariationChange() {
  const value = document.querySelector(
    'input[name="variation_type"]:checked'
  )?.value;
  const nextBtn = document.getElementById("next-variation");

  // Reset warnings and conditional groups
  document.getElementById("warn-snp").hidden = true;
  document.getElementById("warn-other").hidden = true;
  document.getElementById("assembly-group").hidden = true;

  if (value === "SNP") {
    document.getElementById("warn-snp").hidden = false;
    nextBtn.disabled = true;
    return;
  }
  if (value === "other") {
    document.getElementById("warn-other").hidden = false;
    nextBtn.disabled = true;
    return;
  }
  if (value === "CNV") {
    document.getElementById("assembly-group").hidden = false;
    nextBtn.disabled = !document.getElementById("assembly").value;
    // Update columns and row count pages
    showColumnsFor("CNV");
    updateRowCountPage("CNV");
    return;
  }
  // GENE
  showColumnsFor("GENE");
  updateRowCountPage("GENE");
  nextBtn.disabled = false;
}

function handleAssemblyChange() {
  const variation = document.querySelector(
    'input[name="variation_type"]:checked'
  )?.value;
  if (variation === "CNV") {
    document.getElementById("next-variation").disabled =
      !document.getElementById("assembly").value;
  }
}

function handleEffectSizeChange() {
  updatePrimaryEffectFieldset(
    "effect_size", "primary-effect-cnv",
    "primary_effect_cnv", "primary-effect-cnv-options"
  );
  updateColumnsNextButton();
}

function handleGeneEffectSizeChange() {
  updatePrimaryEffectFieldset(
    "gene_effect_size", "primary-effect-gene",
    "primary_effect_gene", "primary-effect-gene-options"
  );
  updateColumnsNextButton();
}

function handlePValueChange() {
  updateColumnsNextButton();
}

// ── Primary effect size helper ───────────────────────────────────

const EFFECT_LABELS = {
  beta: "Beta",
  odds_ratio: "Odds ratio",
  z_score: "Z-score",
  hazard_ratio: "Hazard ratio",
};

/**
 * Show / hide a "primary effect size" radio group and populate it
 * with the currently selected effect size checkboxes.
 */
function updatePrimaryEffectFieldset(checkboxName, fieldsetId, radioName, containerId) {
  const checked = Array.from(
    document.querySelectorAll(`input[name="${checkboxName}"]:checked`)
  );
  const fieldset = document.getElementById(fieldsetId);
  const container = document.getElementById(containerId);

  if (checked.length <= 1) {
    fieldset.hidden = true;
    container.innerHTML = "";
    return;
  }

  // Preserve current selection
  const currentPrimary = document.querySelector(
    `input[name="${radioName}"]:checked`
  )?.value;

  container.innerHTML = "";
  for (const cb of checked) {
    const label = document.createElement("label");
    label.className = "radio-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = radioName;
    radio.value = cb.value;
    if (cb.value === currentPrimary) radio.checked = true;
    radio.addEventListener("change", updateColumnsNextButton);
    label.appendChild(radio);
    label.appendChild(
      document.createTextNode(" " + (EFFECT_LABELS[cb.value] || cb.value))
    );
    container.appendChild(label);
  }

  fieldset.hidden = false;
}
// ── Row count step ─────────────────────────────────────────────────────

const ROW_COUNT_MINIMUMS = {
  GENE: { count: 10_000, unit: "genes" },
  CNV:  { count: 10_000, unit: "variants" },
};

/**
 * Update the row count step's descriptive text to match the selected
 * variation type, and reset any prior answer.
 * @param {string} variationType - "GENE" or "CNV"
 */
function updateRowCountPage(variationType) {
  const min = ROW_COUNT_MINIMUMS[variationType];
  if (!min) return;

  const desc = document.getElementById("rowcount-description");
  if (desc) {
    desc.innerHTML =
      `The GWAS Catalog requires a minimum of <strong>${min.count.toLocaleString()} rows</strong> ` +
      `(${min.unit}) to ensure your submission represents a genome-wide analysis. ` +
      `Does your file meet this requirement?`;
  }

  // Reset any prior selection when the variation type changes
  document.querySelectorAll('input[name="meets_row_count"]').forEach(
    (r) => (r.checked = false)
  );
  const warn = document.getElementById("warn-rowcount");
  if (warn) warn.hidden = true;
  const nextBtn = document.getElementById("next-rowcount");
  if (nextBtn) nextBtn.disabled = true;
}

function handleRowCountChange() {
  const value = document.querySelector(
    'input[name="meets_row_count"]:checked'
  )?.value;
  const warn = document.getElementById("warn-rowcount");
  if (warn) warn.hidden = value === "yes";
  document.getElementById("next-rowcount").disabled = !value;
}
// ── Threshold step ───────────────────────────────────────────────

function handleThresholdChange() {
  const value = document.querySelector(
    'input[name="zero_pvalues"]:checked'
  )?.value;
  const warn = document.getElementById("warn-thresholded");
  if (warn) warn.hidden = value !== "yes";
  document.getElementById("next-threshold").disabled = !value;
}

// ── Columns checklist logic ──────────────────────────────────────

/** Show the correct column checklist based on variation type. */
function showColumnsFor(type) {
  document.getElementById("columns-gene").hidden = type !== "GENE";
  document.getElementById("columns-cnv").hidden = type !== "CNV";
  updateColumnsNextButton();
}

/**
 * Validate effect size / uncertainty combinations and show / hide specific
 * error messages. Returns true if any blocking error is present.
 *
 * Rules:
 *   1. beta             → standard_error required
 *   2. CI               → valid only for odds_ratio / hazard_ratio; not required,
 *                         but both bounds must be provided if one is
 *   3. z_score          → no uncertainty estimate valid; suppressed when z-score
 *                         is not the primary effect size
 *   4. odds_ratio + hazard_ratio together → conflict error
 *
 * @param {string[]} effectValues      - selected effect size values
 * @param {boolean}  hasSE             - standard_error is checked
 * @param {boolean}  hasCILower        - ci_lower is checked
 * @param {boolean}  hasCIUpper        - ci_upper is checked
 * @param {string}   primaryEffectSize - the primary (or only) effect size value
 * @param {string}   prefix            - "gene" or "cnv"
 */
function validateEffectUncertaintyRules(effectValues, hasSE, hasCILower, hasCIUpper, primaryEffectSize, prefix) {
  let hasError = false;
  const hasBeta   = effectValues.includes("beta");
  const hasOR     = effectValues.includes("odds_ratio");
  const hasHR     = effectValues.includes("hazard_ratio");
  const hasZScore = effectValues.includes("z_score");

  // Rule 4: OR and HR cannot both be selected
  const errConflict = document.getElementById(`error-${prefix}-or-hr-conflict`);
  const orHrConflict = hasOR && hasHR;
  if (errConflict) errConflict.hidden = !orHrConflict;
  if (orHrConflict) hasError = true;

  // Rule 1: Beta requires standard error; standard error is only valid for beta
  const errBeta = document.getElementById(`error-${prefix}-beta-uncertainty`);
  const betaError = (hasBeta && !hasSE) || (!hasBeta && hasSE);
  if (errBeta) errBeta.hidden = !betaError;
  if (betaError) hasError = true;

  // Rule 3: Z-score cannot have an uncertainty estimate.
  // Suppress when z-score is not the primary effect size (uncertainty belongs to another effect).
  const errZScore = document.getElementById(`error-${prefix}-zscore-uncertainty`);
  const zScoreIsEffective = hasZScore && (effectValues.length === 1 || primaryEffectSize === "z_score");
  const hasAnyUncertainty = hasSE || hasCILower || hasCIUpper;
  const zScoreError = zScoreIsEffective && hasAnyUncertainty;
  if (errZScore) errZScore.hidden = !zScoreError;
  if (zScoreError) hasError = true;

  // Rule 2: CI is valid only for OR/HR; not required, but both bounds must be provided if one is
  const errCI = document.getElementById(`error-${prefix}-ci-required`);
  const ciInvalid = (hasCILower || hasCIUpper) && !(hasOR || hasHR) && !orHrConflict;
  const ciPartial = (hasCILower || hasCIUpper) && !(hasCILower && hasCIUpper);
  const ciError = ciInvalid || ciPartial;
  if (errCI) errCI.hidden = !ciError;
  if (ciError) hasError = true;

  return hasError;
}

/**
 * Enable / disable the Next button on the columns step.
 *
 * Rules:
 *   - p-value type must be selected (both Gene and CNV)
 *   - CNV: at least one effect size must be selected
 *   - If >1 effect size is selected, a primary must be chosen
 *   - Gene: gene name must be selected
 *   - Effect size / uncertainty rules delegated to validateEffectUncertaintyRules
 *
 * Inline error messages are shown / hidden to guide the user.
 */
function updateColumnsNextButton() {
  const variationType = document.querySelector(
    'input[name="variation_type"]:checked'
  )?.value;
  const pValueType = document.querySelector(
    'input[name="p_value_type"]:checked'
  )?.value;

  if (variationType !== "CNV" && variationType !== "GENE") {
    document.getElementById("next-columns").disabled = true;
    return;
  }

  let ready = !!pValueType;

  if (variationType === "CNV") {
    // Position: all three fields required
    const posChecked = document.querySelectorAll(
      'input[name="col_cnv"]:checked'
    ).length;
    const errPosition = document.getElementById("error-cnv-position");
    if (posChecked < 3) {
      ready = false;
      if (errPosition) errPosition.hidden = false;
    } else {
      if (errPosition) errPosition.hidden = true;
    }

    // P-value type required
    const errPvalue = document.getElementById("error-cnv-pvalue");
    if (!pValueType) {
      if (errPvalue) errPvalue.hidden = false;
    } else {
      if (errPvalue) errPvalue.hidden = true;
    }

    // At least one effect size
    const effectSizes = document.querySelectorAll(
      'input[name="effect_size"]:checked'
    );
    const errEffect = document.getElementById("error-cnv-effect");
    if (effectSizes.length === 0) {
      ready = false;
      if (errEffect) errEffect.hidden = false;
    } else {
      if (errEffect) errEffect.hidden = true;
    }

    // Detailed beta / OR / HR + uncertainty rules
    const cnvHasSE      = !!document.querySelector('input[name="standard_error"]:checked');
    const cnvHasCILower = !!document.querySelector('input[name="ci_lower"]:checked');
    const cnvHasCIUpper = !!document.querySelector('input[name="ci_upper"]:checked');
    const cnvEffectValues = Array.from(effectSizes).map((el) => el.value);
    const cnvPrimary = document.querySelector('input[name="primary_effect_cnv"]:checked')?.value
      || (effectSizes.length === 1 ? effectSizes[0].value : null);
    if (validateEffectUncertaintyRules(cnvEffectValues, cnvHasSE, cnvHasCILower, cnvHasCIUpper, cnvPrimary, "cnv")) {
      ready = false;
    }

    // Primary effect size required when >1 selected
    if (effectSizes.length > 1) {
      const primary = document.querySelector(
        'input[name="primary_effect_cnv"]:checked'
      );
      if (!primary) ready = false;
    }

    // Statistical model type required
    const modelChecked = document.querySelector(
      'input[name="model_type"]:checked'
    );
    const errModel = document.getElementById("error-cnv-model");
    if (!modelChecked) {
      ready = false;
      if (errModel) errModel.hidden = false;
    } else {
      if (errModel) errModel.hidden = true;
    }
  }

  if (variationType === "GENE") {
    // Gene name required
    const geneName = document.querySelector(
      'input[name="gene_name"]:checked'
    );
    const errGeneName = document.getElementById("error-gene-name");
    if (!geneName) {
      ready = false;
      if (errGeneName) errGeneName.hidden = false;
    } else {
      if (errGeneName) errGeneName.hidden = true;
    }

    // P-value type required
    const errPvalue = document.getElementById("error-gene-pvalue");
    if (!pValueType) {
      ready = false;
      if (errPvalue) errPvalue.hidden = false;
    } else {
      if (errPvalue) errPvalue.hidden = true;
    }

    // Position: if any checked, all three must be checked
    const posChecked = document.querySelectorAll(
      'input[name="gene_position"]:checked'
    ).length;
    const errGenePosition = document.getElementById("error-gene-position");
    if (posChecked > 0 && posChecked < 3) {
      ready = false;
      if (errGenePosition) errGenePosition.hidden = false;
    } else {
      if (errGenePosition) errGenePosition.hidden = true;
    }

    const effectSizes = document.querySelectorAll(
      'input[name="gene_effect_size"]:checked'
    );
    const geneHasSE      = !!document.querySelector('input[name="gene_uncertainty_estimate"][value="standard_error"]:checked');
    const geneHasCILower = !!document.querySelector('input[name="gene_uncertainty_estimate"][value="ci_lower"]:checked');
    const geneHasCIUpper = !!document.querySelector('input[name="gene_uncertainty_estimate"][value="ci_upper"]:checked');

    // Detailed beta / OR / HR + uncertainty rules
    const geneEffectValues = Array.from(effectSizes).map((el) => el.value);
    const genePrimary = document.querySelector('input[name="primary_effect_gene"]:checked')?.value
      || (effectSizes.length === 1 ? effectSizes[0].value : null);
    if (validateEffectUncertaintyRules(geneEffectValues, geneHasSE, geneHasCILower, geneHasCIUpper, genePrimary, "gene")) {
      ready = false;
    }

    // Primary effect size required when >1 selected
    if (effectSizes.length > 1) {
      const primary = document.querySelector(
        'input[name="primary_effect_gene"]:checked'
      );
      if (!primary) ready = false;
    }
  }

  document.getElementById("next-columns").disabled = !ready;
}

// ── File handling ────────────────────────────────────────────────

function handleFileChange(input) {
  const file = input.files[0];
  if (!file) return;

  document.getElementById("file-name").textContent = file.name;
  document.getElementById("file-size").textContent = formatFileSize(file.size);
  document.getElementById("file-info").hidden = false;
  document.getElementById("next-file").disabled = false;
}

/**
 * Upload a file to the Emscripten virtual file system via a Web Worker.
 *
 * Reads the file into an ArrayBuffer on the main thread, then transfers
 * ownership to the worker (zero-copy via Transferable).  The worker
 * writes the bytes to the VFS in one FS.writeFile() call — off the
 * main thread, so the UI never freezes.
 */
async function uploadFileToVFS() {
  const file = document.getElementById("file-input").files[0];
  if (!file) throw new Error("No file selected");

  const buffer = await file.arrayBuffer();
  await callWorker("upload", { data: buffer }, [buffer]);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Validation summary (definition list population) ──────────────

function populateSummary() {
  const config = readConfig();

  const variationLabels = { CNV: "Copy number variant (CNV)", GENE: "Genes" };
  const effectLabels = {
    beta: "Beta",
    odds_ratio: "Odds ratio",
    z_score: "Z-score",
    hazard_ratio: "Hazard ratio",
    none: "Not measured",
  };
  const pLabels = { p_value: "p value", neg_log10: "negative log\u2081\u2080 p value" };

  document.getElementById("summary-variation").textContent =
    variationLabels[config.variationType] || "\u2014";

  // Effect size(s)
  if (config.effectSizes.length === 0) {
    document.getElementById("summary-effect").textContent = "Not measured";
  } else {
    const labels = config.effectSizes.map((e) => {
      const label = effectLabels[e] || e;
      return e === config.primaryEffectSize ? `${label} (primary)` : label;
    });
    document.getElementById("summary-effect").textContent = labels.join(", ");
  }

  document.getElementById("summary-pvalue").textContent =
    pLabels[config.pValueType] || "—";
  document.getElementById("summary-zero").textContent =
    config.allowZeroPvalues ? "Yes" : "No";

  const assemblyRow = document.getElementById("summary-assembly-row");
  if (config.variationType === "CNV") {
    assemblyRow.hidden = false;
    document.getElementById("summary-assembly").textContent =
      config.assembly || "—";
  } else {
    assemblyRow.hidden = true;
  }

  document.getElementById("summary-file").textContent =
    document.getElementById("file-input").files[0]?.name || "—";
}

// ── Validation bridge (calls Python via PyScript) ────────────────

async function validateFile() {
  const btn = document.getElementById("btn-validate");
  btn.disabled = true;
  btn.textContent = "Validating...";

  try {
    if (!workerReady) {
      throw new Error(
        "Python environment not ready. Please wait for it to finish loading."
      );
    }

    showLoading("Uploading file...");
    await uploadFileToVFS();

    showLoading(LOADING_MESSAGE);
    const config = readConfig();
    // Build a config object matching Python's WizardConfig TypedDict exactly.
    // Only include the fields Python expects; map "none" sentinel → null.
    const pythonConfig = {
      variationType: config.variationType,
      primaryEffectSize:
        config.primaryEffectSize && config.primaryEffectSize !== "none"
          ? config.primaryEffectSize
          : null,
      allowZeroPvalues: config.allowZeroPvalues,
      assembly: config.assembly || null,
    };
    const configJson = JSON.stringify(pythonConfig);

    const resultJson = await callWorker("validate", { configJson });
    const result = JSON.parse(resultJson);
    displayResults(result);
  } catch (err) {
    console.error("Validation error:", err);
    displayResults({
      errorCount: 1,
      errors: [{ row: 0, message: err.message || String(err) }],
      validRowCount: 0,
      hasOutput: false,
    });
  } finally {
    hideLoading();
    btn.disabled = false;
    btn.textContent = "Validate";
  }
}

function displayResults(result) {
  const output = document.getElementById("validation-output");
  output.hidden = false;

  const heading = document.getElementById("result-heading");
  const summary = document.getElementById("result-summary");

  // Build performance summary suffix
  const perfParts = [];
  if (result.elapsedSeconds != null) {
    const s = result.elapsedSeconds;
    const m = Math.floor(s / 60);
    const rs = Math.round(s % 60);
    perfParts.push(m > 0 ? `${m}m ${rs}s` : `${rs}s`);
  }
  if (result.rowsPerSecond != null) {
    perfParts.push(`${result.rowsPerSecond.toLocaleString()} rows/sec`);
  }
  const perfSuffix = perfParts.length > 0 ? ` (${perfParts.join(", ")})` : "";

  if (result.errorCount === 0) {
    heading.textContent = "✅ Validation passed";
    heading.className = "result-success";
    summary.textContent = `All ${result.validRowCount.toLocaleString()} rows are valid.${perfSuffix}`;
  } else {
    heading.textContent = `⚠️ ${result.errorCount} validation error(s)`;
    heading.className = "result-error";
    summary.textContent =
      result.validRowCount > 0
        ? `${result.validRowCount.toLocaleString()} valid rows.${perfSuffix} Review the errors below.`
        : `No valid rows found.${perfSuffix} Review the errors below.`;
  }

  // Build error list
  const list = document.getElementById("error-list");
  list.innerHTML = "";
  for (const err of result.errors) {
    const div = document.createElement("div");
    div.className = "validation-error-row";
    const span = document.createElement("span");
    span.className = "row-num";
    const colPart = err.column != null && err.column !== "" ? `, column "${err.column}"` : "";
    span.textContent = `Row ${err.row}${colPart}: `;
    div.appendChild(span);
    div.appendChild(document.createTextNode(err.message));
    list.appendChild(div);
  }

  // Checksum
  const checksumPanel = document.getElementById("checksum-panel");
  if (result.md5Checksum) {
    document.getElementById("checksum-value").textContent = result.md5Checksum;
    checksumPanel.hidden = false;
  } else {
    checksumPanel.hidden = true;
  }

  // Download button
  hasValidatedOutput = result.hasOutput;
  document.getElementById("btn-download").hidden = !result.hasOutput;
}

// ── Download (via Web Worker) ────────────────────────────────────

async function downloadOutput() {
  if (!hasValidatedOutput) return;

  showLoading("Preparing download…");

  try {
    const buffer = await callWorker("download");

    const rawName =
      document.getElementById("file-input").files[0]?.name || "output.tsv";
    const baseName = rawName.replace(/\.gz$/, "");
    const fileName = "validated_" + baseName + ".gz";

    const blob = new Blob([new Uint8Array(buffer)], { type: "application/gzip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await callWorker("cleanup");
    hasValidatedOutput = false;
  } catch (err) {
    console.error("Download failed:", err);
    displayResults({
      errorCount: 1,
      errors: [
        { row: 0, message: "Download failed: " + (err.message || String(err)) },
      ],
      validRowCount: 0,
      hasOutput: false,
    });
  } finally {
    hideLoading();
  }
}

// ── Loading dialog ───────────────────────────────────────────────

function showLoading(message) {
  const dialog = document.getElementById("loading-dialog");
  document.getElementById("loading-message").textContent = message;
  document.getElementById("loading-progress").hidden = true;
  if (!dialog.open) dialog.showModal();
}

function hideLoading() {
  document.getElementById("loading-dialog").close();
}

/** Update the loading dialog with live validation progress. */
function handleValidationProgress(msg) {
  document.getElementById("loading-message").textContent = LOADING_MESSAGE;
  const el = document.getElementById("loading-progress");
  el.hidden = false;

  const rows = msg.rowsProcessed.toLocaleString();
  const rate = msg.rowsPerSecond.toLocaleString();
  const secs = msg.elapsedSeconds;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  const timeStr =
    mins > 0 ? `${mins}m ${String(remSecs).padStart(2, "0")}s` : `${remSecs}s`;

  document.getElementById("progress-rows").textContent = rows;
  document.getElementById("progress-rate").textContent = rate;
  document.getElementById("progress-time").textContent = timeStr;
  document.getElementById("progress-errors").textContent =
    msg.errorCount.toLocaleString();
}

// ── Example file downloads ──────────────────────────────────────

const EXAMPLE_HINTS = {
  "static/examples/valid-gene.csv":
    "This file passes validation. In the wizard, choose: Variation type -> Genes.",
  "static/examples/invalid-gene.csv":
    "This file contains deliberate errors. In the wizard, choose: Variation type -> Genes.",
  "static/examples/valid-cnv.csv":
    "This file passes validation. In the wizard, choose: Variation type -> CNV, Assembly -> GRCh38.",
  "static/examples/invalid-cnv.csv":
    "This file contains deliberate errors. In the wizard, choose: Variation type -> CNV, Assembly -> GRCh38.",
};

function handleExampleSelectChange() {
  const select = document.getElementById("example-select");
  const btn = document.getElementById("btn-download-example");
  const hint = document.getElementById("example-hint");
  const value = select.value;

  btn.disabled = !value;

  if (value && EXAMPLE_HINTS[value]) {
    hint.textContent = EXAMPLE_HINTS[value];
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = "";
  }
}

function downloadExample() {
  const url = document.getElementById("example-select").value;
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = url.split("/").pop();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Column checklist generation from shared JSON ─────────────────

/**
 * Fetch column-defs.json and build both gene and CNV column checklists.
 * Must complete before event listeners are attached so that dynamically
 * created inputs are present in the DOM.
 */
async function buildColumnChecklists() {
  const resp = await fetch("column-defs.json");
  const defs = await resp.json();
  buildColumnSection("columns-gene", defs.gene.groups);
  buildColumnSection("columns-cnv", defs.cnv.groups);
}

/**
 * Populate a column checklist section from JSON group definitions.
 *
 * Produces the same DOM structure as the original static HTML:
 *   <fieldset>  → legend + hint + <dl> of inputs + note
 *   <p.field-error> (hidden)
 *   <fieldset>  → primary effect selection (hidden, if applicable)
 *
 * @param {string} sectionId  - e.g. "columns-gene" or "columns-cnv"
 * @param {object[]} groups   - array of group definitions from column-defs.json
 */
function buildColumnSection(sectionId, groups) {
  const section = document.getElementById(sectionId);

  for (const group of groups) {
    const fieldset = document.createElement("fieldset");

    const legend = document.createElement("legend");
    legend.textContent = group.label;
    fieldset.appendChild(legend);

    if (group.hint) {
      const hint = document.createElement("p");
      hint.textContent = group.hint;
      fieldset.appendChild(hint);
    }

    const dl = document.createElement("dl");
    for (const col of group.columns) {
      const wrapper = document.createElement("div");

      const dt = document.createElement("dt");
      const label = document.createElement("label");

      const inputType = col.form?.inputType || group.form?.inputType || "checkbox";
      const inputName = col.form?.name || group.form?.name;
      const inputValue = col.form?.value || col.code;

      const input = document.createElement("input");
      input.type = inputType;
      input.name = inputName;
      input.value = inputValue;
      if (group.requirement === "mandatory") input.required = true;

      label.appendChild(input);
      label.appendChild(document.createTextNode(" "));
      const code = document.createElement("code");
      code.textContent = col.code;
      label.appendChild(code);

      dt.appendChild(label);
      wrapper.appendChild(dt);

      const dd = document.createElement("dd");
      dd.textContent = col.description;
      wrapper.appendChild(dd);

      dl.appendChild(wrapper);
    }
    fieldset.appendChild(dl);

    if (group.note) {
      const note = document.createElement("p");
      note.textContent = group.note;
      fieldset.appendChild(note);
    }

    section.appendChild(fieldset);

    if (group.errors) {
      for (const err of group.errors) {
        const p = document.createElement("p");
        p.className = "field-error";
        p.id = err.id;
        p.hidden = true;
        p.textContent = err.message;
        section.appendChild(p);
      }
    }

    if (group.hasPrimarySelection && group.primaryForm) {
      const pf = group.primaryForm;
      const pFieldset = document.createElement("fieldset");
      pFieldset.id = pf.fieldsetId;
      pFieldset.hidden = true;

      const pLegend = document.createElement("legend");
      pLegend.textContent = "Primary effect size";
      pFieldset.appendChild(pLegend);

      if (pf.hint) {
        const pHint = document.createElement("p");
        pHint.textContent = pf.hint;
        pFieldset.appendChild(pHint);
      }
      if (pf.note) {
        const pNote = document.createElement("p");
        pNote.textContent = pf.note;
        pFieldset.appendChild(pNote);
      }

      const pContainer = document.createElement("div");
      pContainer.id = pf.containerId;
      pFieldset.appendChild(pContainer);

      section.appendChild(pFieldset);
    }
  }
}

// ── Initialisation ───────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Build column checklists from shared JSON before attaching listeners
  await buildColumnChecklists();

  // Radio change listeners
  document.querySelectorAll('input[name="variation_type"]').forEach((r) =>
    r.addEventListener("change", handleVariationChange)
  );
  document
    .getElementById("assembly")
    .addEventListener("change", handleAssemblyChange);
  document.querySelectorAll('input[name="effect_size"]').forEach((r) =>
    r.addEventListener("change", handleEffectSizeChange)
  );
  document.querySelectorAll('input[name="p_value_type"]').forEach((r) =>
    r.addEventListener("change", handlePValueChange)
  );
  document.querySelectorAll('input[name="zero_pvalues"]').forEach((r) =>
    r.addEventListener("change", handleThresholdChange)
  );
  document.querySelectorAll('input[name="meets_row_count"]').forEach((r) =>
    r.addEventListener("change", handleRowCountChange)
  );
  document.querySelectorAll('input[name="gene_effect_size"]').forEach((r) =>
    r.addEventListener("change", handleGeneEffectSizeChange)
  );
  document.querySelectorAll('input[name="gene_name"]').forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );
  document.querySelectorAll('input[name="gene_position"]').forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );
  // Uncertainty estimate checkboxes (gene)
  document.querySelectorAll('input[name="gene_uncertainty_estimate"]').forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );
  // Uncertainty estimate checkboxes (CNV)
  document.querySelectorAll(
    'input[name="standard_error"], input[name="ci_lower"], input[name="ci_upper"]'
  ).forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );
  // Position checkboxes (CNV)
  document.querySelectorAll('input[name="col_cnv"]').forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );
  // Statistical model type (CNV)
  document.querySelectorAll('input[name="model_type"]').forEach((r) =>
    r.addEventListener("change", updateColumnsNextButton)
  );

  // Example file panel
  document
    .getElementById("example-select")
    .addEventListener("change", handleExampleSelectChange);
  document
    .getElementById("btn-download-example")
    .addEventListener("click", downloadExample);

  // File input
  document
    .getElementById("file-input")
    .addEventListener("change", (e) => handleFileChange(e.target));

  // Navigation buttons (data-action="next" / data-action="prev")
  document.querySelectorAll('[data-action="next"]').forEach((btn) =>
    btn.addEventListener("click", next)
  );
  document.querySelectorAll('[data-action="prev"]').forEach((btn) =>
    btn.addEventListener("click", prev)
  );

  // Action buttons
  document
    .getElementById("btn-validate")
    .addEventListener("click", validateFile);
  document
    .getElementById("btn-download")
    .addEventListener("click", downloadOutput);
  document.getElementById("btn-reset").addEventListener("click", async () => {
    document.getElementById("wizard").reset();
    if (hasValidatedOutput) await callWorker("cleanup");
    hasValidatedOutput = false;
    document.getElementById("validation-output").hidden = true;
    document.getElementById("file-info").hidden = true;
    document.getElementById("assembly-group").hidden = true;
    document.getElementById("columns-gene").hidden = true;
    document.getElementById("columns-cnv").hidden = true;
    document.getElementById("columns-placeholder").hidden = false;
    document.getElementById("warn-rowcount").hidden = true;
    document.querySelectorAll(".wizard-warning").forEach((w) => (w.hidden = true));
    document.querySelectorAll(".field-error").forEach((e) => (e.hidden = true));
    document.getElementById("primary-effect-gene").hidden = true;
    document.getElementById("primary-effect-cnv").hidden = true;
    document.querySelectorAll("[id^='next-']").forEach((b) => (b.disabled = true));
    goToStep(0);
  });

  // Start Web Worker (Pyodide loads off the main thread)
  worker = new Worker("validation-worker.js");
  showLoading("Loading Python environment...");
  worker.onmessage = ({ data: msg }) => {
    if (msg.type === "ready") {
      workerReady = true;
      hideLoading();
      if (msg.version) {
        const el = document.getElementById("sumstatlib-version");
        if (el) el.innerHTML = `Running <a href="https://github.com/ebispot/gwas-beyond-snps"><code>gwascatalog.sumstatlib</a> ${msg.version}</code> in your browser.`;
      }
      return;
    }
    if (msg.type === "progress") {
      handleValidationProgress(msg);
      return;
    }

    // Handle worker initialization or unhandled errors (id 0)
    if (msg.type === "error" && msg.id === 0) {
      console.error("Worker initialization error:", msg.error);
      hideLoading();
      const banner = document.getElementById("error-banner");
      if (banner) {
        banner.innerHTML = `
          <strong>Failed to load the Python environment.</strong><br>
          Error: ${msg.error}<br><br>
          Please try to <a href="javascript:location.reload()">refresh the page</a>. 
          If the problem persists, please contact 
          <a href="mailto:gwas-subs@ebi.ac.uk">gwas-subs@ebi.ac.uk</a>.
        `;
        banner.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }

    const p = _pending.get(msg.id);
    if (!p) return;
    _pending.delete(msg.id);
    if (msg.type === "done") p.resolve(msg.result);
    if (msg.type === "error") p.reject(new Error(msg.error));
  };

  // Show initial step
  goToStep(0);
});

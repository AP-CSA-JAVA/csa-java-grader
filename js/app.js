// =====================================================================
// app.js — page wiring: assignment picker, zip drop, grading loop,
// results table, details, CSV export, and saved progress.
// =====================================================================

import { outputSpec, specTitle, specSlug } from './assignment-name.js';
import { CONFIG } from './config.js';
import { specList, privateInfo, privateMailer, importSpec, loadPrivate, clearPrivate } from './spec-store.js';
import { readCanvasZip } from './canvas-zip.js';
import { gradeStudent, feedbackText } from './grader.js';
import { startJava, compileStudent, compileDriver, runStudent, harnessVersion } from './runner.js';
import { studentPdf, classPdf, sheetFileName } from './report-pdf.js';
import { summaryPdf, summaryFileName } from './summary-pdf.js';
import { initEmail } from './email.js';

const $ = (id) => document.getElementById(id);
const els = {
  javaStatus: $('javaStatus'), specSelect: $('specSelect'), dropZone: $('dropZone'), fileInput: $('fileInput'),
  zipInfo: $('zipInfo'), resultsCard: $('resultsCard'), resultsTitle: $('resultsTitle'), progressText: $('progressText'),
  progressBar: $('progressBar'), banner: $('banner'), body: $('resultsBody'),
  specSourceText: $('specSourceText'), loadSpecsBtn: $('loadSpecsBtn'), clearSpecsBtn: $('clearSpecsBtn'), specFileInput: $('specFileInput'),
  gradeBtn: $('gradeBtn'), exportBtn: $('exportBtn'), clearBtn: $('clearBtn'), printBtn: $('printBtn'), summaryBtn: $('summaryBtn'),
  emailBtn: $('emailBtn'),
};

const state = {
  spec: null,
  specFile: null,
  zipName: '',
  zipSize: 0,
  students: [],
  results: new Map(),      // key -> result
  finals: new Map(),       // key -> overridden final score
  javaReady: false,
  grading: false,
};

const java = { compileStudent, compileDriver, runStudent };

// ---------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------

// Assignments: "Any assignment" is built in; the rest come from your private
// repository's zip via "Load assignments" (see js/spec-store.js).
function fillSpecs(want) {
  const list = specList();
  els.specSelect.innerHTML = '';
  for (const s of list) {
    const opt = document.createElement('option');
    opt.value = s.key;
    opt.textContent = s.label;
    els.specSelect.append(opt);
  }
  // older saved choices were plain file names
  const saved = want || localGet('grader:lastSpec') || '';
  const match = list.find((s) => s.key === saved || s.file === saved.replace(/^\.\//, '') || s.file === saved);
  els.specSelect.value = (match || list[0]).key;

  const info = privateInfo();
  els.specSourceText.textContent = info
    ? `${info.count} assignment${info.count === 1 ? '' : 's'}${info.mailer ? ' and mailer settings' : ''} from ${info.source}, loaded ${new Date(info.loadedAt).toLocaleDateString()}`
    : 'Only “Any assignment” is built in. Load your assignments zip to grade with tests.';
  els.clearSpecsBtn.hidden = !info;
}

async function chooseSpec(key) {
  try {
    await loadSpec(key);
  } catch (err) {
    console.error(err);
    showBanner(`Could not open that assignment: ${escapeHtml(err.message || String(err))}`);
    const fallback = specList().find((s) => s.builtIn);
    els.specSelect.value = fallback.key;
    await loadSpec(fallback.key);
  }
  localSet('grader:lastSpec', els.specSelect.value);
  if (state.students.length) { restoreSaved(); renderAll(); }
}

fillSpecs();
await chooseSpec(els.specSelect.value);

els.specSelect.addEventListener('change', () => chooseSpec(els.specSelect.value));

els.loadSpecsBtn.addEventListener('click', () => els.specFileInput.click());
els.specFileInput.addEventListener('change', async () => {
  const files = [...els.specFileInput.files];
  els.specFileInput.value = '';
  if (!files.length) return;
  els.loadSpecsBtn.disabled = true;
  els.specSourceText.textContent = 'Reading assignments…';
  try {
    const { count, skipped } = await loadPrivate(files, window.JSZip);
    hideBanner();
    const current = els.specSelect.value;
    fillSpecs(current);
    await chooseSpec(els.specSelect.value);
    if (skipped) showBanner(`Loaded ${count} assignments. ${skipped} listed in index.js could not be found in the zip.`);
  } catch (err) {
    console.error(err);
    fillSpecs(els.specSelect.value);
    showBanner(escapeHtml(err.message || String(err)));
  } finally {
    els.loadSpecsBtn.disabled = false;
  }
});
els.clearSpecsBtn.addEventListener('click', async () => {
  if (!confirm('Remove the loaded assignments (and mailer settings) from this browser? Load the zip again to get them back.')) return;
  clearPrivate();
  fillSpecs();
  await chooseSpec(els.specSelect.value);
});

startJava((msg) => setJavaStatus('wait', msg))
  .then(() => {
    state.javaReady = true;
    setJavaStatus('ok', harnessVersion ? 'Java ready' : 'Java ready (slow mode)');
    els.javaStatus.title = harnessVersion
      ? `Java 17 with the Eclipse compiler · harness ${harnessVersion}`
      : 'CheerpJ library mode did not start, so each compile reloads the compiler (about 15 s each). Try reloading the page.';
    updateButtons();
  })
  .catch((err) => {
    console.error(err);
    setJavaStatus('bad', 'Java failed to load');
    showBanner(`Java could not start: ${escapeHtml(err.message || String(err))}`);
  });

async function loadSpec(key) {
  state.spec = await importSpec(key);
  state.specFile = key;
}

function setJavaStatus(kind, text) {
  els.javaStatus.className = `pill pill-${kind}`;
  els.javaStatus.textContent = text;
}

// ---------------------------------------------------------------------
// Zip input
// ---------------------------------------------------------------------

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); } });
els.fileInput.addEventListener('change', () => { if (els.fileInput.files[0]) openZip(els.fileInput.files[0]); });
['dragenter', 'dragover'].forEach((t) => els.dropZone.addEventListener(t, (e) => { e.preventDefault(); els.dropZone.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => els.dropZone.addEventListener(t, (e) => { e.preventDefault(); els.dropZone.classList.remove('over'); }));
els.dropZone.addEventListener('drop', (e) => {
  const f = [...e.dataTransfer.files].find((x) => /\.zip$/i.test(x.name));
  if (f) openZip(f); else showBanner('Please drop the .zip file that Canvas downloads.');
});

async function openZip(file) {
  if (state.grading) return;
  hideBanner();
  try {
    state.students = await readCanvasZip(file, window.JSZip);
  } catch (err) {
    showBanner(`Could not read that zip: ${escapeHtml(err.message || String(err))}`);
    return;
  }
  state.zipName = file.name;
  state.zipSize = file.size;
  const files = state.students.reduce((t, s) => t + s.files.length, 0);
  els.zipInfo.hidden = false;
  els.zipInfo.textContent = `${file.name} — ${state.students.length} student${state.students.length === 1 ? '' : 's'}, ${files} files`;
  els.resultsCard.hidden = false;
  restoreSaved();
  renderAll();
  updateButtons();
}

// ---------------------------------------------------------------------
// Saved progress (so a reload after a frozen tab picks up where it left off)
// ---------------------------------------------------------------------

function saveKey() {
  return `grader:${state.spec.id}:${state.zipName}:${state.zipSize}`;
}

function restoreSaved() {
  state.results = new Map();
  state.finals = new Map();
  const saved = localGetJSON(saveKey());
  if (!saved) return;
  for (const [k, r] of Object.entries(saved.results || {})) state.results.set(k, r);
  for (const [k, v] of Object.entries(saved.finals || {})) state.finals.set(k, v);

  // A student that was mid-grade when the page froze is marked stuck.
  if (saved.inProgress && !state.results.has(saved.inProgress)) {
    const st = state.students.find((s) => s.key === saved.inProgress);
    if (st) state.results.set(st.key, stuckResult(st));
  }
  const n = state.results.size;
  if (n) showBanner(`Picked up where you left off: ${n} of ${state.students.length} already graded. Use <b>Clear saved</b> to start over.`);
}

function persist(inProgress = null) {
  localSetJSON(saveKey(), {
    results: Object.fromEntries(state.results),
    finals: Object.fromEntries(state.finals),
    inProgress,
  });
}

els.clearBtn.addEventListener('click', () => {
  if (state.grading) return;
  localStorage.removeItem(saveKey());
  state.results.clear();
  state.finals.clear();
  hideBanner();
  renderAll();
  updateButtons();
});

// ---------------------------------------------------------------------
// Grading loop
// ---------------------------------------------------------------------

els.gradeBtn.addEventListener('click', () => gradeAll());

async function gradeAll(onlyKey = null) {
  if (!state.javaReady || state.grading) return;
  state.grading = true;
  updateButtons();
  const todo = state.students.filter((s) => (onlyKey ? s.key === onlyKey : !state.results.has(s.key)));

  for (const st of todo) {
    persist(st.key);                         // mark in progress before running student code
    renderRow(st, { running: 'Starting' });
    updateProgress(st.name);

    const limitMs = ((state.spec.runs?.length || 0) + 2) * CONFIG.runTimeoutMs + 30000;
    let r;
    try {
      r = await withTimeout(
        gradeStudent(st, state.spec, java, (step) => renderRow(st, { running: step })),
        limitMs,
      );
    } catch (err) {
      if (err === TIMEOUT) {
        state.results.set(st.key, stuckResult(st));
        persist(null);
        renderRow(st);
        showBanner(`<b>${escapeHtml(st.name)}</b>'s program seems stuck in a loop. Reload the page and drop the zip again to finish the rest — everything graded so far is saved.`);
        break;
      }
      console.error(err);
      r = errorResult(st, err);
    }
    state.results.set(st.key, r);
    persist(null);
    renderRow(st);
  }

  state.grading = false;
  updateProgress();
  updateButtons();
}

const TIMEOUT = Symbol('timeout');
function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(TIMEOUT), ms); }),
  ]);
}

function stuckResult(st) {
  return {
    key: st.key, name: st.name, late: st.late, files: st.files.map((f) => f.cleanName || f.name),
    stuck: true, notes: ['Grading stopped: the program appeared to run forever (infinite loop). Grade this one by hand or use Regrade.'],
    scores: null,
  };
}

function errorResult(st, err) {
  return {
    key: st.key, name: st.name, late: st.late, files: st.files.map((f) => f.cleanName || f.name),
    stuck: true, notes: [`Grader error: ${err.message || err}`], scores: null,
  };
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

/** The assignment for titles and file names ("Any assignment" gets a name from the zip). */
function outSpec() {
  return outputSpec(state.spec, state.results, state.zipName);
}

function showTitle() {
  const named = outSpec();
  els.resultsTitle.textContent = named.id === 'general' && !named.displayTitle ? 'Results' : specTitle(named, ' ');
}

function renderAll() {
  showTitle();
  els.body.innerHTML = '';
  for (const st of state.students) renderRow(st);
  updateProgress();
}

function renderRow(st, opts = {}) {
  let row = els.body.querySelector(`tr.main[data-key="${cssEscape(st.key)}"]`);
  const wasOpen = row?.nextElementSibling?.classList.contains('details');
  if (!row) {
    row = document.createElement('tr');
    row.className = 'main';
    row.dataset.key = st.key;
    els.body.append(row);
  }
  const r = state.results.get(st.key);
  const files = st.files.map((f) => f.cleanName || f.name).join(', ') || 'no files';
  const nameCell = `<td class="student"><span class="student-name">${escapeHtml(st.name)}</span>`
    + `${st.late ? '<span class="badge badge-late">LATE</span>' : ''}`
    + `${r?.stuck ? '<span class="badge badge-stuck">CHECK</span>' : ''}`
    + `${r?.newerJava ? `<span class="badge badge-newer" title="${escapeHtml(r.newerJava.compiled ? 'Uses Java newer than 8; graded as Java 17 with no penalty' : 'Also uses Java newer than 8')}">${r.newerJava.compiled ? 'JAVA 17' : 'NEWER JAVA'}</span>` : ''}`
    + `<div class="student-files">${escapeHtml(files)}</div></td>`;

  if (opts.running) {
    row.innerHTML = `${nameCell}<td colspan="7" class="status-cell"><span class="spinner"></span>${escapeHtml(opts.running)}…</td>`;
    return;
  }
  if (!r) {
    row.innerHTML = `${nameCell}<td colspan="7" class="status-cell">Not graded yet</td>`;
    return;
  }
  if (!r.scores) {
    row.innerHTML = `${nameCell}<td colspan="5" class="status-cell">${escapeHtml(r.notes[0] || 'Needs a look')}</td>`
      + `<td>${finalInput(st.key, '')}</td><td><button class="btn btn-small" data-regrade="${escapeHtml(st.key)}" type="button">Regrade</button></td>`;
    wireRow(row, st);
    return;
  }

  const s = r.scores;
  if (s.mode === 'points') {
    const pct = s.maxPoints ? s.points / s.maxPoints : 0;
    const band = pct >= 0.9 ? 5 : pct >= 0.8 ? 4 : pct >= 0.7 ? 3 : 2;
    row.innerHTML = nameCell
      + `<td colspan="4" class="status-cell">${r.compile?.ok ? 'Compiles' : '<b>Does not compile</b>'} · ${s.points} of ${s.maxPoints} points`
      + `${s.review ? ` · <b>${s.review}</b> to check by hand` : ''}</td>`
      + `<td><span class="score sc-${band} score-big">${s.points}/${s.maxPoints}</span></td>`
      + `<td>${finalInput(st.key, s.points, s.maxPoints)}</td>`
      + `<td><button class="open-btn" type="button" aria-expanded="false" aria-label="Show details for ${escapeHtml(st.name)}">▾</button></td>`;
    wireRow(row, st);
    if (wasOpen) toggleDetails(row, st, true);
    return;
  }
  const hdr = r.header
    ? (s.headerDeduction ? `<span class="hdr-bad" title="${escapeHtml(r.header.present ? `Blank: ${r.header.blank.join(', ')}` : 'No header found')}">−${s.headerDeduction}</span>` : '<span class="hdr-ok">✓</span>')
    : '<span class="sc-none">—</span>';
  row.innerHTML = nameCell
    + `<td>${chip(s.output)}</td><td>${chip(s.style)}</td><td>${chip(s.submission)}</td>`
    + `<td>${hdr}</td><td>${chip(s.suggested, true)}</td>`
    + `<td>${finalInput(st.key, s.suggested)}</td>`
    + `<td><button class="open-btn" type="button" aria-expanded="false" aria-label="Show details for ${escapeHtml(st.name)}">▾</button></td>`;
  wireRow(row, st);
  if (wasOpen) toggleDetails(row, st, true);
}

function wireRow(row, st) {
  const input = row.querySelector('.final-input');
  input?.addEventListener('change', () => {
    const v = input.value.trim();
    if (v === '' || Number(v) === state.results.get(st.key)?.scores?.suggested) state.finals.delete(st.key);
    else state.finals.set(st.key, Math.max(0, Math.min(Number(input.dataset.max || 5), Number(v))));
    input.classList.toggle('overridden', state.finals.has(st.key));
    persist(null);
    const details = row.nextElementSibling;
    if (details?.classList.contains('details')) toggleDetails(row, st, true);   // refresh feedback
  });
  row.querySelector('.open-btn')?.addEventListener('click', () => toggleDetails(row, st));
  row.querySelector('[data-regrade]')?.addEventListener('click', () => {
    state.results.delete(st.key);
    gradeAll(st.key);
  });
}

function finalInput(key, suggested, max = 5) {
  const has = state.finals.has(key);
  const value = has ? state.finals.get(key) : suggested;
  return `<input class="final-input${has ? ' overridden' : ''}" type="number" min="0" max="${max}" step="0.5" value="${value}" data-max="${max}" aria-label="Final score">`;
}

function chip(n, big = false) {
  if (n === null || n === undefined) return '<span class="sc-none">—</span>';
  return `<span class="score sc-${Math.round(n)}${big ? ' score-big' : ''}">${n}</span>`;
}

function toggleDetails(row, st, forceOpen = false) {
  const btn = row.querySelector('.open-btn');
  let next = row.nextElementSibling;
  const isOpen = next?.classList.contains('details');
  if (isOpen) next.remove();
  if (isOpen && !forceOpen) { btn?.setAttribute('aria-expanded', 'false'); return; }

  const r = state.results.get(st.key);
  next = document.createElement('tr');
  next.className = 'details';
  next.innerHTML = `<td colspan="8">${detailsHtml(r)}</td>`;
  row.after(next);
  btn?.setAttribute('aria-expanded', 'true');

  next.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    const ta = next.querySelector('textarea');
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    e.target.textContent = 'Copied';
    setTimeout(() => { e.target.textContent = 'Copy for Canvas'; }, 1500);
  });
  next.querySelector('[data-pdf]')?.addEventListener('click', () => {
    const r = state.results.get(st.key);
    savePdf(studentPdf(window.jspdf.jsPDF, r, outSpec()), sheetFileName(r, outSpec()));
  });
  next.querySelector('[data-regrade]')?.addEventListener('click', () => {
    state.results.delete(st.key);
    next.remove();
    gradeAll(st.key);
  });
}

function detailsHtml(r) {
  const spec = outSpec();
  const checkLi = (c) => `<li class="${c.pass === null ? 'skip' : c.pass ? 'pass' : 'fail'}">${escapeHtml(c.label)}`
    + `${c.detail ? `<span class="why">${escapeHtml(c.detail)}</span>` : ''}`
    + `${c.hint && c.pass === false ? `<span class="why hint">Hint: ${escapeHtml(c.hint)}</span>` : ''}</li>`;

  // Compilation & Output
  let co = '';
  if (!r.submission?.hasJava) {
    co = '<p class="muted">No .java file submitted.</p>';
  } else {
    co += r.compile.ok
      ? `<ul class="checks"><li class="pass">Compiles</li></ul>`
      : `<ul class="checks"><li class="fail">Does not compile (${r.compile.errors} error${r.compile.errors === 1 ? '' : 's'})</li></ul><pre class="out">${escapeHtml(r.compile.messages)}</pre>`;
    if (r.requirements.length) co += `<h4>Code requirements</h4><ul class="checks">${r.requirements.map(checkLi).join('')}</ul>`;
    for (const run of r.runs) {
      co += `<h4>Run: ${escapeHtml(run.label)}</h4><ul class="checks">${run.checks.map(checkLi).join('')}</ul>`
        + `<details class="run"><summary>Show input and output (${run.output.ms ?? 0} ms)</summary>`
        + `<pre class="out"><b>Typed:</b>\n${escapeHtml(truncate(run.stdin, 400))}</pre>`
        + `<pre class="out"><b>Program printed:</b>\n${escapeHtml(truncate(run.output.stdout, 4000)) || '(nothing)'}${run.output.exception ? `\n\n${escapeHtml(run.output.exception)}` : ''}</pre></details>`;
    }
    if (r.compile.ok && !r.runs.length && !r.requirements.length) co += '<p class="muted">This assignment has no output tests — compiling earns the 5.</p>';
    co = newerJavaHtml(r) + co;
  }

  // Documentation & Style
  let ds = '';
  if (r.submission?.hasJava) {
    ds = r.style.length
      ? r.style.map((i) => `<p class="issue"><b>${escapeHtml(i.label)}</b> — ${i.count}×`
        + i.where.map((w) => `<span class="where">${escapeHtml(w.file)}:${w.line}  ${escapeHtml(w.snippet)}</span>`).join('')
        + `${i.count > i.where.length ? `<span class="where">…and ${i.count - i.where.length} more</span>` : ''}</p>`).join('')
      : '<ul class="checks"><li class="pass">No convention issues found</li></ul>';
    ds += `<p class="muted small">${r.style.length} unique issue type${r.style.length === 1 ? '' : 's'} → ${r.scores.style}/5</p>`;
  }

  // Submission + header
  let sub = `<ul class="checks">`
    + `<li class="${r.submission?.hasJava ? 'pass' : 'fail'}">.java file</li>`
    + `<li class="${r.submission?.hasTestCases ? 'pass' : spec.requireTestCases === false ? 'skip' : 'fail'}">Test cases document / screenshot`
    + `${r.submission?.commentTestCases ? ` (or ${r.submission.commentTestCases} TEST CASE label${r.submission.commentTestCases === 1 ? '' : 's'} in a comment)` : ''}</li></ul>`
    + `<p class="muted small">Files: ${escapeHtml(r.files.join(', '))}</p>`;
  if (r.header) {
    sub += `<h4>Header ${r.header.present ? '' : '— not found'}</h4><table class="kv">`
      + r.header.fields.map((f) => `<tr><td>${escapeHtml(f.label)}</td><td class="${f.filled ? '' : 'blank'}">${escapeHtml(f.value || (r.header.present ? '(blank)' : '—'))}</td></tr>`).join('')
      + `</table>`;
  }

  const notes = r.notes?.length ? `<ul class="notes">${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '';
  const fb = feedbackText(r, spec, state.finals.get(r.key));

  if (r.scores.mode === 'points') {
    const items = [...r.requirements, ...r.runs.flatMap((x) => x.checks)];
    const compileBox = r.compile.ok ? '' : `<pre class="out">${escapeHtml(r.compile.messages)}</pre>`;
    const runs = r.runs.map((run) => `<details class="run"><summary>Show the test run (${escapeHtml(run.label)})</summary>`
      + `<pre class="out"><b>Typed:</b>\n${escapeHtml(truncate(run.stdin, 400))}</pre>`
      + `<pre class="out"><b>Program printed:</b>\n${escapeHtml(truncate(run.output.stdout, 4000)) || '(nothing)'}${run.output.exception ? `\n\n${escapeHtml(run.output.exception)}` : ''}</pre></details>`).join('');
    return `<div class="detail-grid">
        <div class="detail-box" style="grid-column: span 2"><h3>Rubric — ${r.scores.points} / ${r.scores.maxPoints}</h3>${newerJavaHtml(r)}${compileBox}<ul class="checks">${items.map(checkLi).join('')}</ul>${runs}</div>
        <div class="detail-box"><h3>Style notes (not scored)</h3>${ds}<h3 style="margin-top:14px">Files</h3>${sub}</div>
      </div>
      ${notes}
      <div class="feedback">
        <div class="feedback-head"><b>Feedback for the student</b>
          <span><button class="btn btn-small" type="button" data-regrade>Regrade</button>
          <button class="btn btn-small" type="button" data-copy>Copy for Canvas</button>
          <button class="btn btn-small" type="button" data-pdf>Correction sheet (PDF)</button></span></div>
        <textarea readonly>${escapeHtml(fb)}</textarea>
      </div>`;
  }

  return `<div class="detail-grid">
      <div class="detail-box"><h3>Compilation &amp; Output — ${r.scores.output}</h3>${co}</div>
      <div class="detail-box"><h3>Documentation &amp; Style — ${r.scores.style}</h3>${ds}</div>
      <div class="detail-box"><h3>Submission — ${r.scores.submission}</h3>${sub}</div>
    </div>
    ${notes}
    <div class="feedback">
      <div class="feedback-head"><b>Feedback for the student</b>
        <span><button class="btn btn-small" type="button" data-regrade>Regrade</button>
        <button class="btn btn-small" type="button" data-copy>Copy for Canvas</button>
          <button class="btn btn-small" type="button" data-pdf>Correction sheet (PDF)</button></span></div>
      <textarea readonly>${escapeHtml(fb)}</textarea>
    </div>`;
}

/** The newer-Java note shown at the top of the Compilation & Output box. */
function newerJavaHtml(r) {
  const nj = r.newerJava;
  if (!nj) return '';
  const head = nj.compiled
    ? `<b>Newer Java:</b> doesn't compile as Java 8 but does as Java 17, so it was graded as Java 17 with no penalty.`
    : `<b>Newer Java:</b> also uses features newer than Java 8.`;
  const items = nj.features.map((f) => `<li>${escapeHtml(f.name)} (Java ${f.since}) — line${f.where.length === 1 ? '' : 's'} ${escapeHtml([...new Set(f.where.map((w) => w.line))].join(', '))}</li>`).join('');
  const j8 = nj.compiled && nj.java8Messages?.length ? `<details class="run"><summary>Java 8 compiler said</summary><pre class="out">${escapeHtml(nj.java8Messages.join('\n'))}</pre></details>` : '';
  return `<div class="newer-note">${head}${items ? `<ul>${items}</ul>` : ''}${j8}</div>`;
}

function updateProgress(current = null) {
  showTitle();
  const total = state.students.length;
  const done = state.students.filter((s) => state.results.has(s.key)).length;
  els.progressBar.style.width = total ? `${(done / total) * 100}%` : '0';
  els.progressText.textContent = current
    ? `Grading ${current}… (${done} of ${total} done)`
    : `${done} of ${total} graded${done === total && total ? ' · open a row for details and feedback' : ''}`;
}

function updateButtons() {
  const remaining = state.students.some((s) => !state.results.has(s.key));
  els.gradeBtn.disabled = !state.javaReady || state.grading || !remaining;
  els.gradeBtn.textContent = state.grading ? 'Grading…' : state.javaReady ? (state.results.size ? 'Grade remaining' : 'Grade all') : 'Waiting for Java…';
  els.exportBtn.disabled = state.grading || !state.results.size;
  els.printBtn.disabled = state.grading || ![...state.results.values()].some((r) => r.scores);
  els.summaryBtn.disabled = els.printBtn.disabled;
  els.emailBtn.disabled = els.printBtn.disabled;
  els.clearBtn.disabled = state.grading;
}

// ---------------------------------------------------------------------
// Correction sheets (PDF)
// ---------------------------------------------------------------------

els.printBtn.addEventListener('click', () => {
  if (!window.jspdf) { showBanner('The PDF tool did not load. Reload the page and try again.'); return; }
  const graded = state.students.map((st) => state.results.get(st.key)).filter((r) => r && r.scores);
  const skipped = state.students.length - graded.length;
  if (!graded.length) return;
  const doc = classPdf(window.jspdf.jsPDF, graded, outSpec());
  savePdf(doc, `${specSlug(outSpec())}-correction-sheets.pdf`);
  if (skipped) showBanner(`${skipped} student${skipped === 1 ? '' : 's'} not included (not graded yet, or marked CHECK).`);
});

// Class summary for the teacher: every student plus the most common mistakes.
els.summaryBtn.addEventListener('click', () => {
  if (!window.jspdf) { showBanner('The PDF tool did not load. Reload the page and try again.'); return; }
  if (![...state.results.values()].some((r) => r.scores)) return;
  const doc = summaryPdf(window.jspdf.jsPDF, state.students, state.results, state.finals, outSpec(), state.zipName);
  savePdf(doc, summaryFileName(outSpec()));
});

function savePdf(doc, fileName) {
  const blob = doc.output('blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------------
// Email students (js/email.js; mailer in apps-script/Mailer.gs)
// ---------------------------------------------------------------------

initEmail({
  getStudents: () => state.students,
  getResult: (key) => state.results.get(key),
  getFinal: (key) => state.finals.get(key),
  outSpec,
  feedbackText,
  studentPdf: (r, spec) => {
    if (!window.jspdf) throw new Error('The PDF tool did not load. Reload the page.');
    return studentPdf(window.jspdf.jsPDF, r, spec);
  },
  sheetFileName,
  specSlug,
  specTitle: (spec) => specTitle(spec, ' '),
  escapeHtml,
  privateMailer,
});

// ---------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------

els.exportBtn.addEventListener('click', () => {
  const rows = [['Student', 'Late', 'Compilation & Output', 'Documentation & Style', 'Submission', 'Header deduction', 'Suggested', 'Final', 'Newer Java', 'Files', 'Feedback']];
  for (const st of state.students) {
    const r = state.results.get(st.key);
    if (!r) { rows.push([st.name, st.late ? 'yes' : '', '', '', '', '', '', '', '', '', 'not graded']); continue; }
    const s = r.scores;
    const final = state.finals.has(st.key) ? state.finals.get(st.key) : (s ? s.suggested : '');
    const pts = s?.mode === 'points';
    rows.push([
      st.name, st.late ? 'yes' : '',
      pts ? '' : s?.output ?? '', pts ? '' : s?.style ?? '', pts ? '' : s?.submission ?? '', pts ? '' : (s ? -s.headerDeduction : ''),
      pts ? `${s.points}/${s.maxPoints}` : s?.suggested ?? '', final,
      r.newerJava ? `${r.newerJava.compiled ? 'Graded as Java 17: ' : ''}${r.newerJava.features.map((f) => f.name).join(', ') || 'yes'}` : '',
      r.files.join('; '),
      s ? feedbackText(r, outSpec(), state.finals.get(st.key)) : r.notes.join(' '),
    ]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${specSlug(outSpec())}-grades.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function showBanner(html) { els.banner.innerHTML = html; els.banner.hidden = false; }
function hideBanner() { els.banner.hidden = true; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssEscape(s) { return window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
function csvCell(v) { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function truncate(s, n) { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s; }
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } }
function localGetJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function localSetJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {
    // Too big (very large classes): drop program output transcripts and try again.
    try {
      const slim = JSON.parse(JSON.stringify(v));
      for (const r of Object.values(slim.results || {})) for (const run of r.runs || []) run.output.stdout = truncate(run.output.stdout, 1500);
      localStorage.setItem(k, JSON.stringify(slim));
    } catch { /* give up quietly; grading still works */ }
  }
}

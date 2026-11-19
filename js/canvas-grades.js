// =====================================================================
// canvas-grades.js — "Canvas grades": a CSV that Canvas Grades → Import
// accepts, with the columns in the order Canvas requires:
//
//   Student Name, Student ID, SIS User ID, SIS Login ID, Section, <Assignment>
//   (headers written as Canvas exports them: Student, ID, SIS User ID, …)
//
// Everything but the score comes from the roster (your Canvas gradebook
// export), so names, IDs and sections match Canvas exactly. The assignment
// column keeps its Canvas ID, e.g. "1.11.2 Race Car (123456)", so Canvas
// updates that assignment instead of making a new one. Students are matched
// to the roster by the Canvas ID in the submission file names.
//
// Only graded students are in the file. Canvas leaves everyone else alone,
// and it shows every change for you to approve before saving anything.
// =====================================================================

import { parseRoster } from './email.js';

const ROSTER_KEY = 'grader:roster';     // shared with Email students
const NEW_ASSIGNMENT = '__new__';

/**
 * @param {object} app
 *   getStudents(), getResult(key), getFinal(key), outSpec(),
 *   specTitle(spec), specSlug(spec), escapeHtml(s)
 */
export function initCanvasGrades(app) {
  const $ = (id) => document.getElementById(id);
  const dlg = $('canvasDialog');
  const els = {
    open: $('canvasBtn'), close: $('canvasClose'),
    rosterText: $('cgRosterText'), rosterBtn: $('cgRosterBtn'), rosterInput: $('cgRosterInput'),
    assignment: $('cgAssignment'), newName: $('cgNewName'), newWrap: $('cgNewWrap'),
    scale: $('cgScale'), scaleWrap: $('cgScaleWrap'), scaleText: $('cgScaleText'),
    body: $('cgBody'), note: $('cgNote'), count: $('cgCount'), download: $('cgDownload'),
  };
  const esc = app.escapeHtml;

  els.open.addEventListener('click', () => {
    els.note.textContent = '';
    fillAssignments();
    render();
    dlg.showModal();
  });
  els.close.addEventListener('click', () => dlg.close());

  els.rosterBtn.addEventListener('click', () => els.rosterInput.click());
  els.rosterInput.addEventListener('change', async () => {
    const f = els.rosterInput.files[0];
    els.rosterInput.value = '';
    if (!f) return;
    try {
      localSetJSON(ROSTER_KEY, parseRoster(await f.text(), f.name));
      els.note.textContent = '';
    } catch (err) {
      els.note.textContent = err.message || String(err);
    }
    fillAssignments();
    render();
  });

  els.assignment.addEventListener('change', () => { els.scale.checked = defaultScale(); render(); });
  els.newName.addEventListener('input', render);
  els.scale.addEventListener('change', render);

  /** The roster, if it was loaded by a version that keeps the Canvas columns. */
  function roster() {
    const r = localGetJSON(ROSTER_KEY);
    return r && Array.isArray(r.assignments) ? r : null;
  }

  function fillAssignments() {
    const r = roster();
    const spec = app.outSpec();
    const title = app.specTitle(spec);
    els.rosterText.textContent = r
      ? `Gradebook: ${r.source} · ${Object.keys(r.rows).length} students · ${r.assignments.length} assignments`
      : localGetJSON(ROSTER_KEY)
        ? 'Load your gradebook again — the saved roster is from before Canvas grades and is missing the Section and SIS columns.'
        : 'No gradebook yet. Canvas → Grades → Export → Export Current Gradebook View, then load it here.';

    els.assignment.innerHTML = '';
    for (const a of r?.assignments || []) {
      const opt = document.createElement('option');
      opt.value = a.header;
      opt.textContent = a.points != null ? `${a.header} — ${a.points} pts` : a.header;
      els.assignment.append(opt);
    }
    const opt = document.createElement('option');
    opt.value = NEW_ASSIGNMENT;
    opt.textContent = 'New assignment in Canvas…';
    els.assignment.append(opt);

    const best = bestMatch(r?.assignments || [], spec, title);
    els.assignment.value = best ? best.header : NEW_ASSIGNMENT;
    if (!els.newName.value) els.newName.value = title;
    els.scale.checked = defaultScale();
  }

  function chosen() {
    const r = roster();
    if (els.assignment.value === NEW_ASSIGNMENT) return { header: els.newName.value.trim(), points: null, isNew: true };
    return r?.assignments.find((a) => a.header === els.assignment.value) || null;
  }

  /** What the grader scored out of: 5 for the rubric, maxPoints for points-mode specs. */
  function graderMax() {
    for (const st of app.getStudents()) {
      const s = app.getResult(st.key)?.scores;
      if (s) return s.mode === 'points' ? s.maxPoints : 5;
    }
    return 5;
  }

  function defaultScale() {
    const a = chosen();
    return !!(a && a.points && a.points !== graderMax());
  }

  function finalScore(st) {
    const r = app.getResult(st.key);
    if (!r?.scores) return null;
    const fin = app.getFinal(st.key);
    if (fin != null && fin !== '') return Number(fin);
    return r.scores.mode === 'points' ? r.scores.points : r.scores.suggested;
  }

  function rows() {
    const r = roster();
    const a = chosen();
    const max = graderMax();
    const scale = els.scale.checked && a?.points ? a.points / max : 1;
    return app.getStudents().map((st) => {
      const entry = r?.rows[st.key];
      const raw = finalScore(st);
      let problem = '';
      if (!r) problem = 'Load the gradebook';
      else if (!entry) problem = 'Not in the gradebook';
      else if (raw == null) problem = app.getResult(st.key) ? 'Marked CHECK — not graded' : 'Not graded yet';
      const score = raw == null ? null : round2(raw * scale);
      return { st, entry, raw, score, problem };
    });
  }

  function render() {
    const a = chosen();
    const isNew = els.assignment.value === NEW_ASSIGNMENT;
    els.newWrap.hidden = !isNew;

    const max = graderMax();
    els.scaleWrap.hidden = !(a && a.points && a.points !== max);
    if (!els.scaleWrap.hidden) {
      els.scaleText.textContent = `Scale to Canvas points: the grader scores out of ${max}, this assignment is out of ${a.points} `
        + `(e.g. ${max === 5 ? 4 : Math.round(max * 0.8)}/${max} → ${round2((max === 5 ? 4 : Math.round(max * 0.8)) * a.points / max)}/${a.points})`;
    }

    const list = rows();
    els.body.innerHTML = list.map((d) => `<tr${d.problem ? ' class="cg-skip"' : ''}>`
      + `<td class="em-name">${esc(d.entry?.canvas?.student || d.st.name)}</td>`
      + `<td>${esc(d.entry?.canvas?.section || '')}</td>`
      + `<td>${d.raw == null ? '' : esc(String(d.raw))}</td>`
      + `<td>${d.problem ? '' : `<b>${esc(String(d.score))}</b>`}</td>`
      + `<td>${d.problem ? `<span class="em-bad">${esc(d.problem)}</span>` : '<span class="em-ok">In the file</span>'}</td>`
      + '</tr>').join('') || '<tr><td colspan="5" class="muted">No students yet.</td></tr>';

    const n = list.filter((d) => !d.problem).length;
    const skipped = list.length - n;
    els.count.textContent = `${n} student${n === 1 ? '' : 's'} in the file${skipped ? ` · ${skipped} left out` : ''}`;
    els.download.disabled = !n || !a || !a.header;
  }

  els.download.addEventListener('click', () => {
    const a = chosen();
    if (!a || !a.header) return;
    // Header names exactly as Canvas exports them, so the import always recognizes them.
    const out = [['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', a.header]];
    const list = rows().filter((d) => !d.problem)
      .sort((x, y) => x.entry.canvas.student.localeCompare(y.entry.canvas.student));
    for (const d of list) {
      const c = d.entry.canvas;
      out.push([c.student, d.st.key, c.sisUser, c.sisLogin, c.section, d.score]);
    }
    const csv = out.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${app.specSlug(app.outSpec())}-canvas-import.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    els.note.textContent = `Saved. In Canvas: Grades → Import → choose this file → review the changes → Upload.`
      + (a.isNew ? ' Canvas will ask you to confirm the new assignment and set its points.' : '');
  });

  return { refresh: () => { if (dlg.open) render(); } };
}

/** The gradebook column that best fits the assignment: by number (1.11.2) first, then by title words. */
function bestMatch(assignments, spec, title) {
  if (!assignments.length) return null;
  const id = spec && spec.id !== 'general' ? String(spec.id) : '';
  if (id) {
    const re = new RegExp(`(^|[^\\d.])${id.replace(/\./g, '\\.')}(?![\\d])`);
    const hit = assignments.find((a) => re.test(a.name));
    if (hit) return hit;
  }
  const words = (s) => new Set(String(s).toLowerCase().replace(/\.(?=\D|$)/g, ' ').split(/[^a-z0-9.]+/).filter((w) => w.length > 1));
  const want = words(spec?.title ? `${spec.title} ${title}` : title);
  if (!want.size) return null;
  let best = null; let bestScore = 0;
  for (const a of assignments) {
    const have = words(a.name);
    const common = [...want].filter((w) => have.has(w)).length;
    const score = common / Math.max(want.size, have.size);
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

function round2(n) { return Math.round(n * 100) / 100; }
function csvCell(v) { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function localGetJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function localSetJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } }

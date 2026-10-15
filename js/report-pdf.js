// =====================================================================
// report-pdf.js — the printable Correction Sheet for students.
//
// One student = at most two pages (one sheet printed double-sided):
//   score + rubric columns, a numbered fix list with checkboxes, the style
//   notes, and what to turn in. Only problems are listed, never full
//   program output. Long lists are trimmed ("…and 3 more") and the text
//   shrinks a little before anything is cut, so a sheet never runs past
//   two pages.
//
// Uses jsPDF (js/vendor/jspdf.umd.min.js). Everything happens in the
// browser; nothing is uploaded.
// =====================================================================

import { forClass } from './newer-java.js';

// ---------------------------------------------------------------------
// 1. What goes on the sheet (no drawing here)
// ---------------------------------------------------------------------

const LIMITS = [
  // tried in order until the sheet fits on two pages
  { scale: 1.0, items: 12, styleTypes: 8, styleLines: 3, compileErrors: 3 },
  { scale: 0.92, items: 12, styleTypes: 8, styleLines: 3, compileErrors: 3 },
  { scale: 0.85, items: 10, styleTypes: 6, styleLines: 3, compileErrors: 3 },
  { scale: 0.8, items: 8, styleTypes: 5, styleLines: 2, compileErrors: 2 },
  { scale: 0.8, items: 6, styleTypes: 4, styleLines: 2, compileErrors: 2 },
];

/** Builds the sheet's content from a graded result. */
export function buildSheet(r, spec) {
  const s = r.scores || {};
  const header = r.header;
  const nameFromHeader = header?.fields?.find((f) => f.key === 'name' && f.filled)?.value?.replace(/[[\]]/g, '').trim();
  const sheet = {
    student: nameFromHeader || r.name,
    canvasName: r.name,
    late: !!r.late,
    assignment: spec.id === 'general' ? 'Assignment' : `${spec.id} — ${spec.title}`,
    mode: s.mode === 'points' ? 'points' : 'rubric',
    score: s.mode === 'points' ? `${s.points} / ${s.maxPoints}` : `${s.suggested ?? '—'} / 5`,
    columns: s.mode === 'points' ? [] : [
      { label: 'Compilation & Output', value: s.output },
      { label: 'Documentation & Style', value: s.style },
      { label: 'Submission', value: s.submission },
    ],
    headerNote: !header ? '' : !header.present ? 'Header missing (−1)' : header.blank.length ? `Header incomplete (−${s.headerDeduction})` : 'Header complete',
    passed: s.checksPassed ?? 0,
    total: s.checksTotal ?? 0,
    compiled: !!r.compile?.ok,
    items: [],
    style: [],
    // Newer-than-Java-8 features: listed for the student, no points off when it compiled as Java 17
    newer: (r.newerJava?.features || []).map((f) => ({
      label: `${f.name} (Java ${f.since})`,
      lines: [...new Set(f.where.map((w) => `${w.file} line ${w.line}`))],
      fix: f.fix,
    })),
    newerCompiled: !!r.newerJava?.compiled,
  };

  if (!r.submission?.hasJava) {
    sheet.items.push({ title: 'Submit your .java file', detail: 'No .java file was found in your submission.' });
    return sheet;
  }

  // Compile errors come first: nothing else can be fixed until the program compiles.
  if (r.compile && !r.compile.ok) {
    const errs = r.compile.messages.split('\n').filter((l) => /error:/.test(l)).map((l) => l.trim());
    sheet.items.push({
      title: `Fix the compile error${r.compile.errors === 1 ? '' : 's'} (${r.compile.errors})`,
      detail: 'Your program has to compile before anything else can be checked.',
      lines: errs,
      kind: 'compile',
    });
  }

  // Failed checks — the same problem appears only once (same rule as the score).
  const seen = new Set();
  const once = (c) => {
    const keys = [c.label, c.detail, c.group].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  };
  for (const c of r.requirements || []) {
    if (c.pass !== false || c.detail === 'Does not compile.') continue;   // compile problems are item 1 already
    if (once(c)) sheet.items.push({ title: plainLabel(c.label), detail: c.detail || '', hint: c.hint || '' });
  }
  for (const run of r.runs || []) {
    for (const c of run.checks) {
      if (c.pass !== false) continue;
      if (/^No program found for this test/.test(c.detail || '')) continue;   // already listed as "submit the program"
      if (!once(c)) continue;
      sheet.items.push({
        title: plainLabel(c.label),
        detail: c.detail || '',
        hint: c.hint || '',
        context: run.label,
        typed: typedSummary(run.stdin),
      });
    }
  }

  // Submission and header
  if (spec.requireTestCases !== false && r.submission && !r.submission.hasTestCases) {
    sheet.items.push({ title: 'Turn in your test cases document', detail: 'Inputs, expected output, actual output and Pass/Fail for each test. A document, a screenshot, or a comment at the bottom of your program labeled TEST CASE 1:, TEST CASE 2:, ...' });
  }
  if (header && (!header.present || header.blank.length)) {
    sheet.items.push({
      title: header.present ? 'Complete your block comment header' : 'Add the block comment header',
      detail: header.present ? `Fill in: ${header.blank.join(', ')}` : 'Name, Partner, Course, Instructor, Assignment, Due Date — at the top of your main file.',
    });
  }
  for (const n of r.notes || []) {
    if (/\.txt file instead/.test(n)) sheet.items.push({ title: 'Submit your code as a .java file', detail: n });
  }

  sheet.style = (r.style || []).map((i) => ({ label: plainLabel(i.label), count: i.count, where: i.where }));
  return sheet;
}

function plainLabel(s) {
  return String(s).replace(/^\d+\.\s*/, '').replace(/\s*\(checklist item\)\s*$/, '');
}

function typedSummary(stdin) {
  if (!stdin || stdin.startsWith('(grader test code')) return '';
  const lines = stdin.split('\n').filter((l) => l !== '');
  if (lines.length > 6) return `${lines.slice(0, 4).join(' / ')} / … (${lines.length} answers in all)`;
  return lines.join(' / ');
}

// ---------------------------------------------------------------------
// 2. Drawing
// ---------------------------------------------------------------------

/** Shown on every correction sheet and in the Canvas feedback when something needs fixing. */
export const STUCK = 'Stuck on an item? Re-read the step it names in the assignment instructions and the TO-DO comments in the starter code.';

const PAGE = { w: 612, h: 792, margin: 46 };   // US Letter in points
const INK = [29, 29, 31];
const MUTED = [100, 100, 106];
const LINE = [205, 203, 198];
const ACCENT = [194, 65, 12];

// Standard PDF fonts only cover basic Latin characters.
function safe(text) {
  return String(text ?? '')
    .replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, '->').replace(/÷/g, '/').replace(/×/g, 'x').replace(/…/g, '...')
    .replace(/[✓✔]/g, '').replace(/[✗✘]/g, '').replace(/•/g, '-').replace(/−/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/**
 * Draws one student's sheet starting on a fresh page of `doc`.
 * Returns the number of pages it used.
 */
function drawSheet(doc, sheet, lim, { firstPage, gradedOn }) {
  const k = lim.scale;
  const M = PAGE.margin;
  const W = PAGE.w - 2 * M;
  const startPage = doc.getNumberOfPages() + (firstPage ? 0 : 1);
  if (!firstPage) doc.addPage();
  let y = M;
  let pages = 1;

  const size = (pt) => doc.setFontSize(pt * k);
  const font = (style = 'normal', mono = false) => doc.setFont(mono ? 'courier' : 'helvetica', style);
  const color = (c) => doc.setTextColor(...c);
  const lh = (pt) => pt * k * 1.32;
  const ensure = (need) => {
    if (y + need <= PAGE.h - M - 22) return;
    doc.addPage();
    pages++;
    y = M;
  };
  const wrap = (text, width) => doc.splitTextToSize(safe(text), width);
  const para = (text, { pt = 10, style = 'normal', mono = false, c = INK, indent = 0, width = W - indent } = {}) => {
    size(pt); font(style, mono); color(c);
    for (const line of wrap(text, width)) {
      ensure(lh(pt));
      doc.text(line, M + indent, y + pt * k);
      y += lh(pt);
    }
  };

  // ---- title row ----
  size(9); font('bold'); color(ACCENT);
  doc.text('CORRECTION SHEET', M, y + 9 * k);
  size(9); font('normal'); color(MUTED);
  doc.text(safe(`CSA Java Grader  |  graded ${gradedOn}`), M + W, y + 9 * k, { align: 'right' });
  y += lh(9) + 4;

  // ---- student + assignment (left), score (right) ----
  const scoreW = 150 * Math.max(k, 0.85);
  const leftW = W - scoreW - 14;
  const top = y;
  size(17); font('bold'); color(INK);
  for (const line of wrap(sheet.student + (sheet.late ? '  (LATE)' : ''), leftW)) { doc.text(line, M, y + 17 * k); y += lh(17); }
  size(11); font('normal'); color(MUTED);
  for (const line of wrap(sheet.assignment, leftW)) { doc.text(line, M, y + 11 * k); y += lh(11); }

  // score box
  const boxH = 64 * Math.max(k, 0.85);
  doc.setDrawColor(...ACCENT); doc.setLineWidth(1.4);
  doc.roundedRect(M + W - scoreW, top, scoreW, boxH, 6, 6);
  size(8.5); font('bold'); color(ACCENT);
  doc.text(sheet.mode === 'points' ? 'SUGGESTED POINTS' : 'SUGGESTED SCORE', M + W - scoreW / 2, top + 15, { align: 'center' });
  size(26); font('bold'); color(INK);
  doc.text(safe(sheet.score), M + W - scoreW / 2, top + 15 + 28 * k, { align: 'center' });
  y = Math.max(y, top + boxH) + 10;

  // ---- rubric columns ----
  if (sheet.columns.length) {
    const colW = W / 4;
    const cells = [...sheet.columns.map((c) => [c.label, c.value ?? '-']), ['Header', sheet.headerNote.replace(/^Header /, '')]];
    doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
    doc.line(M, y, M + W, y);
    y += 6;
    cells.forEach(([label, value], i) => {
      const x = M + i * colW;
      size(8); font('normal'); color(MUTED);
      doc.text(safe(label), x, y + 8 * k);
      size(13); font('bold'); color(INK);
      doc.text(safe(String(value)), x, y + 8 * k + lh(13));
    });
    y += 8 * k + lh(13) + 6;
    doc.line(M, y, M + W, y);
    y += 12;
  }

  // ---- what passed ----
  size(10); font('normal'); color(INK);
  const failedChecks = sheet.total - sheet.passed;
  const passedText = !sheet.compiled
    ? 'Your program did not compile, so the other checks could not run yet.'
    : !sheet.total ? 'Your program compiled.'
      : failedChecks > sheet.items.length && sheet.items.length
        ? `${sheet.passed} of ${sheet.total} checks passed. One mistake can fail several checks, so each problem is listed once below.`
        : `${sheet.passed} of ${sheet.total} checks passed.`;
  para(passedText, { pt: 10.5, style: 'bold' });
  y += 6;

  // ---- fix list ----
  const items = sheet.items.slice(0, lim.items);
  const hidden = sheet.items.length - items.length;
  sectionTitle(doc, items.length ? 'What to fix' : sheet.style.length ? 'Every check passed - just the style notes below' : 'Nothing to fix - everything passed!', () => { ensure(lh(13) + 8); return y; }, (ny) => { y = ny; }, k);

  if (items.length) {
    para(STUCK, { pt: 9.5, style: 'italic', c: MUTED });
    y += 4;
  }
  items.forEach((it, idx) => {
    // estimate the block so a short item doesn't split across pages
    size(10.5); font('bold');
    const titleLines = wrap(`${idx + 1}. ${it.title}`, W - 22);
    ensure(titleLines.length * lh(10.5) + lh(9.5));
    // checkbox
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    const box = 9 * k;
    doc.rect(M, y + 1.5 * k, box, box);
    color(INK);
    for (const line of titleLines) { ensure(lh(10.5)); doc.text(line, M + 18, y + 10.5 * k); y += lh(10.5); }
    if (it.detail) para(it.detail, { pt: 9.5, c: MUTED, indent: 18 });
    if (it.hint) para(`Hint: ${it.hint}`, { pt: 9.5, style: 'bold', c: ACCENT, indent: 18 });
    if (it.lines && it.lines.length) {
      it.lines.slice(0, lim.compileErrors).forEach((l) => para(l, { pt: 8.5, mono: true, indent: 18 }));
      if (it.lines.length > lim.compileErrors) para(`...and ${it.lines.length - lim.compileErrors} more`, { pt: 8.5, c: MUTED, indent: 18 });
    }
    if (it.context) {
      para(`Test: ${it.context}${it.typed ? `  |  The grader typed: ${it.typed}` : ''}`, { pt: 8.5, c: MUTED, indent: 18 });
    }
    y += 5;
  });
  if (hidden > 0) para(`...and ${hidden} more item${hidden === 1 ? '' : 's'} - check with your teacher.`, { pt: 9.5, style: 'italic', c: MUTED });

  // ---- newer Java (informational) ----
  if (sheet.newer.length || sheet.newerCompiled) {
    y += 4;
    sectionTitle(doc, sheet.newerCompiled ? 'Newer Java - no points off' : 'Newer Java', () => { ensure(lh(13) + 8); return y; }, (ny) => { y = ny; }, k);
    para(sheet.newerCompiled
      ? 'Your program uses Java newer than Java 8, so it was graded as Java 17. That is fine for competitions; for class assignments, use Java 8:'
      : 'Your program also uses Java newer than Java 8. Our course uses Java 8:', { pt: 9.5, c: MUTED });
    y += 2;
    for (const f of sheet.newer.slice(0, 5)) {
      para(`- ${f.label}: ${f.lines.slice(0, 3).join(', ')}${f.lines.length > 3 ? ', ...' : ''}. ${forClass(f.fix)}`, { pt: 9.5, indent: 10 });
    }
    y += 2;
  }

  // ---- style ----
  if (sheet.style.length) {
    y += 4;
    sectionTitle(doc, 'Code style (Oracle conventions)', () => { ensure(lh(13) + 8); return y; }, (ny) => { y = ny; }, k);
    sheet.style.slice(0, lim.styleTypes).forEach((st) => {
      const lines = st.where.slice(0, lim.styleLines).map((w) => `${w.file} line ${w.line}`).join(', ');
      const more = st.count > lim.styleLines ? `, ...and ${st.count - lim.styleLines} more` : '';
      size(10); font('bold');
      const titleLines = wrap(st.label, W - 22);
      ensure(titleLines.length * lh(10) + lh(9));
      doc.setDrawColor(...INK); doc.setLineWidth(0.8);
      doc.rect(M, y + 1.5 * k, 9 * k, 9 * k);
      color(INK);
      for (const line of titleLines) { ensure(lh(10)); doc.text(line, M + 18, y + 10 * k); y += lh(10); }
      para(`${st.count}x: ${lines}${more}`, { pt: 9, c: MUTED, indent: 18 });
      y += 3;
    });
    if (sheet.style.length > lim.styleTypes) para(`...and ${sheet.style.length - lim.styleTypes} more style notes.`, { pt: 9, style: 'italic', c: MUTED });
  }

  // ---- what to turn in ----
  y += 8;
  ensure(lh(10) * 4 + 20);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
  doc.line(M, y, M + W, y);
  y += 10;
  para(items.length || sheet.style.length || sheet.newer.length
    ? 'Fix each item, re-run your program, then print your corrected code with every change highlighted. Turn it in with this sheet.'
    : 'Great work. Keep this sheet with your notes.', { pt: 9.5 });
  if (items.length || sheet.style.length || sheet.newer.length) {
    y += 6;
    size(9.5); font('normal'); color(INK);
    ensure(lh(9.5) + 4);
    doc.text('Signature: ________________________________     Date: _______________', M, y + 9.5 * k);
    y += lh(9.5);
  }

  // ---- footers ----
  for (let p = 0; p < pages; p++) {
    doc.setPage(startPage + p);
    size(8); font('normal'); color(MUTED);
    doc.text(safe(`${sheet.student}  |  ${sheet.assignment}`), M, PAGE.h - M + 10, { maxWidth: W - 80 });
    doc.text(`Page ${p + 1} of ${pages}`, M + W, PAGE.h - M + 10, { align: 'right' });
  }
  doc.setPage(startPage + pages - 1);
  return pages;
}

function sectionTitle(doc, text, getY, setY, k) {
  const y = getY();
  doc.setFontSize(12.5 * k);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ACCENT);
  doc.text(safe(text), PAGE.margin, y + 12.5 * k);
  setY(y + 12.5 * k * 1.32 + 6);
}

// ---------------------------------------------------------------------
// 3. Public API
// ---------------------------------------------------------------------

/** Finds limits that keep this sheet within two pages. */
function fitLimits(JsPDF, sheet, gradedOn) {
  for (const lim of LIMITS) {
    const doc = new JsPDF({ unit: 'pt', format: 'letter' });
    if (drawSheet(doc, sheet, lim, { firstPage: true, gradedOn }) <= 2) return lim;
  }
  return LIMITS[LIMITS.length - 1];
}

function today() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** One student's sheet as a jsPDF document. */
export function studentPdf(JsPDF, r, spec) {
  const sheet = buildSheet(r, spec);
  const gradedOn = today();
  const lim = fitLimits(JsPDF, sheet, gradedOn);
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  drawSheet(doc, sheet, lim, { firstPage: true, gradedOn });
  return doc;
}

/**
 * Every student in one PDF, each padded to exactly two pages so a
 * double-sided print gives one sheet of paper per student.
 */
export function classPdf(JsPDF, results, spec) {
  const gradedOn = today();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  let first = true;
  for (const r of results) {
    const sheet = buildSheet(r, spec);
    const lim = fitLimits(JsPDF, sheet, gradedOn);
    const used = drawSheet(doc, sheet, lim, { firstPage: first, gradedOn });
    first = false;
    if (used === 1) doc.addPage();   // blank back side
  }
  return doc;
}

/** File name for a student's sheet; keeps the Canvas prefix when known. */
export function sheetFileName(r, spec) {
  const id = String(spec.id).replace(/[^\w.]+/g, '-');
  if (r.canvasPrefix) return `${r.canvasPrefix}${id}-correction-sheet.pdf`;
  return `${String(r.name).replace(/[^\w]+/g, '_')}_${id}-correction-sheet.pdf`;
}

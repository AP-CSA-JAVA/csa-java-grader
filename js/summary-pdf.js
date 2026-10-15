// =====================================================================
// summary-pdf.js — the Class Summary for the teacher (not for students).
//
// One PDF for the whole class, landscape:
//   1. Overview: average final score, score spread, and counts of the
//      things that need attention (didn't compile, no test cases, header).
//   2. Every student in one table: the three rubric columns, header
//      deduction, suggested and final score, checks passed, top problem.
//   3. Most common mistakes across the class, with who made them, so
//      you know what to reteach.
//
// Keep it as a record of each grading run. Uses jsPDF; everything happens
// in the browser and nothing is uploaded.
// =====================================================================

import { specTitle, specSlug } from './assignment-name.js';
import { buildSheet } from './report-pdf.js';

const PAGE = { w: 792, h: 612, margin: 40 };   // US Letter, landscape, in points
const INK = [29, 29, 31];
const MUTED = [100, 100, 106];
const LINE = [205, 203, 198];
const STRIPE = [246, 245, 242];
const ACCENT = [194, 65, 12];
const GOOD = [21, 128, 61];
const MID = [161, 98, 7];
const BAD = [185, 28, 28];

// Standard PDF fonts only cover basic Latin characters.
function safe(text) {
  return String(text ?? '')
    .replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, '->').replace(/÷/g, '/').replace(/×/g, 'x').replace(/…/g, '...')
    .replace(/[✓✔]/g, '').replace(/[✗✘]/g, '').replace(/•/g, '-').replace(/−/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function scoreColor(n, max = 5) {
  if (n === null || n === undefined || n === '') return MUTED;
  const pct = Number(n) / max;
  return pct >= 0.8 ? GOOD : pct >= 0.6 ? MID : BAD;
}

function plainLabel(s) {
  return String(s).replace(/^\d+\.\s*/, '').replace(/\s*\(checklist item\)\s*$/, '');
}

// ---------------------------------------------------------------------
// 1. Gather the numbers (no drawing here)
// ---------------------------------------------------------------------

/**
 * @param students  [{key, name, late}] in table order
 * @param results   Map key -> graded result
 * @param finals    Map key -> teacher's override of the final score
 */
export function buildSummary(students, results, finals, spec, zipName = '') {
  const points = spec.mode === 'points';
  const rows = [];
  const mistakes = new Map();   // title -> { title, kind, names[] }
  const style = new Map();      // label -> { label, names[], times }
  const addMistake = (title, kind, name) => {
    if (!mistakes.has(title)) mistakes.set(title, { title, kind, names: [] });
    const m = mistakes.get(title);
    if (!m.names.includes(name)) m.names.push(name);
  };

  for (const st of students) {
    const r = results.get(st.key);
    const row = { name: st.name, late: !!st.late, graded: !!(r && r.scores) };
    rows.push(row);
    if (!r) { row.note = 'Not graded yet'; continue; }
    if (!r.scores) { row.note = `Needs a look: ${r.notes?.[0] || 'grading stopped'}`; row.check = true; continue; }

    const s = r.scores;
    row.output = s.output; row.style = s.style; row.submission = s.submission;
    row.headerDeduction = s.headerDeduction || 0;
    row.headerProblem = !!(r.header && (!r.header.present || r.header.blank.length));
    row.headerMissing = !!(r.header && !r.header.present);
    row.suggested = s.suggested;
    row.points = s.points; row.maxPoints = s.maxPoints; row.review = s.review;
    row.overridden = finals.has(st.key);
    row.final = row.overridden ? finals.get(st.key) : s.suggested;
    row.passed = s.checksPassed ?? 0; row.total = s.checksTotal ?? 0;
    row.hasJava = !!r.submission?.hasJava;
    row.compiled = !!r.compile?.ok;
    row.compileErrors = r.compile?.errors ?? 0;
    row.newer = r.newerJava ? (r.newerJava.compiled ? 'JAVA 17' : 'NEWER') : '';
    row.newerNames = (r.newerJava?.features || []).map((f) => f.name);
    row.noTestCases = row.hasJava && spec.requireTestCases !== false && r.submission && !r.submission.hasTestCases;

    // Same fix list the student sees, so the counts match their sheets.
    const sheet = buildSheet(r, spec);
    const problems = sheet.items.filter((it) => !/test cases|header|\.java file/i.test(it.title));
    // First thing to fix: program problems first, then the most-repeated style
    // mistake, then test cases and the header.
    const firstStyle = [...(r.style || [])].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    const todo = [
      ...problems.map((it) => (it.kind === 'compile' ? `Compile errors (${row.compileErrors})` : it.title)),
      ...(firstStyle ? [`Style: ${plainLabel(firstStyle.label)}`] : []),
      ...(row.noTestCases ? ['Turn in test cases'] : []),
      ...(row.headerProblem ? [row.headerMissing ? 'Add the header' : 'Finish the header'] : []),
      ...(row.newerNames.length ? [`Java 8 for class: ${row.newerNames.join(', ')}`] : []),
    ];
    row.top = todo[0] || '';
    row.more = Math.max(0, todo.length - 1 + Math.max(0, (r.style || []).length - 1));
    if (!row.hasJava) { row.top = 'No .java file submitted'; row.more = 0; }

    for (const it of sheet.items) {
      if (/test cases|header|\.java file/i.test(it.title)) continue;   // shown in the overview instead
      addMistake(it.kind === 'compile' ? 'Program did not compile' : it.title, it.kind === 'compile' ? 'compile' : 'check', st.name);
    }
    for (const i of r.style || []) {
      const label = plainLabel(i.label);
      if (!style.has(label)) style.set(label, { label, names: [], times: 0 });
      const e = style.get(label);
      if (!e.names.includes(st.name)) e.names.push(st.name);
      e.times += i.count || 0;
    }
  }

  const graded = rows.filter((r) => r.graded);
  const max = points ? (spec.maxPoints || graded[0]?.maxPoints || 0) : 5;
  const finalsNum = graded.map((r) => Number(r.final)).filter((n) => !Number.isNaN(n));
  const avg = (list) => (list.length ? list.reduce((t, n) => t + n, 0) / list.length : null);
  const namesWhere = (fn) => graded.filter(fn).map((r) => r.name);

  return {
    title: specTitle(spec),
    zipName,
    points,
    max,
    rows,
    counts: {
      students: rows.length,
      graded: graded.length,
      notGraded: rows.filter((r) => !r.graded && !r.check).length,
    },
    average: avg(finalsNum),
    averages: points ? null : {
      output: avg(graded.filter((r) => r.output != null).map((r) => r.output)),
      style: avg(graded.filter((r) => r.style != null).map((r) => r.style)),
      submission: avg(graded.map((r) => r.submission)),
    },
    spread: points ? null : [5, 4, 3, 2, 1].map((n) => ({ score: n, count: finalsNum.filter((f) => Math.round(f) === n || (n === 1 && f < 1)).length })),
    attention: [
      { label: 'No .java file', names: namesWhere((r) => !r.hasJava) },
      { label: "Didn't compile", names: namesWhere((r) => r.hasJava && !r.compiled) },
      ...(points ? [] : [{ label: 'No test cases', names: namesWhere((r) => r.noTestCases) }]),
      ...(points ? [] : [{ label: 'Header missing or incomplete', names: namesWhere((r) => r.headerProblem) }]),
      ...(points ? [{ label: 'Items to check by hand', names: namesWhere((r) => r.review) }] : []),
      { label: 'Newer Java (graded as Java 17)', names: namesWhere((r) => r.newer === 'JAVA 17') },
      { label: 'Late', names: rows.filter((r) => r.late).map((r) => r.name) },
      { label: 'Needs a look (CHECK)', names: rows.filter((r) => r.check).map((r) => r.name) },
      { label: 'Final changed by you', names: namesWhere((r) => r.overridden) },
    ],
    mistakes: [...mistakes.values()].sort((a, b) => b.names.length - a.names.length || a.title.localeCompare(b.title)),
    style: [...style.values()].sort((a, b) => b.names.length - a.names.length || b.times - a.times),
  };
}

// ---------------------------------------------------------------------
// 2. Drawing
// ---------------------------------------------------------------------

export function summaryPdf(JsPDF, students, results, finals, spec, zipName = '') {
  const sum = buildSummary(students, results, finals, spec, zipName);
  const doc = new JsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const M = PAGE.margin;
  const W = PAGE.w - 2 * M;
  const BOTTOM = PAGE.h - M - 18;
  const gradedOn = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let y = M;
  let onNewPage = null;

  const size = (pt) => doc.setFontSize(pt);
  const font = (style = 'normal') => doc.setFont('helvetica', style);
  const color = (c) => doc.setTextColor(...c);
  const lh = (pt) => pt * 1.3;
  const wrap = (text, width) => doc.splitTextToSize(safe(text), width);
  const newPage = () => { doc.addPage('letter', 'landscape'); y = M; if (onNewPage) onNewPage(); };
  const ensure = (need) => { if (y + need > BOTTOM) newPage(); };
  const text = (str, x, yy, { pt = 9, style = 'normal', c = INK, align = 'left' } = {}) => {
    size(pt); font(style); color(c);
    doc.text(safe(str), x, yy, { align });
  };
  const fit = (str, width, pt, style = 'normal') => {   // one line, cut with "..."
    size(pt); font(style);
    let s = safe(str);
    if (doc.getTextWidth(s) <= width) return s;
    while (s.length > 1 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  };
  const section = (title, note = '') => {
    ensure(60);
    y += 8;
    text(title, M, y + 12, { pt: 12.5, style: 'bold', c: ACCENT });
    if (note) text(note, M + W, y + 12, { pt: 8.5, c: MUTED, align: 'right' });
    y += 22;
  };
  const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(d));

  // ---- title ----
  text('CLASS SUMMARY', M, y + 9, { pt: 9, style: 'bold', c: ACCENT });
  text(`CSA Java Grader  |  graded ${gradedOn}  |  for the teacher`, M + W, y + 9, { pt: 9, c: MUTED, align: 'right' });
  y += 16;
  text(fit(sum.title, W, 19, 'bold'), M, y + 19, { pt: 19, style: 'bold' });
  y += 26;
  const sub = [`${sum.counts.students} student${sum.counts.students === 1 ? '' : 's'}`, `${sum.counts.graded} graded`];
  if (sum.counts.notGraded) sub.push(`${sum.counts.notGraded} not graded yet`);
  if (sum.zipName) sub.push(sum.zipName);
  text(fit(sub.join('  |  '), W, 10.5), M, y + 10.5, { pt: 10.5, c: MUTED });
  y += 20;
  doc.setDrawColor(...INK); doc.setLineWidth(1.2); doc.line(M, y, M + W, y);
  y += 14;

  // ---- overview: three panels ----
  const panelGap = 22;
  const pw = (W - 2 * panelGap) / 3;
  const top = y;
  let p1 = top, p2 = top, p3 = top;

  // panel 1: average + averages per column
  {
    const x = M;
    text(sum.points ? 'Average points' : 'Average final score', x, p1 + 9, { pt: 9, style: 'bold', c: MUTED });
    const avgStr = sum.average === null ? '-' : `${sum.average.toFixed(1)} / ${sum.max}`;
    text(avgStr, x, p1 + 40, { pt: 28, style: 'bold', c: scoreColor(sum.average, sum.max) });
    p1 += 52;
    if (sum.averages) {
      for (const [label, v] of [['Compilation & Output', sum.averages.output], ['Documentation & Style', sum.averages.style], ['Submission', sum.averages.submission]]) {
        text(label, x, p1 + 9, { pt: 9.5, c: INK });
        text(v === null ? '-' : v.toFixed(1), x + pw, p1 + 9, { pt: 9.5, style: 'bold', c: scoreColor(v), align: 'right' });
        p1 += 14;
      }
      text('Class averages for each rubric column', x, p1 + 9, { pt: 8, c: MUTED });
      p1 += 14;
    } else {
      const pts = sum.rows.filter((r) => r.graded).map((r) => Number(r.final));
      if (pts.length) text(`Lowest ${Math.min(...pts)}, highest ${Math.max(...pts)}`, x, p1 + 9, { pt: 9.5, c: INK });
      p1 += 14;
    }
  }

  // panel 2: score spread
  if (sum.spread) {
    const x = M + pw + panelGap;
    text('Final scores', x, p2 + 9, { pt: 9, style: 'bold', c: MUTED });
    p2 += 18;
    const most = Math.max(1, ...sum.spread.map((b) => b.count));
    const barMax = pw - 48;
    for (const b of sum.spread) {
      const c = scoreColor(b.score);
      text(String(b.score), x, p2 + 9, { pt: 10, style: 'bold', c });
      const bw = b.count ? Math.max(3, barMax * (b.count / most)) : 0;
      if (bw) { doc.setFillColor(...c); doc.rect(x + 14, p2 + 1.5, bw, 9, 'F'); }
      text(String(b.count), x + 20 + bw, p2 + 9.5, { pt: 9, c: b.count ? INK : MUTED });
      p2 += 15;
    }
  }

  // panel 3: needs attention
  {
    const x = sum.spread ? M + 2 * (pw + panelGap) : M + pw + panelGap;
    const width = sum.spread ? pw : pw * 2 + panelGap;
    text('Needs attention', x, p3 + 9, { pt: 9, style: 'bold', c: MUTED });
    p3 += 18;
    for (const a of sum.attention) {
      const n = a.names.length;
      text(a.label, x, p3 + 9, { pt: 9.5, c: n ? INK : MUTED });
      text(String(n), x + width, p3 + 9, { pt: 9.5, style: 'bold', c: n ? BAD : MUTED, align: 'right' });
      p3 += 13.5;
    }
  }
  y = Math.max(p1, p2, p3) + 6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(M, y, M + W, y);
  y += 4;

  // ---- student table ----
  const cols = sum.points
    ? [
      { k: 'n', label: '#', w: 22, al: 'r' },
      { k: 'name', label: 'Student', w: 170 },
      { k: 'comp', label: 'Compiles', w: 58, al: 'c' },
      { k: 'pts', label: 'Points', w: 60, al: 'c' },
      { k: 'review', label: 'By hand', w: 50, al: 'c' },
      { k: 'style', label: 'Style', w: 42, al: 'c' },
      { k: 'final', label: 'Final', w: 52, al: 'c' },
      { k: 'note', label: 'First thing to fix', w: 0 },
    ]
    : [
      { k: 'n', label: '#', w: 22, al: 'r' },
      { k: 'name', label: 'Student', w: 150 },
      { k: 'out', label: 'Comp. & Output', w: 66, al: 'c' },
      { k: 'sty', label: 'Doc. & Style', w: 58, al: 'c' },
      { k: 'sub', label: 'Submission', w: 54, al: 'c' },
      { k: 'hdr', label: 'Header', w: 40, al: 'c' },
      { k: 'sug', label: 'Suggested', w: 50, al: 'c' },
      { k: 'final', label: 'Final', w: 40, al: 'c' },
      { k: 'checks', label: 'Checks', w: 46, al: 'c' },
      { k: 'note', label: 'First thing to fix', w: 0 },
    ];
  cols[cols.length - 1].w = W - cols.reduce((t, c) => t + c.w, 0);
  let cx = M;
  for (const c of cols) { c.x = cx; cx += c.w; }
  const col = (k) => cols.find((c) => c.k === k);
  const PAD = 5;
  const cellX = (c, align) => (align === 'r' ? c.x + c.w - PAD : align === 'c' ? c.x + c.w / 2 : c.x + PAD);
  const cell = (k, str, yy, o = {}) => {
    const c = col(k);
    const s = fit(str, c.w - PAD * 2, o.pt || 9, o.style);
    text(s, cellX(c, c.al === 'r' ? 'r' : c.al === 'c' ? 'c' : 'l'), yy, { ...o, align: c.al === 'r' ? 'right' : c.al === 'c' ? 'center' : 'left' });
  };
  const head = () => {
    doc.setFillColor(...STRIPE); doc.rect(M, y, W, 18, 'F');
    for (const c of cols) text(c.label, cellX(c, c.al), y + 12, { pt: 8, style: 'bold', c: MUTED, align: c.al === 'r' ? 'right' : c.al === 'c' ? 'center' : 'left' });
    y += 18;
  };

  section('Every student', sum.points ? '' : '* = final score changed by you');
  head();
  onNewPage = () => { text(`${sum.title} - class summary (continued)`, M, y + 9, { pt: 9, c: MUTED }); y += 16; head(); };

  sum.rows.forEach((r, i) => {
    const h = 18;
    ensure(h);
    if (i % 2 === 1) { doc.setFillColor(251, 250, 248); doc.rect(M, y, W, h, 'F'); }
    const base = y + 12.5;
    cell('n', String(i + 1), base, { c: MUTED, pt: 8 });
    const tags = [...(r.late ? [['LATE', BAD]] : []), ...(r.newer ? [[r.newer, [15, 118, 110]]] : [])];
    size(7); font('bold');
    const tagsW = tags.reduce((t, [label]) => t + doc.getTextWidth(label) + 5, 0);
    const nameW = col('name').w - PAD * 2 - tagsW;
    const shownName = fit(r.name, nameW, 9.5, 'bold');
    text(shownName, col('name').x + PAD, base, { pt: 9.5, style: 'bold' });
    size(9.5); font('bold');
    let lx = col('name').x + PAD + Math.min(doc.getTextWidth(shownName), nameW) + 5;
    for (const [label, c] of tags) {
      text(label, lx, base, { pt: 7, style: 'bold', c });
      size(7); font('bold');
      lx += doc.getTextWidth(label) + 5;
    }
    if (!r.graded) {
      const first = cols[2];
      text(fit(r.note, W - (first.x - M) - PAD * 2, 9), first.x + PAD, base, { pt: 9, c: r.check ? BAD : MUTED });
    } else if (sum.points) {
      cell('comp', r.compiled ? 'Yes' : r.hasJava ? 'No' : '-', base, { style: 'bold', c: r.compiled ? GOOD : BAD });
      if (r.points === undefined) cell('pts', '-', base, { c: MUTED });
      else cell('pts', `${r.points} / ${r.maxPoints}`, base, { style: 'bold', c: scoreColor(r.points, r.maxPoints) });
      cell('review', r.review ? String(r.review) : '-', base, { c: r.review ? MID : MUTED });
      cell('style', fmt(r.style), base, { c: scoreColor(r.style) });
      cell('final', `${fmt(r.final)}${r.overridden ? '*' : ''}`, base, { pt: 10.5, style: 'bold', c: scoreColor(r.final, sum.max) });
      cell('note', r.top ? `${r.top}${r.more ? `  (+${r.more} more)` : ''}` : 'Nothing to fix', base, { pt: 8.5, c: r.top ? INK : GOOD });
    } else {
      cell('out', fmt(r.output), base, { style: 'bold', c: scoreColor(r.output) });
      cell('sty', fmt(r.style), base, { style: 'bold', c: scoreColor(r.style) });
      cell('sub', fmt(r.submission), base, { style: 'bold', c: scoreColor(r.submission) });
      cell('hdr', r.headerDeduction ? `-${r.headerDeduction}` : r.headerProblem ? '!' : 'OK', base, { style: 'bold', c: r.headerDeduction || r.headerProblem ? BAD : GOOD });
      cell('sug', fmt(r.suggested), base, { c: scoreColor(r.suggested) });
      cell('final', `${fmt(r.final)}${r.overridden ? '*' : ''}`, base, { pt: 11, style: 'bold', c: scoreColor(r.final) });
      cell('checks', !r.hasJava ? '-' : !r.compiled ? 'none ran' : r.total ? `${r.passed}/${r.total}` : '-', base, { pt: 8.5, c: MUTED });
      cell('note', r.top ? `${r.top}${r.more ? `  (+${r.more} more)` : ''}` : 'Nothing to fix', base, { pt: 8.5, c: r.top ? INK : GOOD });
    }
    y += h;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, M + W, y);
  });
  onNewPage = null;
  if (!sum.points) {
    y += 6;
    ensure(lh(8) * 2);
    for (const line of wrap('Header: OK = complete, -1 = missing or a field is blank or a placeholder. Checks = requirement and output checks passed; one problem caught several ways counts once in the score. JAVA 17 = did not compile as Java 8 but did as Java 17, so it was graded as Java 17 with no penalty.', W)) {
      text(line, M, y + 8, { pt: 8, c: MUTED });
      y += lh(8);
    }
  }

  // ---- who's on each attention list ----
  const lists = sum.attention.filter((a) => a.names.length);
  if (lists.length) {
    const lw = 170;
    size(9.5); font('normal');
    const blockH = 30 + lists.reduce((t, a) => t + wrap(a.names.join(', '), W - lw).length * 12 + 6, 0);
    if (blockH < (BOTTOM - M) / 2) ensure(blockH);   // keep a short list together on one page
    section('Who needs attention');
    for (const a of lists) {
      size(9.5); font('normal');
      const lines = wrap(a.names.join(', '), W - lw);
      ensure(lines.length * 12 + 6);
      text(`${a.label} (${a.names.length})`, M, y + 10, { pt: 9.5, style: 'bold' });
      lines.forEach((ln, i) => text(ln, M + lw, y + 10 + i * 12, { pt: 9.5, c: INK }));
      y += lines.length * 12 + 6;
    }
  }

  // ---- most common mistakes ----
  const graded = sum.counts.graded || 1;
  const mistakeTable = (title, note, list, countLabel, extra) => {
    section(title, note);
    if (!list.length) { text('None. Every graded student passed these.', M, y + 10, { pt: 10, style: 'bold', c: GOOD }); y += 20; return; }
    const cW = { what: 290, n: 80, extra: extra ? 50 : 0 };
    const whoX = M + cW.what + cW.n + cW.extra + 10;
    const whoW = M + W - whoX;
    ensure(34);
    doc.setFillColor(...STRIPE); doc.rect(M, y, W, 16, 'F');
    text('Mistake', M + PAD, y + 11, { pt: 8, style: 'bold', c: MUTED });
    text(countLabel, M + cW.what + cW.n - PAD, y + 11, { pt: 8, style: 'bold', c: MUTED, align: 'right' });
    if (extra) text(extra.label, M + cW.what + cW.n + cW.extra - PAD, y + 11, { pt: 8, style: 'bold', c: MUTED, align: 'right' });
    text('Who', whoX, y + 11, { pt: 8, style: 'bold', c: MUTED });
    y += 16;
    for (const m of list) {
      size(9.5); font('bold');
      const lines = wrap(m.title || m.label, cW.what - PAD * 2 - 12).slice(0, 2);
      const h = Math.max(18, lines.length * 11.5 + 7);
      ensure(h);
      lines.forEach((ln, i) => text(ln, M + PAD, y + 12 + i * 11.5, { pt: 9.5, style: i === 0 ? 'bold' : 'normal' }));
      const n = m.names.length;
      // share-of-class bar behind the count
      const barW = 34 * (n / graded);
      doc.setFillColor(...ACCENT); doc.rect(M + cW.what + 4, y + 5, Math.max(2, barW), 8, 'F');
      text(`${n} (${Math.round((100 * n) / graded)}%)`, M + cW.what + cW.n - PAD, y + 12, { pt: 9, style: 'bold', align: 'right' });
      if (extra) text(String(extra.value(m)), M + cW.what + cW.n + cW.extra - PAD, y + 12, { pt: 9, c: MUTED, align: 'right' });
      size(8.5); font('normal');
      const allWho = wrap(m.names.join(', '), whoW);
      const who = allWho.slice(0, 2);
      if (allWho.length > 2) who[1] = fit(allWho.slice(1).join(' '), whoW, 8.5);
      who.forEach((ln, i) => text(ln, whoX, y + 12 + i * 11, { pt: 8.5, c: MUTED }));
      y += Math.max(h, who.length * 11 + 7);
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, M + W, y);
    }
  };

  mistakeTable(
    'Most common program mistakes',
    'Compilation & Output: requirement and output checks that failed, most students first',
    sum.mistakes.slice(0, 10),
    'Students',
  );
  const moreNote = (list, shown, what) => {
    if (list.length <= shown) return;
    const rest = list.slice(shown);
    const solo = rest.every((m) => m.names.length === 1);
    ensure(16);
    text(`...and ${rest.length} more ${what}${solo ? ', each made by one student (see their correction sheets)' : ''}.`, M, y + 11, { pt: 8.5, style: 'italic', c: MUTED });
    y += 16;
  };
  moreNote(sum.mistakes, 10, 'program mistakes');

  mistakeTable(
    'Most common style mistakes',
    'Documentation & Style: each type counts once per student',
    sum.style.slice(0, 10),
    'Students',
    { label: 'Times', value: (m) => m.times },
  );
  moreNote(sum.style, 10, 'style mistakes');

  // ---- footers ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    text(fit(`Class summary  |  ${sum.title}  |  graded ${gradedOn}`, W - 80, 8), M, PAGE.h - M + 12, { pt: 8, c: MUTED });
    text(`Page ${p} of ${pages}`, M + W, PAGE.h - M + 12, { pt: 8, c: MUTED, align: 'right' });
  }
  return doc;
}

/** File name, e.g. 1.07.2-class-summary-2026-10-14.pdf */
export function summaryFileName(spec) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${specSlug(spec)}-class-summary-${stamp}.pdf`;
}

// =====================================================================
// java-text.js — small helpers for reading Java source as text.
// =====================================================================

/**
 * Splits Java source into views that keep line numbers intact:
 *   noComments  – comments blanked out, string literals kept
 *   codeOnly    – comments AND string/char contents blanked out
 *   commentLines – set of 1-based line numbers that contain a comment
 */
export function scanSource(src) {
  const noComments = [];
  const codeOnly = [];
  const commentLines = new Set();
  let line = 1;
  let i = 0;
  const n = src.length;

  const push = (a, b) => { noComments.push(a); codeOnly.push(b); };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {              // line comment
      commentLines.add(line);
      while (i < n && src[i] !== '\n') { push(' ', ' '); i++; }
      continue;
    }
    if (c === '/' && next === '*') {              // block comment
      commentLines.add(line);
      push(' ', ' '); push(' ', ' '); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { push('\n', '\n'); line++; commentLines.add(line); }
        else push(' ', ' ');
        i++;
      }
      if (i < n) { push(' ', ' '); push(' ', ' '); i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {                 // string or char literal
      const quote = c;
      push(c, c); i++;
      while (i < n && src[i] !== quote && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) {
          push(src[i], ' '); push(src[i + 1], ' '); i += 2; continue;
        }
        push(src[i], ' '); i++;
      }
      if (i < n && src[i] === quote) { push(quote, quote); i++; }
      continue;
    }
    if (c === '\n') line++;
    push(c, c);
    i++;
  }
  return { noComments: noComments.join(''), codeOnly: codeOnly.join(''), commentLines };
}

/** Name of the public top-level class (or the first class) in a file. */
export function className(src) {
  const { codeOnly } = scanSource(src);
  let m = codeOnly.match(/\bpublic\s+(?:(?:final|abstract)\s+)*(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/);
  if (!m) m = codeOnly.match(/\b(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}

/** Package name, or '' if none. */
export function packageName(src) {
  const { codeOnly } = scanSource(src);
  const m = codeOnly.match(/^\s*package\s+([\w.]+)\s*;/m);
  return m ? m[1] : '';
}

/** True if the file declares a main method. */
export function hasMain(src) {
  const { codeOnly } = scanSource(src);
  return /\bpublic\s+static\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]\s*\w+|\w+\s*\[\s*\]|\.\.\.\s*\w+)\s*\)/.test(codeOnly)
      || /\bstatic\s+public\s+void\s+main\s*\(/.test(codeOnly);
}

/**
 * The comment text at the top of the file, before `package`, `import`
 * or the first class. Returns { text, endLine } or null when there is none.
 */
export function leadingComment(src) {
  const lines = src.split('\n');
  const out = [];
  let inBlock = false;
  let endLine = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const t = lines[idx].trim();
    if (inBlock) {
      out.push(t);
      endLine = idx + 1;
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t === '') { if (out.length) out.push(''); continue; }
    if (t.startsWith('//')) { out.push(t); endLine = idx + 1; continue; }
    if (t.startsWith('/*')) {
      out.push(t); endLine = idx + 1;
      if (!t.slice(2).includes('*/')) inBlock = true;
      continue;
    }
    break; // first real code line
  }
  const text = out.join('\n').trim();
  return text ? { text, endLine } : null;
}

/** Rewrites System.exit(...) so a student's program cannot shut down the grader. */
export function neutralizeExit(src) {
  // `if (true) throw` keeps code after the call reachable, so it still compiles.
  return src.replace(/System\s*\.\s*exit\s*\([^;]*\)\s*;/g,
    'if (true) throw new java.lang.Error("__GRADER_EXIT__");');
}

/** Normalizes text for loose comparisons (case, curly quotes, punctuation). */
export function loose(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

/** Counts non-overlapping occurrences of needle in haystack. */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) { count++; pos = haystack.indexOf(needle, pos + needle.length); }
  return count;
}

/** Unescapes a Java string literal body (the part between the quotes). */
export function unescapeJava(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\' }[e] ?? e;
  });
}

/**
 * Top-level classes in a file: [{ name, code }], where code is the class
 * from its declaration to its closing brace. Pass code with comments and
 * strings already blanked (codeOnly) for the positions, plus the original
 * text to slice from.
 */
export function topLevelClasses(codeOnly, text = codeOnly) {
  const out = [];
  const re = /\b(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let depth = 0;
  let i = 0;
  while (i < codeOnly.length) {
    re.lastIndex = i;
    const m = re.exec(codeOnly);
    if (!m) break;
    // depth at m.index
    for (; i < m.index; i++) {
      if (codeOnly[i] === '{') depth++;
      else if (codeOnly[i] === '}') depth--;
    }
    const open = codeOnly.indexOf('{', m.index);
    if (open === -1) break;
    if (depth === 0) {
      let d = 0;
      let j = open;
      for (; j < codeOnly.length; j++) {
        if (codeOnly[j] === '{') d++;
        else if (codeOnly[j] === '}') { d--; if (d === 0) break; }
      }
      // include modifiers/annotations on the same line before "class"
      const lineStart = codeOnly.lastIndexOf('\n', m.index) + 1;
      out.push({ name: m[1], code: text.slice(lineStart, j + 1) });
      i = j + 1;
    } else {
      i = m.index + m[0].length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Endless-loop guard
// ---------------------------------------------------------------------

export const LOOP_TICK = 'cjgrader.LoopGuard.tick()';

/**
 * Adds a call to cjgrader.LoopGuard.tick() to every while / for / do loop,
 * so an endless loop ends when the run's time is up instead of freezing the
 * browser tab (CheerpJ can't interrupt a tight loop). Nothing moves to a new
 * line, so compile errors and crash line numbers stay the same.
 *
 *   while (x) {        ->  while (x) { cjgrader.LoopGuard.tick();
 *   while (x) stmt;    ->  while ((x) && cjgrader.LoopGuard.tick()) stmt;
 *   for (a; b; c) s;   ->  for (a; (b) && cjgrader.LoopGuard.tick(); c) s;
 *
 * A loop with braces gets the call inside its body, which never changes how
 * the code compiles. Enhanced for loops (for (x : list)) always end and are
 * left alone, as are rare brace-less `while (true)` / `for (;;)` loops.
 */
export function guardLoops(src) {
  const code = scanSource(src).codeOnly;   // same length as src; comments and strings blanked
  const edits = [];   // [index, deleteCount, insertText]
  const skipSpace = (i) => { while (i < code.length && /\s/.test(code[i])) i++; return i; };
  const matchParen = (open) => {
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) return i;
    }
    return -1;
  };
  const re = /\b(while|for|do)\b/g;
  let m;
  while ((m = re.exec(code))) {
    const kw = m[1];
    if (m.index > 0 && /[\w$.]/.test(code[m.index - 1])) continue;
    if (kw === 'do') {
      const b = skipSpace(m.index + 2);
      if (code[b] === '{') edits.push([b + 1, 0, ` ${LOOP_TICK};`]);
      continue;
    }
    const open = skipSpace(m.index + kw.length);
    if (code[open] !== '(') continue;
    const close = matchParen(open);
    if (close < 0) continue;
    const after = skipSpace(close + 1);
    const header = code.slice(open + 1, close);
    if (kw === 'while' && code[after] === ';' && /}\s*$/.test(code.slice(0, m.index))) continue;   // end of do { } while (...);
    if (kw === 'for') {
      // enhanced for: a ':' at the top level and no ';'
      let depth = 0, semis = [], colon = false;
      for (let i = 0; i < header.length; i++) {
        const c = header[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ';' && depth <= 0) semis.push(i);
        else if (c === ':' && depth <= 0 && header[i - 1] !== ':' && header[i + 1] !== ':') colon = true;
      }
      if (colon && !semis.length) continue;
      if (code[after] === '{') { edits.push([after + 1, 0, ` ${LOOP_TICK};`]); continue; }
      if (semis.length !== 2) continue;
      const cond = header.slice(semis[0] + 1, semis[1]);
      if (!cond.trim() || cond.trim() === 'true') continue;
      const start = open + 1 + semis[0] + 1;
      edits.push([start, cond.length, ` (${src.slice(start, start + cond.length).trim()}) && ${LOOP_TICK}`]);
      continue;
    }
    // while
    if (code[after] === '{') { edits.push([after + 1, 0, ` ${LOOP_TICK};`]); continue; }
    if (header.trim() === 'true') continue;
    edits.push([open + 1, header.length, `(${src.slice(open + 1, close)}) && ${LOOP_TICK}`]);
  }
  let out = src;
  for (const [i, del, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, i) + text + out.slice(i + del);
  return out;
}

/** Removes the loop guard from compiler messages, so students see their own code. */
export function unguardMessages(text) {
  return String(text)
    .split(` ${LOOP_TICK};`).join('')
    .replace(/\(([^\n]*?)\) && cjgrader\.LoopGuard\.tick\(\)/g, '$1')
    .split(`&& ${LOOP_TICK}`).join('');
}

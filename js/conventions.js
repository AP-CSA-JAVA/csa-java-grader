// =====================================================================
// conventions.js — Oracle Java code-convention checks.
// Each mistake TYPE counts once toward the score; students still see
// every place it happened (same rule as the PEP 8 Checker).
// The header comment is skipped.
// =====================================================================

import { CONFIG } from './config.js';
import { scanSource } from './java-text.js';

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'throw',
  'do', 'try', 'case', 'synchronized', 'super', 'this', 'class', 'import', 'package', 'instanceof']);

const CHECKS = {
  'class-name': 'Class names should be PascalCase (e.g. MagicEightBall)',
  'method-name': 'Method names should be camelCase (e.g. calculateTime)',
  'variable-name': 'Variable names should be camelCase (e.g. continueChoice)',
  'constant-name': 'static final constants should be UPPER_CASE (e.g. MAX_SPEED)',
  'short-name': 'Use meaningful names, not single letters (loop counters are fine)',
  'indent-body': 'Code inside { } should be indented one level deeper',
  'indent-mixed': 'Mixing tabs and spaces for indentation',
  'line-length': `Lines longer than ${CONFIG.maxLineLength} characters`,
  'multi-statement': 'More than one statement on a line',
  'missing-braces': 'if / else / for / while bodies should always use { } braces',
  'keyword-space': 'Put a space after if / for / while / switch / catch, e.g. if (x)',
  'few-comments': 'Few or no comments in the code (inline comments should explain the steps)',
};

/**
 * @param {{name:string, src:string, headerEndLine:number}[]} files
 * @returns {{id,label,count,where:{file,line,snippet}[]}[]}
 */
export function checkConventions(files) {
  const found = new Map();
  const add = (id, file, line, snippet) => {
    if (!found.has(id)) found.set(id, { id, label: CHECKS[id], count: 0, where: [] });
    const entry = found.get(id);
    entry.count++;
    if (entry.where.length < 8) entry.where.push({ file, line, snippet: (snippet || '').trim().slice(0, 90) });
  };

  for (const f of files) checkFile(f, add);
  return [...found.values()];
}

function checkFile({ name, src, headerEndLine = 0 }, add) {
  const raw = src.replace(/\r\n?/g, '\n').split('\n');
  const { codeOnly, commentLines } = scanSource(src.replace(/\r\n?/g, '\n'));
  const code = codeOnly.split('\n');
  const skip = (idx) => idx + 1 <= headerEndLine;

  // ---------- names ----------
  const classNames = new Set();
  forEachMatch(codeOnly, /\b(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/g, (m, lineOf) => {
    const line = lineOf(m.index);
    classNames.add(m[1]);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(m[1])) add('class-name', name, line, raw[line - 1]);
  });

  forEachMatch(codeOnly,
    /(?:^|[;{}])\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*([\w$<>[\],.?]+)\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[\w\s,.]+)?\{/g,
    (m, lineOf) => {
      const line = lineOf(m.index + m[0].indexOf(m[2] + ''));
      const type = m[1];
      const method = m[2];
      if (KEYWORDS.has(type) || KEYWORDS.has(method) || classNames.has(method)) return;
      if (method === 'main') return;
      if (!/^[a-z][A-Za-z0-9]*$/.test(method)) add('method-name', name, line, raw[line - 1]);
    });

  const typePattern = '(?:int|double|boolean|char|long|float|short|byte|var|String|[A-Z][\\w$]*(?:<[^>;()]*>)?)';
  const declRe = new RegExp(`(\\bstatic\\s+)?(\\bfinal\\s+)?(?:static\\s+)?\\b${typePattern}((?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_$][\\w$]*)\\s*(?:\\[\\s*\\]\\s*)*(=|;|,|:|\\))`, 'g');
  forEachMatch(codeOnly, declRe, (m, lineOf) => {
    const index = m.index;
    const line = lineOf(index + m[0].search(/\S/));
    const varName = m[4];
    if (KEYWORDS.has(varName)) return;
    const before = codeOnly.slice(Math.max(0, index - 12), index);
    if (/\b(?:new|return|class|throws|instanceof)\s*$/.test(before)) return;
    const lineText = code[line - 1] || '';
    const inForHeader = /\bfor\s*\(/.test(lineText);
    const isConstant = !!(m[1] && m[2]) || /\bstatic\s+final\b|\bfinal\s+static\b/.test(lineText);

    if (isConstant) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(varName)) add('constant-name', name, line, raw[line - 1]);
      return;
    }
    if (m[2] && /^[A-Z][A-Z0-9_]*$/.test(varName)) return;   // final local in ALL CAPS is fine
    if (!/^[a-z][A-Za-z0-9]*$/.test(varName)) {
      add('variable-name', name, line, raw[line - 1]);
    } else if (varName.length === 1 && !inForHeader && !CONFIG.allowedShortNames.includes(varName)) {
      add('short-name', name, line, raw[line - 1]);
    }
  });

  // ---------- per-line layout ----------
  let tabs = false;
  let spaces = false;
  const openers = [];            // { indent, isSwitch } for each line that opened a { block
  let codeLines = 0;
  let commentCount = 0;

  for (let idx = 0; idx < raw.length; idx++) {
    const rawLine = raw[idx];
    const c = code[idx] ?? '';
    const t = c.trim();
    const lineNo = idx + 1;
    const lead = rawLine.match(/^[ \t]*/)[0];
    const indent = lead.replace(/\t/g, '    ').length;

    if (!skip(idx)) {
      if (commentLines.has(lineNo)) commentCount++;
      if (t) codeLines++;
      if (t && lead.includes('\t')) tabs = true;
      if (t && lead.includes(' ')) spaces = true;
      if (rawLine.length > CONFIG.maxLineLength) add('line-length', name, lineNo, rawLine);
      if (/\b(?:if|for|while|switch|catch)\(/.test(c)) add('keyword-space', name, lineNo, rawLine);

      const withoutFor = c.replace(/\bfor\s*\([^)]*\)/g, 'for()');
      if ((withoutFor.match(/;/g) || []).length > 1) add('multi-statement', name, lineNo, rawLine);
    }

    // indentation tracking runs over every line so brace depth stays correct
    let rest = t;
    const top = openers[openers.length - 1];
    // Oracle's convention lines up `case` / `default` with `switch`; the indented
    // style most editors produce is fine too, so both are accepted.
    const switchLabel = top && top.isSwitch && /^(?:case\b|default\s*(?::|->))/.test(t) && indent >= top.indent;
    if (rest.startsWith('}')) { openers.pop(); rest = rest.slice(1); }
    else if (t && openers.length && !skip(idx) && indent <= top.indent && !switchLabel) {
      add('indent-body', name, lineNo, rawLine);
    }
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') openers.push({ indent, isSwitch: /\bswitch\s*\(/.test(rest.slice(0, i)) });
      else if (rest[i] === '}') openers.pop();
    }

    if (!skip(idx)) checkBraces(code, idx, (l) => add('missing-braces', name, l, raw[l - 1]));
  }

  if (tabs && spaces) add('indent-mixed', name, 1, 'tabs and spaces both used');
  if (codeLines >= 10 && commentCount / codeLines < CONFIG.minCommentRatio) {
    add('few-comments', name, 1, `${commentCount} comment line(s) for ${codeLines} lines of code`);
  }
}

/** Flags if/for/while/else whose body is not wrapped in braces. */
function checkBraces(code, idx, flag) {
  const line = code[idx];
  const nextCodeLine = () => {
    for (let k = idx + 1; k < code.length; k++) if (code[k].trim()) return code[k].trim();
    return '';
  };

  const re = /\b(if|for|while)\s*\(/g;
  let m;
  while ((m = re.exec(line))) {
    // find the matching close paren
    let depth = 0;
    let end = -1;
    for (let p = m.index + m[0].length - 1; p < line.length; p++) {
      if (line[p] === '(') depth++;
      else if (line[p] === ')') { depth--; if (depth === 0) { end = p; break; } }
    }
    if (end === -1) continue;               // condition spans lines; skip
    const after = line.slice(end + 1).trim();
    if (after.startsWith('{')) continue;
    if (m[1] === 'while' && after.startsWith(';')) continue;   // end of do-while
    if (after === '' && nextCodeLine().startsWith('{')) continue;
    flag(idx + 1);
    return;
  }

  const e = line.match(/\belse\b(.*)$/);
  if (e) {
    const after = e[1].trim();
    if (after.startsWith('{') || /^if\b/.test(after)) return;
    if (after === '' && nextCodeLine().startsWith('{')) return;
    flag(idx + 1);
  }
}

function forEachMatch(text, re, fn) {
  // precompute line starts so we can turn an index into a line number
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    fn(m, lineOf);
    if (m[0].length === 0) re.lastIndex++;
  }
}

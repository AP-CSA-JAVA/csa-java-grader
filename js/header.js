// =====================================================================
// header.js — reads the student's block comment header.
// Accepts any comment style: `//` lines, `/* ... */`, `/** ... */` and the
// bordered `/*=====` header. Also finds a header placed below the imports,
// several fields on one line, "Label - value" lines and Javadoc @author.
// =====================================================================

import { CONFIG } from './config.js';

// Template text left unfilled, e.g. [Your Full Name] or [Month Day, Year].
// A real value the student typed inside the brackets, like [Mr. Smith], counts as filled.
const TEMPLATE_WORDS = /your\b|full name|partner'?s|instructor name|month|day, year|assignment number|assignment title|due date|course name|describe|^n$|^\s*$/i;
function isPlaceholder(value) {
  if (/^\s*(todo|tbd|your name|n\/a)?\s*$/i.test(value)) return true;
  const inside = [...value.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
  return inside.some((t) => TEMPLATE_WORDS.test(t.trim()));
}

// Javadoc tags that stand in for a header field.
const JAVADOC_TAGS = { author: 'name', date: 'due', due: 'due' };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One regex that finds every "Label: value" on a line, longest label first so
// "Due Date:" wins over "Date:". "Student Name", "Instructor Name" and
// "Partner's Name" resolve to their own field. `:` or `=` may follow a label
// anywhere on the line; " - " only at the start (so "name - then" inside a
// sentence isn't read as a field).
function fieldRegex() {
  const aliases = CONFIG.headerFields.flatMap((f) => f.aliases).sort((a, b) => b.length - a.length);
  const alt = aliases.map(escapeRe).join('|');
  return new RegExp(`(?:^|[\\s|,;])(${alt})(?:'s)?(?:\\s+name)?\\s*[:=]`, 'gi');
}
function dashRegex() {
  const aliases = CONFIG.headerFields.flatMap((f) => f.aliases).sort((a, b) => b.length - a.length);
  return new RegExp(`^(${aliases.map(escapeRe).join('|')})(?:'s)?(?:\\s+name)?\\s+[-–—]\\s+`, 'i');
}

/** Every "label → value" pair found on one decoration-stripped line. */
function fieldsOnLine(line) {
  const out = [];
  const tag = line.match(/^@(\w+)\s+(.*)$/);
  if (tag) {
    const key = JAVADOC_TAGS[tag[1].toLowerCase()];
    if (key) out.push({ key, value: tag[2] });
    return out;
  }
  const dash = line.match(dashRegex());
  if (dash) return [{ label: dash[1], value: line.slice(dash[0].length) }];

  const hits = [...line.matchAll(fieldRegex())];
  hits.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : line.length;
    out.push({ label: m[1], value: line.slice(start, end) });
  });
  return out;
}

/**
 * Comment blocks that sit before the first class (top of file, or between
 * package/import lines). Each block: { text, startLine, endLine }.
 */
function commentBlocksBeforeClass(src) {
  const lines = src.split('\n');
  const blocks = [];
  let cur = null;
  let inBlock = false;
  const close = () => { if (cur) { cur.text = cur.lines.join('\n').trim(); blocks.push(cur); cur = null; } };
  const add = (t, idx) => {
    if (!cur) cur = { lines: [], startLine: idx + 1, endLine: idx + 1 };
    cur.lines.push(t); cur.endLine = idx + 1;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const t = lines[idx].trim();
    if (inBlock) {
      add(t, idx);
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t === '') { if (cur) cur.lines.push(''); continue; }
    if (t.startsWith('//')) { add(t, idx); continue; }
    if (t.startsWith('/*')) {
      add(t, idx);
      if (!t.slice(2).includes('*/')) inBlock = true;
      continue;
    }
    if (/^(import|package)\b/.test(t)) { close(); continue; }
    break; // first real code line (the class)
  }
  close();
  return blocks;
}

/** Reads the header fields out of one comment block's text. */
function parseBlock(text) {
  const fields = CONFIG.headerFields.map((f) => ({ key: f.key, label: f.label, value: '', filled: false }));
  let recognized = 0;
  for (const raw of text.split('\n')) {
    // strip comment decoration:  //  /*  *  |  =  and borders
    const line = raw.replace(/^[\s/*|=#-]+/, '').replace(/[\s|*/=]+$/, '');
    for (const hit of fieldsOnLine(line)) {
      const key = hit.key || CONFIG.headerFields.find((f) => f.aliases.includes(hit.label.toLowerCase()))?.key;
      if (!key) continue;
      const field = fields.find((f) => f.key === key);
      if (field.value) continue;               // first occurrence wins
      recognized++;
      field.value = hit.value.replace(/[\s|*/=]+$/, '').trim();
      field.filled = field.value.length > 0 && !isPlaceholder(field.value);
    }
  }
  return { fields, recognized };
}

/**
 * @returns {{
 *   present: boolean,
 *   text: string,          // full header text (for assignment-specific checks)
 *   endLine: number,       // last line of the header (style checks skip these lines)
 *   fields: {key,label,value,filled}[],
 *   blank: string[],       // labels that are missing or still placeholders
 *   deduction: number,
 *   belowImports: boolean  // header was found under the import lines, not at the top
 * }}
 */
export function readHeader(src) {
  src = src.replace(/\r\n?/g, '\n');
  const blocks = commentBlocksBeforeClass(src);
  // 0-based index of the first line that isn't blank or a comment
  const firstCode = src.split('\n').findIndex((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l));
  const empty = CONFIG.headerFields.map((f) => ({ key: f.key, label: f.label, value: '', filled: false }));

  // The first block with at least two recognized fields is the header
  // (a lone "Name:" comment isn't a header).
  for (const b of blocks) {
    const { fields, recognized } = parseBlock(b.text);
    if (recognized < 2) continue;
    const optional = new Set(CONFIG.headerFields.filter((f) => f.optional).map((f) => f.key));
    const blank = fields.filter((f) => !f.filled && !optional.has(f.key)).map((f) => f.label);
    return {
      present: true,
      text: b.text,
      endLine: b.endLine,
      fields,
      blank,
      deduction: blank.length ? CONFIG.headerDeduction : 0,
      belowImports: firstCode !== -1 && firstCode + 1 < b.startLine,
    };
  }

  const lead = blocks[0];
  return {
    present: false,
    text: lead ? lead.text : '',
    endLine: lead && (firstCode === -1 || lead.startLine <= firstCode + 1) ? lead.endLine : 0,
    fields: empty,
    blank: empty.map((f) => f.label),
    deduction: CONFIG.headerDeduction,
    belowImports: false,
  };
}

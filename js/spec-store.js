// =====================================================================
// spec-store.js — assignment files kept out of the public site.
//
// The public grader only ships specs/general.js ("Any assignment").
// The real assignment files (specs/*.js) live in a PRIVATE repository, so
// students who find this site can't read the expected outputs. To use them:
//
//   1. On GitHub, open the private repository → Code → Download ZIP.
//   2. In the grader, click "Load assignments" and choose that zip
//      (or select the spec .js files themselves).
//
// The grader finds the specs folder in the zip (the folder whose index.js
// exports SPECS), keeps the files in THIS browser only (localStorage), and
// imports them from memory. Nothing is uploaded anywhere. Load the zip again
// after editing an assignment, or on another computer.
//
// The private repository can also hold mailer.js with your Email students
// settings, so they are filled in without typing:
//   export const MAILER = { url: 'https://script.google.com/macros/s/…/exec', key: '…' };
// =====================================================================

import { SPECS as BUILT_IN } from '../specs/index.js';
import { isFrqConfig, frqLabel, frqToSpec } from './frq-spec.js';

const STORE_KEY = 'grader:privateSpecs';
// FRQs come from the private frq-grader zip (its frq/**/*.json configs and grader/*.java files).
// Kept apart from the assignment specs, so loading one zip never removes what the other loaded.
const FRQ_KEY = 'grader:privateFrqs';

/** Built-in (public) assignments: { key, label, builtIn: true, file } */
function builtInList() {
  return BUILT_IN.map((s) => ({ key: `builtin:${s.file}`, label: s.label, builtIn: true, file: s.file }));
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function readFrqs() {
  try {
    const raw = localStorage.getItem(FRQ_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Every assignment for the dropdown: private ones first, then FRQs, then the public ones. */
export function specList() {
  const store = readStore();
  const priv = (store?.specs || []).map((s) => ({ key: `private:${s.file}`, label: s.label, builtIn: false, file: s.file }));
  const frqs = (readFrqs()?.frqs || []).map((f) => ({ key: `frq:${f.id}`, label: frqLabel(f.cfg, f.folder), builtIn: false, file: `frq:${f.id}`, frq: true }));
  return [...priv, ...frqs, ...builtInList()];
}

/** { count, source, loadedAt, mailer, frqs, frqSource } for the status line, or null if nothing is loaded. */
export function privateInfo() {
  const store = readStore(), frq = readFrqs();
  if (!store?.specs?.length && !frq?.frqs?.length) return null;
  return { count: store?.specs?.length || 0, source: store?.source || '', loadedAt: store?.loadedAt || frq?.loadedAt,
           mailer: !!store?.mailer, frqs: frq?.frqs?.length || 0, frqSource: frq?.source || '' };
}

/** { url, key } from mailer.js in the private zip, or null. */
export function privateMailer() {
  return readStore()?.mailer || null;
}

export function clearPrivate() {
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(FRQ_KEY); } catch { /* storage blocked */ }
}

// Specs import helpers with a relative path ('../js/spec-helpers.js'). A spec
// imported from memory has no folder, so point those imports at this site.
function rewriteImports(text) {
  const base = new URL('../', import.meta.url).href;   // the site root, e.g. https://…/csa-java-grader/
  return text.replace(/(from\s*|import\s*\(\s*)(['"])\.\.\/(js\/[^'"]+)\2/g, (m, pre, q, path) => `${pre}${q}${base}${path}${q}`);
}

async function importText(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

/** Imports one assignment by its dropdown key. */
export async function importSpec(key) {
  if (key.startsWith('frq:')) {
    const entry = (readFrqs()?.frqs || []).find((f) => f.id === key.slice(4));
    if (!entry) throw new Error('That FRQ is no longer loaded. Click "Load assignments" and choose the frq-grader zip again.');
    return frqToSpec(entry);
  }
  if (key.startsWith('private:')) {
    const file = key.slice('private:'.length);
    const entry = (readStore()?.specs || []).find((s) => s.file === file);
    if (!entry) throw new Error('That assignment is no longer loaded. Click "Load assignments" and choose the zip again.');
    return (await importText(rewriteImports(entry.text))).default;
  }
  const file = key.replace(/^builtin:/, '');
  return (await import(new URL(`../specs/${file.replace(/^\.\//, '')}`, import.meta.url))).default;
}

// ---------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------

const baseName = (p) => p.split('/').pop();
const dirName = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** True if the text looks like a grader spec (an assignment file). */
function looksLikeSpec(text) {
  return /export\s+default\s*\{/.test(text) && /\bid\s*:/.test(text) && /\b(?:runs|requirements)\b/.test(text);
}

/**
 * Reads assignment files from a zip (e.g. a GitHub "Download ZIP") or from
 * .js files, saves them in this browser, and returns { count, skipped }.
 * @param files  File objects from an <input type="file">
 */
export async function loadPrivate(files, JSZip) {
  const texts = new Map();   // path -> text (.js: assignment specs)
  const frqTexts = new Map(); // path -> text (.json / .java: FRQs)
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)(node_modules|__MACOSX)\//.test(entry.name)) continue;
        if (/\.js$/i.test(entry.name)) texts.set(entry.name, await entry.async('string'));
        else if (/\.(json|java)$/i.test(entry.name)) frqTexts.set(entry.name, await entry.async('string'));
      }
    } else if (/\.js$/i.test(f.name)) {
      texts.set(f.webkitRelativePath || f.name, await f.text());
    } else if (/\.(json|java)$/i.test(f.name)) {
      frqTexts.set(f.webkitRelativePath || f.name, await f.text());
    }
  }
  const frqs = findFrqs(frqTexts);

  // Prefer the folder whose index.js lists the assignments (keeps your order and labels).
  const indexPath = [...texts.keys()].find((p) => baseName(p) === 'index.js' && /export\s+const\s+SPECS\s*=/.test(texts.get(p)));
  const specs = [];
  let skipped = 0;
  if (indexPath) {
    const dir = dirName(indexPath);
    const { SPECS } = await importText(texts.get(indexPath));
    for (const s of SPECS || []) {
      const file = String(s.file || '').replace(/^\.\//, '');
      const text = texts.get(dir + file);
      if (!text || !looksLikeSpec(text) || /^general\.js$/.test(file)) { if (!/^general\.js$/.test(file)) skipped++; continue; }
      specs.push({ file, label: s.label || file, text });
    }
  } else {
    // No index.js: take every spec file, labeled by its id and title.
    for (const [path, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) {
      const file = baseName(path);
      if (file.startsWith('_') || file === 'general.js' || !looksLikeSpec(text)) continue;
      const id = (text.match(/\bid\s*:\s*['"]([^'"]+)['"]/) || [])[1];
      const title = (text.match(/\btitle\s*:\s*['"]([^'"]+)['"]/) || [])[1];
      specs.push({ file, label: id && title ? `${id} — ${title}` : file, text });
    }
  }
  if (!specs.length && !frqs.length) {
    throw new Error('No assignment files or FRQs found. Choose the zip of your private assignments repository (it needs a specs folder with index.js) or of frq-grader (frq/ configs and grader/ files).');
  }

  // Make sure every file actually loads before replacing what's saved.
  const broken = [];
  for (const s of specs) {
    try {
      const spec = (await importText(rewriteImports(s.text))).default;
      if (!spec || !spec.id) broken.push(s.file);
    } catch (err) {
      broken.push(`${s.file} (${String(err.message || err).slice(0, 80)})`);
    }
  }
  if (broken.length) throw new Error(`These assignment files have errors: ${broken.join('; ')}`);

  // Email students settings: any .js file that exports MAILER (e.g. mailer.js).
  let mailer = null;
  const mailerPath = [...texts.keys()].find((p) => /export\s+const\s+MAILER\s*=/.test(texts.get(p)));
  if (mailerPath) {
    try {
      const { MAILER } = await importText(texts.get(mailerPath));
      if (MAILER?.url) mailer = { url: String(MAILER.url).trim(), key: String(MAILER.key || '') };
    } catch (err) {
      throw new Error(`${baseName(mailerPath)} has an error: ${String(err.message || err).slice(0, 80)}`);
    }
  }

  const source = files.length === 1 ? files[0].name : `${files.length} files`;
  try {
    if (specs.length) localStorage.setItem(STORE_KEY, JSON.stringify({ source, loadedAt: new Date().toISOString(), specs, mailer }));
    if (frqs.length) localStorage.setItem(FRQ_KEY, JSON.stringify({ source, loadedAt: new Date().toISOString(), frqs }));
  } catch {
    throw new Error('This browser would not save the assignments (storage is full or blocked).');
  }
  return { count: specs.length, skipped, frqs: frqs.length, frqProblems };
}

/**
 * FRQs in a zip: each .json config with student_class / grader_class / parts, plus the grader and
 * support .java files it names (found anywhere in the zip by file name, e.g. frq-grader's grader/).
 * Answer keys (key/) and starter files are never stored: only the files a config names.
 */
let frqProblems = [];
function findFrqs(frqTexts) {
  frqProblems = [];
  const javaByName = new Map();
  for (const [path, text] of frqTexts) if (/\.java$/i.test(path) && !/(^|\/)key\//.test(path)) javaByName.set(baseName(path), text);
  const out = [];
  const seen = new Set();
  for (const [path, text] of [...frqTexts].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/\.json$/i.test(path)) continue;
    let cfg;
    try { cfg = JSON.parse(text); } catch { continue; }
    if (!isFrqConfig(cfg)) continue;
    const id = baseName(path).replace(/\.json$/i, '');
    if (seen.has(id)) { frqProblems.push(`${id}.json appears twice; kept the first`); continue; }
    const pick = (names) => Object.fromEntries((names || []).filter((n) => n !== 'FrqHarness.java').map((n) => [n, javaByName.get(n)]));
    const graderFiles = pick(cfg.grader_files), supportFiles = pick(cfg.support_files);
    const missing = [...Object.entries(graderFiles), ...Object.entries(supportFiles)].filter(([, t]) => t == null).map(([n]) => n);
    if (missing.length) { frqProblems.push(`${id}: missing ${missing.join(', ')}`); continue; }
    seen.add(id);
    const folder = (path.split('/').slice(-2, -1)[0] || '').replace(/^frq$/i, '');
    out.push({ id, folder, cfg, graderFiles, supportFiles });
  }
  return out;
}

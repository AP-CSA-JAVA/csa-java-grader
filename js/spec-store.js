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
// =====================================================================

import { SPECS as BUILT_IN } from '../specs/index.js';

const STORE_KEY = 'grader:privateSpecs';

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

/** Every assignment for the dropdown: private ones first, then the public ones. */
export function specList() {
  const store = readStore();
  const priv = (store?.specs || []).map((s) => ({ key: `private:${s.file}`, label: s.label, builtIn: false, file: s.file }));
  return [...priv, ...builtInList()];
}

/** { count, source, loadedAt } for the status line, or null if none loaded. */
export function privateInfo() {
  const store = readStore();
  if (!store?.specs?.length) return null;
  return { count: store.specs.length, source: store.source, loadedAt: store.loadedAt };
}

export function clearPrivate() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* storage blocked */ }
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
  const texts = new Map();   // path -> text
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !/\.js$/i.test(entry.name) || /(^|\/)(node_modules|__MACOSX)\//.test(entry.name)) continue;
        texts.set(entry.name, await entry.async('string'));
      }
    } else if (/\.js$/i.test(f.name)) {
      texts.set(f.webkitRelativePath || f.name, await f.text());
    }
  }

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
  if (!specs.length) {
    throw new Error('No assignment files found. Choose the zip of your private repository (it needs a specs folder with index.js), or select the spec .js files.');
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

  const source = files.length === 1 ? files[0].name : `${files.length} files`;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ source, loadedAt: new Date().toISOString(), specs }));
  } catch {
    throw new Error('This browser would not save the assignments (storage is full or blocked).');
  }
  return { count: specs.length, skipped };
}

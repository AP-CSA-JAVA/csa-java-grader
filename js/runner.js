// =====================================================================
// runner.js — compiles and runs Java with CheerpJ (in the browser).
//
// Uses CheerpJ "library mode": one Java session stays loaded and the page
// calls GraderHarness.compileCommand / runCommand directly. (cheerpjRunMain
// reloads the 3 MB compiler on every call: about 15 s per compile, against
// about 0.3 s in library mode. It's kept as a fallback.)
//   • the classpath holds lib/grader-harness.jar and the Eclipse compiler
//     (lib/ecj-3.36.0.jar, lib/ecj-bridge.jar)
//   • anything else Java prints lands in the hidden <pre id="console">,
//     which is shown if something goes wrong
// Sources go in /str/ (written by JavaScript); classes and results go in
// /files/ (written by Java).
// =====================================================================

import { unguardMessages } from './java-text.js';

// Java runs on CheerpJ's Java 17. Programs are compiled by the Eclipse compiler
// (lib/ecj-3.36.0.jar via lib/ecj-bridge.jar) as Java 8 — the course version —
// and, only if that fails, as Java 17 so newer-Java code can still be graded.
// CheerpJ's Java 17 has no javac of its own, so lib/tools.jar is no longer used.
const CHEERPJ_VERSION = 17;
const COMPILER_JARS = ['grader-harness.jar', 'ecj-bridge.jar', 'ecj-3.36.0.jar'];

let libDir = '';
let ready = false;
let harness = null;       // GraderHarness class in library mode (null = cheerpjRunMain fallback)
export let harnessVersion = '';
const session = Date.now().toString(36);
let counter = 0;

function consoleEl() {
  let el = document.getElementById('console');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'console';
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

/** Runs a Java main class and returns { code, printed } with everything it printed. */
async function runMain(className, classPath, args) {
  const con = consoleEl();
  con.textContent = '';
  const code = await cheerpjRunMain(className, classPath, ...args);
  await new Promise((r) => setTimeout(r, 30));   // let CheerpJ finish writing to the console
  return { code, printed: con.textContent };
}

/** Starts CheerpJ and checks that the compiler works. Call once. */
export async function startJava(onStatus = () => {}) {
  if (ready) return;
  if (typeof cheerpjInit !== 'function') {
    throw new Error('CheerpJ did not load. Check your internet connection, or whether a network filter blocks cjrtnc.leaningtech.com.');
  }
  consoleEl();
  onStatus('Starting Java (first load takes a little while)…');
  await cheerpjInit({ version: CHEERPJ_VERSION, status: 'none' });

  // /app/ maps to the web server root; on GitHub Pages that includes the repo name.
  libDir = '/app' + new URL('lib/', document.baseURI).pathname;

  // Library mode: keep the compiler loaded between students.
  onStatus('Loading the Java compiler (about 8 MB the first time)…');
  try {
    const lib = await cheerpjRunLibrary(COMPILER_JARS.map((j) => libDir + j).join(':'));
    harness = await lib.GraderHarness;
    await harness.useLibDir(libDir);
    harnessVersion = await jstr(await harness.version());
  } catch (err) {
    console.warn('CheerpJ library mode failed; using cheerpjRunMain (slower).', err);
    harness = null;
  }

  // Compile a tiny program first. If this fails, stop here rather than
  // marking every student "did not compile".
  const warmSrc = strFile('Warmup.java', 'public class Warmup { public static void main(String[] a) { } }');
  const warm = await compileFiles([['Warmup.java', warmSrc]], `/files/grader/${session}/warm/`, '', true, '8');
  if (!warm.ok) {
    throw new Error(`The Java compiler could not start in this browser. ${warm.messages.slice(0, 500) || '(no message)'}`);
  }
  ready = true;
  onStatus('Java ready');
}

function addStringFile(path, text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof cheerpOSAddStringFile === 'function') cheerpOSAddStringFile(path, bytes);
  else cheerpjAddStringFile(path, bytes);   // older CheerpJ name
}

/** CheerpJ's /str/ holds flat names only, so each file gets a unique flat name. */
function strFile(label, text) {
  const path = `/str/${session}_${++counter}_${label.replace(/[^\w.]/g, '_')}`;
  addStringFile(path, text);
  return path;
}

// files: [[fileName, strPath], ...] — the harness copies them to <outDir>_src/fileName
/** A Java String from library mode as a JavaScript string. */
async function jstr(v) {
  if (typeof v === 'string') return v;
  return v == null ? '' : String(await v.toString());
}

async function compileFiles(files, outDir, extraClassPath, clean = true, level = '8') {
  const listPath = strFile('list.txt', files.map(([name, p]) => `${name}\t${p}`).join('\n'));
  const command = clean ? 'compile' : 'compileInto';
  let result;
  if (harness) {
    const con = consoleEl();
    con.textContent = '';
    try {
      result = parseCompile(await jstr(await harness.compileCommand(command, outDir, listPath, extraClassPath || '-', level)), outDir);
    } catch (err) {
      result = parseCompile(`-1\nGRADER-ERROR: compiler did not finish. ${con.textContent.slice(0, 400) || err}`, outDir);
    }
  } else {
    const resultPath = `/files/grader/${session}/compile${++counter}.txt`;
    const { code, printed } = await runMain('GraderHarness', COMPILER_JARS.map((j) => libDir + j).join(':'),
      [command, outDir, listPath, extraClassPath || '-', resultPath, level]);
    try {
      const blob = await cjFileBlob(resultPath);
      result = parseCompile(await blob.text(), outDir);
    } catch (err) {
      // The harness itself didn't finish: report what Java printed.
      result = parseCompile(`-1\nGRADER-ERROR: compiler did not finish (exit ${code}). ${printed.slice(0, 400) || err}`, outDir);
    }
  }
  result.messages = result.messages.split(`${outDir.replace(/\/$/, '')}_src/`).join('');   // "Main.java:12", not long paths
  return result;
}

/**
 * Compiles one student's files.
 * @param {{fileName:string, text:string}[]} sources  file names already match class names
 * @param {'8'|'17'} level  Java version rules to compile by
 */
export async function compileStudent(sources, level = '8') {
  const classDir = `/files/grader/${session}/s${++counter}/`;
  const files = sources.map((s) => [s.fileName, strFile(s.fileName, s.text)]);
  return compileFiles(files, classDir, '', true, level);
}

/**
 * Compiles a grader test class (from a spec) next to a student's classes,
 * so it can call the student's constructors and methods directly.
 */
export async function compileDriver(classDir, fileName, text, level = '8') {
  return compileFiles([[fileName, strFile(fileName, text)]], classDir, classDir, false, level);
}

/** Runs the compiled program with scripted input. Resolves to the harness result. */
export async function runStudent(classDir, mainClass, stdin, timeoutMs, maxChars) {
  const inPath = strFile('input.txt', stdin);
  if (harness) {
    try {
      return JSON.parse(await jstr(await harness.runCommand(classDir, mainClass, inPath, String(timeoutMs | 0), String(maxChars | 0))));
    } catch (err) {
      return { status: 'exception', exception: `Grader error: ${String(err).slice(0, 300)}`, where: '', stdout: '', stderr: '', ms: 0 };
    }
  }
  const outPath = `/files/grader/${session}/out${++counter}.json`;
  const { code, printed } = await runMain('GraderHarness', `${libDir}grader-harness.jar`,
    ['run', classDir, mainClass, inPath, String(timeoutMs | 0), String(maxChars | 0), outPath]);
  try {
    const blob = await cjFileBlob(outPath);
    return JSON.parse(await blob.text());
  } catch (err) {
    return { status: 'exception', exception: `Grader error (exit ${code}): ${printed.slice(0, 300) || err}`, where: '', stdout: '', stderr: '', ms: 0 };
  }
}

/**
 * The Eclipse compiler words syntax errors in grammar terms ("insert ";" to
 * complete BlockStatements"). Rewrite them the way javac says them, which is
 * what students see in class. Other ECJ messages are already clear.
 */
export function plainCompilerText(text) {
  return text
    .replace(/Syntax error, insert "\}" to complete [\w ]+/g, "'}' expected (a closing brace is missing)")
    .replace(/Syntax error, insert "([^"]+)" to complete [\w ]+/g, (m, tok) => `'${tok.split(' ')[0]}' expected`)
    .replace(/Syntax error on token "([^"]+)", delete this token/g, "unexpected '$1' (delete it)")
    .replace(/Syntax error on tokens?, delete these tokens/g, 'unexpected symbols here (delete them)')
    .replace(/Syntax error on token "([^"]+)", ([^\n]+?) expected(?: (?:after|before) this token)?$/gm, "unexpected '$1' ($2 expected)")
    .replace(/Syntax error on token "([^"]+)", invalid ([^\n]+)$/gm, "'$1' is not a valid $2")
    .replace(/String literal is not properly closed by a double-quote/g, 'unclosed string literal (missing ")');
}

export function parseCompile(out, classDir) {
  const nl = out.indexOf('\n');
  const code = parseInt(nl === -1 ? out : out.slice(0, nl), 10);
  const messages = unguardMessages(plainCompilerText((nl === -1 ? '' : out.slice(nl + 1)).trim()));
  const m = messages.match(/(\d+) errors?/);
  const errors = code === 0 ? 0 : (m ? parseInt(m[1], 10) : 1);
  // A failure that isn't a javac error in the student's code is the grader's problem.
  const graderError = code !== 0 && (Number.isNaN(code) || code < 0 || /GRADER-ERROR/.test(messages) || !/error:/.test(messages));
  return { ok: code === 0, errors, messages, classDir, graderError };
}

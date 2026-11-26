// Java on a desktop JVM, shaped like js/runner.js ({ compileStudent, compileDriver, runStudent }),
// through GraderHarness's command-line mode. Same harness and Eclipse compiler as the browser;
// only CheerpJ itself is left out. Needs Java 17 or newer on the PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompile } from '../js/runner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CP = ['grader-harness.jar', 'ecj-3.36.0.jar', 'ecj-bridge.jar'].map((j) => join(ROOT, 'lib', j)).join(':');
const work = mkdtempSync(join(tmpdir(), 'frq-'));
let n = 0;

function harness(args) {
  try {
    execFileSync('java', ['-cp', CP, 'GraderHarness', ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  } catch (e) { /* the result file tells */ }
}

function compileFiles(files, outDir, classPath, clean, level) {
  const list = files.map(({ fileName, text }) => {
    const p = join(work, `src${++n}.txt`);
    writeFileSync(p, text);
    return `${fileName}\t${p}`;
  }).join('\n');
  const listPath = join(work, `list${++n}.txt`), res = join(work, `res${++n}.txt`);
  writeFileSync(listPath, list);
  harness([clean ? 'compile' : 'compileInto', outDir, listPath, classPath || '-', res, level]);
  let out;
  try { out = readFileSync(res, 'utf8'); } catch { out = '-1\nGRADER-ERROR: no result'; }
  const r = parseCompile(out, outDir);
  r.messages = r.messages.split(`${outDir.replace(/\/$/, '')}_src/`).join('');
  return r;
}

export const java = {
  async compileStudent(sources, level = '8') { return compileFiles(sources, join(work, `s${++n}/`), '', true, level); },
  async compileDriver(classDir, fileName, text, level = '8') { return compileFiles([{ fileName, text }], classDir, classDir, false, level); },
  async runStudent(classDir, mainClass, stdin, timeoutMs, maxChars) {
    const inPath = join(work, `in${++n}.txt`), outPath = join(work, `out${++n}.json`);
    writeFileSync(inPath, stdin);
    harness(['run', classDir, mainClass, inPath, String(timeoutMs), String(maxChars), outPath]);
    try { return JSON.parse(readFileSync(outPath, 'utf8')); } catch { return { status: 'exception', exception: 'no result', stdout: '', stderr: '' }; }
  },
};


// Runs js/frq.js on a desktop JVM, for checking FRQ graders without a browser.
// Uses the same GraderHarness (lib/grader-harness.jar) and Eclipse compiler as the browser, through
// GraderHarness's command-line mode; only CheerpJ itself is left out.
//
//   node test/frq-node.mjs <frq config.json> <grader folder> <student .java file or folder> [--json]
//
// <grader folder> holds the config's grader_files and support_files (frq-grader's grader/ folder).
// Needs Java 17 or newer on the PATH. Prints one line per student, or JSON with --json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompile } from '../js/runner.js';
import { gradeFrq } from '../js/frq.js';

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

const java = {
  async compileStudent(sources, level = '8') { return compileFiles(sources, join(work, `s${++n}/`), '', true, level); },
  async compileDriver(classDir, fileName, text, level = '8') { return compileFiles([{ fileName, text }], classDir, classDir, false, level); },
  async runStudent(classDir, mainClass, stdin, timeoutMs, maxChars) {
    const inPath = join(work, `in${++n}.txt`), outPath = join(work, `out${++n}.json`);
    writeFileSync(inPath, stdin);
    harness(['run', classDir, mainClass, inPath, String(timeoutMs), String(maxChars), outPath]);
    try { return JSON.parse(readFileSync(outPath, 'utf8')); } catch { return { status: 'exception', exception: 'no result', stdout: '', stderr: '' }; }
  },
};

const [cfgPath, graderDir, target] = process.argv.slice(2);
const asJson = process.argv.includes('--json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const read = (names) => Object.fromEntries((names || []).map((f) => [f, readFileSync(join(graderDir, f), 'utf8')]));
const frq = { cfg, graderFiles: read(cfg.grader_files), supportFiles: read(cfg.support_files) };
const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith('.java')).sort().map((f) => join(target, f)) : [target];

const all = {};
for (const f of files) {
  const r = await gradeFrq(java, frq, readFileSync(f, 'utf8'));
  all[basename(f)] = r;
  if (!asJson) console.log(`${basename(f)}\t${r.total}\t${r.flags.join(',') || '-'}\t${Object.entries(r.points).map(([id, [e]]) => id + ':' + e).join(' ')}`);
}
if (asJson) console.log(JSON.stringify(all));

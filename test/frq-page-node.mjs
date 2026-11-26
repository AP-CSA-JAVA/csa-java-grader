// End-to-end check of FRQs on the main grader page's code path, on a desktop JVM:
// Load assignments (frq-grader zip) -> pick an FRQ -> Canvas zip -> gradeStudent -> scores.
//
//   node test/frq-page-node.mjs <frq-grader zip> <FRQ id, e.g. plantgrid> <Canvas submissions zip> [--json]
//
// Needs Java 17+ on the PATH. Uses the same GraderHarness and Eclipse compiler as the browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';

// browser stand-ins
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const require = createRequire(import.meta.url);
const JSZip = require('../js/vendor/jszip.min.js');
const fileLike = (path) => { const buf = readFileSync(path); return { name: basename(path), size: buf.length, arrayBuffer: async () => buf, async: undefined, _buf: buf }; };

const { java } = await import('./java-desktop.mjs');
const { loadPrivate, specList, importSpec } = await import('../js/spec-store.js');
const { readCanvasZip } = await import('../js/canvas-zip.js');
const { gradeStudent } = await import('../js/grader.js');

const [frqZip, frqId, canvasZip] = process.argv.slice(2);
const asJson = process.argv.includes('--json');
const loaded = await loadPrivate([fileLike(frqZip)], { loadAsync: (f) => JSZip.loadAsync(f._buf || f) });
const entry = specList().find((s) => s.key === `frq:${frqId}`);
if (!entry) throw new Error(`FRQ ${frqId} not loaded (${loaded.frqs} FRQs; problems: ${loaded.frqProblems.join('; ')})`);
const spec = await importSpec(entry.key);
const students = await readCanvasZip({ ...fileLike(canvasZip) }, { loadAsync: (f) => JSZip.loadAsync(f._buf || f) });

const out = {};
for (const st of students) {
  const r = await gradeStudent(st, spec, java);
  const checks = r.runs.flatMap((x) => x.checks);
  out[st.name] = { points: r.scores?.points, rubric: r.scores?.rubricPoints, max: r.scores?.maxPoints, header: r.scores?.headerDeduction,
                   compiled: r.compile?.ok, checks: checks.map((c) => [c.label.split(' · ')[0], c.pass]), notes: r.notes };
  if (!asJson) console.log(`${st.name}\t${r.scores?.points}/${r.scores?.maxPoints}\theader -${r.scores?.headerDeduction || 0}\t${checks.map((c) => c.label.split(' · ')[0] + ':' + (c.pass === true ? 1 : c.pass === false ? 0 : '?')).join(' ')}`);
}
if (asJson) console.log(JSON.stringify({ label: entry.label, frqs: loaded.frqs, students: out }));

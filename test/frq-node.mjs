// Runs js/frq.js on a desktop JVM, for checking FRQ graders without a browser.
// Uses the same GraderHarness (lib/grader-harness.jar) and Eclipse compiler as the browser, through
// GraderHarness's command-line mode; only CheerpJ itself is left out.
//
//   node test/frq-node.mjs <frq config.json> <grader folder> <student .java file or folder> [--json]
//
// <grader folder> holds the config's grader_files and support_files (frq-grader's grader/ folder).
// Needs Java 17 or newer on the PATH. Prints one line per student, or JSON with --json.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gradeFrq } from '../js/frq.js';
import { java } from './java-desktop.mjs';

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

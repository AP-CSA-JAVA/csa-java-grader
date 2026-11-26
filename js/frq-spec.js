/**
 * Turns an FRQ from the private frq-grader zip (its .json config, grader class and support classes)
 * into an assignment for the main grader page, in the existing "points" mode:
 *   - each rubric point is one check worth 1 point, labeled "A1 · Traverses every element …"
 *   - the support classes ("implementation not shown") are provided files, so the student's
 *     copy can't change them
 *   - the grader class runs as a driver next to the student's code (java/FrqHarness.java)
 *   - the header costs header_penalty (usually 1) when it's missing, as on the AP-style FRQ rubric
 * Scores match frq-grader's grade_frq.py; see test/frq-node.mjs.
 */
import { pointIds, parsePoints, FRQ_RUN_MS } from './frq.js';

/** True if a parsed .json file is an FRQ config. */
export function isFrqConfig(o) {
  return !!(o && typeof o === 'object' && o.student_class && o.grader_class && Array.isArray(o.parts) && Array.isArray(o.grader_files));
}

/** "apset1" -> "AP Set 1", "unit5" -> "Unit 5", anything else as it is. */
function setName(folder) {
  const m = /^(apset|unit)(\d+)$/i.exec(folder || '');
  return m ? `${/^ap/i.test(m[1]) ? 'AP Set' : 'Unit'} ${m[2]}` : (folder || '');
}

/** Dropdown label, e.g. "AP Set 1 FRQ 2: ComboMeter (Class Design) · practice" or "FRQ 5.D: CultureSample (…, assessed)". */
export function frqLabel(cfg, folder = '') {
  let t = String(cfg.title || cfg.student_class).replace(/^FRQ\s+Practice:\s*/i, '');
  const set = setName(folder);
  // name the set unless the title already does ("AP Set 2 FRQ 1", "FRQ Unit 2", "FRQ 3.E")
  if (set && !new RegExp(set.replace(' ', '\\s*'), 'i').test(t) && !/^FRQ\s+\d+\.[A-Z]\b/i.test(t)) t = /^FRQ\b/i.test(t) ? `${set} ${t}` : `${set} · ${t}`;
  if (!/^(FRQ|AP Set)\b/i.test(t)) t = `FRQ · ${t}`;
  return cfg.category && !new RegExp(cfg.category, 'i').test(t) ? `${t} · ${cfg.category}` : t;
}

/**
 * @param entry { id, cfg, graderFiles: {name: text}, supportFiles: {name: text} }
 */
export function frqToSpec(entry) {
  const { cfg } = entry;
  const ids = pointIds(cfg);
  const criteria = Object.fromEntries(cfg.parts.flatMap((part) => part.points.map((p) => [p.id, p.criterion || ''])));
  const label = (id) => `${id}${criteria[id] ? ` · ${criteria[id]}` : ''}`;
  const [graderName, graderSource] = Object.entries(entry.graderFiles).find(([n]) => n !== 'FrqHarness.java') || [];

  return {
    id: `FRQ-${entry.id}`,
    title: frqLabel(cfg, entry.folder),
    frq: true,
    mode: 'points',
    maxPoints: ids.length,
    headerPenalty: cfg.require_header ? (cfg.header_penalty ?? 1) : 0,
    requireTestCases: false,
    mainClass: cfg.student_class,
    providedFiles: entry.supportFiles || {},
    hints: {},
    runs: [{
      label: 'Rubric checks',
      timeoutMs: FRQ_RUN_MS,
      independentChecks: true,     // one point lost doesn't skip the others
      driver: { className: cfg.grader_class, source: graderSource || '' },
      check(out) {
        if (!graderName) return ids.map((id) => ({ label: label(id), pass: null, detail: 'The grader file is missing from the loaded zip.' }));
        if (out.status === 'driverCompile') {
          return ids.map((id) => ({ label: label(id), pass: false,
            detail: `The grader could not call your methods. Check that the method names, parameters, and return types match the prompt. (${out.exception})` }));
        }
        const { points, done } = parsePoints(out.stdout);
        return ids.map((id) => (points[id]
          ? { label: label(id), pass: points[id][0] === 1, detail: points[id][1] }
          : { label: label(id), pass: null,
              detail: `The grader did not finish (${done ? 'no result for this point' : out.status}${out.exception ? `: ${out.exception}` : ''}). Check by hand.` }));
      },
    }],
  };
}

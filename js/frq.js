/**
 * FRQ grading in the browser: scores one student's FRQ code one rubric point at a time.
 * Same steps and results as frq-grader's grade_frq.py, so the FRQ graders (PlantGridGrader.java …)
 * and their .json configs work unchanged:
 *
 *   1. compile the student's class (plus any "support_files" the prompt calls "implementation not shown")
 *   2. compile the grader class next to it (fails if a method header was changed)
 *   3. run the grader: one "POINT|id|1 or 0|feedback" line per rubric point (java/FrqHarness.java)
 *
 * The FRQ files themselves (configs, graders, support classes) are private: they come from the
 * teacher's assignments zip, never from this public site.
 *
 * `java` is the runner (js/runner.js): { compileStudent, compileDriver, runStudent }.
 */
import { neutralizeExit, guardLoops } from './java-text.js';

/** Whole grader run for one student. Each test case has its own 2-second limit inside FrqHarness. */
export const FRQ_RUN_MS = 120000;
const FRQ_MAX_CHARS = 1000000;

/** Every rubric point id in the config, in order. */
export function pointIds(cfg) {
  return (cfg.parts || []).flatMap((part) => (part.points || []).map((p) => p.id));
}

/** Header = a block comment at the top of the file, with Name: filled in if there is one (as in grade_frq.py). */
export function checkFrqHeader(source) {
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(source);
  if (!m) return { ok: false, msg: 'No block comment header at the top of the file.' };
  const name = /Name:[ \t]*(.*)/.exec(m[1]);
  if (name && !name[1].replace(/[\s*]/g, '')) return { ok: false, msg: 'Header is there, but the Name: line is blank.' };
  return { ok: true, msg: '' };
}

/**
 * The FRQ header in the shape js/header.js uses (present, fields, blank, deduction, endLine),
 * so the rest of the grader can show it. Same rule as checkFrqHeader: a block comment at the
 * top, with the Name: line filled in if there is one. FRQ headers are Name / Period / Assignment.
 */
export function frqHeaderInfo(source, penalty = 1) {
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(source);
  const missingHint = 'A block comment at the very top with Name, Period and Assignment.';
  if (!m) return { present: false, fields: [], blank: [], deduction: penalty, endLine: 0, missingHint };
  const fields = [];
  for (const line of m[1].split('\n')) {
    const f = /^[\s*]*(Name|Period|Assignment)\s*:[ \t]*(.*)$/i.exec(line);
    if (f) {
      const value = f[2].replace(/[\s*]+$/, '').trim();
      fields.push({ key: f[1].toLowerCase(), label: f[1][0].toUpperCase() + f[1].slice(1).toLowerCase(), value, filled: !!value });
    }
  }
  const blank = fields.filter((f) => f.key === 'name' && !f.filled).map((f) => f.label);
  return { present: true, fields, blank, deduction: blank.length ? penalty : 0,
           endLine: source.slice(0, m.index + m[0].length).split('\n').length, missingHint };
}

/** Total after the header deduction, never below 0. */
export function frqTotal(result, cfg) {
  let t = Object.values(result.points).reduce((s, [earned]) => s + earned, 0);
  if (!result.headerOk) t -= cfg.header_penalty ?? 1;
  return Math.max(t, 0);
}

/** Reads POINT lines from the grader's output. */
export function parsePoints(stdout) {
  const points = {};
  let done = false;
  for (const line of String(stdout || '').split('\n')) {
    if (line.startsWith('POINT|')) {
      const [, id, earned, ...msg] = line.split('|');
      points[id] = [Number(earned) === 1 ? 1 : 0, msg.join('|').trim()];
    } else if (line.trim() === 'FRQ-DONE') {
      done = true;
    }
  }
  return { points, done };
}

/**
 * Grades one submission.
 * @param java    the runner: { compileStudent, compileDriver, runStudent }
 * @param frq     { cfg, graderFiles: {name: text}, supportFiles: {name: text} }
 *                graderFiles may include FrqHarness.java; it's skipped (the browser version is in grader-harness.jar).
 * @param source  the student's .java text
 * @returns { points: {id: [earned, message]}, flags: [], compileOutput, headerOk, headerMsg, javaLevel, total }
 */
export async function gradeFrq(java, frq, source) {
  const { cfg } = frq;
  const ids = pointIds(cfg);
  const result = {
    points: Object.fromEntries(ids.map((id) => [id, [0, 'Not run.']])),
    flags: [], compileOutput: '', headerOk: true, headerMsg: '', javaLevel: '8', total: 0,
  };
  const finish = () => { result.total = frqTotal(result, cfg); return result; };
  const allPoints = (msg) => { for (const id of ids) result.points[id] = [0, msg]; };

  if (cfg.require_header) {
    const h = checkFrqHeader(source);
    result.headerOk = h.ok; result.headerMsg = h.msg;
  }

  // 1. The student's class, with System.exit neutralized and a LoopGuard in every loop, plus support classes.
  const support = Object.entries(frq.supportFiles || {}).map(([fileName, text]) => ({ fileName, text }));
  const sources = [{ fileName: `${cfg.student_class}.java`, text: guardLoops(neutralizeExit(source)) }, ...support];
  let compiled = await java.compileStudent(sources, '8');
  if (!compiled.ok) {
    // Newer Java (var, records …) isn't penalized elsewhere in the grader, so not here either.
    const newer = await java.compileStudent(sources, '17');
    if (newer.ok) { compiled = newer; result.javaLevel = '17'; }
  }
  if (!compiled.ok) {
    result.flags.push('HAND GRADE');
    result.compileOutput = compiled.messages;
    allPoints('Code does not compile.');
    return finish();
  }

  // 2. The grader class next to it.
  for (const [fileName, text] of Object.entries(frq.graderFiles || {})) {
    if (fileName === 'FrqHarness.java') continue;
    const dc = await java.compileDriver(compiled.classDir, fileName, text, result.javaLevel);
    if (!dc.ok) {
      result.flags.push('HAND GRADE');
      result.compileOutput = 'Your class compiles, but the grader could not call your methods. '
        + 'Check that the method names, parameters, and return types match the prompt.\n\n' + dc.messages;
      allPoints('Method header does not match the prompt.');
      return finish();
    }
  }

  // 3. Run the rubric checks.
  const run = await java.runStudent(compiled.classDir, cfg.grader_class, '', FRQ_RUN_MS, FRQ_MAX_CHARS);
  const { points, done } = parsePoints(run.stdout);
  Object.assign(result.points, Object.fromEntries(Object.entries(points).filter(([id]) => id in result.points)));
  if (!done || ids.some((id) => !(id in points))) {
    result.flags.push('HAND GRADE');
    result.compileOutput = `The grader did not finish (${run.status}${run.exception ? ': ' + run.exception : ''}).\n${run.stderr || ''}`.trim();
  } else if (ids.some((id) => result.points[id][0] === 0)) {
    // Black-box tests can't award a loop point when the final answer is wrong, but an AP reader might.
    result.flags.push('REVIEW');
  }
  return finish();
}

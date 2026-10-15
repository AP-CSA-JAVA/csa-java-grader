// =====================================================================
// grader.js — grades one student: prepares files, compiles, runs the
// spec's tests, and scores each rubric column.
// Works in the browser (CheerpJ) or in Node tests (desktop Java),
// depending on the `java` backend passed in.
// =====================================================================

import { CONFIG } from './config.js';
import { scanSource, className, packageName, hasMain, neutralizeExit, guardLoops, topLevelClasses } from './java-text.js';
import { readHeader } from './header.js';
import { checkConventions } from './conventions.js';
import { detectNewerJava, newerJavaSummary, forClass } from './newer-java.js';
import { STUCK } from './report-pdf.js';

/**
 * @param student  from canvas-zip.js
 * @param spec     an assignment spec module's default export
 * @param java     { compileStudent(sources), runStudent(classDir, mainClass, stdin, timeout, max) }
 * @param onStep   progress callback
 */
export async function gradeStudent(student, spec, java, onStep = () => {}) {
  const notes = [];
  const javaFiles = student.files.filter((f) => f.ext === 'java' && f.text != null);
  const otherFiles = student.files.filter((f) => f.ext !== 'java');
  const testCaseFiles = otherFiles.filter((f) => CONFIG.testCaseExtensions.includes(f.ext));
  const javaInComments = javaFiles.length === 0 && testCaseFiles.some((f) => f.ext === 'txt' && /class\s+\w+/.test(f.text || ''));

  const result = {
    key: student.key,
    name: student.name,
    late: student.late,
    files: student.files.map((f) => f.cleanName || f.name),
    // e.g. "smithjordan_123456_7890123_" — lets feedback files keep Canvas's naming
    canvasPrefix: ((student.files[0]?.fromCanvas || '').match(/^([^_/]+_(?:late_)?\d+_\d+_)/i) || [])[1] || '',
    notes,
    compile: null,
    header: null,
    style: [],
    requirements: [],
    runs: [],
    scores: {},
  };

  // ---------- Submission column ----------
  const commentTestCases = countCommentTestCases(javaFiles.map((f) => f.text));
  const submission = {
    hasJava: javaFiles.length > 0,
    hasTestCases: testCaseFiles.length > 0 || commentTestCases >= CONFIG.commentTestCasesMin,
    testCaseFiles: testCaseFiles.length,
    commentTestCases,
  };
  if (javaInComments) notes.push('Code may have been submitted as a .txt file instead of .java.');

  if (!submission.hasJava) {
    result.scores = {
      output: null, style: null,
      submission: student.files.length ? 1 : 0,
      headerDeduction: 0,
      suggested: student.files.length ? 1 : 0,
    };
    result.submission = submission;
    notes.push('No .java file submitted — nothing to compile.');
    return result;
  }

  // ---------- Prepare sources (file names must match class names) ----------
  const byName = new Map();
  for (const f of javaFiles) {
    const cls = className(f.text) || (f.cleanName || f.name).replace(/\.java$/i, '');
    const fileName = `${cls}.java`;
    const shown = f.cleanName || f.name;
    if (f.name !== fileName) notes.push(`Renamed ${f.name} → ${fileName} so it compiles (Canvas renames resubmitted files).`);
    if (byName.has(fileName)) notes.push(`Two files declare class ${cls}; graded the newer one.`);
    byName.set(fileName, { fileName, cls, pkg: packageName(f.text), text: f.text, shown, provided: false });
  }

  // Teacher-provided classes ("do not modify"): always grade against the real one.
  for (const [fileName, text] of Object.entries(spec.providedFiles || {})) {
    const cls = fileName.replace(/\.java$/, '');
    const theirs = byName.get(fileName);
    if (theirs) {
      if (squash(theirs.text) !== squash(text)) notes.push(`Used the provided ${fileName}; the student's copy was changed and was not graded.`);
    } else {
      notes.push(`Added the provided ${fileName} (not in the submission).`);
    }
    byName.set(fileName, { fileName, cls, pkg: '', text, shown: fileName, provided: true });
  }

  const sources = [...byName.values()];
  const studentSources = sources.filter((x) => !x.provided);
  if (!studentSources.length) {
    result.scores = { output: null, style: null, submission: 1, headerDeduction: 0, suggested: 1 };
    result.submission = submission;
    notes.push('Only the provided file(s) were submitted — no student code to grade.');
    return result;
  }
  if (studentSources.some((x) => /System\s*\.\s*exit\s*\(/.test(x.text))) {
    notes.push('Program calls System.exit(); the grader catches it so grading can continue.');
  }

  // main class
  const withMain = studentSources.filter((x) => hasMain(x.text));
  const main = withMain.find((x) => x.cls === spec.mainClass) || withMain[0] || null;
  if (spec.mainClass && main && main.cls !== spec.mainClass && withMain.length === 1) {
    notes.push(`Assignment asks for class ${spec.mainClass}; found main() in ${main.cls} instead.`);
  }
  const headerSource = main || studentSources[0];

  // ---------- Header ----------
  result.header = readHeader(headerSource.text);

  // ---------- Style ----------
  result.style = checkConventions(studentSources.map((s) => ({
    name: s.fileName,
    src: s.text,
    headerEndLine: s === headerSource ? result.header.endLine : 0,
  })));

  // ---------- Requirements (code checks) ----------
  const scanned = studentSources.map((x) => ({ ...x, scan: scanSource(x.text) }));
  // every top-level class, including extra non-public classes inside one file
  const allClasses = scanned.flatMap((x) => topLevelClasses(x.scan.codeOnly, x.scan.noComments));
  const ctx = {
    sources: studentSources.map((x) => ({ fileName: x.fileName, cls: x.cls, text: x.text })),
    main: main ? { fileName: main.fileName, cls: main.cls, text: main.text } : null,
    mains: withMain.map((x) => ({ fileName: x.fileName, cls: x.cls, text: x.text })),
    code: scanned.map((x) => x.scan.noComments).join('\n'),
    codeOnly: scanned.map((x) => x.scan.codeOnly).join('\n'),
    comments: studentSources.map((x) => commentText(x.text)).join('\n'),
    header: result.header,
    files: student.files.map((f) => ({ name: f.cleanName || f.name, ext: f.ext, text: f.text })),
    /** Code (comments removed) of one class, or '' if the student has no such class. */
    classCode(cls) { const c = allClasses.find((x) => x.name === cls); return c ? c.code : ''; },
    hasClass(cls) { return allClasses.some((x) => x.name === cls); },
    classNames: allClasses.map((x) => x.name),
    /** The class with main() whose code matches a pattern (for assignments with two programs). */
    findMain(re) { const f = withMain.find((x) => re.test(x.text)); return f ? f.cls : null; },
  };
  try {
    result.requirements = (spec.requirements ? spec.requirements(ctx) : []) || [];
  } catch (err) {
    result.requirements = [{ label: 'Spec error in requirements()', pass: null, detail: String(err) }];
  }

  // ---------- Compile ----------
  // Graded as Java 8 (the course version). If that fails, try Java 17: a program
  // that only compiles there used newer Java. It is flagged, not penalized, and
  // graded with the Java 17 build.
  onStep('Compiling');
  // Student code gets System.exit() neutralized and a guard in every loop (see java-text.js).
  const compileSources = sources.map((x) => ({ fileName: x.fileName, text: x.provided ? x.text : guardLoops(neutralizeExit(x.text)) }));
  let javaLevel = '8';
  result.compile = await java.compileStudent(compileSources, '8');
  if (!result.compile.ok && !result.compile.graderError && CONFIG.allowNewerJava) {
    onStep('Trying newer Java');
    const newer = await java.compileStudent(compileSources, '17');
    const features = detectNewerJava(studentSources.map((x) => ({ fileName: x.fileName, text: x.text })));
    if (newer.ok) {
      result.newerJava = { compiled: true, version: 17, features, java8Errors: result.compile.errors,
        java8Messages: result.compile.messages.split('\n').filter((l) => /error:/.test(l)).slice(0, 3) };
      result.compile = newer;
      javaLevel = '17';
      notes.push(`Uses Java newer than 8, so it was graded as Java 17 (no penalty)${features.length ? `: ${newerJavaSummary(features)}` : ''}.`);
    } else if (features.length) {
      // Still doesn't compile; tell the student about the newer features anyway.
      result.newerJava = { compiled: false, version: null, features, java8Errors: result.compile.errors, java8Messages: [] };
      notes.push(`Also uses Java newer than 8: ${newerJavaSummary(features)}.`);
    }
  }
  if (result.compile.graderError) {
    // Not the student's fault — don't score it.
    result.stuck = true;
    result.scores = null;
    result.submission = submission;
    notes.unshift(`Grader problem: the compiler failed for a reason that is not in this student's code. Regrade, or grade by hand. (${result.compile.messages.split('\n')[0].slice(0, 200)})`);
    return result;
  }

  // ---------- Runs ----------
  const needsMain = (spec.runs || []).some((r) => !r.driver);
  if (result.compile.ok && !main && needsMain) {
    notes.push('Compiled, but no class has public static void main(String[] args).');
  }
  if (result.compile.ok) {
    const pkgImports = [...new Set(studentSources.map((x) => x.pkg).filter(Boolean))].map((p) => `import ${p}.*;`).join('\n');
    for (const run of spec.runs || []) {
      onStep(run.label);
      let out = null;
      let mainClass = null;

      if (run.driver) {
        // A grader test class that calls the student's code directly.
        const d = run.driver;
        const src = typeof d.source === 'function' ? d.source(ctx) : d.source;
        const dc = await java.compileDriver(result.compile.classDir, `${d.className}.java`, `${pkgImports}\n${src}`, javaLevel);
        if (!dc.ok) {
          out = { status: 'driverCompile', exception: firstCompileError(dc.messages, d.className), where: '', stdout: '', stderr: '', ms: 0 };
        } else {
          mainClass = d.className;
        }
      } else {
        // run.main picks a specific program (e.g. one of two); null means "not submitted"
        const picks = run.main !== undefined;
        const want = typeof run.main === 'function' ? run.main(ctx) : (run.main || null);
        const target = picks ? (want ? withMain.find((x) => x.cls === want) : null) : main;
        if (!target) {
          out = { status: 'noMain', exception: picks ? `No program found for this test (${run.mainHint || want || 'not submitted'}).` : 'No class with a main method.', where: '', stdout: '', stderr: '', ms: 0 };
        } else {
          mainClass = target.pkg ? `${target.pkg}.${target.cls}` : target.cls;
        }
      }

      const stdin = typeof run.stdin === 'function' ? run.stdin(ctx) : (run.stdin || '');
      if (mainClass) {
        try {
          out = await java.runStudent(result.compile.classDir, mainClass, stdin, CONFIG.runTimeoutMs, CONFIG.maxOutputChars);
        } catch (err) {
          out = { status: 'exception', exception: `Grader error: ${err}`, where: '', stdout: '', stderr: '', ms: 0 };
        }
      }

      let checks;
      try {
        checks = run.check(out, ctx) || [];
      } catch (err) {
        checks = [{ label: 'Spec error in check()', pass: null, detail: String(err) }];
      }
      // If the program crashed, the rest of that run's checks can't be judged fairly.
      if (checks.length && checks[0].pass === false) {
        checks = checks.map((c, i) => (i === 0 ? c : { ...c, pass: null, detail: 'Skipped — this test could not finish.' }));
      }
      result.runs.push({ label: run.label, stdin: run.driver ? '(grader test code — no typing)' : stdin, output: out, checks });
    }
  }

  // Points-mode projects: no credit for concept items when the program doesn't compile.
  if (spec.mode === 'points' && !result.compile.ok) {
    result.requirements = result.requirements.map((c) => (c.always ? c : { ...c, pass: null, detail: 'Program did not compile — the rubric gives no credit for most concepts. Check by hand.' }));
    if (spec.compileItemLabel) result.requirements.push({ label: spec.compileItemLabel, pass: false, detail: 'Does not compile.', always: true });
  }

  applyHints(result, spec);
  result.submission = submission;
  result.scores = score(result, spec);
  return result;
}

/**
 * spec.hints = { 'Start of a check label': 'Where to look / how to fix it' }
 * adds a hint to any check whose label starts with that text (ignoring case)
 * and doesn't already have one. Lets a hint be added without touching the check.
 */
function applyHints(result, spec) {
  const entries = Object.entries(spec.hints || {}).map(([k, v]) => [k.toLowerCase(), v]);
  if (!entries.length) return;
  const add = (c) => {
    if (c.hint) return c;
    const label = String(c.label || '').toLowerCase();
    const hit = entries.find(([k]) => label.startsWith(k));
    return hit ? { ...c, hint: hit[1] } : c;
  };
  result.requirements = result.requirements.map(add);
  for (const run of result.runs) run.checks = run.checks.map(add);
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

export function score(r, spec) {
  if (spec.mode === 'points') return scorePoints(r, spec);

  // Compilation & Output
  let output;
  const allChecks = [...r.requirements, ...r.runs.flatMap((x) => x.checks)].filter((c) => c.pass !== null);
  // The same problem showing up in several runs (e.g. one crash) counts once.
  // A failure counts once if its label or its message was already counted (e.g. the same
  // crash in two runs, or the same format problem across repeated random runs).
  let failed = 0;
  const seenLabels = new Set();
  const seenDetails = new Set();
  const seenGroups = new Set();
  for (const c of allChecks.filter((x) => !x.pass)) {
    if (seenLabels.has(c.label) || (c.detail && seenDetails.has(c.detail)) || (c.group && seenGroups.has(c.group))) continue;
    failed++;
    seenLabels.add(c.label);
    if (c.detail) seenDetails.add(c.detail);
    if (c.group) seenGroups.add(c.group);
  }
  if (!r.compile.ok) {
    output = r.compile.errors <= CONFIG.compileFailFewErrors ? 2 : 1;
  } else if (!allChecks.length) {
    output = 5;                                // nothing to test beyond compiling
  } else {
    output = 2;
    for (const band of CONFIG.outputBands) {
      if (band.maxFailed !== undefined && failed <= band.maxFailed) { output = band.score; break; }
      if (band.maxFailedFraction !== undefined && failed / allChecks.length <= band.maxFailedFraction) { output = band.score; break; }
    }
  }

  // Documentation & Style
  const types = r.style.length;
  const style = CONFIG.styleBands.find((b) => types <= b.max).score;

  // Submission
  const needTests = spec.requireTestCases !== false;
  const submission = r.submission.hasJava ? (needTests && !r.submission.hasTestCases ? 4 : 5) : 1;

  // Suggested total
  const avg = Math.round((output + style + submission) / 3);
  let suggested = CONFIG.suggestedMethod === 'average' ? avg
    : CONFIG.suggestedMethod === 'lowest' ? Math.min(output, style, submission)
      : Math.min(avg, output);
  if (!r.compile.ok) suggested = Math.min(suggested, CONFIG.capNoCompile);
  if (needTests && !r.submission.hasTestCases) suggested = Math.min(suggested, CONFIG.capNoTestCases);
  const headerDeduction = r.header ? r.header.deduction : 0;
  suggested = Math.max(1, suggested - headerDeduction);

  return { output, style, submission, headerDeduction, suggested, checksPassed: allChecks.filter((c) => c.pass).length, checksTotal: allChecks.length };
}

/** Projects with a point-per-concept rubric (e.g. the Unit 1 final project). */
function scorePoints(r, spec) {
  const items = [...r.requirements, ...r.runs.flatMap((x) => x.checks)];
  const counted = items.filter((c) => (c.points ?? 1) > 0);
  const points = counted.filter((c) => c.pass === true).reduce((t, c) => t + (c.points ?? 1), 0);
  const maxPoints = spec.maxPoints || counted.reduce((t, c) => t + (c.points ?? 1), 0);
  const review = counted.filter((c) => c.pass === null).length;
  const types = r.style.length;
  return {
    mode: 'points',
    points, maxPoints, review,
    suggested: points,
    output: r.compile.ok ? 5 : 1,
    style: CONFIG.styleBands.find((b) => types <= b.max).score,
    submission: r.submission.hasJava ? 5 : 1,
    headerDeduction: 0,
    checksPassed: counted.filter((c) => c.pass === true).length,
    checksTotal: counted.length,
  };
}

// ---------------------------------------------------------------------
// Plain-text feedback for a Canvas comment
// ---------------------------------------------------------------------

export function feedbackText(r, spec, finalScore) {
  const lines = [];
  const s = r.scores;
  lines.push(`${spec.id === 'general' ? 'Assignment' : `${spec.id} ${spec.title}`} — ${finalScore ?? s.suggested}/5`);
  lines.push('');

  if (!r.submission?.hasJava || !r.compile) {
    lines.push(r.notes?.[0] || 'No .java file was submitted.');
    return lines.join('\n');
  }

  if (s.mode === 'points') {
    lines[0] = `${spec.id} ${spec.title} — ${finalScore ?? s.points}/${s.maxPoints}`;
    if (!r.compile.ok) lines.push(`Did not compile (${r.compile.errors} error${r.compile.errors === 1 ? '' : 's'}).`, '');
    if (r.newerJava?.compiled) lines.push(`Uses Java newer than Java 8 (graded as Java 17, no points off): ${newerJavaSummary(r.newerJava.features)}.`, '');
    for (const c of [...r.requirements, ...r.runs.flatMap((x) => x.checks)]) {
      if ((c.points ?? 1) === 0) continue;
      const mark = c.pass === true ? '✓' : c.pass === false ? '✗' : '?';
      lines.push(`${mark} ${c.label}${c.pass !== true && c.detail ? ` — ${c.detail}` : ''}`);
      if (c.pass === false && c.hint) lines.push(`    Hint: ${c.hint}`);
    }
    if (s.review) lines.push('', `? = checked by your teacher (${s.review} item${s.review === 1 ? '' : 's'})`);
    if (!r.compile.ok || [...r.requirements, ...r.runs.flatMap((x) => x.checks)].some((c) => c.pass === false && (c.points ?? 1) > 0)) lines.push('', STUCK);
    if (r.style.length) {
      lines.push('', 'Style notes:');
      for (const issue of r.style) lines.push(`  • ${issue.label} (${issue.count}×)`);
    }
    return lines.join('\n');
  }

  lines.push(`Compilation & Output: ${s.output}/5`);
  if (r.newerJava?.compiled) {
    lines.push('  • Uses Java newer than Java 8, so it was graded as Java 17 (no points off).');
    for (const f of r.newerJava.features) {
      const where = [...new Set(f.where.map((w) => `${w.file} line ${w.line}`))].slice(0, 3).join(', ');
      lines.push(`    - ${f.name} (Java ${f.since}): ${where}. ${forClass(f.fix)}`);
    }
    if (!r.newerJava.features.length) lines.push('    - It does not compile as Java 8. For class, write Java 8 code.');
  } else if (r.newerJava?.features.length) {
    lines.push('  • Also uses Java newer than Java 8 (the course uses Java 8):');
    for (const f of r.newerJava.features) lines.push(`    - ${f.name} (Java ${f.since}). ${forClass(f.fix)}`);
  }
  if (!r.compile.ok) {
    lines.push(`  • Did not compile (${r.compile.errors} error${r.compile.errors === 1 ? '' : 's'}):`);
    const errs = r.compile.messages.split('\n').filter((l) => /error:/.test(l));
    (errs.length ? errs : r.compile.messages.split('\n')).slice(0, 5).forEach((l) => lines.push(`    ${l.trim()}`));
  } else {
    lines.push(`  • Compiled. ${s.checksPassed} of ${s.checksTotal} checks passed.__ONCE__`);
  }
  // Same rule as the score and the correction sheet: a problem caught several ways is listed once.
  const seen = new Set();
  const firstTime = (c) => {
    const keys = [c.label, c.detail, c.group].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  };
  const hintLine = (c, pad) => (c.hint ? [`${pad}  Hint: ${c.hint}`] : []);
  let anyFailed = !r.compile.ok;
  for (const c of r.requirements) {
    if (c.pass !== false || !firstTime(c)) continue;
    anyFailed = true;
    lines.push(`  ✗ ${c.label}${c.detail ? ` — ${c.detail}` : ''}`, ...hintLine(c, '  '));
  }
  for (const run of r.runs) {
    const bad = run.checks.filter((c) => c.pass === false && firstTime(c));
    if (!bad.length) continue;
    anyFailed = true;
    lines.push(`  Test run "${run.label}":`);
    for (const c of bad) lines.push(`    ✗ ${c.label}${c.detail ? ` — ${c.detail}` : ''}`, ...hintLine(c, '    '));
  }
  if (anyFailed) lines.push('', `  ${STUCK}`);
  // say why fewer items than failed checks are listed
  const listed = lines.filter((l) => /^\s+✗ /.test(l)).length;
  const failedCount = (s.checksTotal || 0) - (s.checksPassed || 0);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('__ONCE__')) {
      lines[i] = lines[i].replace('__ONCE__', failedCount > listed && listed ? ' One mistake can fail several checks, so each problem is listed once.' : '');
    }
  }

  lines.push('');
  lines.push(`Documentation & Style: ${s.style}/5`);
  if (!r.style.length) lines.push('  • Follows the Java code conventions — nice work.');
  for (const issue of r.style) {
    const where = issue.where.slice(0, 3).map((w) => `${w.file} line ${w.line}`).join(', ');
    lines.push(`  • ${issue.label} (${issue.count}×: ${where}${issue.count > 3 ? ', …' : ''})`);
  }

  lines.push('');
  lines.push(`Submission: ${s.submission}/5`);
  if (spec.requireTestCases === false) lines.push('  • .java file submitted.');
  else if (!r.submission.hasTestCases) lines.push('  • Test cases document / screenshot is missing.');
  else if (!r.submission.testCaseFiles) {
    const n = r.submission.commentTestCases;
    lines.push(`  • .java file and test cases submitted (${n} test case${n === 1 ? '' : 's'} in a comment).`);
  } else lines.push('  • .java file and test cases submitted.');

  lines.push('');
  if (!r.header.present) lines.push(`Header: missing (−${s.headerDeduction})`);
  else if (r.header.blank.length) lines.push(`Header: fill in ${r.header.blank.join(', ')} (−${s.headerDeduction})`);
  else lines.push('Header: complete');
  if (r.header.present && r.header.belowImports) lines.push('  • Your header is below the import lines; move it to the very top of the file.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function squash(t) { return String(t).replace(/\s+/g, ''); }

/**
 * Number of differently numbered "TEST CASE n:" labels written in comments
 * (strings in the code don't count, so printing "TEST CASE 1" earns nothing).
 */
function countCommentTestCases(texts) {
  const nums = new Set();
  for (const t of texts) {
    for (const m of commentText(t || '').matchAll(/TEST\s*CASE\s*#?\s*(\d+)\s*:/gi)) nums.add(Number(m[1]));
  }
  return nums.size;
}

function commentText(src) {
  const { noComments } = scanSource(src);
  // characters that were blanked out are the comments
  let out = '';
  for (let i = 0; i < src.length; i++) out += noComments[i] === src[i] ? (src[i] === '\n' ? '\n' : ' ') : src[i];
  return out;
}

/** Turns a javac error in the grader's test class into something a student can act on. */
function firstCompileError(messages, driverName) {
  const lines = messages.split('\n');
  const i = lines.findIndex((l) => /error:/.test(l));
  if (i === -1) return 'The grader could not call your code the way the assignment describes.';
  const msg = lines[i].replace(/^.*?error:\s*/, '');
  const sym = lines.slice(i, i + 6).join('\n').match(/symbol:\s+(.*)/);
  const loc = lines.slice(i, i + 6).join('\n').match(/location:\s+(?:class|variable \w+ of type)\s+(\w+)/);
  if (sym) return `Could not use ${sym[1].trim()}${loc && loc[1] !== driverName ? ` in ${loc[1]}` : ''} — check the name and parameters match the assignment.`;
  // The Eclipse compiler words the same problems differently.
  const ecj = msg.match(/^The (method|constructor) (.+?) is undefined(?: for the type (\w+))?/)
    || msg.match(/^()(\w+) cannot be resolved (to a type|to a variable|or is not a field)/);
  if (ecj) {
    const kind = ecj[1] || (/type/.test(ecj[3]) ? 'class' : 'variable');
    const what = `${kind} ${ecj[2].replace(/,\s+/g, ',')}`;
    const where = ecj[1] && ecj[3] && ecj[3] !== driverName ? ` in ${ecj[3]}` : '';
    return `Could not use ${what}${where} — check the name and parameters match the assignment.`;
  }
  return `The grader could not call your code the way the assignment describes: ${msg}`;
}

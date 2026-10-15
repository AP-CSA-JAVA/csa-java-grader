// =====================================================================
// spec-helpers.js — building blocks for assignment test specs.
// Specs live in /specs and import what they need from here.
// =====================================================================

import { loose, countOccurrences, unescapeJava } from './java-text.js';

export { loose, countOccurrences };

/**
 * One pass/fail line shown to you and the student.
 * Checks that share a `group` are one problem: if several fail, it counts once
 * (e.g. a code check and a test run that catch the same bug), and the
 * correction sheet lists it once.
 * `hint` (optional) tells the student where to look when the check fails,
 * e.g. 'See the TO-DO about converting the angle: Math.sin() needs radians.'
 * The 4th argument can also be an object: check(label, pass, detail, { group, hint }).
 */
export function check(label, pass, detail = '', group = null, hint = '') {
  if (group && typeof group === 'object') ({ group = null, hint = '' } = group);
  const c = { label, pass: !!pass, detail };
  if (group) c.group = group;
  if (hint) c.hint = hint;
  return c;
}

/** Adds a hint (and optionally a group) to an existing check: hinted(finishedNormally(r), 'See …'). */
export function hinted(c, hint, group = null) {
  return { ...c, ...(hint ? { hint } : {}), ...(group ? { group } : {}) };
}

/**
 * A value as a student should read it: long decimals rounded to 3 places,
 * and NaN / Infinity explained.
 */
export function readable(v) {
  const s = String(v ?? '').trim();
  if (s === 'NaN') return 'NaN ("not a number": usually Math.sqrt() of a negative number, or 0.0 / 0.0)';
  if (/^-?Infinity$/.test(s)) return `${s} (a number divided by zero)`;
  if (/^-?\d+\.\d{4,}(?:E-?\d+)?$/i.test(s)) {
    const n = Number(s);
    return String(Math.round(n * 1000) / 1000);
  }
  return s;
}

/** Repeats text n times: repeat('Q\nyes\n', 3) */
export function repeat(text, n) {
  return Array.from({ length: n }, () => text).join('');
}

/**
 * Did the program end on its own without crashing?
 * Turns harness statuses into messages a student can act on.
 */
export function finishedNormally(result, label = 'Program finishes without crashing') {
  const s = result.status;
  if (s === 'ok') return check(label, true);
  if (s === 'exit') return check(label, true, 'Ended with System.exit() — works, but letting main finish is cleaner.');
  if (s === 'timeout') return check(label, false, 'Did not finish in time — possible infinite loop.');
  if (s === 'outputLimit') return check(label, false, 'Printed far too much output — probably an infinite loop.');
  if (s === 'noMain') return check(label, false, result.exception);
  if (s === 'driverCompile') return check(label, false, result.exception);

  const ex = result.exception || '';
  const at = result.where ? ` (at ${result.where.replace(/^.*\(|\)$/g, '')})` : '';
  if (/NoSuchElementException/.test(ex)) {
    return check(label, false, `Kept asking for input after the test answers ran out${at}. Does the loop stop when the user is done?`);
  }
  if (/ArrayIndexOutOfBoundsException|IndexOutOfBoundsException/.test(ex)) {
    return check(label, false, `Used an index outside the array${at}: ${ex.replace(/^java\.lang\./, '')}`);
  }
  if (/InputMismatchException/.test(ex)) {
    return check(label, false, `Read the wrong type of input${at} — e.g. nextInt() where the user typed text.`);
  }
  return check(label, false, `Crashed${at}: ${ex.replace(/^java\.(lang|util)\./, '')}`);
}

/** All string literals in a piece of code, unescaped. */
export function stringLiterals(code) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(code))) out.push(unescapeJava(m[1]));
  return out;
}

/**
 * The strings a student put in a String array, e.g. their 8-Ball responses.
 * Handles  String[] a = {...};   String a[] = {...};   new String[] {...}
 * and element-by-element  a[0] = "...";
 */
export function stringArrayValues(code, arrayName = null) {
  const name = arrayName ? arrayName.replace(/\W/g, '') : '[A-Za-z_$][\\w$]*';
  const init = new RegExp(`String\\s*(?:\\[\\s*\\])?\\s*(${name})\\s*(?:\\[\\s*\\])?\\s*=\\s*(?:new\\s+String\\s*\\[\\s*\\]\\s*)?\\{([\\s\\S]*?)\\}\\s*;`);
  const m = code.match(init);
  if (m) return { name: m[1], values: stringLiterals(m[2]) };

  const elem = new RegExp(`\\b(${name})\\s*\\[\\s*\\d+\\s*\\]\\s*=\\s*"((?:[^"\\\\\\n]|\\\\.)*)"`, 'g');
  const values = [];
  let arr = null;
  let e;
  while ((e = elem.exec(code))) { arr = arr || e[1]; values.push(unescapeJava(e[2])); }
  return values.length ? { name: arr, values } : { name: null, values: [] };
}

/** Variable names declared with a given type: declaredAs(code, 'Scanner') -> ['input'] */
export function declaredAs(code, type) {
  const re = new RegExp(`\\b${type}\\s+([A-Za-z_$][\\w$]*)\\s*=`, 'g');
  const names = [];
  let m;
  while ((m = re.exec(code))) names.push(m[1]);
  // Newer Java: `var input = new Scanner(...)` (and `var s = "..."` for String)
  const base = /^[A-Za-z_$][\w$]*$/.test(type) ? type : null;
  if (base) {
    const varRe = new RegExp(`\\bvar\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:new\\s+${base}\\b${base === 'String' ? '|"' : ''})`, 'g');
    while ((m = varRe.exec(code))) if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Does code import a class, directly or with a wildcard? */
export function imports(code, fullName) {
  const pkg = fullName.slice(0, fullName.lastIndexOf('.'));
  const esc = (s) => s.replace(/\./g, '\\.');
  return new RegExp(`^\\s*import\\s+(?:${esc(fullName)}|${esc(pkg)}\\.\\*)\\s*;`, 'm').test(code)
      || new RegExp(`\\b${esc(fullName)}\\b`).test(code);   // fully qualified use
}

/**
 * How many times each of `phrases` appears in the program output
 * (case, punctuation and curly quotes ignored).
 */
export function phraseCounts(stdout, phrases) {
  const text = loose(stdout);
  return phrases.map((p) => {
    const needle = loose(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!needle) return { phrase: p, count: 0 };
    const re = new RegExp(`(?<![a-z0-9'])${needle}(?![a-z0-9'])`, 'g');
    return { phrase: p, count: (text.match(re) || []).length };
  });
}

// ---------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------

/** Collapses runs of spaces/tabs so spacing differences don't matter. */
export function squish(s) {
  return String(s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

/** True if `needle` appears in the output, ignoring spacing (and case if asked). */
export function outputHas(stdout, needle, { ignoreCase = false } = {}) {
  let a = squish(stdout);
  let b = squish(needle);
  if (ignoreCase) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a.includes(b);
}

/** Every number printed, in order: numbersIn('a 1.5 b -2') -> [1.5, -2] */
export function numbersIn(text) {
  return (String(text ?? '').replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(?:\.\d+)?(?:E-?\d+)?/gi) || []).map(Number);
}

/** True if some printed number is within `tol` of value. */
export function hasNumber(text, value, tol = 0.005) {
  return numbersIn(text).some((n) => Math.abs(n - value) <= tol);
}

/** Lines of output, trimmed, blank lines removed. */
export function outputLines(stdout) {
  return String(stdout ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Do these patterns appear in this order in the output? Returns the first missing one, or null. */
export function missingInOrder(stdout, patterns) {
  const text = squish(stdout);
  let pos = 0;
  for (const p of patterns) {
    if (p instanceof RegExp) {
      const m = text.slice(pos).match(p);
      if (!m) return String(p);
      pos += m.index + m[0].length;
    } else {
      const i = text.indexOf(squish(p), pos);
      if (i === -1) return p;
      pos = i + squish(p).length;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Code helpers
// ---------------------------------------------------------------------

/** Body of the first method whose header matches `nameOrRe` (e.g. 'toString'), or ''. */
export function methodBody(code, nameOrRe) {
  const re = nameOrRe instanceof RegExp ? nameOrRe : new RegExp(`\\b${nameOrRe}\\s*\\([^)]*\\)\\s*(?:throws[\\w\\s,.]+)?\\{`);
  const m = code.match(re);
  if (!m) return '';
  let depth = 0;
  const start = m.index + m[0].length - 1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(start + 1, i); }
  }
  return code.slice(start + 1);
}

/** Does the code call a method by name? calls(code, 'nextInt') */
export function calls(code, name) {
  return new RegExp(`\\b${name}\\s*\\(`).test(code);
}

/** Number of constructors written for a class. */
export function constructorCount(classCode, cls) {
  return (classCode.match(new RegExp(`\\b(?:public|private|protected)?\\s*${cls}\\s*\\([^)]*\\)\\s*\\{`, 'g')) || [])
    .filter((m) => !/\bnew\s/.test(m)).length;
}

/** Does toString() return text (instead of printing it)? */
export function toStringReturns(classCode) {
  const body = methodBody(classCode, /public\s+String\s+toString\s*\(\s*\)\s*\{/);
  return !!body && /\breturn\b/.test(body) && !/System\s*\.\s*out/.test(body);
}

/** Private instance variables declared in a class: { name: type } */
export function privateFields(classCode) {
  const out = {};
  const re = /\bprivate\s+(?:final\s+)?([\w<>[\]]+)\s+(\w+)\s*(?:=[^;]*)?;/g;
  let m;
  while ((m = re.exec(classCode))) out[m[2]] = m[1];
  return out;
}

// ---------------------------------------------------------------------
// Grader test classes ("drivers")
// A driver is a small Java class the grader compiles next to the
// student's code so it can call constructors and methods directly.
// Inside the body:
//   T("key", () -> { ... });          runs a step; a crash is reported as key.error
//   out("key", value);                 records a value for the spec to check
//   String s = capture(() -> obj.printOrder());   what a method printed
//   Object v = field(obj, "itemName");            reads a private field
// ---------------------------------------------------------------------

export function driver(className, body) {
  return {
    className,
    source: `public class ${className} {
    static final java.io.PrintStream REAL = System.out;
    interface Step { void run() throws Throwable; }
    static void out(String key, Object value) {
        REAL.println("@@" + key + "=" + String.valueOf(value).replace("\\\\", "\\\\\\\\").replace("\\n", "\\\\n").replace("\\r", ""));
    }
    static void T(String key, Step s) {
        try { s.run(); } catch (Throwable t) {
            Throwable c = (t instanceof java.lang.reflect.InvocationTargetException && t.getCause() != null) ? t.getCause() : t;
            out(key + ".error", c.toString());
        }
    }
    static String capture(Step s) throws Throwable {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        System.setOut(new java.io.PrintStream(b, true, "UTF-8"));
        try { s.run(); } finally { System.setOut(REAL); }
        return b.toString("UTF-8");
    }
    static Object field(Object o, String name) throws Exception {
        Class<?> c = o.getClass();
        while (c != null) {
            try {
                java.lang.reflect.Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(o);
            } catch (NoSuchFieldException e) { c = c.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }
    /** Calls a method by name with reflection (so a missing method fails one step, not the whole test). */
    static Object call(Object o, String name, Object... a) throws Throwable {
        for (java.lang.reflect.Method m : o.getClass().getMethods()) {
            if (m.getName().equals(name) && m.getParameterTypes().length == a.length) {
                try { return m.invoke(o, a); }
                catch (java.lang.reflect.InvocationTargetException e) { throw e.getCause(); }
                catch (IllegalArgumentException e) { /* try the next overload */ }
            }
        }
        throw new NoSuchMethodException(name + " with " + a.length + " parameter(s)");
    }
    /** Runs every public no-parameter void method a class declares (e.g. a calculate() step). */
    static void runVoidMethods(Object o) throws Throwable {
        for (java.lang.reflect.Method m : o.getClass().getDeclaredMethods()) {
            if (java.lang.reflect.Modifier.isPublic(m.getModifiers()) && !java.lang.reflect.Modifier.isStatic(m.getModifiers())
                    && m.getParameterTypes().length == 0 && m.getReturnType() == void.class
                    && !m.getName().toLowerCase().startsWith("print") && !m.getName().toLowerCase().startsWith("display")) {
                capture(() -> m.invoke(o));
            }
        }
    }
    /** new ClassName(args...) by reflection, matching parameter count and simple types. */
    static Object make(String cls, Object... a) throws Throwable {
        for (java.lang.reflect.Constructor<?> c : Class.forName(cls).getConstructors()) {
            if (c.getParameterTypes().length == a.length) {
                try { return c.newInstance(a); }
                catch (java.lang.reflect.InvocationTargetException e) { throw e.getCause(); }
                catch (IllegalArgumentException e) { /* try the next constructor */ }
            }
        }
        throw new NoSuchMethodException("constructor " + cls + " with " + a.length + " parameter(s)");
    }
    public static void main(String[] args) throws Throwable {
${body}
    }
}
`,
  };
}

/** Values a driver recorded with out(): { key: value } (escapes undone). */
export function driverValues(stdout) {
  const map = {};
  for (const line of String(stdout ?? '').split('\n')) {
    const m = line.match(/^@@([^=]+)=(.*)$/);
    if (m) map[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  return map;
}

/** Java string literal for a JS string. */
export function jstr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** A check built from a driver value: did key equal expected (spacing-insensitive)? */
export function driverCheck(values, key, expected, label, { ignoreCase = false, tol = null, group = null, hint = '' } = {}) {
  const opts = { group, hint };
  if (values[`${key}.error`]) return check(label, false, `Crashed: ${values[`${key}.error`]}`, opts);
  const got = values[key];
  if (got === undefined) return check(label, false, 'Not reached — an earlier step failed.', opts);
  let ok;
  if (tol !== null) ok = Math.abs(Number(got) - Number(expected)) <= tol;
  else ok = ignoreCase ? squish(got).toLowerCase() === squish(expected).toLowerCase() : squish(got) === squish(expected);
  if (ok) return check(label, true, '', opts);
  const detail = tol !== null
    ? `Expected about ${readable(Number(expected).toFixed(6))}, got ${readable(got)}`
    : `Expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(got)}`;
  return check(label, false, detail, opts);
}

// ---------------------------------------------------------------------
// Typing answers in the order a program asks for them
// ---------------------------------------------------------------------

/**
 * Builds keyboard input that matches the order a program reads it.
 * Looks at each Scanner read (nextLine, next, nextInt, nextDouble,
 * nextBoolean) in the order it appears in the code and types a value of
 * the right type. `values` supplies what to type per read kind, as lists
 * used in order: { line: ['Jordan Smith'], int: ['17'], double: ['3.75'], ... }.
 * A nextLine() right after a number read just consumes the leftover
 * newline (no extra line typed), exactly like a real Scanner.
 */
export function scriptedInput(code, values = {}) {
  const pools = {
    line: [...(values.line || ['Jordan Smith', 'Alex Rivera', 'Sam Lee'])],
    word: [...(values.word || ['Jordan', 'Alex', 'Sam'])],
    int: [...(values.int || ['17', '42', '8'])],
    double: [...(values.double || ['3.75', '12.5', '2.25'])],
    boolean: [...(values.boolean || ['true', 'false'])],
  };
  const take = (k) => (pools[k].length > 1 ? pools[k].shift() : pools[k][0]);
  const kindOf = { nextLine: 'line', next: 'word', nextInt: 'int', nextDouble: 'double', nextBoolean: 'boolean', nextLong: 'int', nextFloat: 'double' };
  const reads = [...code.matchAll(/\.\s*(nextLine|nextInt|nextDouble|nextBoolean|nextLong|nextFloat|next)\s*\(\s*\)/g)].map((m) => m[1]);
  const lines = [];
  let pending = false;                      // rest of the current line not consumed yet
  for (const r of reads) {
    if (r === 'nextLine') {
      if (pending) { pending = false; continue; }   // eats the leftover newline
      lines.push(take('line'));
    } else {
      if (pending && r === 'next') { /* reads next token on a new line anyway */ }
      lines.push(take(kindOf[r]));
      pending = true;
    }
  }
  return { input: lines.join('\n') + '\n', reads, typed: lines };
}

/** Argument counts of every `new Cls(...)` call: newArgCounts(code, 'Order') -> [0, 1, 2, 4] */
export function newArgCounts(code, cls) {
  const out = [];
  const re = new RegExp(`\\bnew\\s+${cls}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let commas = 0;
    let any = false;
    let inStr = false;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = c; any = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 1) commas++;
      else if (!/\s/.test(c)) any = true;
    }
    out.push(any ? commas + 1 : 0);
  }
  return out;
}

/** Text of all comments in the student's files (lowercased helpers do the rest). */
export function commentsMention(ctx, ...words) {
  const c = ctx.comments.toLowerCase();
  return words.every((w) => (w instanceof RegExp ? w.test(c) : c.includes(w.toLowerCase())));
}

/** A reminder for something only the teacher can judge (not scored). */
export function review(label, detail = 'Check this by hand.') {
  return { label, pass: null, detail };
}

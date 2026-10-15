// =====================================================================
// newer-java.js — names the Java features newer than Java 8 in a program.
//
// The course is graded as Java 8. A program that only compiles as Java 17
// is still graded (no penalty), but the grader lists what it used so the
// student knows what to change for class, and you can see it at a glance.
// Students often pick these up from Java competitions, tutorials or AI.
//
// Patterns run on the code with comments and string contents blanked out,
// so words inside strings or comments don't count.
// =====================================================================

import { scanSource } from './java-text.js';

const FEATURES = [
  { name: 'var for local variables', since: 10, re: /\bvar\s+[A-Za-z_$][\w$]*\s*[=:]/g,
    fix: 'write the type instead (int count = 10, not var count = 10)' },
  { name: 'List.of / Set.of / Map.of', since: 9, re: /\b(?:List|Set|Map)\s*\.\s*(?:of|ofEntries|copyOf)\s*\(/g,
    fix: 'build the list with new ArrayList<>() and add(), or Arrays.asList(...)' },
  { name: 'String isBlank / strip / repeat / lines', since: 11, re: /\.\s*(?:isBlank|strip|stripLeading|stripTrailing|repeat|lines)\s*\(\s*\S?/g,
    fix: 'use trim().isEmpty(), trim(), or a loop to repeat text' },
  { name: 'String.formatted(...)', since: 15, re: /\.\s*formatted\s*\(/g,
    fix: 'use String.format(...) instead' },
  { name: 'Switch arrows (case ... ->)', since: 14, re: /\b(?:case\b[^:;{}\n]*|default\s*)->/g,
    fix: 'use case ...: with break' },
  { name: 'yield in a switch', since: 14, re: /(?:^|[;{}]\s*)yield\s+[^\s=;(.]/gm,
    fix: 'set a variable in each case, then break' },
  { name: 'Text block ("""...""")', since: 15, re: /"""/g, onText: true,
    fix: 'join normal strings with + and "\\n"' },
  { name: 'record classes', since: 16, re: /\brecord\s+[A-Z][\w$]*\s*[(<]/g,
    fix: 'write a class with private fields, a constructor and getters' },
  { name: 'Pattern matching with instanceof', since: 16, re: /\binstanceof\s+(?:final\s+)?[A-Z][\w$.]*(?:<[^>]*>)?(?:\[\])*\s+[a-z_$][\w$]*/g,
    fix: 'check instanceof, then cast: String s = (String) o;' },
  { name: 'Stream .toList()', since: 16, re: /\.\s*toList\s*\(\s*\)/g,
    fix: 'use .collect(Collectors.toList())' },
  { name: 'sealed / permits classes', since: 17, re: /\b(?:sealed\s+(?:abstract\s+)?(?:class|interface)|non-sealed|permits)\b/g,
    fix: 'remove sealed and permits' },
  { name: 'Several labels in one case (case 1, 2:)', since: 14, re: /\bcase\s+[^:;{}\n]*?,[^:;{}\n]*?(?::|->)/g,
    fix: 'write each label on its own line: case 1: case 2:' },
  { name: 'Files.readString / Path.of', since: 11, re: /\b(?:Files\s*\.\s*(?:readString|writeString)|Path\s*\.\s*of)\s*\(/g,
    fix: 'read the file with a Scanner, and use Paths.get(...)' },
  { name: 'getFirst / getLast / reversed on a list', since: 21, re: /\.\s*(?:getFirst|getLast|removeFirst|removeLast|reversed)\s*\(\s*\)/g,
    fix: 'use list.get(0) and list.get(list.size() - 1)' },
  { name: 'Math.clamp / StringBuilder.repeat', since: 21, re: /\bMath\s*\.\s*clamp\s*\(|\bnew\s+StringBuilder\s*\([^)]*\)\s*\.\s*repeat\s*\(/g,
    fix: 'use Math.max(low, Math.min(high, x)), or a loop to repeat text' },
  { name: 'Pattern matching in switch', since: 21, re: /\bcase\s+[A-Z][\w$]*(?:<[^>]*>)?\s+[a-z_$][\w$]*\s*(?:->|:|when\b)/g,
    fix: 'use if / else with instanceof and a cast' },
];

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++;
  return n;
}

/**
 * @param sources [{ fileName, text }]
 * @returns [{ name, since, fix, where: [{ file, line }], count }] — newest first
 */
export function detectNewerJava(sources) {
  const found = new Map();
  for (const { fileName, text } of sources) {
    const scan = scanSource(text);
    for (const f of FEATURES) {
      const hay = f.onText ? scan.noComments : scan.codeOnly;
      f.re.lastIndex = 0;
      let m;
      while ((m = f.re.exec(hay))) {
        if (!found.has(f.name)) found.set(f.name, { name: f.name, since: f.since, fix: f.fix, where: [], count: 0 });
        const e = found.get(f.name);
        const line = lineOf(hay, m.index + (m[0].length - m[0].trimStart().length));
        if (!e.where.some((w) => w.file === fileName && w.line === line)) {
          e.where.push({ file: fileName, line });
          e.count++;
        }
        if (f.onText) f.re.lastIndex = hay.indexOf('"""', m.index + 3) + 3 || hay.length;   // skip to after the closing """
      }
    }
  }
  return [...found.values()].sort((a, b) => b.since - a.since || a.name.localeCompare(b.name));
}

/** One line for feedback, e.g. "var (Java 10) line 3; record (Java 16) lines 5, 9" */
export function newerJavaSummary(features, max = 4) {
  return features.slice(0, max).map((f) => {
    const lines = [...new Set(f.where.map((w) => w.line))];
    return `${f.name} (Java ${f.since}) line${lines.length === 1 ? '' : 's'} ${lines.slice(0, 4).join(', ')}${lines.length > 4 ? ', ...' : ''}`;
  }).join('; ') + (features.length > max ? `; and ${features.length - max} more` : '');
}

/** "For class, <fix>." with a single period at the end. */
export function forClass(fix) {
  return `For class, ${fix}${/[.;!?]$/.test(fix) ? '' : '.'}`;
}

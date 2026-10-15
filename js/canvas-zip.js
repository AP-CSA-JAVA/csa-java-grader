// =====================================================================
// canvas-zip.js — turns a Canvas "Download Submissions" zip into
// one entry per student.
//
// Canvas names files like:
//   smithjordan_123456_7890123_Main.java
//   smithjordan_LATE_123456_7890123_Main-1.java   (resubmitted / late)
// A student's own .zip inside the Canvas zip is opened too.
// =====================================================================

const CANVAS_NAME = /^([^_/]+?)(_late)?_(\d+)_(\d+)_(.+)$/i;
const TEXT_EXT = new Set(['java', 'txt', 'md']);

/**
 * @param {ArrayBuffer|Blob} data  the Canvas zip
 * @param {typeof JSZip} JSZipLib
 * @returns {Promise<Student[]>}
 *   Student = { key, name, late, files: File[] }
 *   File    = { name, ext, size, text|null, fromCanvas: string }
 */
export async function readCanvasZip(data, JSZipLib) {
  const zip = await JSZipLib.loadAsync(data);
  const students = new Map();
  const entries = Object.values(zip.files).filter((e) => !e.dir && !isJunk(e.name));

  for (const entry of entries) {
    const base = entry.name.split('/').pop();
    const m = base.match(CANVAS_NAME);
    let key;
    let name;
    let late = false;
    let original;

    if (m) {
      key = m[3];                              // Canvas user id
      name = prettyName(m[1]);
      late = !!m[2];
      original = m[5];
    } else {
      // Not Canvas-named: group by top folder, or treat as one student.
      const parts = entry.name.split('/');
      key = parts.length > 1 ? parts[0] : 'student';
      name = parts.length > 1 ? parts[0] : 'Student';
      original = base;
    }

    if (!students.has(key)) students.set(key, { key, name, late, files: [] });
    const student = students.get(key);
    student.late = student.late || late;

    if (/\.zip$/i.test(original)) {
      // a student zipped their project folder
      const inner = await JSZipLib.loadAsync(await entry.async('arraybuffer'));
      for (const ie of Object.values(inner.files)) {
        if (ie.dir || isJunk(ie.name)) continue;
        student.files.push(await toFile(ie, ie.name.split('/').pop(), base));
      }
    } else {
      student.files.push(await toFile(entry, original, base));
    }
  }

  const list = [...students.values()];
  for (const s of list) s.files = dedupeResubmissions(s.files);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

async function toFile(entry, original, fromCanvas) {
  const name = original;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isText = TEXT_EXT.has(ext);
  const text = isText ? await entry.async('string') : null;
  const size = entry._data?.uncompressedSize ?? (text ? text.length : 0);
  return { name, ext, size, text, fromCanvas };
}

/**
 * Canvas adds "-1", "-2" to a resubmitted file (Main-1.java).
 * Keep the highest-numbered copy of each .java file; other files are kept as-is.
 */
function dedupeResubmissions(files) {
  const best = new Map();
  const others = [];
  for (const f of files) {
    if (f.ext !== 'java') { others.push(f); continue; }   // only .java names matter to javac
    const m = f.name.match(/^(.*?)(?:-(\d+))?(\.[^.]+)$/);
    const stem = m ? m[1] + m[3] : f.name;
    const ver = m && m[2] ? parseInt(m[2], 10) : 0;
    const prev = best.get(stem.toLowerCase());
    if (!prev || ver >= prev.ver) best.set(stem.toLowerCase(), { ver, file: { ...f, cleanName: stem } });
  }
  return [...[...best.values()].map((b) => b.file), ...others];
}

function isJunk(path) {
  return /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git|\.vscode|\.idea)(\/|$)/.test(path)
      || /(^|\/)\._/.test(path)
      || /\.class$/i.test(path);
}

/** "smithjordan" -> "Smithjordan"; Canvas joins last+first with no separator. */
function prettyName(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

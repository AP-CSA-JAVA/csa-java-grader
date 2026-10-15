// =====================================================================
// assignment-name.js — a name for "Any assignment" output.
// With a real assignment picked, its number and title are used. With
// "Any assignment", the name comes from the zip you dropped (e.g.
// "Race Car.zip" -> "Race Car"). If the zip still has Canvas's default
// name ("submissions.zip"), it uses the Assignment line most students
// wrote in their header.
// =====================================================================

const GENERIC_ZIP = /^(submissions?|download|archive|canvas)?[\s_()\d-]*$/i;

/** "Race Car.zip" -> "Race Car"; null for Canvas's default name. */
function nameFromZip(zipName) {
  const base = String(zipName || '').replace(/\.zip$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base && !GENERIC_ZIP.test(base) ? base : null;
}

/** The Assignment header value most students agree on, or null. */
function nameFromHeaders(results) {
  const counts = new Map();
  let headers = 0;
  for (const r of results) {
    const v = r?.header?.fields?.find((f) => f.key === 'assignment' && f.filled)?.value;
    if (!v) continue;
    headers++;
    const key = v.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
    const c = counts.get(key) || { n: 0, text: v.trim() };
    c.n++;
    counts.set(key, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= 2 && best.n >= headers * 0.3 ? best.text : null;
}

/**
 * The spec to use for titles and file names. For "Any assignment" it is a
 * copy with displayTitle set when a name can be found.
 */
export function outputSpec(spec, results = [], zipName = '') {
  if (!spec || spec.id !== 'general') return spec;
  const list = results instanceof Map ? [...results.values()] : results;
  const name = nameFromZip(zipName) || nameFromHeaders(list);
  return name ? { ...spec, displayTitle: name } : spec;
}

/** "1.11.2 - Race Car", "Race Car" (from the zip), or "Any assignment". */
export function specTitle(spec, sep = ' - ') {
  if (spec.displayTitle) return spec.displayTitle;
  return spec.id === 'general' ? 'Any assignment' : `${spec.id}${sep}${spec.title}`;
}

/** Safe file-name part: "1.11.2" or "Race-Car". */
export function specSlug(spec) {
  return String(spec.displayTitle || spec.id).replace(/[^\w.]+/g, '-').replace(/^-+|-+$/g, '') || 'assignment';
}

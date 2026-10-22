// =====================================================================
// email.js — "Email students": sends each student their feedback and
// correction sheet through YOUR Google Apps Script mailer.
//
// The page can't send email by itself, so it hands each message to a small
// Apps Script web app that runs under your school Google account
// (apps-script/Mailer.gs; setup steps in EMAIL-SETUP.md).
//
// Nothing private lives in this public repo:
//   • the mailer URL is typed in once and kept in this browser
//   • the mailer key is typed in each session and never saved to disk
//   • the roster (Canvas ID -> email) is loaded from a Canvas gradebook
//     export and kept in this browser only
//
// Safeguards: test mode (on by default, sends to you), a preview of every
// address before anything is sent, roster/name checks, and a sent log on
// both sides so a student never gets the same email twice by accident.
// =====================================================================

import { CONFIG } from './config.js';

const ROSTER_KEY = 'grader:roster';
const URL_KEY = 'grader:mailerUrl';
const KEY_KEY = 'grader:mailerKey';          // sessionStorage only
const SENT_PREFIX = 'grader:sent:';

const E = CONFIG.email;

/**
 * @param {object} app
 *   getStudents(), getResult(key), getFinal(key), outSpec(),
 *   feedbackText(r, spec, final), studentPdf(r, spec) -> jsPDF doc,
 *   sheetFileName(r, spec), specSlug(spec), specTitle(spec), escapeHtml(s)
 */
export function initEmail(app) {
  const $ = (id) => document.getElementById(id);
  const dlg = $('emailDialog');
  const els = {
    open: $('emailBtn'), url: $('mailerUrl'), key: $('mailerKey'), ping: $('mailerPing'), pingText: $('mailerPingText'),
    rosterText: $('rosterText'), rosterBtn: $('rosterBtn'), rosterInput: $('rosterInput'), rosterClear: $('rosterClear'),
    test: $('emailTest'), attach: $('emailAttach'), body: $('emailBody'), all: $('emailAll'),
    count: $('emailCount'), send: $('emailSend'), stop: $('emailStop'), close: $('emailClose'), note: $('emailNote'),
  };
  const esc = app.escapeHtml;
  let sending = false;
  let stopAsked = false;

  els.url.value = localGet(URL_KEY) || E.mailerUrl || '';
  els.key.value = sessionGet(KEY_KEY) || '';
  els.url.addEventListener('change', () => { localSet(URL_KEY, els.url.value.trim()); });
  els.key.addEventListener('change', () => { sessionSet(KEY_KEY, els.key.value); });

  els.open.addEventListener('click', () => {
    els.test.checked = true;                  // every time: a real send is a deliberate choice
    els.note.textContent = '';
    showRoster();
    renderRows();
    dlg.showModal();
  });
  els.close.addEventListener('click', () => { if (!sending) dlg.close(); });
  dlg.addEventListener('cancel', (e) => { if (sending) e.preventDefault(); });
  els.test.addEventListener('change', updateCount);
  els.all.addEventListener('change', () => {
    for (const cb of els.body.querySelectorAll('input[type=checkbox]:not(:disabled)')) cb.checked = els.all.checked;
    updateCount();
  });
  els.stop.addEventListener('click', () => { stopAsked = true; els.stop.disabled = true; });

  // ---------------- Roster ----------------
  els.rosterBtn.addEventListener('click', () => els.rosterInput.click());
  els.rosterInput.addEventListener('change', async () => {
    const f = els.rosterInput.files[0];
    els.rosterInput.value = '';
    if (!f) return;
    try {
      const roster = parseRoster(await f.text(), f.name);
      localSetJSON(ROSTER_KEY, roster);
      els.note.textContent = '';
    } catch (err) {
      els.note.textContent = err.message;
    }
    showRoster();
    renderRows();
  });
  els.rosterClear.addEventListener('click', () => {
    localRemove(ROSTER_KEY);
    showRoster();
    renderRows();
  });

  function showRoster() {
    const r = localGetJSON(ROSTER_KEY);
    els.rosterText.textContent = r
      ? `${Object.keys(r.rows).length} students from ${r.source}, loaded ${new Date(r.loadedAt).toLocaleDateString()}`
      : 'No roster yet. Canvas → Grades → Export → CSV, then load it here.';
    els.rosterClear.hidden = !r;
  }

  // ---------------- Connection test ----------------
  els.ping.addEventListener('click', async () => {
    els.pingText.textContent = 'Checking…';
    try {
      const res = await post({ action: 'ping' });
      els.pingText.textContent = `Connected. Sends from ${res.from} · ${res.quota} emails left today`;
    } catch (err) {
      els.pingText.textContent = err.message;
    }
  });

  // ---------------- Preview table ----------------
  function rowsData() {
    const roster = localGetJSON(ROSTER_KEY);
    const spec = app.outSpec();
    const sent = sentLog(spec);
    return app.getStudents().map((st) => {
      const r = app.getResult(st.key);
      const entry = roster?.rows[st.key];
      const d = { st, r, entry, sentAt: sent[st.key]?.at || null, problem: '', warn: '' };
      if (!r) d.problem = 'Not graded';
      else if (!r.scores) d.problem = 'Marked CHECK';
      else if (!roster) d.problem = 'Load a roster';
      else if (!entry) d.problem = 'Not on roster';
      else if (!entry.email) d.problem = 'No email on roster';
      else if (!emailAllowed(entry.email)) d.problem = `Not an @${E.domain} address`;
      else if (!sameName(st.name, entry.keys)) d.warn = 'Roster name differs';
      if (r?.scores) {
        const s = r.scores;
        const fin = app.getFinal(st.key);
        d.score = s.mode === 'points' ? `${fin ?? s.points}/${s.maxPoints}` : `${fin ?? s.suggested}/5`;
      }
      return d;
    });
  }

  function renderRows() {
    const data = rowsData();
    els.body.innerHTML = '';
    for (const d of data) {
      const tr = document.createElement('tr');
      tr.dataset.key = d.st.key;
      const can = !d.problem;
      const checked = can && !d.warn && !d.sentAt;
      tr.innerHTML = `<td><input type="checkbox" ${can ? '' : 'disabled'} ${checked ? 'checked' : ''} aria-label="Send to ${esc(d.st.name)}"></td>`
        + `<td class="em-name">${esc(d.st.name)}${d.entry?.name ? `<div class="muted small">${esc(d.entry.name)}</div>` : ''}</td>`
        + `<td class="em-addr">${esc(d.entry?.email || '—')}</td>`
        + `<td>${esc(d.score || '—')}</td>`
        + `<td class="em-status">${statusHtml(d)}</td>`;
      tr.querySelector('input').addEventListener('change', updateCount);
      els.body.append(tr);
    }
    els.all.checked = false;
    updateCount();
  }

  function statusHtml(d) {
    if (d.problem) return `<span class="em-bad">${esc(d.problem)}</span>`;
    if (d.warn) return `<span class="em-warn" title="Check that this is the same student before sending">${esc(d.warn)}</span>`;
    if (d.sentAt) return `<span class="muted">Sent ${esc(new Date(d.sentAt).toLocaleDateString())}</span>`;
    return '<span class="muted">Ready</span>';
  }

  function selectedKeys() {
    return [...els.body.querySelectorAll('tr')].filter((tr) => tr.querySelector('input:checked')).map((tr) => tr.dataset.key);
  }

  function updateCount() {
    const n = selectedKeys().length;
    const test = els.test.checked;
    const goes = test ? Math.min(n, E.testLimit) : n;
    els.count.textContent = test
      ? `${n} selected · test run sends the first ${goes} to you, not the students`
      : `${n} selected · sends to the students`;
    els.send.textContent = test ? `Send ${goes} test email${goes === 1 ? '' : 's'} to me` : `Send ${n} email${n === 1 ? '' : 's'} to students`;
    els.send.classList.toggle('btn-danger', !test);
    els.send.disabled = sending || !n;
  }

  function setStatus(key, html) {
    const cell = els.body.querySelector(`tr[data-key="${cssEscape(key)}"] .em-status`);
    if (cell) cell.innerHTML = html;
  }

  // ---------------- Sending ----------------
  els.send.addEventListener('click', async () => {
    const test = els.test.checked;
    let keys = selectedKeys();
    if (!keys.length) return;
    if (!els.url.value.trim() || !els.key.value) { els.note.textContent = 'Enter the mailer URL and key first (see EMAIL-SETUP.md).'; return; }
    if (test) keys = keys.slice(0, E.testLimit);
    else if (!confirm(`Send ${keys.length} email${keys.length === 1 ? '' : 's'} to students now?`)) return;

    const spec = app.outSpec();
    const roster = localGetJSON(ROSTER_KEY);
    const data = new Map(rowsData().map((d) => [d.st.key, d]));
    sending = true; stopAsked = false;
    els.stop.hidden = false; els.stop.disabled = false; els.close.disabled = true;
    updateCount();
    let ok = 0; let failed = 0; let skipped = 0;

    for (const key of keys) {
      if (stopAsked) break;
      const d = data.get(key);
      const entry = roster.rows[key];
      setStatus(key, '<span class="spinner"></span>Sending…');
      try {
        const msg = buildMessage(d.r, entry, spec, test);
        const res = await post(msg);
        if (res.status === 'duplicate') {
          skipped++;
          setStatus(key, `<span class="muted">Already sent ${esc(res.sentAt ? new Date(res.sentAt).toLocaleDateString() : '')} (skipped)</span>`);
          markSent(spec, key, entry.email, res.sentAt);
        } else if (res.status === 'test') {
          ok++;
          setStatus(key, `<span class="em-ok">Test sent to ${esc(res.to)}</span>`);
        } else {
          ok++;
          markSent(spec, key, entry.email);
          setStatus(key, '<span class="em-ok">Sent</span>');
          const cb = els.body.querySelector(`tr[data-key="${cssEscape(key)}"] input`);
          if (cb) cb.checked = false;
        }
      } catch (err) {
        failed++;
        setStatus(key, `<span class="em-bad">${esc(err.message)}</span>`);
        if (err.fatal) break;                  // wrong key / bad URL: don't keep trying
      }
    }

    sending = false;
    els.stop.hidden = true; els.close.disabled = false;
    updateCount();
    els.note.textContent = `${test ? 'Test: ' : ''}${ok} sent${skipped ? `, ${skipped} already sent before` : ''}${failed ? `, ${failed} failed` : ''}${stopAsked ? ' (stopped)' : ''}.`
      + (test && ok ? ' Check your inbox, then uncheck “Test run” to send to students.' : '');
  });

  function buildMessage(r, entry, spec, test) {
    const fin = app.getFinal(r.key);
    const s = r.scores;
    const vars = {
      first: entry.first || 'there',
      name: entry.name || r.name,
      assignment: app.specTitle(spec),
      score: s.mode === 'points' ? `${fin ?? s.points}/${s.maxPoints}` : `${fin ?? s.suggested}/5`,
    };
    const fill = (t) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    const msg = {
      action: 'send',
      test,
      assignment: app.specSlug(spec),
      canvasId: r.key,
      student: vars.name,
      to: entry.email,
      subject: fill(E.subject),
      body: `${fill(E.intro)}\n\n${app.feedbackText(r, spec, fin)}`,
    };
    if (els.attach.checked) {
      const uri = app.studentPdf(r, spec).output('datauristring');
      msg.pdfName = app.sheetFileName(r, spec).replace(/^[^_]+_(?:late_)?\d+_\d+_/i, '');
      msg.pdfBase64 = uri.slice(uri.indexOf('base64,') + 7);
    }
    return msg;
  }

  async function post(payload) {
    const url = els.url.value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      throw fatal('The mailer URL should look like https://script.google.com/macros/s/…/exec');
    }
    let res;
    try {
      // A plain-text body keeps this a "simple" request, so Apps Script needs no CORS preflight.
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ ...payload, key: els.key.value }) });
    } catch {
      throw fatal('Could not reach the mailer. Check the URL, and that the deployment allows “Anyone”.');
    }
    let json;
    try { json = await res.json(); } catch { throw fatal('The mailer did not answer with JSON. Is the URL the /exec link of the deployment?'); }
    if (!json.ok) {
      const err = new Error(json.error || 'Mailer error');
      err.fatal = !!json.fatal;
      throw err;
    }
    return json;
  }

  return { refresh: () => { if (dlg.open && !sending) renderRows(); } };
}

// ---------------------------------------------------------------------
// Roster: a Canvas gradebook export (Grades → Export → Export Current
// Gradebook View), or any CSV with an ID column and an Email column.
// ---------------------------------------------------------------------

export function parseRoster(text, source = 'roster.csv') {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('That roster file is empty.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => names.map((n) => head.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1;

  const idCol = col('ID', 'Canvas ID', 'Canvas User ID', 'User ID');
  const nameCol = col('Student', 'Name', 'Student Name');
  const emailCol = col('Email', 'Email Address', 'E-mail');
  const sisCol = col(E.idColumn);
  if (idCol < 0) throw new Error('No “ID” column found. Use Canvas → Grades → Export → Export Current Gradebook View.');
  if (emailCol < 0 && sisCol < 0) throw new Error(`No “Email” or “${E.idColumn}” column found in the roster.`);

  const out = {};
  for (const row of rows.slice(1)) {
    const id = (row[idCol] || '').trim();
    if (!/^\d+$/.test(id)) continue;            // skips Canvas's "Points Possible" row and blanks
    const name = nameCol >= 0 ? (row[nameCol] || '').trim() : '';
    let email = emailCol >= 0 ? (row[emailCol] || '').trim() : '';
    if (!email && sisCol >= 0) {
      const v = (row[sisCol] || '').trim();
      email = v.includes('@') ? v : v ? `${v}@${E.domain}` : '';
    }
    out[id] = { name: displayName(name), first: firstName(name), keys: nameKeys(name), email: email.toLowerCase() };
  }
  if (!Object.keys(out).length) throw new Error('No students found in that roster.');
  return { source, loadedAt: Date.now(), rows: out };
}

/** "Smith, Jordan" -> "Jordan Smith" */
function displayName(n) {
  const m = n.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : n;
}
function firstName(n) {
  const m = n.match(/^[^,]+,\s*(\S+)/);
  return m ? m[1] : (n.split(/\s+/)[0] || '');
}

/** Ways the roster name could appear in a Canvas file name (last+first squashed). */
function nameKeys(n) {
  const m = n.match(/^([^,]+),\s*(.+)$/);
  if (m) return [letters(m[1]) + letters(m[2])];               // "Smith, Jordan Lee" -> smithjordanlee
  const parts = n.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const keys = [];
  for (let i = 1; i < parts.length; i++) {                       // "Jordan Lee Smith": try each split
    keys.push(letters(parts.slice(i).join('')) + letters(parts.slice(0, i).join('')));
  }
  keys.push(letters(n));
  return keys;
}

/** True when the Canvas zip name ("Smithjordan") fits the roster name. No roster name: nothing to check. */
export function sameName(zipName, keys = []) {
  const z = letters(zipName);
  if (!z || !keys.length) return true;
  return keys.some((k) => k && (k === z || k.startsWith(z) || z.startsWith(k)));
}
function letters(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''); }

function emailAllowed(email) {
  return new RegExp(`^[^@\\s]+@${E.domain.replace(/\./g, '\\.')}$`, 'i').test(email);
}

function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// ---------------------------------------------------------------------
// Local sent log (the mailer keeps the real one in its Google Sheet)
// ---------------------------------------------------------------------

function sentLog(spec) { return localGetJSON(SENT_PREFIX + slugOf(spec)) || {}; }
function markSent(spec, key, to, at = null) {
  const log = sentLog(spec);
  log[key] = { to, at: at || new Date().toISOString() };
  localSetJSON(SENT_PREFIX + slugOf(spec), log);
}
function slugOf(spec) { return String(spec.displayTitle || spec.id); }

function fatal(msg) { const e = new Error(msg); e.fatal = true; return e; }
function cssEscape(s) { return window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } }
function localRemove(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
function localGetJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function localSetJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } }
function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } }

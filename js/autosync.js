// Keeps Google connected without manual imports.
// One sign-in covers Gmail, Calendar, Google Tasks and Drive; while that
// sign-in lasts (about an hour per tab), everything syncs on open, on return
// to the app and every 15 minutes.

import * as db from './db.js';
import * as google from './google.js';
import * as gcal from './gcal.js';
import * as gtasks from './gtasks.js';
import * as gmail from './gmail.js';
import * as drive from './drive.js';

const ALL = [google.SCOPES.calendar, google.SCOPES.gmail, google.SCOPES.tasks, google.SCOPES.drive];
let running = false;

export const connected = () => google.hasToken(google.SCOPES.calendar);
export async function lastRun() { return db.kvGet('autoSyncAt', null); }

export async function connect() {
  await google.signInMany(ALL);
  return run();
}

export async function run({ onlyIfStale = false } = {}) {
  if (running || !connected()) return null;
  const last = await lastRun();
  if (onlyIfStale && last && Date.now() - Date.parse(last) < 10 * 6e4) return null;
  running = true;
  const out = { events: 0, tasks: 0, jobs: 0, places: 0, errors: [] };
  try {
    try { await gcal.flushTaskEvents(); out.events = (await gcal.refreshEvents()).length; await gcal.flush(); } catch (e) { out.errors.push(`Calendar: ${e.message}`); }
    if (google.hasToken(google.SCOPES.tasks)) {
      try { out.tasks = (await gtasks.sync()).added; } catch (e) { out.errors.push(`Tasks: ${e.message}`); }
    }
    if (google.hasToken(google.SCOPES.gmail)) {
      try {
        await gmail.scan({ useAi: false });
        // clear-cut updates go straight in; unclear ones stay for review
        for (const s of await gmail.suggestions()) {
          if (s.company && s.status && !/^unknown/i.test(s.company)) { await gmail.accept(s.msgId); out.jobs++; }
        }
      } catch (e) { out.errors.push(`Gmail: ${e.message}`); }
    }
    if (google.hasToken(google.SCOPES.drive)) {
      try {
        for (const p of await drive.scan()) {
          if (!drive.existing(p)) { await drive.importPlace(p, p.travelled); out.places++; }
        }
      } catch (e) { if (!/No folder called/.test(e.message)) out.errors.push(`Drive: ${e.message}`); }
    }
    await db.kvSet('autoSyncAt', new Date().toISOString());
    await db.kvSet('autoSyncResult', out);
  } finally {
    running = false;
  }
  return out;
}

export function start(onDone) {
  const tick = async (opts) => { const r = await run(opts); if (r && onDone) onDone(r); };
  tick({ onlyIfStale: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick({ onlyIfStale: true }); });
  setInterval(() => tick({}), 15 * 6e4);
}

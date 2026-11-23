// Google Calendar, both ways.
//   Read:  upcoming events from your primary calendar, cached for offline display.
//   Write: birthdays/anniversaries (yearly) and renewal/expiry dates from the app
//          become all-day events with a reminder. Editing or deleting the item
//          updates or removes its event. Event ids are kept on the item, so other
//          devices don't create duplicates.

import * as db from './db.js';
import * as google from './google.js';
import { MODULES, MODULE, titleOf, isDone } from './schemas.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary';
// planning items that would be noise in a calendar
const SKIP_MODULES = new Set(['tasks', 'jobs', 'decisions', 'wishlist', 'goals', 'journal', 'days', 'healthlog', 'profiles']);

export async function settings() {
  return { birthdays: true, deadlines: true, ...((await db.kvGet('gcal')) || {}) };
}

function eligibleFields(module, s) {
  const m = MODULE[module];
  if (!m || SKIP_MODULES.has(module)) return [];
  return m.fields.filter((fd) => fd.type === 'date' && fd.remind !== undefined && (fd.yearly ? s.birthdays : s.deadlines));
}

export function isEligible(module) {
  return !SKIP_MODULES.has(module) && (MODULE[module]?.fields || []).some((fd) => fd.type === 'date' && fd.remind !== undefined);
}

async function api(path, opts = {}) {
  const token = google.tokenFor(google.SCOPES.calendar);
  if (!token) throw Object.assign(new Error('Not signed in'), { code: 'auth' });
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { google.expire(); throw Object.assign(new Error('Google sign-in expired'), { code: 'auth' }); }
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`Calendar error ${res.status}`);
  return res.status === 204 ? {} : res.json();
}

// ── read ───────────────────────────────────────────────────────────────
export async function refreshEvents(days = 14) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + days * 864e5);
  const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const j = await api(`/events?${q}`);
  const events = (j?.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    allDay: !e.start?.dateTime,
    link: e.htmlLink,
    location: e.location || '',
    mine: !!e.extendedProperties?.private?.lifeId,
  }));
  await db.kvSet('gcalEvents', { at: new Date().toISOString(), events });
  return events;
}

export async function cachedEvents() {
  return (await db.kvGet('gcalEvents')) || { at: null, events: [] };
}

// ── write ──────────────────────────────────────────────────────────────
const nextDay = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };

function eventBody(rec, fd) {
  const date = rec.data[fd.k];
  const name = titleOf(rec);
  const summary = fd.yearly ? `${name}'s ${fd.k === 'birthday' ? 'birthday' : fd.label.toLowerCase()}` : `${name}: ${fd.label.toLowerCase()}`;
  const remindDays = Math.min(Number(fd.remind) || 0, 28);
  const appLink = `${location.origin}${location.pathname}#/r/${rec.id}`;
  const body = {
    summary,
    description: `From your Life tracker: ${appLink}`,
    start: { date },
    end: { date: nextDay(date) },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: remindDays ? remindDays * 1440 - 9 * 60 : 0 }] },
    extendedProperties: { private: { lifeId: rec.id, lifeField: fd.k } },
  };
  if (fd.yearly) body.recurrence = ['RRULE:FREQ=YEARLY'];
  return body;
}

// Bring one item's calendar events in line with its current dates.
export async function syncRecord(id) {
  const rec = db.get(id);
  if (!rec) return false;
  const s = await settings();
  const links = { ...(rec.data.gcal || {}) };
  const fields = eligibleFields(rec.module, s);
  const gone = rec.deletedAt || isDone(rec);
  const removed = new Set(await db.kvGet('gcalRemoved', []));
  let changed = false;

  for (const fd of fields) {
    const link = links[fd.k];
    const date = rec.data[fd.k];
    const sig = `${date}|${titleOf(rec)}|${fd.remind}`;
    if (gone || !date) {
      if (link) {
        if (!removed.has(link.id)) await api(`/events/${link.id}`, { method: 'DELETE' });
        removed.add(link.id);
        await db.kvSet('gcalRemoved', [...removed].slice(-500));
        delete links[fd.k];
        changed = true;
      }
      continue;
    }
    // an undo can bring back a link to an event we already deleted: make a new one
    const live = link && !removed.has(link.id);
    if (live && link.sig === sig) continue;
    let ev = null;
    if (live) ev = await api(`/events/${link.id}`, { method: 'PUT', body: JSON.stringify(eventBody(rec, fd)) });
    if (!ev) ev = await api('/events', { method: 'POST', body: JSON.stringify(eventBody(rec, fd)) });
    links[fd.k] = { id: ev.id, sig };
    changed = true;
  }
  // a field whose category was switched off: leave its event alone, just stop tracking nothing
  if (changed) await db.update(id, { gcal: links }, { silentUndo: true });
  return changed;
}

// ── queue (items waiting for a Google sign-in) ─────────────────────────
export async function enqueue(id) {
  const q = new Set(await db.kvGet('gcalQueue', []));
  q.add(id);
  await db.kvSet('gcalQueue', [...q]);
}

export async function pending() {
  const q = await db.kvGet('gcalQueue', []);
  const out = [];
  const s = await settings();
  const removedIds = new Set(await db.kvGet('gcalRemoved', []));
  for (const id of q) {
    const rec = db.get(id);
    if (!rec) continue;
    const fields = eligibleFields(rec.module, s);
    const links = rec.data.gcal || {};
    const gone = rec.deletedAt || isDone(rec);
    const needs = fields.some((fd) => {
      const date = rec.data[fd.k];
      const link = links[fd.k];
      if (gone || !date) return !!link;
      return !link || removedIds.has(link.id) || link.sig !== `${date}|${titleOf(rec)}|${fd.remind}`;
    });
    if (needs) out.push(id);
  }
  return out;
}

let flushing = false;
export async function flush() {
  if (flushing || !google.hasToken(google.SCOPES.calendar)) return { done: 0, left: (await pending()).length };
  flushing = true;
  let done = 0;
  try {
    for (const id of await pending()) {
      try { if (await syncRecord(id)) done++; } catch (e) { if (e.code === 'auth') break; console.error(e); }
    }
    const left = await pending();
    await db.kvSet('gcalQueue', left);
    return { done, left: left.length };
  } finally {
    flushing = false;
  }
}

// Queue every existing item that should be on the calendar (first connect).
export async function queueAll() {
  const s = await settings();
  const q = new Set(await db.kvGet('gcalQueue', []));
  for (const m of MODULES) {
    if (!eligibleFields(m.id, s).length) continue;
    for (const r of db.list(m.id)) q.add(r.id);
  }
  await db.kvSet('gcalQueue', [...q]);
}


// A task with a date → an all-day event (or update the one already made).
export async function addTaskEvent(id) {
  const t = db.get(id);
  if (!t) return null;
  const date = t.data.due || new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const body = {
    summary: t.data.title,
    description: `Task from your Life tracker: ${location.origin}${location.pathname}#/r/${t.id}${t.data.notes ? `\n\n${t.data.notes}` : ''}`,
    start: { date }, end: { date: nextDay(date) },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { lifeId: t.id, lifeField: 'task' } },
  };
  let ev = null;
  if (t.data.gcalEvent?.id) ev = await api(`/events/${t.data.gcalEvent.id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!ev) ev = await api('/events', { method: 'POST', body: JSON.stringify(body) });
  await db.update(id, { gcalEvent: { id: ev.id, link: ev.htmlLink || '', date } }, { silentUndo: true });
  return ev;
}

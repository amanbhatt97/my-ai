// Ask: answer questions about your own records through your Worker (/ask).
// Only what's needed leaves the phone: sensitive modules and fields are never sent.
import * as db from './db.js';
import { MODULE, titleOf } from './schemas.js';
import * as gcal from './gcal.js';

// whole modules that never leave the device
const NEVER_MODULES = new Set(['emergency', 'medical', 'medicines', 'healthprofile', 'contacts']);
// field types / keys that never leave the device
const NEVER_TYPES = new Set(['secret4']);
const NEVER_KEYS = new Set(['details', 'scan', 'gcal', 'gtask', 'driveId', 'emails', 'durationSec', 'audio', 'blob']);
const MAX_TEXT = 600;

const QUESTION = /^(what|whats|what's|when|who|whom|whose|where|which|why|how|is|are|am|do|does|did|can|could|should|will|would|have|has|had|any|kya|kab|kaun|kahan|kitna|kitni|kitne|kaise|kyun|kis|kisne|mera|meri|mere|tell|show|list|brief|summari[sz]e|remind)\b/i;
export const isQuestion = (q) => /\?\s*$/.test(q) || QUESTION.test(q.trim());

function clean(v) {
  if (v === '' || v == null || v === false) return undefined;
  if (typeof v === 'string') return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) + '…' : v;
  if (Array.isArray(v)) return v.length ? v.slice(0, 20) : undefined;
  if (typeof v === 'object') {
    // habit logs: keep only the last 60 days of ticks as a count + recent dates
    const keys = Object.keys(v).filter((k) => v[k]).sort();
    return keys.length ? { days: keys.length, recent: keys.slice(-14) } : undefined;
  }
  return v;
}

// Everything the assistant may see, in a stable order so the Worker's cache hits between questions.
export function digest() {
  const out = [];
  const recs = db.all().filter((r) => MODULE[r.module] && !NEVER_MODULES.has(r.module));
  const journal = recs.filter((r) => r.module === 'journal').sort((a, b) => String(b.data.at || '').localeCompare(String(a.data.at || ''))).slice(0, 60);
  const days = recs.filter((r) => r.module === 'days').sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || ''))).slice(0, 90);
  const keep = recs.filter((r) => r.module !== 'journal' && r.module !== 'days').concat(journal, days);
  keep.sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id));
  for (const r of keep) {
    const m = MODULE[r.module];
    const fields = {};
    for (const fd of m.fields) {
      if (fd.hidden || NEVER_TYPES.has(fd.type) || NEVER_KEYS.has(fd.k)) continue;
      const v = clean(r.data[fd.k]);
      if (v !== undefined) fields[fd.label] = v;
    }
    out.push({ id: r.id, module: m.name, title: titleOf(r), fields });
  }
  return out;
}

async function calendarDigest() {
  try {
    const cal = await gcal.cachedEvents();
    return (cal.events || []).filter((e) => !e.mine).slice(0, 40).map((e) => ({ id: `cal:${e.id}`, module: 'Google Calendar', title: e.title, fields: { Starts: e.start } }));
  } catch { return []; }
}

export async function configured() {
  const v = await db.kvGet('voice', null);
  return !!v?.url;
}

export async function ask(question) {
  const voice = await db.kvGet('voice', null);
  if (!voice?.url) throw Object.assign(new Error('not-configured'), { code: 'not-configured' });
  const now = new Date();
  const today = now.toLocaleDateString('en-CA') + ' (' + now.toLocaleDateString('en-IN', { weekday: 'long' }) + ')';
  const records = [...digest(), ...(await calendarDigest())];
  const res = await fetch(voice.url.replace(/\/$/, '') + '/ask', {
    method: 'POST',
    headers: { 'X-App-Token': voice.token || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, today, records }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Assistant error ${res.status}`);
  return { answer: String(j.answer || ''), sources: (j.sources || []).filter((id) => db.get(id)) };
}

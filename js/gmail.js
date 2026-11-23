// Gmail → job application suggestions.
// Runs entirely in the browser with a short-lived, read-only Google token.
// Nothing is added to Jobs until you accept a suggestion.

import * as db from './db.js';
import * as google from './google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ATS = /(greenhouse|lever\.co|workday|myworkdayjobs|ashby|smartrecruiters|icims|jobvite|taleo|successfactors|linkedin|naukri|instahyre|indeed|wellfound|hirist|cutshort|iimjobs|foundit|monster|glassdoor|keka|darwinbox|zoho|freshteam|recruitee|workable|breezy|bamboohr|gmail|outlook|yahoo|google)/i;

const RANK = { 'to apply': 0, applied: 1, screening: 2, interview: 3, offer: 4, accepted: 5, declined: 5, rejected: 5, ghosted: 5, withdrawn: 5 };

async function gmail(path) {
  const token = google.tokenFor(google.SCOPES.gmail);
  if (!token) throw new Error('Google sign-in expired. Scan again.');
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { google.expire(); throw new Error('Google sign-in expired. Scan again.'); }
  if (!res.ok) throw new Error(`Gmail error ${res.status}`);
  return res.json();
}

// ── search ─────────────────────────────────────────────────────────────
const SENDERS = ['greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com', 'ashbyhq.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'naukri.com', 'instahyre.com', 'wellfound.com', 'jobs-noreply@linkedin.com', 'hirist.tech', 'cutshort.io', 'iimjobs.com', 'keka.com', 'darwinbox.in', 'workable.com', 'recruitee.com'];

function buildQuery(afterEpoch) {
  const subjects = 'application OR applying OR applied OR interview OR offer OR candidacy OR "your application" OR "next steps"';
  return `after:${afterEpoch} -in:chats -category:promotions (subject:(${subjects}) OR from:(${SENDERS.join(' OR ')}))`;
}

async function listIds(q, max = 300) {
  const ids = [];
  let pageToken = '';
  do {
    const j = await gmail(`/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const m of j.messages || []) ids.push(m);
    pageToken = j.nextPageToken || '';
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

async function getMeta(id) {
  const j = await gmail(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
  const h = Object.fromEntries((j.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  const fromRaw = h.from || '';
  const m = fromRaw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const d = new Date(Number(j.internalDate));
  const p = (n) => String(n).padStart(2, '0');
  return {
    id: j.id,
    threadId: j.threadId,
    fromName: (m ? m[1] : '').trim(),
    fromEmail: (m ? m[2] : fromRaw).trim().toLowerCase(),
    subject: h.subject || '',
    snippet: decodeEntities(j.snippet || ''),
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
  };
}

function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ── rule-based extraction ──────────────────────────────────────────────
const RULES = {
  offer: /(pleased to (offer|extend)|offer letter|offer of employment|extend (you )?an offer|job offer)/i,
  rejected: /(unfortunately|not (be )?moving forward|decided (not )?to (move|proceed) forward with other|move forward with other candidates|not (be )?progress(ing)?|regret to inform|position has been filled|will not be proceeding|pursue other candidates|not selected)/i,
  interview: /(interview|schedule (a|an|your) (call|chat|conversation|meeting)|(technical|coding|online) (assessment|test|round|challenge)|hackerrank|codility|hackerearth|take-?home)/i,
  applied: /(thank(s| you) for (applying|your application|your interest)|application (has been |was )?(received|submitted|sent|complete)|we('ve| have) received your application|your application (was sent|to|for|has been)|successfully applied|application confirmation)/i,
};

function classify(e) {
  const text = `${e.subject} ${e.snippet}`;
  if (RULES.offer.test(text)) return 'offer';
  if (RULES.rejected.test(text)) return 'rejected';
  if (RULES.applied.test(e.subject)) return 'applied';
  if (RULES.interview.test(text)) return 'interview';
  if (RULES.applied.test(text)) return 'applied';
  return null;
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s"'“”-]+|[\s"'“”.,!:|-]+$/g, '').trim();
const COMPANY_STOP = /\b(careers?|recruit(ing|ment|er|ers)?|talent( acquisition)?( team)?|hiring( team)?|team|jobs?|hr|people|no-?reply|notifications?|do not reply|via .*)\b/gi;

function companyOf(e) {
  const pats = [
    /application (?:to|at|with) (.{2,50}?)(?:\s+for\b|\s+has\b|\s+was\b|[!.,:|(\-–]|$)/i,
    /applying (?:to|at|with|for a (?:role|position|job) at) (.{2,50}?)(?:\s+for\b|[!.,:|(\-–]|$)/i,
    /(?:sent|submitted) to (.{2,50}?)(?:[!.,:|(\-–]|$)/i,
    /interest in (?:joining |working at )?(.{2,50}?)(?:\s+and\b|[!.,:|(\-–]|$)/i,
    /\bat (.{2,40}?)(?:[!.,:|(\-–]|$)/i,
  ];
  for (const text of [e.subject, e.snippet]) {
    for (const p of pats) {
      const m = text.match(p);
      if (m) {
        const c = clean(m[1]).replace(/^the /i, '');
        if (c && !/^(our|your|this|the|a|an)$/i.test(c) && !ATS.test(c) && c.split(' ').length <= 6) return c;
      }
    }
  }
  const fromName = clean((e.fromName || '').replace(COMPANY_STOP, ' '));
  if (fromName && !ATS.test(fromName)) return fromName;
  const domain = (e.fromEmail.split('@')[1] || '').split('.');
  const sld = domain.length >= 2 ? domain[domain.length - 2] : '';
  if (sld && !ATS.test(sld) && sld.length > 2) return sld[0].toUpperCase() + sld.slice(1);
  return '';
}

function roleOf(e) {
  if (/linkedin/i.test(e.fromEmail)) {
    const m = e.snippet.match(/^(.{3,70}?)\s+·\s+/);
    if (m) return clean(m[1]);
  }
  const pats = [
    /position of (.{3,70}?)(?:\s+at\b|\s+with\b|[!.,]|$)/i,
    /^(?:offer(?: letter)?|interview(?: invitation| invite)?|application(?: received| update)?)\s*[-–:|]\s*(.{3,60}?)(?:\s+at\b|$)/i,
    /(?:for|as) (?:the |a |an )?(?:position of |role of )?(.{3,70}?) (?:position|role|opening|job|vacancy)\b/i,
    /application (?:for|to) (?:the )?(.{3,70}?)(?:\s+(?:at|with|position|role)\b|[!.,:|(\-–]|$)/i,
    /applied (?:for|to) (?:the )?(.{3,70}?)(?:\s+(?:at|with|position|role)\b|[!.,:|(\-–]|$)/i,
  ];
  for (const text of [e.subject, e.snippet]) {
    for (const p of pats) {
      const m = text.match(p);
      if (m) {
        const r = clean(m[1]);
        if (r && r.split(' ').length <= 10 && !/^(our|your|this|the)$/i.test(r)) return r;
      }
    }
  }
  return '';
}

// ── optional AI extraction through your Worker ─────────────────────────
async function aiExtract(emails) {
  const voice = await db.kvGet('voice', null);
  if (!voice?.url) return null;
  const out = new Map();
  for (let i = 0; i < emails.length; i += 25) {
    const batch = emails.slice(i, i + 25).map((e) => ({ id: e.id, from: `${e.fromName} <${e.fromEmail}>`, subject: e.subject, snippet: e.snippet, date: e.date }));
    const res = await fetch(voice.url.replace(/\/$/, '') + '/jobmail', {
      method: 'POST',
      headers: { 'X-App-Token': voice.token || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: batch }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    for (const r of j.results || []) out.set(r.id, r);
  }
  return out;
}

// ── matching to existing jobs ──────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|technologies|technology|labs|solutions|india|software|services|corp|co)\b/g, '').replace(/[^a-z0-9]/g, '');

function findJob(company, threadId) {
  const jobs = db.list('jobs');
  const byThread = jobs.find((j) => (j.data.emails || []).some((m) => m.threadId === threadId));
  if (byThread) return byThread;
  const n = norm(company);
  if (!n) return null;
  return jobs.find((j) => { const c = norm(j.data.company); return c && (c === n || c.includes(n) || n.includes(c)); }) || null;
}

function linkedIds() {
  const s = new Set();
  for (const j of db.list('jobs')) for (const m of j.data.emails || []) s.add(m.id);
  return s;
}

// ── scan ───────────────────────────────────────────────────────────────
export async function scan({ useAi, onProgress = () => {} }) {
  await google.signIn(google.SCOPES.gmail);
  const last = await db.kvGet('gmailLastScan', null);
  const firstDays = (await db.kvGet('gmail', {})).firstDays || 90;
  const after = Math.floor((last ? Date.parse(last) - 2 * 864e5 : Date.now() - firstDays * 864e5) / 1000);
  onProgress('Searching your inbox…');
  const ids = await listIds(buildQuery(after));
  const seen = new Set(await db.kvGet('gmailSeen', []));
  const linked = linkedIds();
  const fresh = ids.filter((m) => !seen.has(m.id) && !linked.has(m.id));
  onProgress(`Reading ${fresh.length} emails…`);
  const metas = await mapLimit(fresh, 5, (m) => getMeta(m.id));

  let ai = null;
  if (useAi && metas.length) {
    onProgress('Reading with AI…');
    try { ai = await aiExtract(metas); } catch { ai = null; }
  }

  const existing = await db.kvGet('gmailSuggestions', []);
  const pendingIds = new Set(existing.map((s) => s.msgId));
  const suggestions = [...existing];
  for (const e of metas) {
    seen.add(e.id);
    if (pendingIds.has(e.id)) continue;
    let status; let company; let role;
    const a = ai && ai.get(e.id);
    if (a) {
      if (!a.is_job_email || !a.status) continue;
      ({ status, company, role } = a);
    } else {
      status = classify(e);
      if (!status) continue;
      company = companyOf(e);
      role = roleOf(e);
    }
    const job = findJob(company, e.threadId);
    if (job) {
      const cur = RANK[job.data.status] ?? 0;
      const nxt = RANK[status] ?? 0;
      if (nxt <= cur && status !== 'rejected') { continue; }
      if (job.data.status === status) continue;
    }
    suggestions.push({
      msgId: e.id, threadId: e.threadId, date: e.date, from: e.fromName || e.fromEmail, subject: e.subject, snippet: e.snippet.slice(0, 240),
      kind: job ? 'update' : 'new', status, company: company || '', role: role || '', jobId: job ? job.id : null,
    });
  }
  // keep the most recent 5000 seen ids
  await db.kvSet('gmailSeen', [...seen].slice(-5000));
  await db.kvSet('gmailSuggestions', suggestions.sort((x, y) => y.date.localeCompare(x.date)));
  await db.kvSet('gmailLastScan', new Date().toISOString());
  return { scanned: metas.length, added: suggestions.length - existing.length };
}

export async function suggestions() { return db.kvGet('gmailSuggestions', []); }

async function dropSuggestion(msgId) {
  const list = await db.kvGet('gmailSuggestions', []);
  await db.kvSet('gmailSuggestions', list.filter((s) => s.msgId !== msgId));
}

export const mailLink = (threadId) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

export async function accept(msgId, overrides = {}) {
  const list = await db.kvGet('gmailSuggestions', []);
  const s = list.find((x) => x.msgId === msgId);
  if (!s) return null;
  const v = { ...s, ...overrides };
  const email = { id: s.msgId, threadId: s.threadId, subject: s.subject, date: s.date, status: v.status };
  let rec;
  // Re-resolve at accept time: an earlier accept in this session may have created the job.
  let job = v.jobId && db.get(v.jobId);
  if (!job || job.deletedAt) job = findJob(v.company, s.threadId);
  if (job) {
    const patch = { emails: [...(job.data.emails || []).filter((m) => m.id !== s.msgId), email] };
    const cur = RANK[job.data.status] ?? 0;
    const nxt = RANK[v.status] ?? 0;
    // never move a job backwards (e.g. an old confirmation accepted after the rejection)
    if (nxt > cur || (v.status === 'rejected' && job.data.status !== 'rejected')) patch.status = v.status;
    if (v.status === 'applied' && !job.data.appliedOn) patch.appliedOn = s.date;
    if (v.role && !job.data.role) patch.role = v.role;
    if (patch.status === 'interview' && !job.data.nextAction) patch.nextAction = 'Prepare for interview';
    rec = await db.update(job.id, patch);
  } else {
    const followUp = new Date(Date.parse(s.date) + 10 * 864e5);
    const p = (n) => String(n).padStart(2, '0');
    rec = await db.create('jobs', {
      company: v.company || 'Unknown company',
      role: v.role || '',
      status: v.status,
      appliedOn: v.status === 'applied' ? s.date : '',
      source: /linkedin/i.test(s.from) ? 'linkedin' : /naukri/i.test(s.from) ? 'naukri' : '',
      nextAction: v.status === 'applied' ? 'Follow up if no reply' : v.status === 'interview' ? 'Prepare for interview' : '',
      nextActionDate: v.status === 'applied' ? `${followUp.getFullYear()}-${p(followUp.getMonth() + 1)}-${p(followUp.getDate())}` : '',
      emails: [email],
    });
  }
  await dropSuggestion(msgId);
  return rec;
}

export async function ignore(msgId) { await dropSuggestion(msgId); }

export async function resetScan() {
  await db.kvSet('gmailLastScan', null);
  await db.kvSet('gmailSeen', []);
}

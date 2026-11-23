import * as db from './db.js';
import * as sync from './sync.js';
import { Recorder, saveRecording, transcribe, retryPending, localStamp } from './journal.js';
import * as gmail from './gmail.js';
import * as gcal from './gcal.js';
import * as google from './google.js';
import { ROOMS, ROOM, PLAN_MODULES, roomOf, colorOf, homeOf } from './rooms.js';
import { MODULES, MODULE, GROUPS, LINK_CATEGORIES, titleOf, defaults, isDone } from './schemas.js';

// ── tiny helpers ────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const startOfToday = () => parseDay(todayStr());
const diffDays = (a, b) => Math.round((a - b) / 864e5);

function fmtDay(s) {
  if (!s) return '';
  const d = parseDay(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
function fmtTime(s) { return s && s.length > 11 ? s.slice(11, 16) : ''; }
function rel(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
function weekNo(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
const plural = (n, w) => `${n} ${w.toLowerCase()}${n === 1 ? '' : 's'}`;
const titleKey = (m) => (typeof m.title === 'string' ? m.title : m.fields.find((x) => x.req).k);

// ── icons (inline stroke SVG) ───────────────────────────────────────────
const I = {
  now: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/>',
  plan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  life: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  track: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  career: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  learning: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  health: '<path d="M20.8 6.6a5 5 0 0 0-8.8-2.4 5 5 0 0 0-8.8 2.4c-.6 4.8 8.8 11.4 8.8 11.4s9.4-6.6 8.8-11.4z"/><path d="M3.5 11h4l2-3 3 6 2-3h6"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
  assets: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  travel: '<path d="M10.5 13.5L3 11l1.5-1.5 8 1 4-4.5a2.1 2.1 0 0 1 3 3l-4.5 4 1 8L14.5 22 12 14.5"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16h.01"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  dot: '<circle cx="12" cy="12" r="2.5"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

// ── theme ───────────────────────────────────────────────────────────────
function getTheme() { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  try { localStorage.setItem('theme', t); } catch { /* private mode */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', light ? '#f6f6f4' : '#0b0b0c');
}

// ── time progress (day / week / year) ──────────────────────────────────
function timeProgress() {
  const n = new Date();
  const day = (n.getHours() * 60 + n.getMinutes()) / 1440;
  const week = (((n.getDay() + 6) % 7) + day) / 7;
  const y0 = new Date(n.getFullYear(), 0, 1);
  const y1 = new Date(n.getFullYear() + 1, 0, 1);
  const year = (n - y0) / (y1 - y0);
  return [['Day', day], ['Week', week], ['Year', year]].map(([k, v]) => [k, Math.floor(v * 100)]);
}

// ── setup guide ─────────────────────────────────────────────────────────
const SETUP = [
  { title: 'Your links', why: 'Portfolio, GitHub, LinkedIn, notes, bank and investment logins: one tap away.', modules: ['links'], starter: true },
  { title: 'Documents & IDs', why: 'Passport, PAN, Aadhaar, licence, degrees. Expiry and where the physical copy is.', modules: ['documents'] },
  { title: 'Vehicles', why: 'Insurance, PUC and service reminders, and where the RC is.', modules: ['vehicles'] },
  { title: 'Insurance', why: 'Health, term and vehicle policies with renewal dates and nominees.', modules: ['insurance'] },
  { title: 'Accounts & loans', why: 'Where your money is, nominees, EMIs and card due dates.', modules: ['accounts', 'loans'] },
  { title: 'Health profile', why: 'Blood group, allergies, conditions, vaccinations, check-up dates.', modules: ['healthprofile'] },
  { title: 'Birthdays', why: "People who matter, with reminders a week before.", modules: ['people'] },
  { title: 'Things you own', why: 'Phone, laptop, appliances, with warranty end dates and invoices.', modules: ['possessions'] },
  { title: 'Habits', why: 'Pick 3–5. They appear as one-tap toggles on Now.', modules: ['habits'] },
  { title: "This year's goals", why: 'A few goals for the year. Break them into months and weeks later.', modules: ['goals'], query: 'horizon=year' },
];
const setupDone = (s) => s.modules.some((m) => db.list(m).length > 0);

function starterLinks() {
  const host = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const user = host || 'your-username';
  return [
    { name: 'GitHub', url: `https://github.com/${user}`, category: 'profile', pinned: true },
    { name: 'Portfolio', url: `https://${user}.github.io/portfolio/`, category: 'profile', pinned: true },
    { name: 'Notes', url: `https://${user}.github.io/Notes/`, category: 'learning', pinned: true },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/in/', category: 'profile', pinned: true },
    { name: 'Income Tax e-filing', url: 'https://www.incometax.gov.in/', category: 'finance' },
    { name: 'EPF passbook', url: 'https://passbook.epfindia.gov.in/', category: 'finance' },
  ];
}
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;

// ── toast with undo ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, { undo = false } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-action="undo">Undo</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 8000 : 3000);
}

// ── reminders: any date field with `remind` shows up in "Heads up" ─────
function reminders() {
  const out = [];
  const t0 = startOfToday();
  for (const m of MODULES) {
    const dateFields = m.fields.filter((x) => x.remind !== undefined);
    if (!dateFields.length) continue;
    for (const r of db.list(m.id)) {
      if (isDone(r)) continue;
      for (const fd of dateFields) {
        const v = r.data[fd.k];
        if (!v) continue;
        let d = parseDay(v);
        if (fd.yearly) {
          d = new Date(t0.getFullYear(), d.getMonth(), d.getDate());
          if (d < t0) d.setFullYear(d.getFullYear() + 1);
        }
        const days = diffDays(d, t0);
        if (days <= fd.remind) out.push({ r, m, label: fd.label, days });
      }
    }
  }
  for (const r of db.list('people')) {
    const { everyWeeks, lastContact } = r.data;
    if (!everyWeeks || !lastContact) continue;
    const due = parseDay(lastContact);
    due.setDate(due.getDate() + Number(everyWeeks) * 7);
    const days = diffDays(due, t0);
    if (days <= 0) out.push({ r, m: MODULE.people, label: 'Reach out', days });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── router ──────────────────────────────────────────────────────────────
let formDirty = false;
let currentRoute = { name: 'now', parts: [] };

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'now', parts: parts.slice(1) };
}
const go = (hash) => { location.hash = hash; };

const VIEWS = {
  now: viewNow, plan: viewPlan, journal: viewJournal, life: viewLife,
  m: viewModule, new: viewNew, r: viewRecord, search: viewSearch, settings: viewSettings, trash: viewTrash,
  links: viewLinks, setup: viewSetup, progress: viewProgress, inbox: viewInbox, t: viewLife, room: viewRoom, review: viewReview,
};

async function render() {
  currentRoute = parseRoute();
  formDirty = false;
  currentBack = backFor(currentRoute);
  const view = VIEWS[currentRoute.name] || viewNow;
  const main = $('#main');
  main.innerHTML = await view(...currentRoute.parts);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  const top = tabFor(currentRoute);
  for (const a of document.querySelectorAll('.nav a, .side a[data-nav]')) a.classList.toggle('on', a.dataset.nav === top);
  renderSide();
  hydrate();
}

// Load audio blobs and async sections after render.
async function hydrate() {
  for (const el of document.querySelectorAll('audio[data-blob]')) {
    const blob = await db.getBlob(el.dataset.blob);
    if (blob) el.src = URL.createObjectURL(blob);
    else el.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Audio is stored on the device that recorded it.' }));
  }
  const hist = $('#history');
  if (hist) hist.innerHTML = await historyHtml(hist.dataset.id);
}

// ── shared pieces ───────────────────────────────────────────────────────
let currentBack = null;
function moduleOfRoute({ name, parts }) {
  if (name === 'm' || name === 'new') return (parts[0] || '').split('?')[0];
  if (name === 'r') return db.get(parts[0])?.module || '';
  return '';
}
function tabFor(route) {
  if (route.name === 'now') return 'today';
  if (route.name === 'search') return 'search';
  if (route.name === 'plan' || route.name === 'progress' || route.name === 'review') return 'plan';
  const mid = moduleOfRoute(route);
  if (mid && PLAN_MODULES.includes(mid)) return 'plan';
  return 'life';
}
function backFor(route) {
  const { name, parts } = route;
  const mid = moduleOfRoute(route);
  const special = (m) => (m === 'journal' ? { name: 'Journal', href: '#/journal' } : m === 'links' ? { name: 'Links', href: '#/links' } : null);
  if (name === 'm') return parts[1] ? { name: MODULE[mid]?.name || 'Back', href: `#/m/${mid}` } : homeOf(mid);
  if (name === 'new') return special(mid) || { name: MODULE[mid]?.name || 'Back', href: `#/m/${mid}` };
  if (name === 'r') {
    const r = db.get(parts[0]);
    if (!r) return { name: 'Life', href: '#/life' };
    if (parts[1]) return { name: 'Overview', href: `#/r/${r.id}` };
    return special(r.module) || { name: MODULE[r.module].name, href: `#/m/${r.module}` };
  }
  if (name === 'room') return { name: 'Life', href: '#/life' };
  if (name === 'journal' || name === 'links') return { name: 'Me', href: '#/room/me' };
  if (name === 'inbox') return { name: 'Career', href: '#/room/career' };
  if (name === 'progress' || name === 'review') return { name: 'Plan', href: '#/plan' };
  if (['settings', 'setup', 'trash'].includes(name)) return { name: 'Life', href: '#/life' };
  return null;
}

function header(title, { kicker = '', back = null, actions = '', sub = '' } = {}) {
  const b = back === false ? null : back || currentBack;
  const k = kicker && kicker === kicker.toUpperCase() && !kicker.includes('<') ? kicker.charAt(0) + kicker.slice(1).toLowerCase() : kicker;
  return `<header class="top">
    ${b || actions ? `<div class="top-meta">${b ? `<a class="backlink" href="${esc(b.href)}">${icon('back', 16)}${esc(b.name)}</a>` : '<span></span>'}${actions ? `<div class="top-actions">${actions}</div>` : ''}</div>` : ''}
    ${k ? `<div class="kicker">${k}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
  </header>`;
}

// Nearest reminder dates for an item (countdowns).
function countdownsOf(r) {
  const m = MODULE[r.module];
  if (!m || isDone(r)) return [];
  const t0 = startOfToday();
  return m.fields.filter((fd) => fd.remind !== undefined && r.data[fd.k]).map((fd) => {
    let d = parseDay(r.data[fd.k]);
    if (fd.yearly) { d = new Date(t0.getFullYear(), d.getMonth(), d.getDate()); if (d < t0) d.setFullYear(d.getFullYear() + 1); }
    return { fd, days: diffDays(d, t0) };
  }).sort((a, b) => a.days - b.days);
}

const SUB_SKIP = new Set(['long', 'links', 'json', 'url', 'check', 'rating']);
function subtitleOf(r) {
  const m = MODULE[r.module];
  const tk = typeof m.title === 'string' ? m.title : null;
  const titleKeys = tk ? [tk] : ['company', 'role'];
  const parts = [];
  for (const fd of m.fields) {
    if (parts.length >= 2) break;
    if (fd.hidden || SUB_SKIP.has(fd.type) || titleKeys.includes(fd.k) || fd.k === m.status || fd.remind !== undefined) continue;
    const v = r.data[fd.k];
    if (isEmpty(v)) continue;
    if (fd.type === 'money') parts.push(`₹${Number(v).toLocaleString('en-IN')}`);
    else if (fd.type === 'date') parts.push(`${fd.label} ${fmtDay(v)}`);
    else if (fd.type === 'tags') parts.push(v.slice(0, 3).join(', '));
    else if (fd.type === 'secret4') parts.push(`•••• ${v}`);
    else parts.push(String(v));
  }
  return parts.join(' · ');
}

function pillFor(r, { noStatus = false } = {}) {
  const m = MODULE[r.module];
  const cd = countdownsOf(r)[0];
  if (cd && cd.days <= Math.max(cd.fd.remind || 0, 30)) {
    const cls = cd.days < 0 ? 'late' : cd.days <= (cd.fd.remind || 0) ? 'soon' : '';
    const txt = cd.days < 0 ? `${-cd.days}d late` : cd.days === 0 ? 'today' : `${cd.days}d`;
    return `<span class="pill ${cls}" title="${esc(cd.fd.label)}">${esc(txt)}</span>`;
  }
  if (!noStatus && m.status && r.data[m.status]) return `<span class="pill ghost">${esc(r.data[m.status])}</span>`;
  if (m.sort && r.data[m.sort]) return `<span class="row-meta">${esc(m.fields.find((x) => x.k === m.sort)?.type === 'date' ? fmtDay(r.data[m.sort]) : r.data[m.sort])}</span>`;
  return '';
}

function row(r, { showModule = false, noStatus = false } = {}) {
  const m = MODULE[r.module];
  const title = r.module === 'journal' ? (r.data.text || 'Voice entry').slice(0, 90) : titleOf(r);
  const sub = [showModule ? m.name : '', r.module === 'journal' ? `${fmtDay(r.data.at)} ${fmtTime(r.data.at)}` : subtitleOf(r)].filter(Boolean).join(' · ');
  return `<a class="row rich ${isDone(r) ? 'done' : ''}" href="#/r/${r.id}">
    <span class="avatar" aria-hidden="true" style="--c:${colorOf(r.module)}">${esc(title.trim().slice(0, 1).toUpperCase() || '·')}</span>
    <span class="row-body"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    ${pillFor(r, { noStatus })}
  </a>`;
}

function emptyState(text, href, cta) {
  return `<div class="empty"><p>${esc(text)}</p>${href ? `<a class="btn ghost" href="${href}">${esc(cta)}</a>` : ''}</div>`;
}

// ── NOW ─────────────────────────────────────────────────────────────────
async function viewNow() {
  const t = todayStr();
  const now = new Date();
  const t0 = startOfToday();
  const tasks = db.list('tasks')
    .filter((r) => r.data.status !== 'done' && (r.data.status === 'today' || (r.data.due && r.data.due <= t)))
    .sort((a, b) => (a.data.due || '9').localeCompare(b.data.due || '9'));
  const habits = db.list('habits').filter((r) => r.data.active !== false);
  const dayRec = db.list('days').find((r) => r.data.date === t);
  const mood = dayRec?.data.mood;
  const rems = reminders().filter((x) => x.r.module !== 'tasks');
  const overdue = rems.filter((x) => x.days < 0);
  const dueToday = rems.filter((x) => x.days === 0);
  const cal = await gcal.cachedEvents();
  const todayEvents = cal.events.filter((e) => (e.start || '').slice(0, 10) === t);
  const lateTasks = tasks.filter((r) => r.data.due && r.data.due < t);
  const left = tasks.length - lateTasks.length + dueToday.length;
  const lateN = overdue.length + lateTasks.length;
  const journaledToday = db.list('journal').some((r) => (r.data.at || '').startsWith(t));

  let headline;
  if (!left && !lateN) headline = `All clear.<br><span class="soft">${todayEvents.length ? `${plural(todayEvents.length, 'event')} on your calendar.` : 'Nothing due today.'}</span>`;
  else headline = `${left ? `${plural(left, 'thing')} left` : 'Nothing else due'}${lateN ? `<br><span class="soft">and ${lateN} overdue.</span>` : '<br><span class="soft">You’re on track.</span>'}`;

  // timeline: late → anytime → timed events → night
  const items = [];
  for (const x of overdue) items.push({ o: 0, html: `<li><span class="when late">Late</span><span class="dot" style="--c:${colorOf(x.r.module)}"></span><a class="what" href="#/r/${x.r.id}"><span>${esc(titleOf(x.r))}</span><small>${esc(x.label)} · ${rel(x.days)}</small></a></li>` });
  for (const r of lateTasks) items.push({ o: 0, html: `<li><span class="when late">Late</span><button type="button" class="tick" data-action="task-done" data-id="${r.id}" aria-label="Mark ${esc(titleOf(r))} done">${icon('check', 14)}</button><a class="what" href="#/r/${r.id}"><span>${esc(titleOf(r))}</span><small>due ${rel(diffDays(parseDay(r.data.due), t0))}</small></a></li>` });
  for (const x of dueToday) items.push({ o: 1, html: `<li><span class="when strong">Today</span><span class="dot" style="--c:${colorOf(x.r.module)}"></span><a class="what" href="#/r/${x.r.id}"><span>${esc(titleOf(x.r))}</span><small>${esc(x.label)}</small></a></li>` });
  for (const r of tasks.filter((x) => !lateTasks.includes(x))) items.push({ o: 1, html: `<li><span class="when">Any</span><button type="button" class="tick" data-action="task-done" data-id="${r.id}" aria-label="Mark ${esc(titleOf(r))} done">${icon('check', 14)}</button><a class="what" href="#/r/${r.id}"><span>${esc(titleOf(r))}</span></a></li>` });
  for (const e of todayEvents) {
    const time = e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    items.push({ o: 2, k: e.start, html: `<li><span class="when strong">${esc(time)}</span><span class="dot" style="--c:#7AA2FF"></span><a class="what" href="${esc(e.link || '#')}" target="_blank" rel="noopener"><span>${esc(e.title)}</span><small>Google Calendar</small></a></li>` });
  }
  if (!journaledToday) items.push({ o: 3, html: `<li><span class="when">Night</span><span class="dot"></span><span class="what"><span>Journal: how did today go?</span></span><button type="button" class="link" data-action="record">Speak</button></li>` });
  items.sort((a, b) => a.o - b.o || String(a.k || '').localeCompare(String(b.k || '')));

  const coming = [
    ...rems.filter((x) => x.days > 0 && x.days <= 21).map((x) => ({ days: x.days, html: `<li><a href="#/r/${x.r.id}"><span class="l"><span class="dot" style="--c:${colorOf(x.r.module)}"></span><span>${esc(titleOf(x.r))} · ${esc(x.label)}</span></span><span class="r">${rel(x.days)}</span></a></li>` })),
    ...cal.events.filter((e) => (e.start || '').slice(0, 10) > t && !e.mine).map((e) => { const dd = diffDays(parseDay(e.start.slice(0, 10)), t0); return { days: dd, html: `<li><a href="${esc(e.link || '#')}" target="_blank" rel="noopener"><span class="l"><span class="dot" style="--c:#7AA2FF"></span><span>${esc(e.title)}</span></span><span class="r">${dd === 1 ? 'Tomorrow' : fmtDay(e.start.slice(0, 10))}</span></a></li>` }; }),
  ].sort((a, b) => a.days - b.days).slice(0, 4);

  const mailCount = (await gmail.suggestions()).length;
  const nudge = (await nudges())[0];
  const setupLeft = SETUP.length - SETUP.filter(setupDone).length;
  let hint = '';
  if (mailCount) hint = `<a class="hint-card" href="#/inbox"><span class="dot" style="--c:#7AA2FF"></span><span class="t"><b>${plural(mailCount, 'job update')} from Gmail</b><span>Review and add to your applications</span></span>${icon('chev', 16)}</a>`;
  else if (setupLeft >= 5) hint = `<a class="hint-card" href="#/setup"><span class="dot"></span><span class="t"><b>Finish setting up · ${SETUP.length - setupLeft}/${SETUP.length}</b><span>Next: ${esc(SETUP.find((x) => !setupDone(x)).title)}</span></span>${icon('chev', 16)}</a>`;
  else if (nudge) hint = `<div class="hint-card"><span class="dot"></span><span class="t"><b>${esc(nudge.text)}</b></span>${nudge.href ? `<a class="btn small" href="${esc(nudge.href)}">${esc(nudge.cta)}</a>` : `<button type="button" class="btn small" data-action="${nudge.action}"${nudge.id ? ` data-id="${nudge.id}"` : ''}>${esc(nudge.cta)}</button>`}<button type="button" class="icon-btn sm" data-action="nudge-dismiss" data-key="${esc(nudge.key)}" aria-label="Hide for today">×</button></div>`;

  const habitsDone = habits.filter((h) => (h.data.log || {})[t]).length;
  return `<header class="top">
    <div class="kicker">${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <h1>${headline}</h1>
  </header>
  <form class="capture" data-form="capture" role="search">
    <input name="q" type="text" placeholder="Add, find or ask anything…" aria-label="Add, find or ask anything" autocomplete="off">
    <button type="button" class="mic" data-action="record" aria-label="Speak">${icon('mic', 18)}</button>
  </form>
  <div id="capture-results" class="capture-results" hidden></div>
  ${hint}
  <div class="grid-2">
    <section class="block" aria-label="Today">
      ${items.length ? `<ul class="tl">${items.map((i) => i.html).join('')}</ul>` : '<p class="muted">Nothing on today. Add a task above.</p>'}
    </section>
    <div>
      <section class="block" aria-label="Habits">
        <div class="label-row"><span class="label">Habits</span>${habits.length ? `<span class="small muted">${habitsDone} of ${habits.length}</span>` : ''}</div>
        ${habits.length ? `<div class="habit-grid">${habits.map((h) => {
          const on = !!(h.data.log || {})[t];
          const st = streak(h.data.log || {});
          return `<button type="button" class="habit-btn ${on ? 'on' : ''}" data-action="habit" data-id="${h.id}" aria-pressed="${on}"><b>${esc(h.data.name)}</b><span>${st ? plural(st, 'day') : '–'}</span></button>`;
        }).join('')}</div>` : '<p class="muted">Pick 3–5 habits to keep. <a class="link" href="#/new/habits">Add one</a></p>'}
      </section>
      <section class="block" aria-label="Mood">
        <span class="label">How's today?</span>
        <div class="mood" role="group" aria-label="Mood today">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="mood" data-v="${n}" class="${mood === n ? 'on' : ''}" aria-pressed="${mood === n}">${n}</button>`).join('')}</div>
      </section>
      ${coming.length ? `<section class="block" aria-label="Coming up"><span class="label">Coming up</span><ul class="simple">${coming.map((c) => c.html).join('')}</ul></section>` : ''}
    </div>
  </div>`;
}

// ── suggestions: small nudges based on what's in the app ───────────────
async function nudges() {
  const out = [];
  const now = new Date();
  const t = todayStr();
  const t0 = startOfToday();
  const ago = (s) => (s ? diffDays(t0, parseDay(s)) : Infinity);
  const dismissed = (await db.kvGet('nudgeDismissed', {}));

  const reviews = db.list('reviews').map((r) => r.data);
  const lastWeekly = reviews.filter((r) => r.period === 'week').map((r) => r.date).sort().pop();
  if ((now.getDay() === 0 || now.getDay() === 6 || ago(lastWeekly) >= 10) && ago(lastWeekly) >= 6) {
    out.push({ key: 'review', text: lastWeekly ? `Weekly review: last one was ${ago(lastWeekly)} days ago.` : 'Do your first weekly review. 10 minutes.', href: '#/review', cta: 'Start' });
  }
  if (now.getDate() <= 3) {
    const month = t.slice(0, 7);
    if (!reviews.some((r) => r.period === 'month' && (r.date || '').slice(0, 7) === month)) out.push({ key: 'mreview', text: 'New month: review last month and set this one.', href: '#/new/reviews?period=month', cta: 'Review' });
  }
  if (!db.list('goals').some((g) => g.data.horizon === 'week' && g.data.status !== 'dropped' && g.data.status !== 'achieved')) {
    out.push({ key: 'weekgoals', text: "No goals for this week. Pick your top 3.", href: '#/new/goals?horizon=week', cta: 'Set' });
  }

  const tasks = db.list('tasks').filter((r) => r.data.status !== 'done');
  const overdue = tasks.filter((r) => r.data.due && r.data.due < t);
  if (overdue.length >= 3) out.push({ key: 'overdue', text: `${overdue.length} overdue tasks. Reschedule or drop them.`, href: '#/m/tasks', cta: 'Review' });
  const inbox = tasks.filter((r) => r.data.status === 'inbox');
  if (inbox.length >= 5) out.push({ key: 'inbox', text: `${inbox.length} tasks in the inbox. Decide when each happens.`, href: '#/m/tasks/inbox', cta: 'Sort' });

  const jobs = db.list('jobs');
  const silent = jobs.filter((j) => j.data.status === 'applied' && ago(j.data.appliedOn) >= 14 && !(j.data.nextActionDate && j.data.nextActionDate >= t));
  if (silent.length) out.push({ key: 'silent', text: `${silent.length} application${silent.length === 1 ? '' : 's'} with no reply for 2+ weeks. Follow up or mark ghosted.`, href: '#/m/jobs/applied', cta: 'Open' });
  const toApply = jobs.filter((j) => j.data.status === 'to apply' && ago(j.createdAt.slice(0, 10)) >= 5);
  if (toApply.length) out.push({ key: 'toapply', text: `${toApply.length} job${toApply.length === 1 ? '' : 's'} saved but not applied to yet.`, href: '#/m/jobs/to%20apply', cta: 'Apply' });
  const gm = (await db.kvGet('gmail')) || {};
  const lastScan = await db.kvGet('gmailLastScan');
  if (gm.clientId && jobs.length && (!lastScan || ago(lastScan.slice(0, 10)) >= 3)) out.push({ key: 'scan', text: 'Check Gmail for new job replies.', href: '#/inbox', cta: 'Scan' });

  if (now.getHours() >= 18) {
    for (const h of db.list('habits').filter((x) => x.data.active !== false)) {
      const log = h.data.log || {};
      const st = streak(log);
      if (!log[t] && st >= 2) { out.push({ key: `habit-${h.id}`, text: `Keep your ${st}-day ${h.data.name} streak alive today.`, action: 'habit', id: h.id, cta: 'Done' }); break; }
    }
  }

  const lastJ = db.list('journal').map((r) => (r.data.at || '').slice(0, 10)).sort().pop();
  if (ago(lastJ) >= 3) out.push({ key: 'journal', text: lastJ ? `No journal entry for ${ago(lastJ)} days. Talk for 30 seconds.` : 'Try the voice journal: talk about your day for 30 seconds.', action: 'record', cta: 'Speak' });

  if (!(await db.kvGet('sync')) && db.all().length >= 15) out.push({ key: 'sync', text: 'Your data is only on this device. Turn on encrypted sync.', href: '#/settings', cta: 'Set up' });

  return out.filter((n) => dismissed[n.key] !== t);
}

function nudgesHtml(list) {
  if (!list.length) return '';
  return `<section class="block nudges" aria-label="Suggestions">
    <span class="label">Suggestions</span>
    <ul>${list.slice(0, 3).map((n) => `<li>
      <span class="nudge-text">${esc(n.text)}</span>
      <span class="nudge-actions">
        ${n.href ? `<a class="btn primary small" href="${esc(n.href)}">${esc(n.cta)}</a>` : `<button type="button" class="btn primary small" data-action="${n.action}"${n.id ? ` data-id="${n.id}"` : ''}>${esc(n.cta)}</button>`}
        <button type="button" class="icon-btn sm" data-action="nudge-dismiss" data-key="${esc(n.key)}" aria-label="Hide for today">×</button>
      </span>
    </li>`).join('')}</ul>
  </section>`;
}

function calendarHtml(cal) {
  if (!cal.at) return '<p class="muted">Your Google Calendar events will show here.</p>';
  const t = todayStr();
  const upcoming = cal.events.filter((e) => (e.start || '').slice(0, 10) >= t).slice(0, 6);
  if (!upcoming.length) return '<p class="muted">Nothing on your calendar for the next two weeks.</p>';
  let lastDay = '';
  return `<ul class="cal">${upcoming.map((e) => {
    const day = e.start.slice(0, 10);
    const dayLabel = day === t ? 'Today' : diffDays(parseDay(day), startOfToday()) === 1 ? 'Tomorrow' : fmtDay(day);
    const head = day !== lastDay ? `<li class="cal-day mono">${esc(dayLabel)}</li>` : '';
    lastDay = day;
    const time = e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${head}<li><a href="${esc(e.link || '#')}" target="_blank" rel="noopener"><span class="cal-time mono">${esc(time)}</span><span class="cal-title">${esc(e.title)}</span></a></li>`;
  }).join('')}</ul><p class="small muted mono">Updated ${new Date(cal.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>`;
}

function setupCard() {
  const done = SETUP.filter(setupDone).length;
  if (done === SETUP.length) return '';
  const next = SETUP.find((s) => !setupDone(s));
  return `<a class="setup-card" href="#/setup">
    <span class="mono small">SET UP · ${done}/${SETUP.length}</span>
    <span class="setup-next">Next: ${esc(next.title)}</span>
    <span class="bar"><span style="width:${Math.round((done / SETUP.length) * 100)}%"></span></span>
  </a>`;
}

function favicon(name) {
  return `<span class="mono-badge" aria-hidden="true">${esc((name || '?').trim().slice(0, 2).toUpperCase())}</span>`;
}

function pinnedLinks() {
  const pins = db.list('links').filter((r) => r.data.pinned && r.data.url).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  if (!pins.length) return '';
  return `<nav class="pins" aria-label="Pinned links">${pins.map((r) => `<a href="${esc(r.data.url)}" target="_blank" rel="noopener">${favicon(r.data.name)}<span>${esc(r.data.name)}</span></a>`).join('')}<a href="#/links" class="pins-all">${icon('link', 16)}<span>All</span></a></nav>`;
}

// ── LINKS ───────────────────────────────────────────────────────────────
async function viewLinks() {
  const all = db.list('links');
  const groups = LINK_CATEGORIES.map((c) => [c, all.filter((r) => (r.data.category || 'other') === c).sort((a, b) => titleOf(a).localeCompare(titleOf(b)))]).filter(([, l]) => l.length);
  return `${header('Links', { kicker: `${all.length} SAVED`, actions: `<a class="btn primary small" href="#/new/links">+ Link</a>` })}
  ${all.length ? '' : `<div class="empty"><p>Profiles, finance logins, government portals: everything you open often.</p><button type="button" class="btn primary" data-action="starter-links">Add starter links</button></div>`}
  ${groups.map(([c, list]) => `<section class="block">
    <span class="label">${esc(c === 'profile' ? 'Profiles' : c[0].toUpperCase() + c.slice(1))}</span>
    <ul class="link-list">${list.map((r) => `<li>
      <a class="link-open" href="${esc(r.data.url)}" target="_blank" rel="noopener">${favicon(r.data.name)}<span class="ll-text"><span>${esc(r.data.name)}</span><span class="mono small muted">${esc((r.data.url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 42))}</span></span>${icon('out', 16)}</a>
      <a class="icon-btn sm" href="#/r/${r.id}" aria-label="Edit ${esc(r.data.name)}">${icon('edit', 16)}</a>
    </li>`).join('')}</ul>
  </section>`).join('')}`;
}

// ── PROGRESS (tracking over time) ───────────────────────────────────────
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function lastNDays(n) {
  const out = [];
  const t = startOfToday();
  for (let i = n - 1; i >= 0; i--) { const d = new Date(t); d.setDate(t.getDate() - i); out.push(d); }
  return out;
}
function streak(log) {
  const t = startOfToday();
  const d = new Date(t);
  if (!log[dayKey(d)]) d.setDate(d.getDate() - 1); // today not done yet doesn't break the streak
  let n = 0;
  while (log[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function completedDay(r) {
  return r.data.completedOn || (r.data.status === 'done' ? r.updatedAt.slice(0, 10) : null);
}
function weekStart(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }

async function viewProgress() {
  const t = todayStr();
  const tasks = db.list('tasks');
  const open = tasks.filter((r) => r.data.status !== 'done');
  const overdue = open.filter((r) => r.data.due && r.data.due < t);
  const ws = weekStart(new Date());
  const doneThisWeek = tasks.filter((r) => { const c = completedDay(r); return c && parseDay(c) >= ws; }).length;
  const monthKey = t.slice(0, 7);
  const journalMonth = db.list('journal').filter((r) => (r.data.at || '').startsWith(monthKey)).length;
  const habits = db.list('habits').filter((h) => h.data.active !== false);
  const days30 = lastNDays(30);
  const bestStreak = Math.max(0, ...habits.map((h) => streak(h.data.log || {})));

  // tasks done per week, last 8 weeks
  const weeks = [];
  for (let i = 7; i >= 0; i--) { const s = new Date(ws); s.setDate(ws.getDate() - i * 7); weeks.push({ s, n: 0 }); }
  for (const r of tasks) {
    const c = completedDay(r);
    if (!c) continue;
    const w = weekStart(parseDay(c)).getTime();
    const slot = weeks.find((x) => x.s.getTime() === w);
    if (slot) slot.n++;
  }
  const maxW = Math.max(1, ...weeks.map((w) => w.n));

  // mood: day log first, then the average of journal moods that day
  const moodBy = {};
  for (const r of db.list('journal')) if (r.data.mood && r.data.at) (moodBy[r.data.at.slice(0, 10)] ||= []).push(Number(r.data.mood));
  for (const k of Object.keys(moodBy)) moodBy[k] = Math.round(moodBy[k].reduce((a, b) => a + b, 0) / moodBy[k].length);
  for (const r of db.list('days')) if (r.data.mood && r.data.date) moodBy[r.data.date] = Number(r.data.mood);
  const moods = days30.map((d) => ({ d, v: moodBy[dayKey(d)] || null }));
  const logged = moods.filter((m) => m.v);
  const avgMood = logged.length ? (logged.reduce((a, m) => a + m.v, 0) / logged.length).toFixed(1) : '–';

  const goals = db.list('goals').filter((g) => g.data.status === 'active' || !g.data.status);

  const tile = (v, k, cls = '') => `<div class="stat"><span class="stat-v ${cls}">${v}</span><span class="mono small muted">${esc(k)}</span></div>`;
  return `${header('Progress', { kicker: 'TRACKING' })}
  <div class="stats">
    ${tile(doneThisWeek, 'TASKS DONE THIS WEEK')}
    ${tile(open.length, 'OPEN TASKS')}
    ${tile(overdue.length, 'OVERDUE', overdue.length ? 'warn' : '')}
    ${tile(bestStreak, 'BEST HABIT STREAK')}
    ${tile(journalMonth, 'JOURNAL ENTRIES THIS MONTH')}
    ${tile(avgMood, 'AVG MOOD · 30 DAYS')}
  </div>

  <section class="block">
    <div class="label-row"><span class="label">Habits · last 30 days</span><a class="link" href="#/m/habits">Edit</a></div>
    ${habits.length ? habits.map((h) => {
      const log = h.data.log || {};
      const done = days30.filter((d) => log[dayKey(d)]).length;
      const target = Math.round(((Number(h.data.perWeek) || 7) / 7) * 30);
      return `<div class="habit-row">
        <div class="pr-top"><span>${esc(h.data.name)}</span><span class="mono small muted">${streak(log)}d streak · ${done}/${target}</span></div>
        <div class="hgrid" role="img" aria-label="${esc(h.data.name)}: done on ${done} of the last 30 days">${days30.map((d) => {
          const on = !!log[dayKey(d)];
          return `<span class="${on ? 'on' : ''}${dayKey(d) === t ? ' today' : ''}" title="${fmtDay(dayKey(d))}: ${on ? 'done' : 'not done'}"></span>`;
        }).join('')}</div>
      </div>`;
    }).join('') : `<p class="muted">No habits yet. <a class="link" href="#/new/habits">Add one</a></p>`}
  </section>

  <div class="grid-2">
    <section class="block">
      <span class="label">Tasks done per week</span>
      <div class="wbars" role="img" aria-label="Tasks done per week, last 8 weeks: ${weeks.map((w) => w.n).join(', ')}">
        ${weeks.map((w, i) => `<div class="wbar" title="Week of ${fmtDay(dayKey(w.s))}: ${w.n} done">
          <span class="mono small ${i === weeks.length - 1 || w.n === maxW ? '' : 'invisible'}">${w.n}</span>
          <span class="wbar-fill" style="height:${Math.round((w.n / maxW) * 100)}%"></span>
        </div>`).join('')}
      </div>
      <div class="wbar-axis mono small muted"><span>${fmtDay(dayKey(weeks[0].s))}</span><span>this week</span></div>
    </section>

    <section class="block">
      <span class="label">Mood · last 30 days</span>
      <div class="mchart" role="img" aria-label="Mood over the last 30 days, average ${avgMood}">
        ${moods.map((m) => `<span class="mcol" title="${fmtDay(dayKey(m.d))}: ${m.v ? `mood ${m.v}` : 'not logged'}">${m.v ? `<span class="mdot" style="bottom:${(m.v - 1) * 25}%"></span>` : ''}</span>`).join('')}
      </div>
      <div class="wbar-axis mono small muted"><span>${fmtDay(dayKey(days30[0]))}</span><span>today</span></div>
      ${logged.length ? '' : '<p class="small muted">Tap a mood on Now each day, or speak in the journal.</p>'}
    </section>
  </div>

  <section class="block">
    <div class="label-row"><span class="label">Active goals</span><a class="link" href="#/plan">Plan</a></div>
    ${goals.length ? goals.map((g) => progressRow(g)).join('') : '<p class="muted">No active goals.</p>'}
  </section>`;
}

// ── GMAIL INBOX (job suggestions) ───────────────────────────────────────
async function viewInbox() {
  const list = await gmail.suggestions();
  const gm = (await db.kvGet('gmail')) || {};
  const last = await db.kvGet('gmailLastScan');
  const statuses = MODULE.jobs.fields.find((x) => x.k === 'status').options;
  return `${header('From Gmail', { kicker: 'JOB APPLICATIONS' })}
  <section class="block">
    <button type="button" class="btn primary wide" data-action="gmail-scan">Scan Gmail</button>
    <p class="small muted" id="scan-status">${gm.clientId ? (last ? `Last scan ${new Date(last).toLocaleString('en-IN')}` : 'Never scanned. The first scan looks back ' + (gm.firstDays || 90) + ' days.') : 'Set up Gmail in Settings first.'}</p>
  </section>
  ${list.length ? list.map((s) => `<form class="block mail" data-form="gmail-accept" data-msg="${esc(s.msgId)}">
    <div class="label-row"><span class="label">${s.kind === 'update' ? 'Status update' : 'New application'} · ${fmtDay(s.date)}</span><a class="link" href="${esc(gmail.mailLink(s.threadId))}" target="_blank" rel="noopener">Open email</a></div>
    <p class="mail-subj">${esc(s.subject)}</p>
    <p class="small muted">${esc(s.from)} · ${esc(s.snippet)}</p>
    <div class="mail-fields">
      <div class="field"><label for="c-${esc(s.msgId)}">Company</label><input id="c-${esc(s.msgId)}" name="company" value="${esc(s.kind === 'update' && s.jobId && db.get(s.jobId) ? db.get(s.jobId).data.company : s.company)}" ${s.kind === 'update' ? 'readonly' : ''}></div>
      <div class="field"><label for="r-${esc(s.msgId)}">Role</label><input id="r-${esc(s.msgId)}" name="role" value="${esc(s.kind === 'update' && s.jobId && db.get(s.jobId) ? db.get(s.jobId).data.role || '' : s.role)}" ${s.kind === 'update' ? 'readonly' : ''}></div>
      <div class="field"><label for="s-${esc(s.msgId)}">Status</label><select id="s-${esc(s.msgId)}" name="status">${statuses.map((o) => `<option ${o === s.status ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
    </div>
    <div class="form-actions"><button class="btn primary" type="submit">${s.kind === 'update' ? 'Update job' : 'Add to Jobs'}</button><button class="btn ghost" type="button" data-action="gmail-ignore" data-msg="${esc(s.msgId)}">Ignore</button></div>
  </form>`).join('') : `<div class="empty"><p>No suggestions waiting.</p></div>`}`;
}

// ── GUIDED WEEKLY REVIEW ────────────────────────────────────────────────
async function viewReview() {
  const t0 = startOfToday();
  const start = new Date(t0); start.setDate(start.getDate() - 6);
  const days7 = lastNDays(7);
  const inWeek = (s) => s && parseDay(s) >= start;
  const doneTasks = db.list('tasks').filter((r) => inWeek(completedDay(r)));
  const habits = db.list('habits').filter((h) => h.data.active !== false);
  const moods = days7.map((d) => db.list('days').find((r) => r.data.date === dayKey(d))?.data.mood).filter(Boolean);
  const avgMood = moods.length ? (moods.reduce((a, b) => a + Number(b), 0) / moods.length).toFixed(1) : '–';
  const entries = db.list('journal').filter((r) => inWeek((r.data.at || '').slice(0, 10))).length;
  const hist = (await db.allHistory()).filter((h) => h.module === 'jobs' && Date.parse(h.at) >= start.getTime());
  const jobsTouched = new Set(hist.map((h) => h.recordId)).size;
  const weekGoals = db.list('goals').filter((g) => g.data.horizon === 'week' && g.data.status !== 'dropped');
  const overdue = db.list('tasks').filter((r) => r.data.status !== 'done' && r.data.due && r.data.due < todayStr()).length;

  return `${header('Weekly review', { kicker: `${fmtDay(dayKey(start))} – ${fmtDay(dayKey(t0))}` })}
  <p class="lead">Ten minutes. Look at what happened, then answer four questions. It's saved under Plan → Reviews.</p>
  <div class="stats">
    <div class="stat"><span class="stat-v">${doneTasks.length}</span><span class="mono">tasks done</span></div>
    <div class="stat"><span class="stat-v">${overdue}</span><span class="mono">tasks overdue</span></div>
    <div class="stat"><span class="stat-v">${avgMood}</span><span class="mono">average mood</span></div>
    <div class="stat"><span class="stat-v">${entries}</span><span class="mono">journal entries</span></div>
    <div class="stat"><span class="stat-v">${jobsTouched}</span><span class="mono">applications moved</span></div>
    <div class="stat"><span class="stat-v">${weekGoals.length ? Math.round(weekGoals.reduce((a, g) => a + (Number(g.data.progress) || 0), 0) / weekGoals.length) + '%' : '–'}</span><span class="mono">weekly goals</span></div>
  </div>
  ${habits.length ? `<section class="block"><span class="label">Habits this week</span><ul class="simple">${habits.map((h) => {
    const n = days7.filter((d) => (h.data.log || {})[dayKey(d)]).length;
    const target = Math.min(7, Number(h.data.perWeek) || 7);
    return `<li><div><span class="l"><span class="dot" style="--c:${n >= target ? 'var(--accent)' : 'var(--warn)'}"></span><span>${esc(h.data.name)}</span></span><span class="r">${n}/${target}</span></div></li>`;
  }).join('')}</ul></section>` : ''}
  ${doneTasks.length ? `<section class="block"><span class="label">You finished</span><ul class="simple">${doneTasks.slice(0, 6).map((r) => `<li><a href="#/r/${r.id}"><span class="l"><span class="dot"></span><span>${esc(titleOf(r))}</span></span><span class="r">${fmtDay(completedDay(r))}</span></a></li>`).join('')}</ul></section>` : ''}
  <form class="form" data-form="review">
    <div class="field"><label for="rv-well">What went well?</label><textarea id="rv-well" name="wentWell" rows="3"></textarea></div>
    <div class="field"><label for="rv-didnt">What didn't, and why?</label><textarea id="rv-didnt" name="didnt" rows="3"></textarea></div>
    <div class="field"><label for="rv-learned">What did you learn?</label><textarea id="rv-learned" name="learned" rows="2"></textarea></div>
    <div class="field"><label for="rv-next">Top 3 for next week (one per line, they become weekly goals)</label><textarea id="rv-next" name="next" rows="3"></textarea></div>
    <fieldset class="field"><legend>Rate the week</legend><div class="mood">${[1, 2, 3, 4, 5].map((n) => `<label class="rate"><input type="radio" name="score" value="${n}"><span>${n}</span></label>`).join('')}</div></fieldset>
    <div class="form-actions"><button class="btn primary wide" type="submit">Save review</button></div>
  </form>`;
}

// ── SETUP GUIDE ─────────────────────────────────────────────────────────
async function viewSetup() {
  const done = SETUP.filter(setupDone).length;
  return `${header('Set up', { kicker: `${done} OF ${SETUP.length} DONE` })}
  <p class="muted lead">Enter these once. After that the app reminds you before anything expires or is due. Each step takes 2–10 minutes; do them in any order.</p>
  <ol class="steps">${SETUP.map((s, i) => {
    const ok = setupDone(s);
    const count = s.modules.reduce((n, m) => n + db.list(m).length, 0);
    return `<li class="${ok ? 'ok' : ''}">
      <span class="step-no mono">${ok ? icon('check', 16) : String(i + 1).padStart(2, '0')}</span>
      <div class="step-body">
        <span class="step-title">${esc(s.title)}${count ? ` <span class="mono small muted">· ${count}</span>` : ''}</span>
        <span class="small muted">${esc(s.why)}</span>
        <span class="step-actions">
          ${s.starter && !count ? '<button type="button" class="btn primary small" data-action="starter-links">Add starter links</button>' : ''}
          ${s.modules.map((m) => `<a class="btn ${ok || s.starter ? 'ghost' : 'primary'} small" href="#/new/${m}${s.query ? `?${s.query}` : ''}">+ ${esc(MODULE[m].name)}</a>`).join('')}
          ${count ? `<a class="link" href="#/${s.modules[0] === 'links' ? 'links' : `m/${s.modules[0]}`}">View</a>` : ''}
        </span>
      </div>
    </li>`;
  }).join('')}</ol>`;
}

function progressRow(g) {
  const p = Math.max(0, Math.min(100, Number(g.data.progress) || 0));
  return `<a class="progress-row" href="#/r/${g.id}">
    <span class="pr-top"><span>${esc(g.data.title)}</span><span class="mono small muted">${p}%</span></span>
    <span class="bar"><span style="width:${p}%"></span></span>
  </a>`;
}

// ── PLAN ────────────────────────────────────────────────────────────────
async function viewPlan(horizon = 'year') {
  const hs = ['life', 'year', 'quarter', 'month', 'week'];
  const goals = db.list('goals').filter((g) => g.data.horizon === horizon).sort((a, b) => (a.data.status === 'active' ? -1 : 1) - (b.data.status === 'active' ? -1 : 1));
  const revisit = reminders().filter((x) => x.r.module === 'decisions');
  const lastReview = db.list('reviews').sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''))[0];
  return `${header('Plan', { kicker: 'Where you are going' })}
  <nav class="tabs" aria-label="Horizon">${hs.map((h) => `<a href="#/plan/${h}" class="${h === horizon ? 'on' : ''}" aria-current="${h === horizon ? 'page' : 'false'}">${h}</a>`).join('')}</nav>
  <section class="block">
    <div class="label-row"><span class="label">${esc(horizon)} goals</span><a class="link" href="#/new/goals?horizon=${horizon}">+ Goal</a></div>
    ${goals.length ? goals.map((g) => {
      const parent = g.data.parent && db.get(g.data.parent);
      return `${progressRow(g)}${parent ? `<p class="small muted indent">part of ${esc(titleOf(parent))}</p>` : ''}`;
    }).join('') : '<p class="muted">None yet.</p>'}
  </section>
  <div class="grid-2">
    <section class="block">
      <span class="label">Review</span>
      <p class="muted small">${lastReview ? `Last: ${esc(lastReview.data.period)} review, ${fmtDay(lastReview.data.date)}` : 'No reviews yet. 15 minutes every Sunday is the habit that makes all of this work.'}</p>
      <a class="btn primary wide" href="#/review">Start weekly review</a>
    </section>
    <section class="block">
      <span class="label">Decisions</span>
      <p class="muted small">${revisit.length ? `${revisit.length} decision(s) due for a check-back.` : 'Log big decisions with what you expect, then check back.'}</p>
      <a class="btn ghost wide" href="#/m/decisions">Decision log</a>
    </section>
  </div>
  <section class="block"><span class="label">Everything in Plan</span><ul class="simple">
    ${['tasks', 'habits', 'goals', 'reviews', 'decisions', 'lessons', 'vision'].map((m) => `<li><a href="#/m/${m}"><span class="l"><span>${esc(MODULE[m].name)}</span></span><span class="r">${db.list(m).length} ›</span></a></li>`).join('')}
    <li><a href="#/progress"><span class="l"><span>Progress & streaks</span></span><span class="r">›</span></a></li>
  </ul></section>`;
}

// ── JOURNAL ─────────────────────────────────────────────────────────────
function statusText(s) {
  return {
    pending: 'Waiting to transcribe…',
    transcribing: 'Transcribing…',
    failed: 'Transcription failed. Open to retry.',
    'no-transcriber': 'Voice note saved. Set up transcription in Settings to get text.',
  }[s] || '';
}

async function viewJournal() {
  const entries = db.list('journal').sort((a, b) => (b.data.at || '').localeCompare(a.data.at || ''));
  const byDay = new Map();
  for (const e of entries) {
    const k = (e.data.at || '').slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  return `${header('Journal', { kicker: `${entries.length} ${entries.length === 1 ? 'ENTRY' : 'ENTRIES'}` })}
  <section class="block center">
    <button type="button" class="mic-big" data-action="record" aria-label="Record a voice entry">${icon('mic', 34)}</button>
    <p class="muted small">Speak in Hindi, English or both. Saved with date and time.</p>
    <a class="link" href="#/new/journal">Type instead</a>
  </section>
  ${[...byDay.entries()].map(([day, list]) => `<section class="block">
    <span class="label">${day ? fmtDay(day) : 'Undated'}</span>
    ${list.map((e) => `<a class="entry" href="#/r/${e.id}">
      <span class="mono small muted">${fmtTime(e.data.at)}${e.data.kind === 'daily journal' ? ' · DAILY' : ''}${e.data.mood ? ` · MOOD ${e.data.mood}` : ''}</span>
      <span>${esc(e.data.text || statusText(e.data.status) || 'Empty entry')}</span>
    </a>`).join('')}
  </section>`).join('') || emptyState('No entries yet. Tap the mic and talk for 30 seconds.')}`;
}

// ── LIFE (all modules) ─────────────────────────────────────────────────
// ── LIFE: 8 rooms ───────────────────────────────────────────────────────
const sumOf = (mod, k) => db.list(mod).reduce((n, r) => n + (Number(r.data[k]) || 0), 0);
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
function roomReminders(room) {
  return reminders().filter((x) => room.modules.includes(x.r.module));
}
function roomKpis(room) {
  const n = (m) => db.list(m).length;
  switch (room.id) {
    case 'career': {
      const jobs = db.list('jobs');
      return [['Active applications', jobs.filter((j) => !isDone(j) && j.data.status !== 'to apply').length], ['Interviews', jobs.filter((j) => j.data.status === 'interview').length]];
    }
    case 'money': return [['Invested', inr(sumOf('accounts', 'value'))], ['Loans outstanding', inr(sumOf('loans', 'outstanding'))]];
    case 'health': return [['Medical records', n('medical')], ['Medicines', n('medicines')]];
    case 'people': return [['People', n('people')], ['Favours open', db.list('favours').filter((f) => !f.data.done).length]];
    case 'home': return [['Vehicles', n('vehicles')], ['Documents', n('documents')]];
    case 'learning': return [['Reading', db.list('books').filter((b) => b.data.status === 'reading').length], ['Books done', db.list('books').filter((b) => b.data.status === 'done').length]];
    case 'travel': return [['Trips', n('trips')], ['Countries', new Set(db.list('trips').map((x) => (x.data.country || '').trim().toLowerCase()).filter(Boolean)).size]];
    default: return [['Journal entries', n('journal')], ['Links', n('links')]];
  }
}
function roomFact(room) {
  const urgent = roomReminders(room).find((x) => x.days <= 14);
  const second = room.modules.map((m) => MODULE[m].name).slice(0, 3).join(', ');
  if (urgent) return [`${titleOf(urgent.r)}: ${urgent.label} · ${urgent.days < 0 ? `${-urgent.days}d overdue` : rel(urgent.days)}`, second];
  const total = room.modules.reduce((s, m) => s + db.list(m).length, 0);
  if (!total) return ['Nothing here yet', second];
  const [k1, v1] = roomKpis(room)[0];
  const word = v1 === 1 ? k1.toLowerCase().replace(/ies\b/, 'y').replace(/s\b/, '') : k1.toLowerCase();
  return [`${v1} ${word}`, second];
}

async function viewLife() {
  const recent = db.all().filter((r) => MODULE[r.module]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const ago = (iso) => { const m = (Date.now() - Date.parse(iso)) / 6e4; return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 2880 ? 'Yesterday' : fmtDay(iso.slice(0, 10)); };
  return `${header('Life', { kicker: 'Everything you keep track of', actions: `<a class="icon-btn" href="#/settings" aria-label="Settings">${icon('gear', 18)}</a>` })}
  <div class="rooms">${ROOMS.map((room) => {
    const late = roomReminders(room).filter((x) => x.days < 0).length;
    const [f1, f2] = roomFact(room);
    return `<a class="room-card ${late ? 'alert' : ''}" href="#/room/${room.id}" style="--c:${room.color}">
      <span class="rc-top"><span class="rc-name">${esc(room.name)}</span>${late ? `<span class="badge">${late}</span>` : `<span class="dot" style="--c:${room.color}"></span>`}</span>
      <span class="rc-fact">${esc(f1)}<span>${esc(f2)}</span></span>
    </a>`;
  }).join('')}</div>
  ${recent.length ? `<section class="block"><span class="label">Recently changed</span><ul class="simple">${recent.map((r) => `<li><a href="#/r/${r.id}"><span class="l"><span class="dot" style="--c:${colorOf(r.module)}"></span><span>${esc(r.module === 'journal' ? 'Journal entry' : titleOf(r))}</span></span><span class="r">${ago(r.updatedAt)}</span></a></li>`).join('')}</ul></section>` : ''}
  <section class="block"><span class="label">More</span><ul class="simple">
    <li><a href="#/setup"><span class="l"><span>Set up guide</span></span><span class="r">${SETUP.filter(setupDone).length}/${SETUP.length}</span></a></li>
    <li><a href="#/settings"><span class="l"><span>Settings</span></span><span class="r">›</span></a></li>
    <li><a href="#/trash"><span class="l"><span>Trash</span></span><span class="r">${db.trash().length}</span></a></li>
  </ul></section>`;
}

function collectionHref(m) {
  return m === 'journal' ? '#/journal' : m === 'links' ? '#/links' : `#/m/${m}`;
}

async function viewRoom(id) {
  const room = ROOM[id];
  if (!room) return emptyState('Unknown room.', '#/life', 'Back to Life');
  const attn = roomReminders(room).filter((x) => x.days <= Math.max(x.r ? 30 : 0, 30)).slice(0, 4);
  return `<div class="room-head" style="--c:${room.color}">
    ${header(room.name, { back: { name: 'Life', href: '#/life' } })}
    <div class="kpis">${roomKpis(room).map(([k, v]) => `<div class="kpi"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('')}</div>
  </div>
  ${attn.length ? `<section class="block"><span class="label">Needs attention</span><div class="attn">${attn.map((x) => {
    const cls = x.days < 0 ? 'late' : x.days <= 7 ? 'soon' : '';
    const txt = x.days < 0 ? `${-x.days}d` : x.days === 0 ? 'Today' : `${x.days}d`;
    return `<a href="#/r/${x.r.id}"><span class="cd-badge ${cls}">${txt}</span><span class="t"><span>${esc(titleOf(x.r))}</span><span>${esc(x.label)} · ${x.days < 0 ? 'overdue' : rel(x.days)}</span></span></a>`;
  }).join('')}</div></section>` : ''}
  <section class="block"><span class="label">In this room</span><ul class="simple">
    ${room.modules.map((m) => `<li><a href="${collectionHref(m)}"><span class="l"><span>${esc(MODULE[m].name)}</span></span><span class="r">${db.list(m).length} ›</span></a></li>`).join('')}
    ${(room.extra || []).map((e) => `<li><a href="${esc(e.href)}"><span class="l"><span>${esc(e.name)}</span></span><span class="r">›</span></a></li>`).join('')}
  </ul></section>`;
}

function renderSide() {
  const side = $('#side');
  if (!side) return;
  const curRoom = currentRoute.name === 'room' ? currentRoute.parts[0] : roomOf(moduleOfRoute(currentRoute))?.id;
  side.innerHTML = `<a class="brand" href="#/now">Life</a>
    <a href="#/now" data-nav="today">${icon('now', 18)}Today</a>
    <a href="#/life" data-nav="life">${icon('life', 18)}Life</a>
    <a href="#/plan" data-nav="plan">${icon('plan', 18)}Plan</a>
    <a href="#/search" data-nav="search">${icon('search', 18)}Search</a>
    <div class="side-h">Rooms</div>
    ${ROOMS.map((r) => `<a href="#/room/${r.id}" class="${curRoom === r.id ? 'on' : ''}"><span class="dot" style="--c:${r.color}"></span>${esc(r.name)}</a>`).join('')}
    <div class="side-h">More</div>
    <a href="#/settings">${icon('gear', 18)}Settings</a>`;
  const top = tabFor(currentRoute);
  for (const a of side.querySelectorAll('a[data-nav]')) a.classList.toggle('on', a.dataset.nav === top && !curRoom);
}

// ── MODULE LIST ─────────────────────────────────────────────────────────
function sortRecords(m, list) {
  if (m.sort) return list.sort((a, b) => String(b.data[m.sort] || '').localeCompare(String(a.data[m.sort] || '')));
  // soonest deadline first, then recently changed; done items last
  const key = (r) => { const c = countdownsOf(r)[0]; return c ? c.days : 1e6; };
  return list.sort((a, b) => (isDone(a) - isDone(b)) || (key(a) - key(b)) || b.updatedAt.localeCompare(a.updatedAt));
}

function listHtml(m, filter, q) {
  let list = db.list(m.id);
  if (filter && m.status) list = list.filter((r) => r.data[m.status] === filter);
  if (q) list = list.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()));
  list = sortRecords(m, list);
  if (!list.length) return q || filter ? '<p class="muted pad">No matches.</p>' : '';
  const sf = m.status && m.fields.find((x) => x.k === m.status);
  if (sf && !filter && !q && list.length > 3) {
    const groups = [...sf.options, ''].map((o) => [o, list.filter((r) => (r.data[m.status] || '') === o)]).filter(([, l]) => l.length);
    return groups.map(([o, l]) => `<div class="group-head mono">${esc(o || 'no ' + sf.label.toLowerCase())} <span>${l.length}</span></div>${l.map((r) => row(r, { noStatus: true })).join('')}`).join('');
  }
  return list.map((r) => row(r, { noStatus: !!filter })).join('');
}

// What each section is for, shown when it's empty (setup lives in the tree).
const HINTS = {
  tasks: 'Anything you need to do. Give it a "when" (today, this week…) and optionally a due date.',
  habits: 'Pick 3–5 habits. They become one-tap toggles on Today, with streaks.',
  goals: 'Start with a few yearly goals, then break them into months and weeks.',
  jobs: 'Every application: company, role, status, link, next follow-up. Gmail can fill this for you.',
  documents: 'Passport, PAN, Aadhaar, licence, degrees. Store expiry, where the original is, and a scan link. Last 4 digits only.',
  vehicles: 'Car or bike: insurance, PUC and service dates get reminders; note where the RC is.',
  insurance: 'Health, term, vehicle policies: renewal date, cover, nominee.',
  accounts: 'Banks, mutual funds, EPF, PPF, stocks: where they are and who the nominee is.',
  loans: 'EMIs and credit cards: amount and due day.',
  people: "People who matter: birthday, last contact, things to remember. Birthdays can go to Google Calendar.",
  healthprofile: 'Blood group, allergies, conditions, vaccinations, check-up dates.',
  possessions: 'Phone, laptop, appliances: warranty end date and invoice link.',
  links: 'Profiles, finance logins, government portals: everything you open often.',
  trips: 'Places you went, with dates, people, cost and a photo album link.',
  subscriptions: 'Netflix, Spotify, cloud storage…: cost and renewal date.',
  books: 'Books to read, reading, and done, with 3 takeaways each.',
  emergency: 'Emergency contacts, blood group, what to do if you are hospitalised.',
};

function startCard(m) {
  return `<section class="block start">
    <span class="label">Start here</span>
    <p class="start-text">${esc(HINTS[m.id] || `Nothing in ${m.name} yet.`)}</p>
    <div class="form-actions">
      ${m.id === 'links' ? '<button type="button" class="btn primary" data-action="starter-links">Add starter links</button>' : ''}
      <a class="btn ${m.id === 'links' ? 'ghost' : 'primary'}" href="#/new/${m.id}">+ Add ${esc(m.name.toLowerCase().replace(/s$/, ''))}</a>
    </div>
  </section>`;
}

async function viewModule(id, filter = '') {
  const m = MODULE[id];
  if (!m) return emptyState('Unknown section.', '#/life', 'Back to Life');
  const statusField = m.status && m.fields.find((x) => x.k === m.status);
  const counts = {};
  if (statusField) for (const r of db.list(id)) counts[r.data[m.status]] = (counts[r.data[m.status]] || 0) + 1;
  return `${header(m.name, { kicker: plural(db.list(id).length, 'ITEM'), actions: `${id === 'jobs' ? '<a class="btn ghost small" href="#/inbox">Gmail</a>' : ''}<a class="btn primary small" href="#/new/${id}">+ New</a>` })}
  ${db.list(id).length ? `<div class="toolbar">
    <label class="search-box">${icon('search', 16)}<input type="search" data-filter="${id}" data-status="${esc(filter)}" placeholder="Filter ${esc(m.name.toLowerCase())}" aria-label="Filter"></label>
  </div>` : ''}
  ${statusField ? `<nav class="chips" aria-label="Status filter">
    <a href="#/m/${id}" class="chip ${!filter ? 'on' : ''}">all</a>
    ${statusField.options.filter((o) => counts[o]).map((o) => `<a href="#/m/${id}/${encodeURIComponent(o)}" class="chip ${filter === o ? 'on' : ''}">${esc(o)} · ${counts[o]}</a>`).join('')}
  </nav>` : ''}
  ${db.list(id).length ? `<div class="list" id="list">${listHtml(m, filter, '')}</div>` : startCard(m)}`;
}

// ── FORMS ───────────────────────────────────────────────────────────────
function fieldHtml(fd, value) {
  if (fd.hidden) return '';
  const id = `f-${fd.k}`;
  const v = value ?? '';
  const label = `<label for="${id}">${esc(fd.label)}${fd.req ? ' *' : ''}</label>`;
  const ph = fd.ph ? ` placeholder="${esc(fd.ph)}"` : '';
  if (fd.readonly) return v ? `<div class="field"><span class="flabel">${esc(fd.label)}</span><p class="readonly">${esc(v)}</p></div>` : '';
  switch (fd.type) {
    case 'long': return `<div class="field">${label}<textarea id="${id}" name="${fd.k}" rows="4"${ph}>${esc(v)}</textarea></div>`;
    case 'date': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="date" value="${esc(v)}"></div>`;
    case 'datetime': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="datetime-local" value="${esc(v)}"></div>`;
    case 'number': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="number" inputmode="decimal" step="any" value="${esc(v)}"${ph}></div>`;
    case 'money': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="number" inputmode="decimal" step="any" value="${esc(v)}" placeholder="₹"></div>`;
    case 'url': return `<div class="field">${label}<div class="url-row"><input id="${id}" name="${fd.k}" type="url" value="${esc(v)}" placeholder="https://"${''}>${v ? `<a class="btn ghost small" href="${esc(v)}" target="_blank" rel="noopener">Open</a>` : ''}</div></div>`;
    case 'secret4': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="text" inputmode="numeric" maxlength="4" pattern="[0-9A-Za-z]{0,4}" value="${esc(v)}" placeholder="Last 4 only"></div>`;
    case 'select': return `<div class="field">${label}<select id="${id}" name="${fd.k}"><option value=""></option>${fd.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    case 'check': return `<div class="field check"><input id="${id}" name="${fd.k}" type="checkbox" ${value ? 'checked' : ''}><label for="${id}">${esc(fd.label)}</label></div>`;
    case 'tags': return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="text" value="${esc(Array.isArray(v) ? v.join(', ') : v)}" placeholder="comma, separated"></div>`;
    case 'links': return `<div class="field">${label}<textarea id="${id}" name="${fd.k}" rows="2" placeholder="One link per line">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>${Array.isArray(v) && v.length ? `<div class="links">${v.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 40))}</a>`).join('')}</div>` : ''}</div>`;
    case 'rating': return `<fieldset class="field"><legend>${esc(fd.label)}</legend><div class="mood">${[1, 2, 3, 4, 5].map((n) => `<label class="rate"><input type="radio" name="${fd.k}" value="${n}" ${Number(v) === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></fieldset>`;
    case 'ref': {
      const opts = db.list(fd.ref);
      return `<div class="field">${label}<select id="${id}" name="${fd.k}"><option value=""></option>${opts.map((r) => `<option value="${r.id}" ${r.id === v ? 'selected' : ''}>${esc(titleOf(r))}</option>`).join('')}</select></div>`;
    }
    default: return `<div class="field">${label}<input id="${id}" name="${fd.k}" type="text" value="${esc(v)}"${ph}></div>`;
  }
}

// Forms are a small tree too: fields grouped into sub-sections.
const FGROUPS = [
  { id: 'basics', name: 'Basics', test: (fd) => !['date', 'datetime', 'money', 'url', 'links', 'long'].includes(fd.type) },
  { id: 'dates', name: 'Dates & reminders', test: (fd) => fd.type === 'date' || fd.type === 'datetime' },
  { id: 'money', name: 'Money', test: (fd) => fd.type === 'money' },
  { id: 'files', name: 'Files & links', test: (fd) => fd.type === 'url' || fd.type === 'links' },
  { id: 'notes', name: 'Notes', test: (fd) => fd.type === 'long' },
];
function formFields(m, data) {
  const visible = m.fields.filter((fd) => !fd.hidden && !(fd.readonly && isEmpty(data[fd.k])));
  if (visible.length <= 5) return visible.map((fd) => fieldHtml(fd, data[fd.k])).join('');
  const has = (fd) => !isEmpty(data[fd.k]) && data[fd.k] !== false;
  return FGROUPS.map((g) => {
    const fs = visible.filter(g.test);
    if (!fs.length) return '';
    const filled = fs.filter(has).length;
    const tk = typeof m.title === 'string' ? m.title : '';
    const open = g.id === 'basics' || fs.some((fd) => fd.req || fd.remind !== undefined || fd.k === tk) || filled > 0;
    return `<details class="fgroup" ${open ? 'open' : ''}>
      <summary><span class="fg-name">${esc(g.name)}</span><span class="fg-n mono">${filled}/${fs.length}</span></summary>
      <div class="fg-body">${fs.map((fd) => fieldHtml(fd, data[fd.k])).join('')}</div>
    </details>`;
  }).join('');
}

function readForm(form, m) {
  const fdata = new FormData(form);
  const out = {};
  for (const fd of m.fields) {
    if (fd.hidden || fd.readonly) continue;
    if (fd.type === 'check') { out[fd.k] = form.elements[fd.k]?.checked || false; continue; }
    let v = fdata.get(fd.k);
    if (v === null) continue;
    v = String(v).trim();
    if (fd.type === 'number' || fd.type === 'money' || fd.type === 'rating') out[fd.k] = v === '' ? '' : Number(v);
    else if (fd.type === 'tags') out[fd.k] = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    else if (fd.type === 'links') out[fd.k] = v ? v.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    else out[fd.k] = v;
  }
  return out;
}

function missingRequired(m, data) {
  return m.fields.filter((fd) => fd.req && !fd.hidden && (data[fd.k] === '' || data[fd.k] === undefined)).map((fd) => fd.label);
}

async function viewNew(idWithQuery) {
  const [id, qs] = (idWithQuery || '').split('?');
  const m = MODULE[id];
  if (!m) return emptyState('Unknown section.', '#/life', 'Back to Life');
  const data = defaults(id);
  if (qs) for (const [k, v] of new URLSearchParams(qs)) data[k] = v;
  if (id === 'journal') { data.at = localStamp(); data.status = 'typed'; }
  if (id === 'days') data.date = todayStr();
  if (id === 'reviews' || id === 'decisions' || id === 'wins' || id === 'lessons') data.date = todayStr();
  return `${header(`New · ${m.name}`)}
  <form class="form" data-form="new" data-module="${id}">
    ${formFields(m, data)}
    ${Object.entries(data).filter(([k]) => m.fields.find((x) => x.k === k)?.hidden).map(([k, v]) => `<input type="hidden" data-hidden="${esc(k)}" value="${esc(JSON.stringify(v))}">`).join('')}
    <div class="form-actions"><button class="btn primary wide" type="submit">Save</button></div>
  </form>`;
}

// ── RECORD DETAIL ───────────────────────────────────────────────────────
// Read-only display of one field value.
function valueHtml(fd, v, r) {
  switch (fd.type) {
    case 'date': {
      const days = diffDays(parseDay(v), startOfToday());
      return `${esc(fmtDay(v))} <span class="mono small ${days < 0 && fd.remind !== undefined ? 'warn' : 'muted'}">· ${rel(days)}</span>`;
    }
    case 'datetime': return `${esc(fmtDay(v))} · ${esc(fmtTime(v))}`;
    case 'money': return `₹${Number(v).toLocaleString('en-IN')}`;
    case 'number': return esc(Number(v).toLocaleString('en-IN'));
    case 'url': return `<a class="ext" href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 48))} ${icon('out', 14)}</a>`;
    case 'links': return v.map((u) => `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))} ${icon('out', 14)}</a>`).join('<br>');
    case 'tags': return `<span class="tagrow">${v.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>`;
    case 'check': return v ? 'Yes' : 'No';
    case 'rating': return `<span class="dots" aria-label="${v} of 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= v ? 'on' : ''}"></i>`).join('')}</span>`;
    case 'ref': { const t = db.get(v); return t ? `<a href="#/r/${t.id}">${esc(titleOf(t))}</a>` : '—'; }
    case 'secret4': return `<span class="mono">•••• ${esc(v)}</span>`;
    case 'long': return `<span class="prose">${esc(v)}</span>`;
    default: return esc(v);
  }
}
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

async function viewRecord(id, tab = 'view') {
  const r = db.get(id);
  if (!r) return emptyState('This item no longer exists.', '#/life', 'Back to Life');
  const m = MODULE[r.module];
  const deleted = !!r.deletedAt;
  const isJournal = r.module === 'journal';
  const title = isJournal ? `${fmtDay(r.data.at)} · ${fmtTime(r.data.at)}` : titleOf(r);
  const tabs = `<nav class="tabs" aria-label="View">
    <a href="#/r/${id}" class="${tab === 'view' ? 'on' : ''}">Overview</a>
    <a href="#/r/${id}/edit" class="${tab === 'edit' ? 'on' : ''}">Edit</a>
    <a href="#/r/${id}/history" class="${tab === 'history' ? 'on' : ''}">History</a>
  </nav>`;
  const trashNote = deleted ? `<div class="notice">In Trash. <button type="button" class="link" data-action="restore-trash" data-id="${id}">Restore</button></div>` : '';

  if (tab === 'history') {
    return `${header(title, { kicker: 'HISTORY' })}${trashNote}${tabs}<section class="block" id="history" data-id="${id}"><p class="muted">Loading…</p></section>`;
  }
  if (tab === 'edit') {
    return `${header(title, { kicker: 'EDITING' })}${trashNote}${tabs}
    <form class="form" data-form="edit" data-id="${id}" data-module="${r.module}">
      ${formFields(m, r.data)}
      <div class="form-actions">
        <button class="btn primary" type="submit">Save changes</button>
        <a class="btn ghost" href="#/r/${id}">Cancel</a>
      </div>
    </form>`;
  }

  // ── overview (read-only, with quick actions) ──
  const tk = typeof m.title === 'string' ? m.title : null;
  const statusField = m.status && m.fields.find((x) => x.k === m.status);
  const visible = m.fields.filter((fd) => !fd.hidden && fd.k !== tk && fd.k !== m.status && !(isJournal && ['text', 'at'].includes(fd.k)));
  const filled = visible.filter((fd) => !isEmpty(r.data[fd.k]) && fd.type !== 'long');
  const longs = visible.filter((fd) => !isEmpty(r.data[fd.k]) && fd.type === 'long');
  const empty = visible.filter((fd) => isEmpty(r.data[fd.k]));
  const t0 = startOfToday();
  const countdowns = m.fields.filter((fd) => fd.remind !== undefined && r.data[fd.k] && !isDone(r)).map((fd) => {
    let d = parseDay(r.data[fd.k]);
    if (fd.yearly) { d = new Date(t0.getFullYear(), d.getMonth(), d.getDate()); if (d < t0) d.setFullYear(d.getFullYear() + 1); }
    return { fd, days: diffDays(d, t0) };
  }).sort((a, b) => a.days - b.days);
  const done = isDone(r);
  const doneToggle = m.fields.find((x) => x.type === 'check' && ['done', 'settled'].includes(x.k));

  return `${header(title, { kicker: `<span class="dot" style="--c:${colorOf(r.module)}"></span>${esc(m.name)}`, sub: isJournal ? '' : subtitleOf(r), actions: deleted ? '' : `<a class="link" href="#/r/${id}/edit">Edit</a>` })}
  ${trashNote}${tabs}
  ${statusField ? `<section class="block">
    <span class="label">${esc(statusField.label)}</span>
    <div class="chips status-chips" role="group" aria-label="${esc(statusField.label)}">${statusField.options.map((o) => `<button type="button" class="chip ${r.data[m.status] === o ? 'on' : ''}" data-action="set-status" data-id="${id}" data-v="${esc(o)}" aria-pressed="${r.data[m.status] === o}">${esc(o)}</button>`).join('')}</div>
  </section>` : ''}
  ${countdowns.length ? `<div class="countdowns">${countdowns.map(({ fd, days }) => {
    const cls = days < 0 ? 'late' : days <= (fd.remind || 0) ? 'soon' : '';
    const v = days < 0 ? `${-days}d late` : days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`;
    const inner = `<span class="cd-v">${v}</span><span class="cd-k">${esc(fd.label)}</span>${fd.yearly ? '' : '<span class="cd-act">Update</span>'}`;
    return fd.yearly || deleted ? `<div class="cd ${cls}">${inner}</div>` : `<button type="button" class="cd ${cls}" data-action="renew" data-id="${id}" data-k="${fd.k}" aria-label="Update ${esc(fd.label)}">${inner}</button>`;
  }).join('')}</div>` : ''}
  ${isJournal ? `<section class="block"><span class="label">Entry</span><p class="prose big">${esc(r.data.text || statusText(r.data.status) || 'Empty entry')}</p></section>${journalExtras(r)}` : ''}
  ${filled.length ? `<section class="block"><span class="label">Details</span><dl class="spec">${filled.map((fd) => `<div><dt>${esc(fd.label)}</dt><dd>${valueHtml(fd, r.data[fd.k], r)}</dd></div>`).join('')}</dl></section>` : ''}
  ${longs.map((fd) => `<section class="block"><span class="label">${esc(fd.label)}</span><p class="prose">${esc(r.data[fd.k])}</p></section>`).join('')}
  ${r.module === 'jobs' ? jobTimeline(r) : ''}
  ${empty.length && !deleted ? `<a class="add-more" href="#/r/${id}/edit"><b>+ Add details</b><span>${esc(empty.slice(0, 4).map((x) => x.label).join(', '))}${empty.length > 4 ? '…' : ''}</span></a>` : ''}
  <div class="record-foot">
    ${r.module === 'jobs' && !deleted ? `<button class="btn small" type="button" data-action="merge-open" data-id="${id}">Merge into…</button>` : ''}
    ${deleted ? '' : `<button class="btn danger small" type="button" data-action="delete" data-id="${id}">Delete</button>`}
    <span class="mono">Updated ${fmtDay(r.updatedAt.slice(0, 10))}</span>
  </div>
  ${deleted ? '' : `<div class="action-bar">
    <a class="btn" href="#/r/${id}/edit">Edit</a>
    ${r.module === 'tasks' && !done ? `<button type="button" class="btn primary" data-action="set-status" data-id="${id}" data-v="done">Mark done</button>`
      : doneToggle ? `<button type="button" class="btn ${done ? '' : 'primary'}" data-action="toggle-done" data-id="${id}" data-k="${doneToggle.k}">${done ? 'Mark not done' : `Mark ${doneToggle.label.toLowerCase()}`}</button>`
      : isJournal ? '<button type="button" class="btn primary" data-action="record">New entry</button>' : ''}
  </div>`}`;
}

// One application's story: applied → screening → interview → result.
function jobTimeline(r) {
  const ev = [];
  if (r.data.appliedOn) ev.push({ date: r.data.appliedOn, status: 'applied', text: 'Applied', href: '' });
  for (const em of r.data.emails || []) ev.push({ date: em.date, status: em.status || '', text: em.subject, href: gmail.mailLink(em.threadId) });
  if (!ev.length) return '';
  ev.sort((a, b) => a.date.localeCompare(b.date) || (a.href ? 1 : -1));
  // drop the plain "Applied" row if an application email covers the same day
  const rows = ev.filter((e, i) => !(e.text === 'Applied' && ev.some((x, j) => j !== i && x.status === 'applied' && x.date === e.date)));
  return `<section class="block"><span class="label">Timeline</span><ol class="jt">${rows.map((e) => `<li class="jt-${esc(e.status)}">
    <span class="jt-date">${fmtDay(e.date)}</span>
    <span class="jt-body">${e.status ? `<span class="pill ${e.status === 'rejected' ? 'late' : e.status === 'interview' || e.status === 'offer' ? 'soon' : 'ghost'}">${esc(e.status)}</span>` : ''}${e.href ? `<a href="${esc(e.href)}" target="_blank" rel="noopener">${esc(e.text)}</a>` : `<span>${esc(e.text)}</span>`}</span>
  </li>`).join('')}</ol></section>`;
}

const JOB_RANK = { 'to apply': 0, applied: 1, screening: 2, interview: 3, offer: 4, accepted: 5, declined: 5, rejected: 5, ghosted: 5, withdrawn: 5 };
async function mergeJobs(srcId, dstId) {
  const src = db.get(srcId);
  const dst = db.get(dstId);
  if (!src || !dst) return;
  const emails = [...(dst.data.emails || [])];
  for (const em of src.data.emails || []) if (!emails.some((x) => x.id === em.id)) emails.push(em);
  emails.sort((a, b) => a.date.localeCompare(b.date));
  const patch = { emails };
  // fill empty fields on the target from the source (company name stays the target's)
  for (const fd of MODULE.jobs.fields) {
    if (fd.hidden || fd.k === 'company' || fd.k === 'status') continue;
    if (isEmpty(dst.data[fd.k]) && !isEmpty(src.data[fd.k])) patch[fd.k] = src.data[fd.k];
  }
  const latest = emails.filter((e) => e.status).pop();
  const best = [dst.data.status, src.data.status].sort((a, b) => (JOB_RANK[b] ?? 0) - (JOB_RANK[a] ?? 0))[0];
  patch.status = latest ? latest.status : best;
  if (['rejected', 'offer', 'accepted', 'declined', 'withdrawn', 'ghosted'].includes(patch.status)) { patch.nextAction = ''; patch.nextActionDate = ''; }
  else if (isEmpty(dst.data.nextAction) && src.data.nextAction) patch.nextAction = src.data.nextAction;
  if (!dst.data.appliedOn || (src.data.appliedOn && src.data.appliedOn < dst.data.appliedOn)) patch.appliedOn = src.data.appliedOn || dst.data.appliedOn || '';
  await db.update(dstId, patch);
  await db.remove(srcId);
}

function openMerge(id) {
  const r = db.get(id);
  const others = db.list('jobs').filter((j) => j.id !== id).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Merge application">
    <div class="grab"></div>
    <span class="label">Merge “${esc(titleOf(r))}” into…</span>
    <p class="small muted">Its emails and any missing details move to the one you pick, which keeps its own name. This one then goes to Trash.</p>
    <label class="search-box">${icon('search', 16)}<input type="search" id="merge-q" placeholder="Find company" aria-label="Find company"></label>
    <div class="merge-list" id="merge-list">${others.map((j) => `<button type="button" class="row" data-action="merge-into" data-src="${id}" data-dst="${j.id}" data-name="${esc(titleOf(j).toLowerCase())}"><span class="avatar" style="--c:${colorOf('jobs')}">${esc(titleOf(j).slice(0, 1).toUpperCase())}</span><span class="row-body"><span class="row-title">${esc(titleOf(j))}</span><span class="row-sub">${esc(j.data.status || '')}</span></span></button>`).join('') || '<p class="muted">No other applications.</p>'}</div>
  </div>`;
  sheet.classList.add('open');
}

function journalExtras(r) {
  const d = r.data;
  const audio = (d.audio || []).map((b) => `<audio controls preload="none" data-blob="${b}"></audio>`).join('');
  const st = statusText(d.status);
  const tasks = (d.suggestedTasks || []).map((t, i) => `<li><span>${esc(t)}</span><button type="button" class="btn ghost small" data-action="add-suggested" data-id="${r.id}" data-i="${i}">Add task</button></li>`).join('');
  return `<section class="block">
    ${audio ? `<div class="audio">${audio}</div>` : ''}
    ${st ? `<p class="muted small">${esc(st)}</p>` : ''}
    ${['failed', 'no-transcriber', 'pending'].includes(d.status) && (d.audio || []).length ? `<button type="button" class="btn ghost small" data-action="retry" data-id="${r.id}">Retry transcription</button>` : ''}
    ${tasks ? `<span class="label">Suggested tasks</span><ul class="suggest">${tasks}</ul>` : ''}
  </section>`;
}

let historyCache = new Map();
async function historyHtml(id) {
  const r = db.get(id);
  const m = MODULE[r.module];
  const entries = await db.historyFor(id);
  historyCache = new Map(entries.map((e) => [e.id, e]));
  const label = (k) => m.fields.find((x) => x.k === k)?.label || k;
  const show = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'yes' : v === false ? 'no' : v === '' || v === undefined || v === null ? '∅' : typeof v === 'object' ? '…' : String(v));
  if (!entries.length) return '<p class="muted">No history yet.</p>';
  return `<ol class="timeline">${entries.map((e, i) => {
    let changes = '';
    if (e.action === 'update' || e.action === 'revert' || e.action === 'undo') {
      const keys = [...new Set([...Object.keys(e.before || {}), ...Object.keys(e.after || {})])]
        .filter((k) => JSON.stringify((e.before || {})[k]) !== JSON.stringify((e.after || {})[k]))
        .filter((k) => m.fields.find((x) => x.k === k) && !m.fields.find((x) => x.k === k).hidden);
      changes = keys.map((k) => `<li><span class="muted">${esc(label(k))}:</span> <s>${esc(show((e.before || {})[k]).slice(0, 80))}</s> → ${esc(show((e.after || {})[k]).slice(0, 80))}</li>`).join('');
    }
    const when = new Date(e.at);
    return `<li>
      <span class="mono small muted">${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${pad(when.getHours())}:${pad(when.getMinutes())} · ${esc(e.device || '')}</span>
      <span class="act">${esc(e.action)}</span>
      ${changes ? `<ul class="diff">${changes}</ul>` : ''}
      ${i > 0 && e.action !== 'delete' ? `<button type="button" class="btn ghost small" data-action="restore-version" data-hid="${e.id}">Restore this version</button>` : ''}
    </li>`;
  }).join('')}</ol>`;
}

// ── SEARCH ──────────────────────────────────────────────────────────────
async function viewSearch() {
  return `${header('Search')}
  <div class="toolbar"><label class="search-box">${icon('search', 16)}<input type="search" id="global-q" placeholder="Search everything" aria-label="Search everything" autofocus></label></div>
  <div class="list" id="search-results"><p class="muted pad">People, companies, trips, documents, journal… anything.</p></div>`;
}

function searchHtml(q) {
  if (!q.trim()) return '<p class="muted pad">Type to search.</p>';
  const ql = q.toLowerCase();
  const hits = db.all().filter((r) => titleOf(r).toLowerCase().includes(ql) || JSON.stringify(r.data).toLowerCase().includes(ql));
  return hits.length ? hits.slice(0, 100).map((r) => row(r, { showModule: true })).join('') : '<p class="muted pad">No matches.</p>';
}

// ── TRASH ───────────────────────────────────────────────────────────────
async function viewTrash() {
  const items = db.trash().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return `${header('Trash', { kicker: 'KEPT 30 DAYS' })}
  <div class="list">${items.length ? items.map((r) => `<div class="row">
    <span class="row-title">${esc(titleOf(r))} <span class="muted small">· ${esc(MODULE[r.module]?.name || r.module)}</span></span>
    <button type="button" class="btn ghost small" data-action="restore-trash" data-id="${r.id}">Restore</button>
  </div>`).join('') : '<p class="muted pad">Trash is empty.</p>'}</div>`;
}

// ── SETTINGS ────────────────────────────────────────────────────────────
async function viewSettings() {
  const s = await db.kvGet('sync');
  const voice = (await db.kvGet('voice')) || {};
  const device = await db.kvGet('device', '');
  const last = await db.kvGet('lastSync');
  const theme = getTheme();
  const gm = (await db.kvGet('gmail')) || {};
  const gc = await gcal.settings();
  return `${header('Settings')}
  <section class="block">
    <span class="label">Appearance</span>
    <div class="chips" role="radiogroup" aria-label="Theme">
      ${['system', 'dark', 'light'].map((t) => `<label class="chip-radio"><input type="radio" name="theme" value="${t}" ${t === theme ? 'checked' : ''}><span>${t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}</span></label>`).join('')}
    </div>
  </section>
  <section class="block">
    <span class="label">Sync · private GitHub repo</span>
    <p class="small muted">Data is encrypted on this device with your passphrase before upload. The passphrase is never stored or sent. Lose it and the synced data cannot be recovered.</p>
    ${s ? `<p>Connected to <span class="mono">${esc(s.owner)}/${esc(s.repo)}</span> (branch <span class="mono">${esc(s.branch)}</span>).</p>
      <p class="small muted" id="sync-line">${last ? `Last synced ${new Date(last).toLocaleString('en-IN')}` : 'Not synced yet'}</p>
      <div class="form-actions"><button type="button" class="btn primary" data-action="sync-now">Sync now</button><button type="button" class="btn ghost" data-action="sync-off">Disconnect</button></div>`
    : `<form class="form" data-form="sync">
      <div class="field"><label for="s-owner">GitHub username</label><input id="s-owner" name="owner" required autocomplete="off"></div>
      <div class="field"><label for="s-repo">Private repo</label><input id="s-repo" name="repo" required autocomplete="off"></div>
      <div class="field"><label for="s-branch">Data branch</label><input id="s-branch" name="branch" value="data" required></div>
      <div class="field"><label for="s-token">Fine-grained token (Contents: read & write, this repo only)</label><input id="s-token" name="token" type="password" required autocomplete="off"></div>
      <div class="field"><label for="s-pass">Encryption passphrase</label><input id="s-pass" name="passphrase" type="password" required minlength="10" autocomplete="new-password"></div>
      <div class="form-actions"><button class="btn primary wide" type="submit">Connect & sync</button></div>
    </form>`}
  </section>

  <section class="block">
    <span class="label">Google · Gmail & Calendar</span>
    <p class="small muted">Gmail is read-only: it scans for application confirmations, interview invites, rejections and offers, and suggests updates you accept or ignore. Calendar shows your events on Now and adds dates from here to your calendar. Both need a Google OAuth client ID (see the README).</p>
    <form class="form" data-form="gmail">
      <div class="field"><label for="g-client">Google OAuth client ID</label><input id="g-client" name="clientId" value="${esc(gm.clientId || '')}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off"></div>
      <div class="field"><label for="g-days">First scan looks back (days)</label><input id="g-days" name="firstDays" type="number" min="7" max="730" value="${esc(gm.firstDays || 90)}"></div>
      <div class="field check"><input id="g-ai" name="ai" type="checkbox" ${gm.ai ? 'checked' : ''}><label for="g-ai">Use AI through my Worker for better company and role detection (sends sender, subject and preview of matching emails)</label></div>
      <div class="form-actions"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-action="gmail-reset">Rescan from scratch</button></div>
    </form>
  </section>

  <section class="block">
    <span class="label">Google Calendar</span>
    <form class="form" data-form="gcal">
      <div class="field check"><input id="c-bday" name="birthdays" type="checkbox" ${gc.birthdays ? 'checked' : ''}><label for="c-bday">Add birthdays and anniversaries as yearly events</label></div>
      <div class="field check"><input id="c-dead" name="deadlines" type="checkbox" ${gc.deadlines ? 'checked' : ''}><label for="c-dead">Add renewals and expiries (insurance, PUC, passport, warranty, subscriptions, maintenance…)</label></div>
      <div class="form-actions"><button class="btn ghost" type="submit">Save</button><button class="btn primary" type="button" data-action="gcal-connect">Connect & add existing dates</button></div>
    </form>
  </section>

  <section class="block">
    <span class="label">Voice transcription</span>
    <p class="small muted">Your Cloudflare Worker address (see the README). Without it, voice notes are still saved; they just stay as audio.</p>
    <form class="form" data-form="voice">
      <div class="field"><label for="v-url">Worker URL</label><input id="v-url" name="url" type="url" value="${esc(voice.url || '')}" placeholder="https://life-voice.yourname.workers.dev"></div>
      <div class="field"><label for="v-token">App token</label><input id="v-token" name="token" type="password" value="${esc(voice.token || '')}" autocomplete="off"></div>
      <div class="field check"><input id="v-clean" name="cleanup" type="checkbox" ${voice.cleanup !== false ? 'checked' : ''}><label for="v-clean">Clean up into readable Hinglish and suggest mood, people and tasks</label></div>
      <div class="form-actions"><button class="btn primary" type="submit">Save</button></div>
    </form>
  </section>

  <section class="block">
    <span class="label">This device</span>
    <form class="form" data-form="device">
      <div class="field"><label for="d-name">Device name (shown in history)</label><input id="d-name" name="device" value="${esc(device)}"></div>
      <div class="form-actions"><button class="btn ghost" type="submit">Save</button></div>
    </form>
  </section>

  <section class="block">
    <span class="label">Backup</span>
    <p class="small muted">Export is <strong>not encrypted</strong>. Store it somewhere safe.</p>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-action="export">Export JSON</button>
      <label class="btn ghost">Import JSON<input type="file" accept="application/json" data-action="import" hidden></label>
    </div>
  </section>`;
}

// ── quick add sheet ─────────────────────────────────────────────────────
const QUICK = ['tasks', 'journal', 'jobs', 'ideas', 'people', 'decisions', 'wins', 'notes'];
// Understands "today", "tonight", "tomorrow", weekday names, "in 3 days", "next week".
function parseWhen(text) {
  const t0 = startOfToday();
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const add = (n) => { const d = new Date(t0); d.setDate(d.getDate() + n); return d; };
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const rules = [
    [/\b(today|tonight)\b/i, () => add(0)],
    [/\btomorrow\b/i, () => add(1)],
    [/\bday after tomorrow\b/i, () => add(2)],
    [/\bnext week\b/i, () => add(7)],
    [/\bin (\d{1,3}) days?\b/i, (m) => add(Number(m[1]))],
    [/\b(?:on |by |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (m) => { const want = days.indexOf(m[1].toLowerCase()); let n = (want - t0.getDay() + 7) % 7; if (n === 0) n = 7; return add(n); }],
  ];
  for (const [re, fn] of rules) {
    const m = text.match(re);
    if (m) {
      const d = fn(m);
      const title = text.replace(m[0], '').replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '');
      return { title: title || text, due: iso(d), days: diffDays(d, t0) };
    }
  }
  return { title: text, due: '', days: null };
}

function openQuickAdd(preset = 'tasks', text = '') {
  const sheet = $('#sheet');
  const when = text ? parseWhen(text) : { title: '', due: '' };
  if (when.due) text = when.title;
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Quick add">
    <div class="grab"></div>
    <form data-form="quick">
      <label for="q-text" class="label">Add</label>
      <textarea id="q-text" name="text" rows="2" placeholder="Type anything…" required>${esc(text)}</textarea>
      <div class="when-row" id="q-when" ${when.due ? '' : 'hidden'}>
        <span class="small muted">Due</span>
        <input type="date" name="due" value="${esc(when.due || '')}" aria-label="Due date">
        <button type="button" class="link" data-action="clear-due">Clear</button>
      </div>
      <div class="chips" role="radiogroup" aria-label="Type">
        ${QUICK.map((id) => `<label class="chip-radio"><input type="radio" name="module" value="${id}" ${id === preset ? 'checked' : ''}><span>${esc(MODULE[id].name.replace('Job applications', 'Job'))}</span></label>`).join('')}
        <a class="chip" href="#/life" data-action="close-sheet">More…</a>
      </div>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="record">${icon('mic', 18)} Speak</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  </div>`;
  sheet.classList.add('open');
  setTimeout(() => $('#q-text')?.focus(), 50);
}
function openRenew(id, k) {
  const r = db.get(id);
  if (!r) return;
  const fd = MODULE[r.module].fields.find((x) => x.k === k);
  const cur = r.data[k];
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Update ${esc(fd.label)}">
    <div class="grab"></div>
    <span class="label">${esc(titleOf(r))}</span>
    <h2 class="sheet-title">${esc(fd.label)}</h2>
    <p class="small muted">${cur ? `Currently ${fmtDay(cur)} · ${rel(diffDays(parseDay(cur), startOfToday()))}` : 'Not set'}. Renewed it? Move it forward:</p>
    <div class="renew-grid">
      ${[[1, '+1 month'], [3, '+3 months'], [6, '+6 months'], [12, '+1 year']].map(([mth, l]) => `<button type="button" class="btn" data-action="renew-by" data-id="${id}" data-k="${k}" data-m="${mth}">${l}</button>`).join('')}
    </div>
    <form data-form="renew" data-id="${id}" data-k="${k}" class="renew-custom">
      <input type="date" name="date" value="${esc(cur || '')}" aria-label="New date" required>
      <button type="submit" class="btn primary">Set date</button>
    </form>
  </div>`;
  sheet.classList.add('open');
}

function closeSheet() { const s = $('#sheet'); s.classList.remove('open'); s.innerHTML = ''; }

// ── recorder sheet ──────────────────────────────────────────────────────
let recorder = null;
let recTick = null;
async function openRecorder() {
  closeSheet();
  if (!Recorder.supported()) { toast('This browser cannot record audio.'); return; }
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-card center" role="dialog" aria-modal="true" aria-label="Recording">
    <div class="grab"></div>
    <span class="label">Recording</span>
    <div class="rec-dot" aria-hidden="true"></div>
    <div class="mono timer" id="rec-time">0:00</div>
    <div class="chips" role="radiogroup" aria-label="Entry type">
      <label class="chip-radio"><input type="radio" name="kind" value="quick log" checked><span>Quick log</span></label>
      <label class="chip-radio"><input type="radio" name="kind" value="daily journal"><span>Daily journal</span></label>
    </div>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-action="rec-cancel">Cancel</button>
      <button type="button" class="btn primary" data-action="rec-stop">Stop & save</button>
    </div>
  </div>`;
  sheet.classList.add('open');
  recorder = new Recorder();
  try {
    await recorder.start();
  } catch (e) {
    closeSheet();
    recorder = null;
    toast('Microphone permission was denied.');
    return;
  }
  recTick = setInterval(() => {
    const s = recorder ? recorder.elapsed() : 0;
    const el = $('#rec-time');
    if (el) el.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }, 500);
}

async function stopRecorder(save) {
  clearInterval(recTick);
  if (!recorder) return closeSheet();
  const kind = document.querySelector('input[name="kind"]:checked')?.value || 'quick log';
  if (!save) { recorder.cancel(); recorder = null; closeSheet(); return; }
  const result = await recorder.stop();
  recorder = null;
  closeSheet();
  if (!result.segments.length) { toast('Nothing was recorded.'); return; }
  await saveRecording(result, kind);
  toast('Saved. Transcribing…', { undo: true });
  if (currentRoute.name !== 'journal') go('#/journal');
}

// ── events ──────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    if (e.target.id === 'sheet') { if (recorder) return; closeSheet(); }
    return;
  }
  const a = el.dataset.action;
  if (el.tagName === 'INPUT') return;
  if (a !== 'close-sheet') e.preventDefault();
  const id = el.dataset.id;
  switch (a) {
    case 'quick-add': openQuickAdd(); break;
    case 'close-sheet': closeSheet(); break;
    case 'record': openRecorder(); break;
    case 'rec-stop': stopRecorder(true); break;
    case 'rec-cancel': stopRecorder(false); break;
    case 'undo': {
      const label = await db.undo();
      toast(label ? `${label}: undone` : 'Nothing to undo');
      render();
      break;
    }
    case 'task-done': {
      const li = el.closest('li');
      if (li && !matchMedia('(prefers-reduced-motion: reduce)').matches) { li.classList.add('completing'); await new Promise((r) => setTimeout(r, 320)); }
      await db.update(id, { status: 'done', completedOn: todayStr() });
      toast('Done', { undo: true });
      break;
    }
    case 'habit': {
      const h = db.get(id);
      const log = { ...(h.data.log || {}) };
      const t = todayStr();
      if (log[t]) delete log[t]; else log[t] = true;
      await db.update(id, { log });
      break;
    }
    case 'mood': {
      const v = Number(el.dataset.v);
      const t = todayStr();
      const rec = db.list('days').find((r) => r.data.date === t);
      if (rec) await db.update(rec.id, { mood: v }); else await db.create('days', { date: t, mood: v });
      break;
    }
    case 'delete':
      await db.remove(id);
      toast('Moved to Trash', { undo: true });
      go(`#/m/${db.get(id).module}`);
      break;
    case 'restore-trash':
      await db.restoreFromTrash(id);
      toast('Restored');
      render();
      break;
    case 'restore-version': {
      const entry = historyCache.get(el.dataset.hid);
      if (entry) { await db.restoreVersion(entry); toast('Version restored', { undo: true }); go(`#/r/${entry.recordId}`); }
      break;
    }
    case 'retry': transcribe(id); toast('Retrying…'); break;
    case 'add-suggested': {
      const r = db.get(id);
      const i = Number(el.dataset.i);
      const text = r.data.suggestedTasks[i];
      await db.create('tasks', { title: text, status: 'inbox' });
      const rest = r.data.suggestedTasks.filter((_, j) => j !== i);
      await db.update(id, { suggestedTasks: rest }, { silentUndo: true });
      toast('Task added');
      render();
      break;
    }
    case 'gmail-scan': {
      const gm = (await db.kvGet('gmail')) || {};
      if (!gm.clientId) { toast('Add your Google client ID in Settings first.'); go('#/settings'); break; }
      el.disabled = true;
      const status = $('#scan-status');
      try {
        const r = await gmail.scan({ useAi: !!gm.ai, onProgress: (m) => { if (status) status.textContent = m; } });
        toast(r.added ? `${r.added} new suggestion${r.added === 1 ? '' : 's'}` : `Checked ${r.scanned} emails. Nothing new.`);
      } catch (err) {
        toast(err.message || 'Scan failed');
      }
      render();
      break;
    }
    case 'gcal-refresh':
    case 'gcal-connect': {
      try {
        await google.signIn(google.SCOPES.calendar);
        if (a === 'gcal-connect') await gcal.queueAll();
        await gcal.refreshEvents();
        const r = await gcal.flush();
        toast(r.done ? `Calendar updated · ${r.done} item${r.done === 1 ? '' : 's'} added or changed` : 'Calendar up to date');
      } catch (err) {
        toast(err.message || 'Calendar failed');
      }
      render();
      break;
    }
    case 'nudge-dismiss': {
      const d = await db.kvGet('nudgeDismissed', {});
      const t = todayStr();
      for (const k of Object.keys(d)) if (d[k] !== t) delete d[k];
      d[el.dataset.key] = t;
      await db.kvSet('nudgeDismissed', d);
      render();
      break;
    }
    case 'set-status': {
      const r = db.get(id);
      const m = MODULE[r.module];
      const patch = { [m.status]: el.dataset.v };
      if (r.module === 'tasks' && el.dataset.v === 'done' && !r.data.completedOn) patch.completedOn = todayStr();
      await db.update(id, patch);
      toast(`${m.fields.find((x) => x.k === m.status).label}: ${el.dataset.v}`, { undo: true });
      break;
    }
    case 'toggle-done': {
      const r = db.get(id);
      await db.update(id, { [el.dataset.k]: !r.data[el.dataset.k] });
      toast('Updated', { undo: true });
      break;
    }
    case 'capture-add': {
      const inp = document.querySelector('form.capture input');
      if (inp && inp.value.trim()) openQuickAdd('tasks', inp.value.trim());
      break;
    }
    case 'clear-due': {
      const row = $('#q-when');
      if (row) { row.querySelector('input').value = ''; row.hidden = true; }
      break;
    }
    case 'renew': openRenew(id, el.dataset.k); break;
    case 'renew-by': {
      const r = db.get(id);
      const k = el.dataset.k;
      const months = Number(el.dataset.m);
      const cur = r.data[k] ? parseDay(r.data[k]) : startOfToday();
      const base = cur < startOfToday() ? startOfToday() : cur; // overdue renews from today
      base.setMonth(base.getMonth() + months);
      const v = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
      await db.update(id, { [k]: v });
      closeSheet();
      toast(`${MODULE[r.module].fields.find((x) => x.k === k).label}: ${fmtDay(v)}`, { undo: true });
      break;
    }
    case 'merge-open': openMerge(id); break;
    case 'merge-into': {
      const dst = el.dataset.dst;
      await mergeJobs(el.dataset.src, dst);
      closeSheet();
      toast(`Merged into ${titleOf(db.get(dst))}`);
      location.hash = `#/r/${dst}`;
      break;
    }
    case 'gmail-ignore': await gmail.ignore(el.dataset.msg); render(); break;
    case 'gmail-reset': await gmail.resetScan(); toast('Next scan starts from scratch.'); break;
    case 'starter-links': {
      const existing = new Set(db.list('links').map((r) => (r.data.name || '').toLowerCase()));
      let n = 0;
      for (const l of starterLinks()) if (!existing.has(l.name.toLowerCase())) { await db.create('links', l); n++; }
      toast(`Added ${n} links. Fix the LinkedIn URL and add your own.`, { undo: false });
      go('#/links');
      render();
      break;
    }
    case 'sync-now': await sync.syncNow(); render(); break;
    case 'sync-off': await sync.disconnect(); toast('Sync disconnected. Data stays on this device.'); render(); break;
    case 'export': {
      const payload = { exportedAt: new Date().toISOString(), records: db.allRaw(), history: await db.allHistory() };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `life-tracker-${todayStr()}.json` });
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.matches('input[name="theme"]')) { applyTheme(e.target.value); return; }
  if (e.target.matches('input[data-action="import"]')) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const n = await db.importAll(JSON.parse(await file.text()));
      toast(`Imported ${n} items`);
      sync.scheduleSync(2000);
      render();
    } catch {
      toast('That file could not be imported.');
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.closest('form[data-form="edit"], form[data-form="new"]')) formDirty = true;
  if (e.target.matches('input[data-filter]')) {
    const m = MODULE[e.target.dataset.filter];
    $('#list').innerHTML = listHtml(m, e.target.dataset.status, e.target.value);
  }
  if (e.target.id === 'global-q') $('#search-results').innerHTML = searchHtml(e.target.value);
  if (e.target.id === 'merge-q') {
    const q = e.target.value.trim().toLowerCase();
    for (const b of document.querySelectorAll('#merge-list [data-name]')) b.hidden = q && !b.dataset.name.includes(q);
  }
  if (e.target.matches('form.capture input')) {
    const box = $('#capture-results');
    const q = e.target.value.trim();
    if (!box) return;
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const ql = q.toLowerCase();
    const when = parseWhen(q);
    const words = when.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    const score = (r) => {
      const t = titleOf(r).toLowerCase();
      if (t.includes(ql) || JSON.stringify(r.data).toLowerCase().includes(ql)) return 3;
      return words.some((w) => t.split(/\W+/).includes(w)) ? 1 : 0;
    };
    const hits = db.all().filter((r) => MODULE[r.module]).map((r) => [score(r), r]).filter(([n]) => n).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, r]) => r);
    box.hidden = false;
    box.innerHTML = `<button type="button" class="cr-add" data-action="capture-add">${icon('plus', 16)}<span>Add “${esc(when.title)}”${when.due ? ` <em>· due ${esc(rel(when.days))}</em>` : ''}</span><kbd>Enter</kbd></button>${hits.map((r) => row(r, { showModule: true })).join('')}`;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  try {
    if (kind === 'new' || kind === 'edit') {
      const m = MODULE[form.dataset.module];
      const data = readForm(form, m);
      for (const h of form.querySelectorAll('input[data-hidden]')) data[h.dataset.hidden] = JSON.parse(h.value);
      if (m.id === 'tasks' && data.status === 'done' && !(kind === 'edit' && db.get(form.dataset.id)?.data.completedOn)) data.completedOn = todayStr();
      const missing = missingRequired(m, data);
      if (missing.length) { toast(`Fill in: ${missing.join(', ')}`); return; }
      if (kind === 'new') {
        const rec = await db.create(m.id, data);
        toast('Saved', { undo: true });
        location.replace(`#/r/${rec.id}`);
      } else {
        await db.update(form.dataset.id, data);
        formDirty = false;
        toast('Saved', { undo: true });
        if (location.hash === `#/r/${form.dataset.id}`) render(); else location.hash = `#/r/${form.dataset.id}`;
      }
    } else if (kind === 'capture') {
      const q = form.elements.q.value.trim();
      if (!q) return;
      // "?something" or a match in your data → search; otherwise add it
      if (q.startsWith('?')) { location.hash = '#/search'; setTimeout(() => { const i = $('#global-q'); if (i) { i.value = q.slice(1).trim(); i.dispatchEvent(new Event('input', { bubbles: true })); } }, 60); return; }
      openQuickAdd('tasks', q);
    } else if (kind === 'review') {
      const fd = new FormData(form);
      const next = String(fd.get('next') || '').split('\n').map((x) => x.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 5);
      const rec = await db.create('reviews', {
        period: 'week', date: todayStr(), score: fd.get('score') ? Number(fd.get('score')) : '',
        wentWell: String(fd.get('wentWell') || ''), didnt: String(fd.get('didnt') || ''), learned: String(fd.get('learned') || ''), next: next.join('\n'),
      });
      for (const g of next) await db.create('goals', { title: g, horizon: 'week', status: 'active', progress: 0 });
      toast(next.length ? `Review saved · ${plural(next.length, 'weekly goal')} set` : 'Review saved', { undo: false });
      location.hash = `#/r/${rec.id}`;
    } else if (kind === 'renew') {
      const v = form.elements.date.value;
      if (!v) return;
      const r = db.get(form.dataset.id);
      await db.update(form.dataset.id, { [form.dataset.k]: v });
      closeSheet();
      toast(`${MODULE[r.module].fields.find((x) => x.k === form.dataset.k).label}: ${fmtDay(v)}`, { undo: true });
    } else if (kind === 'quick') {
      const text = form.elements.text.value.trim();
      const id = form.elements.module.value;
      if (!text) return;
      const m = MODULE[id];
      const data = { ...defaults(id) };
      if (id === 'journal') Object.assign(data, { at: localStamp(), text, status: 'typed' });
      else data[titleKey(m)] = text;
      if (id === 'tasks') {
        const due = form.elements.due?.value || '';
        if (due) {
          data.due = due;
          const dd = diffDays(parseDay(due), startOfToday());
          data.status = dd <= 0 ? 'today' : dd <= 7 ? 'this week' : 'later';
        } else if (!data.status) data.status = 'today';
      }
      const rec = await db.create(id, data);
      closeSheet();
      toast(id === 'tasks' && data.due ? `Task added · due ${rel(diffDays(parseDay(data.due), startOfToday()))}` : `Added to ${m.name}`, { undo: true });
      if (!['tasks', 'journal', 'ideas'].includes(id)) go(`#/r/${rec.id}`);
    } else if (kind === 'sync') {
      const fd = Object.fromEntries(new FormData(form));
      await sync.connect(fd);
      toast(sync.getStatus().state === 'ok' ? 'Connected and synced' : sync.getStatus().message);
      render();
    } else if (kind === 'voice') {
      const fd = new FormData(form);
      await db.kvSet('voice', { url: String(fd.get('url') || '').trim(), token: String(fd.get('token') || ''), cleanup: form.elements.cleanup.checked });
      toast('Saved');
      retryPending();
    } else if (kind === 'gmail-accept') {
      const fd = new FormData(form);
      const rec = await gmail.accept(form.dataset.msg, { company: String(fd.get('company') || '').trim(), role: String(fd.get('role') || '').trim(), status: String(fd.get('status')) });
      toast(rec ? `Saved to Jobs: ${titleOf(rec)}` : 'Already handled', { undo: !!rec });
      render();
    } else if (kind === 'gcal') {
      await db.kvSet('gcal', { birthdays: form.elements.birthdays.checked, deadlines: form.elements.deadlines.checked });
      toast('Saved');
    } else if (kind === 'gmail') {
      const fd = new FormData(form);
      await db.kvSet('gmail', { clientId: String(fd.get('clientId') || '').trim(), firstDays: Number(fd.get('firstDays')) || 90, ai: form.elements.ai.checked });
      toast('Saved');
    } else if (kind === 'device') {
      await db.kvSet('device', String(new FormData(form).get('device') || 'Device').trim());
      toast('Saved');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong');
  }
});

// Laptop shortcuts: "/" find, "n" new, then g+t/l/p/s to jump between tabs.
let gPressed = 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#sheet').classList.contains('open') && !recorder) closeSheet();
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('#sheet').classList.contains('open')) return;
  if (e.key === '/') {
    e.preventDefault();
    const cap = document.querySelector('form.capture input') || $('#global-q');
    if (cap) cap.focus(); else { go('#/search'); setTimeout(() => $('#global-q')?.focus(), 60); }
  } else if (e.key === 'n') { e.preventDefault(); openQuickAdd(); }
  else if (e.key === 'g') gPressed = Date.now();
  else if (Date.now() - gPressed < 1200 && { t: 1, l: 1, p: 1, s: 1 }[e.key]) {
    gPressed = 0;
    go({ t: '#/now', l: '#/life', p: '#/plan', s: '#/search' }[e.key]);
  }
});

// ── boot ────────────────────────────────────────────────────────────────
let renderQueued = false;
function queueRender(info) {
  // don't wipe a form the user is typing in
  if (formDirty) return;
  if (['settings', 'new', 'search', 'inbox', 'review'].includes(currentRoute.name)) return;
  if (currentRoute.name === 'r' && info?.rec && info.rec.id !== currentRoute.parts[0]) return;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

async function boot() {
  applyTheme(getTheme());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(getTheme()));
  await db.init();
  db.onChange((info) => {
    if (info.type !== 'sync') sync.scheduleSync();
    if (info.rec && info.type !== 'sync' && gcal.isEligible(info.rec.module)) gcal.enqueue(info.rec.id).then(() => gcal.flush());
    queueRender(info);
  });
  sync.onStatus((s) => {
    const el = $('#sync-dot');
    el.dataset.state = s.state;
    el.title = s.message;
    el.setAttribute('aria-label', `Sync: ${s.message}`);
  });
  window.addEventListener('hashchange', render);
  await render();
  sync.initSync();
  if (google.hasToken(google.SCOPES.calendar)) gcal.refreshEvents().then(() => gcal.flush()).then(() => queueRender()).catch(() => {});
  retryPending();
  window.addEventListener('online', retryPending);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Check for a new version on every open; reload once when it takes over.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || formDirty || recorder) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
      })
      .catch(() => {});
  }
}

boot().catch((e) => {
  console.error(e);
  $('#main').innerHTML = `<div class="empty"><p>Could not start: ${esc(e.message)}</p></div>`;
});

import * as db from './db.js';
import * as sync from './sync.js';
import { Recorder, saveRecording, transcribe, retryPending, localStamp } from './journal.js';
import * as gmail from './gmail.js';
import * as gcal from './gcal.js';
import * as google from './google.js';
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
  document.querySelector('meta[name="theme-color"]').setAttribute('content', light ? '#eef1f4' : '#05060a');
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
  links: viewLinks, setup: viewSetup, progress: viewProgress, inbox: viewInbox,
};

async function render() {
  currentRoute = parseRoute();
  formDirty = false;
  const view = VIEWS[currentRoute.name] || viewNow;
  const main = $('#main');
  main.innerHTML = await view(...currentRoute.parts);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  for (const a of document.querySelectorAll('.nav a')) {
    a.classList.toggle('on', a.dataset.nav === currentRoute.name || (a.dataset.nav === 'life' && ['m', 'r', 'new', 'trash', 'links', 'setup'].includes(currentRoute.name)));
  }
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
function header(title, { kicker = '', back = '', actions = '' } = {}) {
  return `<header class="top">
    <div class="top-row">
      ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>` : ''}
      <div class="top-title">${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}<h1>${esc(title)}</h1></div>
      <div class="top-actions">${actions}</div>
    </div>
  </header>`;
}

function row(r, { showModule = false } = {}) {
  const m = MODULE[r.module];
  const meta = [];
  if (m.status && r.data[m.status]) meta.push(r.data[m.status]);
  if (showModule) meta.push(m.name);
  if (m.sort && r.data[m.sort]) meta.push(m.fields.find((x) => x.k === m.sort)?.type === 'date' ? fmtDay(r.data[m.sort]) : r.data[m.sort]);
  return `<a class="row ${isDone(r) ? 'done' : ''}" href="#/r/${r.id}">
    <span class="row-title">${esc(r.module === 'journal' ? (r.data.text || 'Voice entry').slice(0, 90) : titleOf(r))}</span>
    <span class="row-meta">${esc(meta.join(' · '))}</span>
  </a>`;
}

function emptyState(text, href, cta) {
  return `<div class="empty"><p>${esc(text)}</p>${href ? `<a class="btn ghost" href="${href}">${esc(cta)}</a>` : ''}</div>`;
}

// ── NOW ─────────────────────────────────────────────────────────────────
async function viewNow() {
  const d = new Date();
  const kicker = `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · W${weekNo(d)}`;
  const t = todayStr();
  const tasks = db.list('tasks')
    .filter((r) => r.data.status !== 'done' && (r.data.status === 'today' || (r.data.due && r.data.due <= t)))
    .sort((a, b) => (a.data.due || '9').localeCompare(b.data.due || '9'));
  const next = tasks[0];
  const habits = db.list('habits').filter((r) => r.data.active !== false);
  const dayRec = db.list('days').find((r) => r.data.date === t);
  const mood = dayRec?.data.mood;
  const heads = reminders().filter((x) => x.r.module !== 'tasks').slice(0, 8);
  const lastEntry = db.list('journal').sort((a, b) => (b.data.at || '').localeCompare(a.data.at || ''))[0];
  const mailCount = (await gmail.suggestions()).length;
  const cal = await gcal.cachedEvents();
  const calPending = (await gcal.pending()).length;
  const calSetUp = !!(await google.clientId());
  const weekGoals = db.list('goals').filter((r) => r.data.horizon === 'week' && r.data.status !== 'dropped');
  const doneToday = db.list('tasks').filter((r) => r.data.completedOn === t).length;
  const taskTotal = tasks.length + doneToday;
  const habitsDone = habits.filter((h) => (h.data.log || {})[t]).length;
  const denom = taskTotal + habits.length;
  const score = denom ? Math.round(((doneToday + habitsDone) / denom) * 100) : 0;

  return `${header('Now', {
    kicker,
    actions: `<a class="icon-btn" href="#/progress" aria-label="Progress">${icon('chart')}</a><a class="icon-btn" href="#/search" aria-label="Search">${icon('search')}</a><a class="icon-btn" href="#/settings" aria-label="Settings">${icon('gear')}</a>`,
  })}
  <section class="hero" aria-label="Today at a glance">
    <div class="ring" style="--p:${score}" role="img" aria-label="${score}% of today's tasks and habits done">
      <div class="ring-in"><span class="ring-v">${score}<small>%</small></span><span class="ring-k mono">TODAY</span></div>
    </div>
    <div class="hero-side">
      <div class="hero-kv"><span class="mono">TASKS</span><span class="hv">${doneToday}<small>/${taskTotal}</small></span></div>
      <div class="hero-kv"><span class="mono">HABITS</span><span class="hv">${habitsDone}<small>/${habits.length}</small></span></div>
      <div class="tp" aria-label="Time elapsed">${timeProgress().map(([k, v]) => `<div class="tp-item"><span class="mono">${k.toUpperCase()}</span><span class="tp-bar"><span style="width:${v}%"></span></span><span class="mono">${v}%</span></div>`).join('')}</div>
    </div>
  </section>
  ${setupCard()}
  ${mailCount ? `<a class="setup-card" href="#/inbox"><span class="mono small">GMAIL · ${mailCount}</span><span class="setup-next">Job updates to review</span></a>` : ''}
  ${pinnedLinks()}
  <div class="grid-2">
    <section class="block">
      <span class="label">Next</span>
      ${next ? `<div class="next">
          <button type="button" class="tick" data-action="task-done" data-id="${next.id}" aria-label="Mark done">${icon('check', 18)}</button>
          <a href="#/r/${next.id}" class="next-title">${esc(titleOf(next))}</a>
        </div>`
        : `<p class="muted">Nothing scheduled for today. <a href="#" data-action="quick-add">Add a task</a></p>`}
    </section>

    <section class="block">
      <span class="label">Mood today</span>
      <div class="mood" role="group" aria-label="Mood today">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="mood" data-v="${n}" class="${mood === n ? 'on' : ''}" aria-pressed="${mood === n}">${n}</button>`).join('')}
      </div>
    </section>

    <section class="block">
      <div class="label-row"><span class="label">Today · ${tasks.length}</span><a href="#/m/tasks" class="link">All tasks</a></div>
      ${tasks.length ? `<ul class="checks">${tasks.map((r) => `<li>
          <button type="button" class="tick" data-action="task-done" data-id="${r.id}" aria-label="Mark ${esc(titleOf(r))} done">${icon('check', 16)}</button>
          <a href="#/r/${r.id}">${esc(titleOf(r))}</a>
          ${r.data.due && r.data.due < t ? `<span class="warn small">${rel(diffDays(parseDay(r.data.due), startOfToday()))}</span>` : r.data.area ? `<span class="muted small">${esc(r.data.area)}</span>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Clear.</p>'}
    </section>

    <section class="block">
      <div class="label-row"><span class="label">Calendar</span>${calSetUp ? `<button type="button" class="link" data-action="gcal-refresh">${cal.at ? 'Refresh' : 'Connect'}</button>` : '<a class="link" href="#/settings">Set up</a>'}</div>
      ${calendarHtml(cal)}
      ${calPending ? `<p class="small muted">${calPending} item${calPending === 1 ? '' : 's'} waiting to be added to Google Calendar. <button type="button" class="link" data-action="gcal-refresh">Send now</button></p>` : ''}
    </section>

    <section class="block">
      <div class="label-row"><span class="label">Heads up</span></div>
      ${heads.length ? `<ul class="heads">${heads.map((x) => `<li><a href="#/r/${x.r.id}">
          <span>${esc(titleOf(x.r))} <span class="muted">· ${esc(x.label)}</span></span>
          <span class="${x.days < 0 ? 'warn' : x.days <= 7 ? 'accent' : 'muted'} small mono">${rel(x.days)}</span>
        </a></li>`).join('')}</ul>` : '<p class="muted">No upcoming deadlines, renewals or birthdays.</p>'}
    </section>

    <section class="block">
      <div class="label-row"><span class="label">Habits</span><a href="#/progress" class="link">Progress</a></div>
      ${habits.length ? `<div class="habits">${habits.map((h) => {
        const on = !!(h.data.log || {})[t];
        const s = streak(h.data.log || {});
        return `<button type="button" class="chip ${on ? 'on' : ''}" data-action="habit" data-id="${h.id}" aria-pressed="${on}">${esc(h.data.name)}${s ? `<span class="chip-n mono">${s}d</span>` : ''}</button>`;
      }).join('')}</div>` : `<p class="muted">Add 3–5 habits you want to keep. <a href="#/new/habits">Add one</a></p>`}
    </section>

    <section class="block">
      <div class="label-row"><span class="label">This week</span><a href="#/plan/week" class="link">Plan</a></div>
      ${weekGoals.length ? weekGoals.map((g) => progressRow(g)).join('') : `<p class="muted">No weekly goals. <a href="#/new/goals">Set this week's top 3</a></p>`}
    </section>

    <section class="block span-2">
      <div class="label-row"><span class="label">Journal</span><a href="#/journal" class="link">Open</a></div>
      ${lastEntry ? `<a class="quote" href="#/r/${lastEntry.id}"><span class="mono small muted">${fmtDay(lastEntry.data.at)} ${fmtTime(lastEntry.data.at)}</span>${esc((lastEntry.data.text || statusText(lastEntry.data.status)).slice(0, 160))}</a>` : ''}
      <button type="button" class="btn primary wide" data-action="record">${icon('mic', 18)} Speak about your day</button>
    </section>
  </div>`;
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
  return `${header('Links', { kicker: `${all.length} SAVED`, back: '#/life', actions: `<a class="btn primary small" href="#/new/links">+ Link</a>` })}
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
  return `${header('Progress', { kicker: 'TRACKING', back: '#/now' })}
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
  return `${header('From Gmail', { kicker: 'JOB APPLICATIONS', back: '#/m/jobs' })}
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

// ── SETUP GUIDE ─────────────────────────────────────────────────────────
async function viewSetup() {
  const done = SETUP.filter(setupDone).length;
  return `${header('Set up', { kicker: `${done} OF ${SETUP.length} DONE`, back: '#/now' })}
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
  return `${header('Plan', { kicker: 'GOALS · REVIEWS · DECISIONS' })}
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
      <a class="btn primary wide" href="#/new/reviews">Start a review</a>
    </section>
    <section class="block">
      <span class="label">Decisions</span>
      <p class="muted small">${revisit.length ? `${revisit.length} decision(s) due for a check-back.` : 'Log big decisions with what you expect, then check back.'}</p>
      <a class="btn ghost wide" href="#/m/decisions">Decision log</a>
    </section>
  </div>
  <section class="block">
    <span class="label">Also</span>
    <div class="links">${['vision', 'reviews', 'lessons'].map((id) => `<a href="#/m/${id}">${esc(MODULE[id].name)}</a>`).join('')}</div>
  </section>`;
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
async function viewLife() {
  const setupLeft = SETUP.length - SETUP.filter(setupDone).length;
  return `${header('Life', { kicker: `${MODULES.length} SECTIONS`, actions: `<a class="icon-btn" href="#/search" aria-label="Search">${icon('search')}</a>` })}
  <div class="quick3">
    <a href="#/links">${icon('link', 18)}<span>Links</span><span class="mono small muted">${db.list('links').length}</span></a>
    <a href="#/progress">${icon('chart', 18)}<span>Progress</span><span class="mono small muted">stats</span></a>
    <a href="#/setup">${icon('check', 18)}<span>Set up</span><span class="mono small muted">${setupLeft ? `${setupLeft} left` : 'done'}</span></a>
  </div>
  ${GROUPS.filter((g) => g !== 'Links').map((g) => `<section class="block">
    <span class="label">${esc(g)}</span>
    <div class="index">${MODULES.filter((m) => m.group === g).map((m) => {
      const n = db.list(m.id).length;
      return `<a href="#/m/${m.id}"><span>${esc(m.name)}</span><span class="mono small ${n ? '' : 'muted'}">${String(n).padStart(2, '0')}</span></a>`;
    }).join('')}</div>
  </section>`).join('')}
  <section class="block"><div class="links"><a href="#/trash">Trash</a><a href="#/settings">Settings</a></div></section>`;
}

// ── MODULE LIST ─────────────────────────────────────────────────────────
function sortRecords(m, list) {
  if (m.sort) return list.sort((a, b) => String(b.data[m.sort] || '').localeCompare(String(a.data[m.sort] || '')));
  return list.sort((a, b) => (isDone(a) - isDone(b)) || b.updatedAt.localeCompare(a.updatedAt));
}

function listHtml(m, filter, q) {
  let list = db.list(m.id);
  if (filter && m.status) list = list.filter((r) => r.data[m.status] === filter);
  if (q) list = list.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()));
  list = sortRecords(m, list);
  return list.length ? list.map((r) => row(r)).join('') : '<p class="muted pad">Nothing here yet.</p>';
}

async function viewModule(id, filter = '') {
  const m = MODULE[id];
  if (!m) return emptyState('Unknown section.', '#/life', 'Back to Life');
  const statusField = m.status && m.fields.find((x) => x.k === m.status);
  const counts = {};
  if (statusField) for (const r of db.list(id)) counts[r.data[m.status]] = (counts[r.data[m.status]] || 0) + 1;
  return `${header(m.name, { kicker: m.group.toUpperCase(), back: '#/life', actions: `${id === 'jobs' ? '<a class="btn ghost small" href="#/inbox">Gmail</a>' : ''}<a class="btn primary small" href="#/new/${id}">+ New</a>` })}
  <div class="toolbar">
    <label class="search-box">${icon('search', 16)}<input type="search" data-filter="${id}" data-status="${esc(filter)}" placeholder="Filter ${esc(m.name.toLowerCase())}" aria-label="Filter"></label>
  </div>
  ${statusField ? `<nav class="chips" aria-label="Status filter">
    <a href="#/m/${id}" class="chip ${!filter ? 'on' : ''}">all</a>
    ${statusField.options.filter((o) => counts[o]).map((o) => `<a href="#/m/${id}/${encodeURIComponent(o)}" class="chip ${filter === o ? 'on' : ''}">${esc(o)} · ${counts[o]}</a>`).join('')}
  </nav>` : ''}
  <div class="list" id="list">${listHtml(m, filter, '')}</div>`;
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

// Show the first few fields plus any that have a value; tuck the rest away.
function formFields(m, data) {
  const visible = m.fields.filter((fd) => !fd.hidden);
  const hasVal = (fd) => {
    const v = data[fd.k];
    return !(v === undefined || v === '' || v === null || v === false || (Array.isArray(v) && !v.length)) && fd.def !== v;
  };
  const primary = [];
  const extra = [];
  visible.forEach((fd, i) => ((i < 4 || fd.req || hasVal(fd) || fd.readonly || fd.remind !== undefined) ? primary : extra).push(fd));
  return `${primary.map((fd) => fieldHtml(fd, data[fd.k])).join('')}
    ${extra.length ? `<details class="more"><summary>More details <span class="mono small muted">${extra.length}</span></summary><div class="form">${extra.map((fd) => fieldHtml(fd, data[fd.k])).join('')}</div></details>` : ''}`;
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
  return `${header(`New · ${m.name}`, { back: `#/m/${id}` })}
  <form class="form" data-form="new" data-module="${id}">
    ${formFields(m, data)}
    ${Object.entries(data).filter(([k]) => m.fields.find((x) => x.k === k)?.hidden).map(([k, v]) => `<input type="hidden" data-hidden="${esc(k)}" value="${esc(JSON.stringify(v))}">`).join('')}
    <div class="form-actions"><button class="btn primary wide" type="submit">Save</button></div>
  </form>`;
}

// ── RECORD DETAIL ───────────────────────────────────────────────────────
async function viewRecord(id, tab = 'details') {
  const r = db.get(id);
  if (!r) return emptyState('This item no longer exists.', '#/life', 'Back to Life');
  const m = MODULE[r.module];
  const deleted = !!r.deletedAt;
  const isJournal = r.module === 'journal';
  const title = isJournal ? `${fmtDay(r.data.at)} · ${fmtTime(r.data.at)}` : titleOf(r);
  return `${header(title, { kicker: m.name.toUpperCase(), back: `#/m/${r.module}` })}
  ${deleted ? `<div class="notice">In Trash. <button type="button" class="link" data-action="restore-trash" data-id="${id}">Restore</button></div>` : ''}
  <nav class="tabs" aria-label="View">
    <a href="#/r/${id}" class="${tab === 'details' ? 'on' : ''}">Details</a>
    <a href="#/r/${id}/history" class="${tab === 'history' ? 'on' : ''}">History</a>
  </nav>
  ${tab === 'history' ? `<section class="block" id="history" data-id="${id}"><p class="muted">Loading…</p></section>` : `
  ${isJournal ? journalExtras(r) : ''}
  ${r.module === 'jobs' && (r.data.emails || []).length ? `<section class="block"><span class="label">Emails</span><ul class="heads">${r.data.emails.slice().sort((a, b) => b.date.localeCompare(a.date)).map((m) => `<li><a href="${esc(gmail.mailLink(m.threadId))}" target="_blank" rel="noopener"><span>${esc(m.subject)}</span><span class="mono small muted">${fmtDay(m.date)}</span></a></li>`).join('')}</ul></section>` : ''}
  <form class="form" data-form="edit" data-id="${id}" data-module="${r.module}">
    ${formFields(m, r.data)}
    <div class="form-actions">
      <button class="btn primary" type="submit">Save</button>
      ${deleted ? '' : `<button class="btn danger" type="button" data-action="delete" data-id="${id}">Delete</button>`}
    </div>
    <p class="small muted">Created ${fmtDay(r.createdAt.slice(0, 10))} · updated ${fmtDay(r.updatedAt.slice(0, 10))} ${r.updatedAt.slice(11, 16)} UTC</p>
  </form>`}`;
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
  return `${header('Search', { back: '#/now' })}
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
  return `${header('Trash', { kicker: 'KEPT 30 DAYS', back: '#/life' })}
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
  return `${header('Settings', { back: '#/now' })}
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
function openQuickAdd(preset = 'tasks') {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Quick add">
    <div class="grab"></div>
    <form data-form="quick">
      <label for="q-text" class="label">Add</label>
      <textarea id="q-text" name="text" rows="2" placeholder="Type anything…" required></textarea>
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
    case 'task-done':
      await db.update(id, { status: 'done', completedOn: todayStr() });
      toast('Done', { undo: true });
      break;
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
        render();
      }
    } else if (kind === 'quick') {
      const text = form.elements.text.value.trim();
      const id = form.elements.module.value;
      if (!text) return;
      const m = MODULE[id];
      const data = { ...defaults(id) };
      if (id === 'journal') Object.assign(data, { at: localStamp(), text, status: 'typed' });
      else data[titleKey(m)] = text;
      if (id === 'tasks' && !data.status) data.status = 'today';
      const rec = await db.create(id, data);
      closeSheet();
      toast(`Added to ${m.name}`, { undo: true });
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#sheet').classList.contains('open') && !recorder) closeSheet();
});

// ── boot ────────────────────────────────────────────────────────────────
let renderQueued = false;
function queueRender(info) {
  // don't wipe a form the user is typing in
  if (formDirty) return;
  if (['settings', 'new', 'search', 'inbox'].includes(currentRoute.name)) return;
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

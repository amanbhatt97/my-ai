// Every module is just a schema. Adding something new to track = adding an
// entry here; lists, forms, search, history and reminders work automatically.
//
// Field types: text, long, number, money, date, datetime, select, tags, url,
// links, check, rating, ref, secret4 (last 4 digits only)
// remind: N  → show in "Heads up" N days before this date (and when overdue)

const f = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });
const AREAS = ['personal', 'office', 'career', 'health', 'money', 'people', 'learning', 'home', 'travel'];
const area = f('area', 'Area', 'select', { options: AREAS });
const notes = f('notes', 'Notes', 'long');
const links = f('links', 'Links', 'links');
const doc = f('docLocation', 'Where the physical document is', 'text', { ph: 'Blue folder, top drawer' });
const scan = f('scan', 'Scan / file link (Drive)', 'url');

export const GROUPS = [
  'Links', 'Daily', 'Plan', 'Career', 'Learning', 'Health', 'Money', 'Own',
  'People', 'Travel', 'Home', 'Presence', 'Life', 'Emergency',
];

export const LINK_CATEGORIES = ['profile', 'finance', 'work', 'learning', 'government', 'health', 'travel', 'shopping', 'tools', 'other'];

export const MODULES = [
  // ── Links ───────────────────────────────────────────────────────────
  {
    id: 'links', name: 'Links', group: 'Links', title: 'name', status: 'category',
    fields: [
      f('name', 'Name', 'text', { req: true, ph: 'GitHub / LinkedIn / Zerodha / EPFO' }),
      f('url', 'URL', 'url', { req: true }),
      f('category', 'Category', 'select', { options: LINK_CATEGORIES, def: 'profile' }),
      f('pinned', 'Pin to Now screen', 'check'),
      f('handle', 'Username / login hint (never the password)', 'text'),
      notes,
    ],
  },

  // ── Daily ───────────────────────────────────────────────────────────
  {
    id: 'tasks', name: 'Tasks', group: 'Daily', title: 'title', status: 'status',
    done: (d) => d.status === 'done',
    fields: [
      f('title', 'Task', 'text', { req: true }),
      f('status', 'When', 'select', { options: ['inbox', 'today', 'this week', 'later', 'done'], def: 'today' }),
      area, f('due', 'Due', 'date', { remind: 1 }), notes,
    ],
  },
  {
    id: 'habits', name: 'Habits', group: 'Daily', title: 'name',
    fields: [
      f('name', 'Habit', 'text', { req: true }),
      f('active', 'Active', 'check', { def: true }),
      f('perWeek', 'Target days per week', 'number', { def: 7 }),
      f('log', 'Log', 'json', { hidden: true }), notes,
    ],
  },
  {
    id: 'journal', name: 'Journal', group: 'Daily', title: 'text', sort: 'at',
    fields: [
      f('at', 'When', 'datetime', { req: true }),
      f('kind', 'Type', 'select', { options: ['quick log', 'daily journal'], def: 'quick log' }),
      f('text', 'Entry', 'long'),
      f('mood', 'Mood', 'rating'),
      f('people', 'People mentioned', 'tags'),
      f('areas', 'Areas', 'tags'),
      f('rawText', 'Raw transcript', 'long', { readonly: true }),
      f('status', 'Status', 'text', { hidden: true }),
      f('audio', 'Audio', 'json', { hidden: true }),
      f('durationSec', 'Duration', 'number', { hidden: true }),
      f('suggestedTasks', 'Suggested tasks', 'json', { hidden: true }),
    ],
  },
  {
    id: 'days', name: 'Day log', group: 'Daily', title: 'date', sort: 'date',
    fields: [
      f('date', 'Date', 'date', { req: true }),
      f('mood', 'Mood', 'rating'), f('energy', 'Energy', 'rating'),
      f('sleep', 'Sleep (hours)', 'number'), f('steps', 'Steps', 'number'),
      f('highlight', 'Highlight of the day', 'text'), notes,
    ],
  },

  // ── Plan ────────────────────────────────────────────────────────────
  {
    id: 'vision', name: 'Vision & values', group: 'Plan', title: 'title',
    fields: [f('title', 'Statement', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['vision', 'value', 'principle', 'rule'] }), notes],
  },
  {
    id: 'goals', name: 'Goals', group: 'Plan', title: 'title', status: 'status',
    done: (d) => d.status === 'achieved' || d.status === 'dropped',
    fields: [
      f('title', 'Goal', 'text', { req: true }),
      f('horizon', 'Horizon', 'select', { options: ['life', 'year', 'quarter', 'month', 'week'], def: 'year' }),
      area, f('parent', 'Part of', 'ref', { ref: 'goals' }),
      f('progress', 'Progress %', 'number'),
      f('status', 'Status', 'select', { options: ['active', 'achieved', 'dropped', 'paused'], def: 'active' }),
      f('due', 'Target date', 'date', { remind: 14 }), f('why', 'Why it matters', 'long'), notes,
    ],
  },
  {
    id: 'reviews', name: 'Reviews', group: 'Plan', title: 'period', sort: 'date',
    fields: [
      f('period', 'Period', 'select', { options: ['week', 'month', 'quarter', 'year'], def: 'week', req: true }),
      f('date', 'Date', 'date'),
      f('wentWell', 'What went well', 'long'), f('didnt', "What didn't", 'long'),
      f('learned', 'What I learned', 'long'), f('next', 'Top 3 for next period', 'long'),
      f('score', 'Rating', 'rating'),
    ],
  },
  {
    id: 'decisions', name: 'Decisions', group: 'Plan', title: 'decision', sort: 'date',
    done: (d) => !!d.outcome,
    fields: [
      f('decision', 'Decision', 'text', { req: true }), f('date', 'Date', 'date'), area,
      f('options', 'Options considered', 'long'), f('chosen', 'What I chose', 'text'),
      f('why', 'Why', 'long'), f('expected', 'What I expect to happen', 'long'),
      f('revisit', 'Check back on', 'date', { remind: 0 }), f('outcome', 'What actually happened', 'long'),
    ],
  },
  {
    id: 'lessons', name: 'Lessons', group: 'Plan', title: 'lesson',
    fields: [f('lesson', 'Lesson', 'text', { req: true }), f('date', 'Date', 'date'), area, f('context', 'What happened', 'long')],
  },

  // ── Career ──────────────────────────────────────────────────────────
  {
    id: 'jobs', name: 'Job applications', group: 'Career', title: (d) => [d.role, d.company].filter(Boolean).join(' · '), status: 'status',
    done: (d) => ['rejected', 'ghosted', 'withdrawn', 'accepted', 'declined'].includes(d.status),
    fields: [
      f('company', 'Company', 'text', { req: true }), f('role', 'Role', 'text'),
      f('status', 'Status', 'select', { options: ['to apply', 'applied', 'screening', 'interview', 'offer', 'accepted', 'declined', 'rejected', 'ghosted', 'withdrawn'], def: 'to apply' }),
      f('link', 'Job post', 'url'), f('source', 'Source', 'select', { options: ['referral', 'linkedin', 'careers page', 'naukri', 'recruiter', 'other'] }),
      f('location', 'Location', 'text'), f('appliedOn', 'Applied on', 'date'),
      f('nextAction', 'Next action', 'text'), f('nextActionDate', 'Next action date', 'date', { remind: 0 }),
      f('salary', 'Salary / expected', 'text'), f('contact', 'Contact / recruiter', 'text'),
      f('resume', 'Résumé version used', 'url'), f('interviews', 'Interview notes & questions', 'long'), notes,
      f('emails', 'Emails', 'json', { hidden: true }),
    ],
  },
  {
    id: 'currentjob', name: 'Current job', group: 'Career', title: (d) => [d.role, d.company].filter(Boolean).join(' · '),
    fields: [
      f('company', 'Company', 'text', { req: true }), f('role', 'Role', 'text'), f('joined', 'Joined', 'date'),
      f('ctc', 'Pay (CTC)', 'text'), f('manager', 'Manager', 'text'), f('notice', 'Notice period', 'text'),
      f('appraisal', 'Next appraisal', 'date', { remind: 30 }), notes,
    ],
  },
  {
    id: 'wins', name: 'Wins & feedback', group: 'Career', title: 'title', sort: 'date',
    fields: [f('title', 'Win', 'text', { req: true }), f('date', 'Date', 'date'), f('impact', 'Impact (numbers)', 'text'), f('kind', 'Type', 'select', { options: ['win', 'praise', 'feedback', 'promotion', 'award'] }), notes],
  },
  {
    id: 'office', name: 'Office notes', group: 'Career', title: 'title', sort: 'date',
    fields: [f('title', 'Title', 'text', { req: true }), f('date', 'Date', 'date'), f('kind', 'Type', 'select', { options: ['1:1', 'meeting', 'project', 'idea', 'other'] }), f('people', 'People', 'tags'), notes, links],
  },
  {
    id: 'targets', name: 'Companies to target', group: 'Career', title: 'company',
    fields: [f('company', 'Company', 'text', { req: true }), f('why', 'Why', 'text'), f('careers', 'Careers page', 'url'), f('contact', 'Who I know there', 'text'), f('priority', 'Priority', 'rating'), notes],
  },

  // ── Learning ────────────────────────────────────────────────────────
  {
    id: 'books', name: 'Books', group: 'Learning', title: 'title', status: 'status',
    fields: [f('title', 'Title', 'text', { req: true }), f('author', 'Author', 'text'), f('status', 'Status', 'select', { options: ['want to read', 'reading', 'done', 'dropped'], def: 'want to read' }), f('rating', 'Rating', 'rating'), f('takeaways', '3 takeaways', 'long')],
  },
  {
    id: 'courses', name: 'Courses & certificates', group: 'Learning', title: 'title', status: 'status',
    fields: [f('title', 'Course', 'text', { req: true }), f('provider', 'Provider', 'text'), f('status', 'Status', 'select', { options: ['planned', 'doing', 'done'], def: 'planned' }), f('certificate', 'Certificate link', 'url'), f('expires', 'Certificate expires', 'date', { remind: 60 }), notes],
  },
  {
    id: 'skills', name: 'Skills', group: 'Learning', title: 'skill',
    fields: [f('skill', 'Skill', 'text', { req: true }), f('now', 'Current level', 'rating'), f('target', 'Target level', 'rating'), f('plan', 'How I will get there', 'long')],
  },
  {
    id: 'notes', name: 'Notes hub', group: 'Learning', title: 'title',
    fields: [f('title', 'Title', 'text', { req: true }), f('url', 'Link', 'url'), f('tags', 'Tags', 'tags'), notes],
  },

  // ── Health ──────────────────────────────────────────────────────────
  {
    id: 'healthlog', name: 'Health log', group: 'Health', title: (d) => [d.date, d.kind].filter(Boolean).join(' · '), sort: 'date',
    fields: [f('date', 'Date', 'date', { req: true }), f('kind', 'Type', 'select', { options: ['weight', 'workout', 'run', 'sleep', 'symptom', 'other'] }), f('value', 'Value', 'text', { ph: '72.4 kg / 5 km / 30 min' }), notes],
  },
  {
    id: 'medical', name: 'Medical records', group: 'Health', title: 'title', sort: 'date',
    fields: [f('title', 'Visit / test', 'text', { req: true }), f('date', 'Date', 'date'), f('doctor', 'Doctor / lab', 'text'), f('summary', 'Summary', 'long'), scan, f('followUp', 'Follow-up date', 'date', { remind: 3 })],
  },
  {
    id: 'medicines', name: 'Medicines', group: 'Health', title: 'name',
    fields: [f('name', 'Medicine', 'text', { req: true }), f('dose', 'Dose & timing', 'text'), f('for', 'For', 'text'), f('until', 'Until', 'date', { remind: 3 }), f('refill', 'Refill by', 'date', { remind: 3 })],
  },
  {
    id: 'healthprofile', name: 'Health profile', group: 'Health', title: 'item',
    fields: [f('item', 'Item', 'text', { req: true, ph: 'Blood group / allergy / condition / vaccination' }), f('value', 'Details', 'text'), f('date', 'Date', 'date'), f('nextDue', 'Next due', 'date', { remind: 14 }), notes],
  },

  // ── Money ───────────────────────────────────────────────────────────
  {
    id: 'networth', name: 'Net worth snapshots', group: 'Money', title: 'month', sort: 'month',
    fields: [f('month', 'Month', 'text', { req: true, ph: '2026-11' }), f('assets', 'Total assets', 'money'), f('liabilities', 'Total loans', 'money'), notes],
  },
  {
    id: 'accounts', name: 'Investments & accounts', group: 'Money', title: 'name',
    fields: [f('name', 'Name', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['bank', 'mutual fund', 'stocks', 'EPF', 'PPF', 'NPS', 'FD', 'gold', 'crypto', 'other'] }), f('where', 'Held with', 'text'), f('last4', 'Account no. (last 4)', 'secret4'), f('value', 'Current value', 'money'), f('nominee', 'Nominee', 'text'), f('maturity', 'Maturity date', 'date', { remind: 30 }), notes],
  },
  {
    id: 'loans', name: 'Loans & EMIs', group: 'Money', title: 'name',
    fields: [f('name', 'Name', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['home loan', 'car loan', 'personal loan', 'education loan', 'credit card', 'other'] }), f('lender', 'Lender', 'text'), f('emi', 'EMI / due amount', 'money'), f('dueDay', 'Due day of month', 'number'), f('endDate', 'Ends on', 'date'), f('outstanding', 'Outstanding', 'money'), notes],
  },
  {
    id: 'insurance', name: 'Insurance', group: 'Money', title: 'name',
    fields: [f('name', 'Policy', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['health', 'term life', 'vehicle', 'home', 'travel', 'other'] }), f('insurer', 'Insurer', 'text'), f('policyLast4', 'Policy no. (last 4)', 'secret4'), f('cover', 'Cover amount', 'money'), f('premium', 'Premium', 'money'), f('renewal', 'Renewal date', 'date', { remind: 30 }), f('nominee', 'Nominee', 'text'), scan, notes],
  },
  {
    id: 'subscriptions', name: 'Subscriptions', group: 'Money', title: 'name',
    fields: [f('name', 'Service', 'text', { req: true }), f('cost', 'Cost', 'money'), f('cycle', 'Billing', 'select', { options: ['monthly', 'quarterly', 'yearly'] }), f('renews', 'Renews on', 'date', { remind: 5 }), f('stillUsing', 'Still using it?', 'check', { def: true }), notes],
  },
  {
    id: 'tax', name: 'Tax', group: 'Money', title: 'title',
    fields: [f('title', 'Item', 'text', { req: true, ph: 'ITR FY 2025-26 / Form 16 / 80C proof' }), f('fy', 'Financial year', 'text'), f('due', 'Due date', 'date', { remind: 15 }), f('done', 'Done', 'check'), scan, notes],
  },
  {
    id: 'lent', name: 'Lent & borrowed', group: 'Money', title: (d) => `${d.direction || ''} ${d.person || ''}`.trim(),
    done: (d) => !!d.settled,
    fields: [f('person', 'Person', 'text', { req: true }), f('direction', 'Direction', 'select', { options: ['lent to', 'borrowed from'] }), f('amount', 'Amount', 'money'), f('date', 'Date', 'date'), f('dueBy', 'Return by', 'date', { remind: 3 }), f('settled', 'Settled', 'check'), notes],
  },
  {
    id: 'spending', name: 'Monthly spending', group: 'Money', title: 'month', sort: 'month',
    fields: [f('month', 'Month', 'text', { req: true, ph: '2026-11' }), f('total', 'Total spent', 'money'), f('rent', 'Rent', 'money'), f('food', 'Food', 'money'), f('travel', 'Travel', 'money'), f('shopping', 'Shopping', 'money'), f('other', 'Other', 'money'), notes],
  },

  // ── Own ─────────────────────────────────────────────────────────────
  {
    id: 'vehicles', name: 'Vehicles', group: 'Own', title: 'name',
    fields: [
      f('name', 'Vehicle', 'text', { req: true, ph: 'Car / bike model' }), f('kind', 'Type', 'select', { options: ['car', 'bike', 'scooter', 'cycle', 'other'] }),
      f('reg', 'Registration no.', 'text'), f('bought', 'Bought on', 'date'), f('price', 'Price', 'money'),
      f('insuranceExpiry', 'Insurance expires', 'date', { remind: 30 }), f('pucExpiry', 'PUC expires', 'date', { remind: 15 }),
      f('serviceDue', 'Next service', 'date', { remind: 7 }), f('serviceKm', 'Next service at (km)', 'number'),
      f('loan', 'Loan / EMI', 'text'), f('rcLocation', 'Where the RC is', 'text'), doc, scan,
      f('serviceLog', 'Service history', 'long'), notes,
    ],
  },
  {
    id: 'possessions', name: 'Things I own', group: 'Own', title: 'name',
    fields: [f('name', 'Item', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['phone', 'laptop', 'appliance', 'furniture', 'jewellery', 'watch', 'other'] }), f('bought', 'Bought on', 'date'), f('price', 'Price', 'money'), f('warranty', 'Warranty ends', 'date', { remind: 30 }), f('serial', 'Serial no.', 'text'), f('invoice', 'Invoice link', 'url'), f('keptWhere', 'Kept where', 'text'), notes],
  },
  {
    id: 'documents', name: 'Documents & IDs', group: 'Own', title: 'name',
    fields: [f('name', 'Document', 'text', { req: true, ph: 'Passport / PAN / Aadhaar / DL / degree' }), f('last4', 'Number (last 4 only)', 'secret4'), f('issued', 'Issued on', 'date'), f('expires', 'Expires on', 'date', { remind: 120 }), doc, scan, notes],
  },
  {
    id: 'home', name: 'Home', group: 'Own', title: 'item',
    fields: [f('item', 'Item', 'text', { req: true, ph: 'Rent agreement / electricity / wifi / property papers' }), f('details', 'Details / account no.', 'text'), f('contact', 'Contact', 'text'), f('amount', 'Amount', 'money'), f('expires', 'Expires / renews', 'date', { remind: 30 }), doc, scan, notes],
  },

  // ── People ──────────────────────────────────────────────────────────
  {
    id: 'people', name: 'People', group: 'People', title: 'name',
    fields: [
      f('name', 'Name', 'text', { req: true }), f('relation', 'Relation', 'select', { options: ['family', 'partner', 'friend', 'colleague', 'mentor', 'other'] }),
      f('birthday', 'Birthday', 'date', { remind: 7, yearly: true }), f('anniversary', 'Anniversary', 'date', { remind: 7, yearly: true }),
      f('phone', 'Phone', 'text'), f('lastContact', 'Last contacted', 'date'),
      f('everyWeeks', 'Reach out every (weeks)', 'number'),
      f('likes', 'Likes / gift ideas', 'long'), f('remember', 'Things to remember', 'long'), notes,
    ],
  },
  {
    id: 'favours', name: 'Favours', group: 'People', title: 'what',
    done: (d) => !!d.done,
    fields: [f('what', 'Favour', 'text', { req: true }), f('person', 'Person', 'text'), f('direction', 'Direction', 'select', { options: ['I owe', 'they owe'] }), f('done', 'Done', 'check')],
  },

  // ── Travel ──────────────────────────────────────────────────────────
  {
    id: 'trips', name: 'Trips', group: 'Travel', title: 'place', sort: 'from',
    fields: [f('place', 'Place', 'text', { req: true }), f('country', 'Country', 'text'), f('from', 'From', 'date', { remind: 7 }), f('to', 'To', 'date'), f('with', 'With', 'tags'), f('cost', 'Total cost', 'money'), f('album', 'Photo album', 'url'), f('highlights', 'Highlights', 'long'), links],
  },
  {
    id: 'travelwish', name: 'Places to go', group: 'Travel', title: 'place',
    fields: [f('place', 'Place', 'text', { req: true }), f('when', 'Ideal time', 'text'), f('budget', 'Budget', 'money'), notes],
  },
  {
    id: 'traveldocs', name: 'Visas & travel IDs', group: 'Travel', title: 'name',
    fields: [f('name', 'Item', 'text', { req: true, ph: 'Schengen visa / frequent flyer' }), f('number', 'Number (last 4)', 'secret4'), f('expires', 'Expires', 'date', { remind: 60 }), scan, notes],
  },

  // ── Home ────────────────────────────────────────────────────────────
  {
    id: 'maintenance', name: 'Maintenance', group: 'Home', title: 'task',
    fields: [f('task', 'Task', 'text', { req: true, ph: 'AC service / purifier filter' }), f('everyMonths', 'Every (months)', 'number'), f('last', 'Last done', 'date'), f('next', 'Next due', 'date', { remind: 7 }), f('vendor', 'Vendor / contact', 'text'), notes],
  },
  {
    id: 'contacts', name: 'Useful contacts', group: 'Home', title: 'name',
    fields: [f('name', 'Name', 'text', { req: true }), f('role', 'Role', 'text', { ph: 'Electrician / CA / mechanic' }), f('phone', 'Phone', 'text'), notes],
  },

  // ── Presence ────────────────────────────────────────────────────────
  {
    id: 'profiles', name: 'Portfolio & profiles', group: 'Presence', title: 'name',
    fields: [f('name', 'Name', 'text', { req: true, ph: 'Portfolio site / GitHub / LinkedIn' }), f('url', 'URL', 'url'), f('lastUpdated', 'Last updated', 'date'), f('nextUpdate', 'Review on', 'date', { remind: 0 }), notes],
  },
  {
    id: 'projects', name: 'Projects', group: 'Presence', title: 'name', status: 'status',
    fields: [f('name', 'Project', 'text', { req: true }), f('status', 'Status', 'select', { options: ['idea', 'building', 'shipped', 'paused'], def: 'idea' }), f('repo', 'Repo', 'url'), f('live', 'Live link', 'url'), f('stack', 'Stack', 'tags'), notes],
  },

  // ── Life ────────────────────────────────────────────────────────────
  {
    id: 'milestones', name: 'Milestones', group: 'Life', title: 'title', sort: 'date',
    fields: [f('title', 'Milestone', 'text', { req: true }), f('date', 'Date', 'date'), f('photos', 'Photos', 'url'), notes],
  },
  {
    id: 'ideas', name: 'Ideas', group: 'Life', title: 'idea',
    fields: [f('idea', 'Idea', 'text', { req: true }), f('kind', 'Type', 'select', { options: ['side project', 'business', 'content', 'life', 'other'] }), notes],
  },
  {
    id: 'wishlist', name: 'Wishlist (30-day rule)', group: 'Life', title: 'item',
    done: (d) => d.decision === 'bought' || d.decision === 'skipped',
    fields: [f('item', 'Item', 'text', { req: true }), f('price', 'Price', 'money'), f('added', 'Added on', 'date'), f('decideOn', 'Decide on', 'date', { remind: 0 }), f('decision', 'Decision', 'select', { options: ['waiting', 'bought', 'skipped'], def: 'waiting' }), f('link', 'Link', 'url')],
  },
  {
    id: 'bucket', name: 'Bucket list', group: 'Life', title: 'item',
    fields: [f('item', 'Item', 'text', { req: true }), f('done', 'Done', 'check'), f('doneOn', 'Done on', 'date'), notes],
  },

  // ── Emergency ───────────────────────────────────────────────────────
  {
    id: 'emergency', name: 'Emergency info', group: 'Emergency', title: 'item',
    fields: [f('item', 'Item', 'text', { req: true, ph: 'Emergency contact / blood group / what to do if hospitalised' }), f('details', 'Details', 'long'), f('phone', 'Phone', 'text')],
  },
];

export const MODULE = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export function titleOf(rec) {
  const m = MODULE[rec.module];
  if (!m) return 'Untitled';
  const t = typeof m.title === 'function' ? m.title(rec.data) : rec.data[m.title];
  const s = (t ?? '').toString().trim();
  return s || 'Untitled';
}

export function defaults(moduleId) {
  const out = {};
  for (const fd of MODULE[moduleId].fields) if (fd.def !== undefined) out[fd.k] = fd.def;
  return out;
}

export function isDone(rec) {
  const m = MODULE[rec.module];
  if (m?.done) return m.done(rec.data);
  return rec.data.done === true;
}

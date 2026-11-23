// v3 information architecture: 4 tabs, 8 rooms, max 2 levels (room → collection → item).
//   Today  · what do I do now?
//   Life   · where is it?        (8 rooms)
//   Plan   · where am I going?
//   Search · find anything

export const ROOMS = [
  { id: 'career', name: 'Career', color: '#7AA2FF', modules: ['jobs', 'targets', 'currentjob', 'wins', 'office'], extra: [{ name: 'From Gmail', href: '#/inbox' }] },
  { id: 'money', name: 'Money', color: '#4FD1A5', modules: ['accounts', 'loans', 'insurance', 'tax'] },
  { id: 'health', name: 'Health', color: '#FF7A8A', modules: ['healthprofile', 'medical', 'medicines', 'healthlog', 'emergency'] },
  { id: 'people', name: 'People', color: '#F5B65C', modules: ['people', 'favours'] },
  { id: 'home', name: 'Home & things', color: '#B08CFF', modules: ['vehicles', 'documents', 'possessions', 'home', 'maintenance', 'contacts'] },
  { id: 'learning', name: 'Learning', color: '#5CC8F5', modules: ['books', 'courses', 'skills', 'notes'] },
  { id: 'travel', name: 'Travel', color: '#FF9F5C', modules: ['trips', 'travelwish', 'traveldocs'], extra: [{ name: 'Import from Google Drive', href: '#/drive-travel' }] },
  { id: 'me', name: 'Me', color: '#C8FF4D', modules: ['journal', 'links', 'days', 'profiles', 'projects', 'ideas', 'milestones', 'wishlist', 'bucket'] },
];

export const PLAN_MODULES = ['goals', 'tasks', 'habits', 'reviews', 'decisions', 'lessons', 'vision'];

export const ROOM = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

const MOD_ROOM = {};
for (const r of ROOMS) for (const m of r.modules) MOD_ROOM[m] = r;
export const roomOf = (moduleId) => MOD_ROOM[moduleId] || null;
export const colorOf = (moduleId) => (MOD_ROOM[moduleId] ? MOD_ROOM[moduleId].color : '#C8FF4D');

// Where "back" goes from a collection.
export function homeOf(moduleId) {
  const r = MOD_ROOM[moduleId];
  if (r) return { name: r.name, href: `#/room/${r.id}` };
  if (PLAN_MODULES.includes(moduleId)) return { name: 'Plan', href: '#/plan' };
  return { name: 'Life', href: '#/life' };
}

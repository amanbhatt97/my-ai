// v3 information architecture: 4 tabs, 8 rooms, max 2 levels (room → collection → item).
//   Today  · what do I do now?
//   Life   · where is it?        (8 rooms)
//   Plan   · where am I going?
//   Search · find anything

export const ROOMS = [
  { id: 'career', icon: 'career', name: 'Career', color: '#5856D6', modules: ['jobs', 'targets', 'currentjob', 'wins', 'office'], extra: [{ name: 'From Gmail', href: '#/inbox' }] },
  { id: 'money', icon: 'money', name: 'Money', color: '#34C759', modules: ['accounts', 'loans', 'insurance', 'tax'] },
  { id: 'health', icon: 'health', name: 'Health', color: '#FF2D55', modules: ['healthprofile', 'medical', 'medicines', 'healthlog', 'emergency'] },
  { id: 'people', icon: 'people', name: 'People', color: '#FF9500', modules: ['people', 'favours'] },
  { id: 'home', icon: 'home', name: 'Home & things', color: '#30B0C7', modules: ['vehicles', 'documents', 'possessions', 'home', 'maintenance', 'contacts'] },
  { id: 'learning', icon: 'learning', name: 'Learning', color: '#007AFF', modules: ['books', 'courses', 'skills', 'notes'] },
  { id: 'travel', icon: 'travel', name: 'Travel', color: '#32ADE6', modules: ['trips', 'travelwish', 'traveldocs'], extra: [{ name: 'Import from Google Drive', href: '#/drive-travel' }] },
  { id: 'me', icon: 'star', name: 'Me', color: '#AF52DE', modules: ['journal', 'links', 'days', 'profiles', 'projects', 'ideas', 'milestones', 'wishlist', 'bucket'] },
];

export const PLAN_MODULES = ['goals', 'tasks', 'habits', 'reviews', 'decisions', 'lessons', 'vision'];

export const ROOM = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

const MOD_ROOM = {};
for (const r of ROOMS) for (const m of r.modules) MOD_ROOM[m] = r;
export const roomOf = (moduleId) => MOD_ROOM[moduleId] || null;
export const colorOf = (moduleId) => (MOD_ROOM[moduleId] ? MOD_ROOM[moduleId].color : '#007AFF');

// Where "back" goes from a collection.
export function homeOf(moduleId) {
  const r = MOD_ROOM[moduleId];
  if (r) return { name: r.name, href: `#/room/${r.id}` };
  if (PLAN_MODULES.includes(moduleId)) return { name: 'Plan', href: '#/plan' };
  return { name: 'Home', href: '#/now' };
}

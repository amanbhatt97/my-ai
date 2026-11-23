// The whole app as one tree. Every screen has a place here, which gives us
// breadcrumbs, the Life map, node pages and the desktop sidebar.
//   Do:     Today, Track, Plan     (daily use, one tap away)
//   Manage: Areas, Links, Insights, System
// Module nodes automatically get their status values as child nodes.

import { MODULE } from './schemas.js';

const mod = (id, name) => ({ id: `m-${id}`, module: id, name: name || MODULE[id].name });
const route = (id, name, href, extra = {}) => ({ id, name, route: href, ...extra });

export const TREE = {
  id: 'life', name: 'Life', route: '#/life',
  children: [
    route('today', 'Today', '#/now', { icon: 'now', mode: 'do' }),
    {
      id: 'track', name: 'Track', icon: 'track', mode: 'do',
      children: [mod('tasks'), mod('habits'), route('journal', 'Journal', '#/journal'), mod('days', 'Mood & day log')],
    },
    {
      id: 'plan', name: 'Plan', icon: 'plan', mode: 'do', route: '#/plan',
      children: [mod('vision'), mod('goals'), mod('reviews'), mod('decisions'), mod('lessons')],
    },
    {
      id: 'areas', name: 'Areas', icon: 'life', mode: 'manage',
      children: [
        {
          id: 'career', name: 'Career', icon: 'career',
          children: [
            { id: 'jobsearch', name: 'Job search', children: [mod('jobs', 'Applications'), mod('targets'), route('inbox', 'From Gmail', '#/inbox')] },
            { id: 'work', name: 'Current work', children: [mod('currentjob'), mod('wins'), mod('office')] },
          ],
        },
        { id: 'learning', name: 'Learning', icon: 'learning', children: [mod('books'), mod('courses'), mod('skills'), mod('notes')] },
        { id: 'health', name: 'Health', icon: 'health', children: [mod('healthprofile'), mod('healthlog'), mod('medical'), mod('medicines')] },
        {
          id: 'money', name: 'Money', icon: 'money',
          children: [
            { id: 'wealth', name: 'Wealth', children: [mod('accounts'), mod('networth')] },
            { id: 'obligations', name: 'Obligations', children: [mod('loans'), mod('insurance'), mod('subscriptions'), mod('tax')] },
            { id: 'cashflow', name: 'Cash flow', children: [mod('spending'), mod('lent')] },
          ],
        },
        { id: 'assets', name: 'Assets & documents', icon: 'assets', children: [mod('vehicles'), mod('possessions'), mod('documents'), mod('home')] },
        { id: 'people', name: 'People', icon: 'people', children: [mod('people', 'Contacts & birthdays'), mod('favours')] },
        { id: 'travel', name: 'Travel', icon: 'travel', children: [mod('trips'), mod('travelwish'), mod('traveldocs')] },
        { id: 'homeadmin', name: 'Home admin', icon: 'home', children: [mod('maintenance'), mod('contacts')] },
        { id: 'presence', name: 'Online presence', icon: 'globe', children: [mod('profiles'), mod('projects')] },
        { id: 'lifelog', name: 'Life log', icon: 'star', children: [mod('milestones'), mod('ideas'), mod('wishlist'), mod('bucket')] },
        { id: 'safety', name: 'Emergency', icon: 'shield', children: [mod('emergency')] },
      ],
    },
    route('links', 'Links', '#/links', { icon: 'link', mode: 'manage' }),
    {
      id: 'insights', name: 'Insights', icon: 'chart', mode: 'manage',
      children: [route('progress', 'Progress', '#/progress'), route('search', 'Search everything', '#/search')],
    },
    {
      id: 'system', name: 'System', icon: 'gear', mode: 'manage',
      children: [route('setup', 'Set up guide', '#/setup'), route('settings', 'Settings', '#/settings'), route('trash', 'Trash', '#/trash')],
    },
  ],
};

// index: id → { node, parent }
const INDEX = new Map();
(function walk(node, parent) {
  INDEX.set(node.id, { node, parent });
  for (const c of node.children || []) walk(c, node);
})(TREE, null);

export const nodeById = (id) => INDEX.get(id)?.node || null;
export const parentOf = (id) => INDEX.get(id)?.parent || null;

export function pathTo(id) {
  const out = [];
  let cur = INDEX.get(id);
  while (cur) { out.unshift(cur.node); cur = cur.parent ? INDEX.get(cur.parent.id) : null; }
  return out;
}

export const moduleNodeId = (moduleId) => `m-${moduleId}`;
export function nodeForRoute(hash) {
  for (const { node } of INDEX.values()) if (node.route === hash) return node;
  return null;
}

// Where a node goes when tapped.
export function hrefOf(node) {
  if (node.route) return node.route;
  if (node.module) return `#/m/${node.module}`;
  return `#/t/${node.id}`;
}

// Children including generated status sub-sections for module nodes.
export function childrenOf(node) {
  if (node.children) return node.children;
  if (node.module && !node.status) {
    const m = MODULE[node.module];
    const sf = m.status && m.fields.find((x) => x.k === m.status);
    if (sf) return sf.options.map((o) => ({ id: `${node.id}:${o}`, name: o, status: o, module: node.module, href: `#/m/${node.module}/${encodeURIComponent(o)}` }));
  }
  return [];
}

// All module ids under a node (for counts).
export function modulesUnder(node) {
  if (node.module && !node.status) return [node.module];
  const out = [];
  for (const c of node.children || []) out.push(...modulesUnder(c));
  return [...new Set(out)];
}

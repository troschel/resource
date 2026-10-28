/* =============================================================================
   tenancy.js — derived figures for the Mietverträge tab.

   The second planning domain: the contracts the BBL lets to the federal
   offices. A team of three per group of cantons — Treuhand, Bewirtschaftung,
   Sachbearbeitung — carries every contract in its cantons, and the plan is one
   allocation per canton and office: a pensum per role and quarter. The
   contracts underneath are the evidence, not the unit of planning.

   Like store.js, this holds no markup and no German beyond the data's own
   labels; the views translate.
   ============================================================================= */

import { data, state, memo, t, periods, periodValue, searchMatcher, compareDe, nowIndex } from './store.js';

const tn = () => data.tenancy;

export const ROLE_IDS = ['treuhand', 'bewirtschaftung', 'sachbearbeitung'];

/* -----------------------------------------------------------------------------
   Pensum, with the session's edits applied
   -------------------------------------------------------------------------- */

const key = (allocation, role, q) => `${allocation.id}:${role}:${q}`;

/** One role's pensum on an allocation in a quarter. */
export function roleValue(allocation, role, q) {
  const o = state.tOverrides[key(allocation, role, q)];
  return o === undefined ? allocation.demand[role][q] : o;
}

/** The figure the grid shows: one role's, or the team's when the view is «all». */
export function allocValue(allocation, q, role = state.role) {
  return role === 'all'
    ? ROLE_IDS.reduce((a, r) => a + roleValue(allocation, r, q), 0)
    : roleValue(allocation, role, q);
}

export const allocDemand = (allocation, role = state.role) =>
  data.quarters.map((_, q) => allocValue(allocation, q, role));

export const isEditedAlloc = (allocation, q, role = state.role) =>
  (role === 'all' ? ROLE_IDS : [role]).some(r => state.tOverrides[key(allocation, r, q)] !== undefined);

/* -----------------------------------------------------------------------------
   People — a person's load is their role's share of their team's allocations
   -------------------------------------------------------------------------- */

/** Who holds a role in a team, or null for a vacancy. */
export const memberOf = (teamId, role) => tn().peopleById[tn().teamsById[teamId]?.members[role]] ?? null;

/** A person's pensum in a quarter, unsaved edits included. In pensum points. */
export function tPersonLoad(person, q) {
  let delta = 0;
  for (const a of tn().allocationsByTeam[person.teamId] ?? []) {
    const o = state.tOverrides[key(a, person.role, q)];
    if (o !== undefined) delta += o - a.demand[person.role][q];
  }
  return person.baseLoad[q] + delta;
}

/**
 * The same load against the person's contract. Nobody in this domain keeps a
 * share back for other work, so the whole contract is the ceiling. `delta` is
 * an edit not yet applied, which the editor asks about.
 */
export const tPersonUtil = (person, q, delta = 0) =>
  Math.round((tPersonLoad(person, q) + delta) / person.employment * 100);

/** The load of the role left vacant in a team: real work that nobody carries. */
export function vacantLoad(teamId, role, q) {
  return (tn().allocationsByTeam[teamId] ?? []).reduce((a, x) => a + roleValue(x, role, q), 0);
}

/* -----------------------------------------------------------------------------
   Contracts — the end dates behind the peaks
   -------------------------------------------------------------------------- */

/** The window's index of the quarter an ISO date falls in, or null outside it. */
export function quarterOfDate(iso) {
  if (!iso) return null;
  const [y, m] = iso.split('-').map(Number);
  return data.quarterIndex[`${y}Q${Math.ceil(m / 3)}`] ?? null;
}

export const contractsOf = allocation => tn().contractsByAllocation[allocation.id] ?? [];

/** Months from today to an end date, rounded down; negative once it has passed. */
export function monthsUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = data.meta.today.split('-').map(Number);
  return (y - ty) * 12 + (m - tm) - (d < td ? 1 : 0);
}

/*
 * «Due» means the end date falls within the next twelve months: that is when
 * the renewal is negotiated and the pensum rises, so it is what the row warns
 * of. The generator's RENEWAL_SPAN is three quarters, about the same.
 */
export const DUE_MONTHS = 12;
export const isDue = c => c.end != null && monthsUntil(c.end) < DUE_MONTHS;

const dueIndex = memo(() => Object.fromEntries(tn().allocations.map(a => [a.id, contractsOf(a).filter(isDue).length])));
export const dueCount = allocation => dueIndex()[allocation.id];

/** How many of an allocation's contracts end in each quarter of the window. */
const endsIndex = memo(() => Object.fromEntries(tn().allocations.map(a => {
  const out = {};
  for (const c of contractsOf(a)) {
    const q = quarterOfDate(c.end);
    if (q !== null) out[q] = (out[q] ?? 0) + 1;
  }
  return [a.id, out];
})));
export const endsIn = (allocation, period) =>
  period.quarters.reduce((a, q) => a + (endsIndex()[allocation.id][q] ?? 0), 0);

/* -----------------------------------------------------------------------------
   Filtering, sorting, grouping
   -------------------------------------------------------------------------- */

export const cantonLabel = id => t(tn().cantonsById[id]?.label ?? id);
export const officeOf = id => tn().officesById[id] ?? { id, short: id, label: id };

/*
 * The search finds an allocation by what its row shows — canton, office, team,
 * the people on it — and by any contract underneath, so a contract number
 * typed in leads to the row that carries it.
 */
function matches(allocation, match) {
  const team = tn().teamsById[allocation.teamId];
  const office = officeOf(allocation.officeId);
  const people = ROLE_IDS.map(r => memberOf(allocation.teamId, r)?.name ?? '').join(' ');
  const row = `${allocation.canton} ${cantonLabel(allocation.canton)} ${office.short} ${office.label} ${t(team.label)} ${people}`;
  return match.test(row) || contractsOf(allocation).some(c => match.test(`${c.number} ${c.buildingId} ${c.title}`));
}

export const T_SORT_KEYS = {
  canton:    { numeric: false, value: a => `${cantonLabel(a.canton)} ${officeOf(a.officeId).short}` },
  office:    { numeric: false, value: a => `${officeOf(a.officeId).short} ${cantonLabel(a.canton)}` },
  team:      { numeric: false, value: a => t(tn().teamsById[a.teamId].label) },
  contracts: { numeric: true, value: a => a.contracts },
  rent:      { numeric: true, value: a => a.rent },
  due:       { numeric: true, value: a => dueCount(a) }
};

export const tDefaultDir = k => (k.startsWith('q') || T_SORT_KEYS[k]?.numeric ? 'desc' : 'asc');

/* A period column is addressed by its place in the visible window, q0 first. */
function sortKeyOf(k) {
  const q = /^q(\d+)$/.exec(k);
  if (q) {
    const period = periods()[Number(q[1])];
    if (period) return { numeric: true, value: a => periodValue(allocDemand(a), period) };
  }
  return T_SORT_KEYS[k] ?? T_SORT_KEYS.canton;
}

/** The allocations in scope, filtered and sorted — once per change of state. */
export const filteredAllocations = memo(() => {
  const match = searchMatcher();
  const list = tn().allocations.filter(a => {
    if (state.teams.length && !state.teams.includes(a.teamId)) return false;
    if (state.cantons.length && !state.cantons.includes(a.canton)) return false;
    if (state.offices.length && !state.offices.includes(a.officeId)) return false;
    return !match || matches(a, match);
  });
  return sortAllocations(list);
});

export function sortAllocations(list) {
  const { numeric, value } = sortKeyOf(state.tSort);
  const sign = state.tDir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = value(a), y = value(b);
    return (numeric ? x - y : compareDe(x, y)) * sign;
  });
}

/** Group the allocations the way the toolbar says, in the data's own order. */
export function groupAllocations(list) {
  if (state.tgroup === 'none') return [{ key: 'all', label: null, rows: list }];
  const keyOf = { team: a => a.teamId, canton: a => a.canton, office: a => a.officeId }[state.tgroup];
  const order = {
    team: () => tn().meta.teams.map(x => x.id),
    canton: () => tn().meta.cantons.map(x => x.id),
    office: () => tn().meta.offices.map(x => x.id)
  }[state.tgroup]();
  const labelOf = {
    team: id => {
      const team = tn().teamsById[id];
      return `${t(team.label)} · ${team.cantons.join(', ')}`;
    },
    canton: id => `${cantonLabel(id)} (${id})`,
    office: id => `${officeOf(id).short} · ${t(officeOf(id).label)}`
  }[state.tgroup];
  const buckets = new Map();
  for (const a of list) {
    const k = keyOf(a);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(a);
  }
  return order.filter(k => buckets.has(k)).map(k => ({ key: `t:${state.tgroup}:${k}`, id: k, label: labelOf(k), rows: buckets.get(k) }));
}

/* -----------------------------------------------------------------------------
   Roll-ups
   -------------------------------------------------------------------------- */

/** The KPI strip of the tab: what is in scope, what it is worth, what it asks. */
export function tenancyKpis() {
  const list = filteredAllocations();
  const now = nowIndex();
  const contracts = list.reduce((a, x) => a + x.contracts, 0);
  const rent = list.reduce((a, x) => a + x.rent, 0);
  const pensum = list.reduce((a, x) => a + allocValue(x, now), 0);
  const due = list.reduce((a, x) => a + dueCount(x), 0);
  return { contracts, rent, pensum, due, allocations: list.length };
}

export const tenancyScoped = () => filteredAllocations().length !== tn().allocations.length;

/** Active tenancy filter chips, in the order the toolbar declares them. */
export function tenancyFilters() {
  const chips = [];
  state.teams.forEach(id => chips.push({ kind: 'team', id, label: t(tn().teamsById[id].label) }));
  state.cantons.forEach(id => chips.push({ kind: 'canton', id, label: cantonLabel(id) }));
  state.offices.forEach(id => chips.push({ kind: 'office', id, label: officeOf(id).short }));
  if (state.search) chips.push({ kind: 'search', id: '1', label: `${t('Suche')}: ${state.search}` });
  return chips;
}

/** Yearly rent the Swiss way: CHF 1’234’500, or in millions for a total. */
export function chf(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} Mio.`;
  return `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’')}`;
}

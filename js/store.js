/* =============================================================================
   store.js — data loading, application state, URL sync and all derived figures.

   The prototype keeps one rule: nothing that can be computed is hard-coded.
   Demand, net capacity, utilisation, free capacity, per-person load, budget
   roll-ups and milestone counts are all derived from the JSON in /data, so
   editing a pensum cell moves every number that depends on it.
   ============================================================================= */

const DATA_FILES = [
  'meta', 'phases', 'people', 'capacity', 'projects',
  'milestones', 'changes', 'dashboard', 'i18n', 'print'
];

/* The second domain, the tenancy agreements, under data/tenancy/ — see
   tools/README.md. Its people are a roster of their own, not the project leads. */
const TENANCY_FILES = ['meta', 'people', 'allocations', 'contracts'];

/** Raw data, populated by load(). */
export const data = {};

/* -----------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

/*
 * The closed sets the URL and the state share. readUrl() accepts nothing else,
 * so a hand-edited hash cannot put the app into a state a view has no branch
 * for — `#?group=colour` used to reach the toolbar and throw.
 */
export const VOCAB = {
  /* «schedule» is gone from the set but not from the world: readUrl() maps an
     old link to the Planung tab in its Termine view. */
  tab:     ['overview', 'people', 'dashboard', 'history', 'tenancy', 'api', 'export'],
  lang:    ['de', 'en', 'fr', 'it'],
  scale:   ['year', 'quarter', 'month'],
  unit:    ['pct', 'fte'],
  view:    ['pensum', 'pensum-termine', 'termine', 'custom'],   // «both» in old links
  colour:  ['pensum', 'none'],
  sortDir: ['asc', 'desc'],
  group:   ['portfolio', 'lead', 'phase', 'organisation', 'size', 'none'],
  paper:   ['a4', 'a3', 'a2', 'a1', 'a0'],
  zoom:    ['fit', '50', '100', '200', '400'],
  sheet:   ['portrait', 'landscape'],
  pageSize: ['25', '50', '100'],
  /* The Mietverträge tab: how its rows are grouped, and which of the three
     roles its figures show — «all» is the team's pensum, the three summed. */
  tgroup:  ['team', 'canton', 'office', 'none'],
  role:    ['all', 'treuhand', 'bewirtschaftung', 'sachbearbeitung']
};

const DEFAULT_STATE = {
  tab: 'overview',
  paper: 'a4',             // ISO size, see VOCAB.paper
  sheet: 'portrait',       // orientation, see VOCAB.sheet
  lang: 'de',
  scale: 'quarter',
  periodOffset: 0,         // how far the visible window has been stepped
  unit: 'pct',             // pct | fte
  /*
   * What the planning grid draws. `view` is a name for a set of layers —
   * VIEW_PRESETS below — and `layers` is the set itself; the two are always
   * written together, so a switch that leaves a named set turns the view
   * into «custom» on its own. `colour` is whether the figures carry the heat
   * ramp; it means nothing while the figures are hidden.
   */
  view: 'pensum',          // see VOCAB.view
  layers: { values: true, phases: false, gates: false, today: false },
  colour: 'pensum',        // see VOCAB.colour
  sort: 'project',         // any key in SORT_KEYS, or q0…q7 for one quarter
  sortDir: 'asc',          // asc | desc
  group: 'none',           // portfolio | lead | phase | organisation | size | none
  search: '',
  phases: [],              // selected main phase ids, e.g. ['3','5']
  leads: [],               // selected person ids
  portfolios: [],          // selected portfolio ids
  organisations: [],       // selected team ids
  exporting: false,        // a PDF is being written; transient, never in the URL
  // column / attribute toggles, one set per grid — see columnSet()
  cols: null,              // filled from COLUMN_DEFAULTS below
  hideZeros: false,        // in the URL as zeros=hide
  // editing
  editing: null,           // { projectId, q }
  picking: null,           // { projectId, anchor, search } — the Bearbeitender picker
  draft: 0,
  reason: '',
  overrides: {},           // 'projectId:q' -> value
  settingsDraft: null,     // setting key -> text typed in the Einstellungen dialog, not yet saved
  /*
   * The session. Access itself is eIAM's business — this only models what the
   * application does on either side of it, which is the part a reader of the
   * prototype cannot otherwise see.
   */
  signedIn: true,
  /*
   * What the account carries. Neither is in the URL: a shared link should open
   * in the reader's own language with the reader's own notifications.
   */
  account: {
    mail: { milestones: true, changes: true, digest: false },
    lang: 'de'
  },
  // transient ui
  menu: null,              // id of the open dropdown
  menuSearch: '',          // filter inside the open dropdown
  modal: null,             // { type: 'project'|'rebook', ... }
  footDetails: false,
  zoom: 'fit',             // print preview, see VOCAB.zoom
  page: 1,                 // change log, 1-based
  pageSize: '25',          // see VOCAB.pageSize
  pSort: 'peak',           // person table: name | organisation | employment | share | projects | peak | q0…q7
  pDir: 'desc',
  searchOpen: false,
  collapsedGroups: {},
  cardSort: {},            // dashboard card id -> { by: 'label'|'value', dir: 'asc'|'desc' }
  toast: null,
  /*
   * The Mietverträge tab. Its own grouping, sort and filters, because none of
   * the project ones mean anything there; the search, the time window and the
   * unit are shared. An allocation is edited per role and quarter, so its
   * overrides are keyed «allocationId:role:q».
   */
  tgroup: 'team',
  role: 'all',
  teams: [],               // selected team ids
  cantons: [],             // selected canton ids, e.g. 'BE'
  offices: [],             // selected federal office ids
  tSort: 'canton',         // any of T_SORT_IDS, or q0…q39 for one period
  tDir: 'asc',
  tOverrides: {},
  tEditing: null           // { allocationId, q, anchor, draft: { role: value }, reason }
};

/*
 * What each grid shows before anyone touches the Attribute menu. The two answer
 * different questions, so they start from different columns: the pensum grid
 * needs enough master data to judge a number, the bar plan needs only enough to
 * find the row again.
 */
/*
 * The phase column starts off. The band under the figures already says «31»,
 * and the column said «31 Vorprojekt» three pixels above it — the same fact
 * twice, for 152px of a frozen block that took two thirds of a small laptop.
 * It is one click away in the Ansicht menu.
 */
const COLUMN_DEFAULTS = {
  overview: { title: true, phase: false, lead: true, credit: true, portfolio: false, organisation: false },
  schedule: { title: true, phase: false, lead: false, credit: false, portfolio: false, organisation: false }
};

export const state = {
  ...DEFAULT_STATE,
  layers: { ...DEFAULT_STATE.layers },
  cols: { overview: { ...COLUMN_DEFAULTS.overview }, schedule: { ...COLUMN_DEFAULTS.schedule } }
};

/* -----------------------------------------------------------------------------
   Views — three named sets of layers, and the fourth that is none of them
   -------------------------------------------------------------------------- */

export const LAYER_KEYS = ['values', 'phases', 'gates', 'today'];

/*
 * Of the sixteen combinations the switches allow, these are the three anyone
 * asked for: the heat map, the bar plan with its today line, and both on one
 * row. «Heute» belongs to the bar plan, which is why only Termine turns it on.
 */
export const VIEW_PRESETS = {
  pensum:  { values: true,  phases: false, gates: false, today: false },
  'pensum-termine': { values: true, phases: true, gates: true, today: false },
  termine: { values: false, phases: true,  gates: true,  today: true }
};

/** The name of the set these layers are, or «custom» when they are none. */
export function viewOf(layers = state.layers) {
  const hit = Object.keys(VIEW_PRESETS).find(id =>
    LAYER_KEYS.every(k => !!layers[k] === VIEW_PRESETS[id][k]));
  return hit ?? 'custom';
}

/** The state patch that selects a view. «custom» changes nothing but the name. */
export function viewPatch(view) {
  const preset = VIEW_PRESETS[view];
  return preset ? { view, layers: { ...preset } } : { view: 'custom' };
}

/**
 * The state patch that flips one layer. The view stays «Benutzerdefiniert»: the
 * switches are only reachable there, and a combination that happened to equal
 * a named view used to snap the tick to that view and take the switches away
 * with it — mid-adjustment, the control the reader was using vanished.
 */
export function layerPatch(key) {
  return { layers: { ...state.layers, [key]: !state.layers[key] }, view: 'custom' };
}

/** Are the figures coloured? Never while there are no figures to colour. */
export const coloured = () => state.layers.values && state.colour === 'pensum';

/**
 * Which set of switches the view in front of the reader is driven by.
 *
 * The export tab has no grid of its own — it prints one of the two reports,
 * and the bar plan on paper has columns of its own. Anything else reads the
 * planning grid's set, which is also what the spreadsheet export takes its
 * columns from.
 */
export function columnSet() {
  return state.cols[columnSetKey()];
}

/** The name of the set columnSet() returns, for the action that writes to it. */
export function columnSetKey() {
  return state.tab === 'export' && !state.layers.values ? 'schedule' : 'overview';
}

const listeners = new Set();

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Merge a patch into state and re-render.
 * Pass { silent: true } as second argument to skip the URL write
 * (used by the popstate handler so we don't fight the browser).
 */
/*
 * Every change of state, counted. Derived lists are memoised against it, so
 * a list is computed once per change however many views ask for it in one
 * render — filteredProjects() was filtered and sorted five times per render.
 * Anything that changes what a derived list would say without going through
 * setState — the search field written per keystroke, a project's lead moved
 * by the picker — calls touch().
 */
let version = 0;
export function touch() { version++; }

export function memo(fn) {
  let at = -1;
  let value;
  return () => {
    if (at !== version) { value = fn(); at = version; }
    return value;
  };
}

export function setState(patch, opts = {}) {
  const tab = state.tab;
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  version++;
  if (!opts.silent) writeUrl({ push: state.tab !== tab });
  listeners.forEach(fn => fn(state));
}

/* Every transient layer closed at once — spread into any patch that opens a
   new one, so a dialog cannot open over a live popover. */
export const OVERLAYS_CLOSED = { menu: null, modal: null, editing: null, picking: null, tEditing: null };

/** Close every transient overlay. Used by Escape and by outside-clicks. */
export function closeOverlays() {
  if (Object.keys(OVERLAYS_CLOSED).every(k => state[k] === null)) return false;
  setState({ ...OVERLAYS_CLOSED });
  return true;
}

/* -----------------------------------------------------------------------------
   URL <-> state.  Everything lives in the hash so the prototype works as a
   static GitHub Page: shareable, bookmarkable, and the back button behaves.
   -------------------------------------------------------------------------- */


/*
 * A sort key is a column name or a span of quarters — q3 for one, q4-7 for a
 * period that averages several. Own keys only: `in` walked the prototype, so
 * #?sort=toString passed and the first render threw.
 */
const isSortKey = v => typeof v === 'string'
  && (Object.hasOwn(SORT_KEYS, v) || /^q\d+(?:-\d+)?$/.test(v));

/* The filter lists, validated against the data. An id the data does not know
   filtered the grid to nothing while the chip row said «keine». */
const KNOWN = {
  phase: () => new Set(data.phases.eppm.map(e => e.id)),
  lead: () => new Set([...data.people.map(x => x.id), 'none']),
  portfolio: () => new Set(Object.keys(data.portfoliosById)),
  org: () => new Set(Object.keys(data.organisationsById)),
  team: () => new Set(data.tenancy.meta.teams.map(x => x.id)),
  canton: () => new Set(data.tenancy.meta.cantons.map(x => x.id)),
  office: () => new Set(data.tenancy.meta.offices.map(x => x.id)),
  cols: () => new Set(Object.keys(COLUMN_DEFAULTS.overview)),
  barcols: () => new Set(Object.keys(COLUMN_DEFAULTS.schedule))
};

/*
 * The column sets in the hash: the flags that are on, as a list, and only
 * when the set is not the default. `cols` is the pensum grid, `barcols` the
 * bar plan on paper. A hash that names a set names all of it — a column it
 * leaves out is off.
 */
const COLUMN_PARAMS = { overview: 'cols', schedule: 'barcols' };

function readColumns(p, list) {
  return Object.fromEntries(Object.entries(COLUMN_PARAMS).map(([set, key]) => {
    if (!p.has(key)) return [set, { ...COLUMN_DEFAULTS[set] }];
    const on = new Set(list(key));
    return [set, Object.fromEntries(Object.keys(COLUMN_DEFAULTS[set]).map(c => [c, on.has(c)]))];
  }));
}

const columnsDiffer = (set) =>
  Object.keys(COLUMN_DEFAULTS[set]).some(c => !!state.cols[set][c] !== COLUMN_DEFAULTS[set][c]);

/*
 * The person table's sort, and the order of each dashboard card. `csort`
 * lists only the cards that left their default, as «card:by:dir».
 */
const isPersonSort = v => /^q\d+$/.test(v) || Object.hasOwn(P_SORTS, v);

function readCardSort(p) {
  const out = {};
  for (const entry of (p.get('csort') || '').split(',')) {
    const [id, by, dir] = entry.split(':');
    if (!/^[a-z-]+$/.test(id ?? '')) continue;
    const sort = {};
    if (by === 'label' || by === 'value') sort.by = by;
    if (dir === 'asc' || dir === 'desc') sort.dir = dir;
    if (Object.keys(sort).length) out[id] = sort;
  }
  return out;
}

const cardSortParam = () => Object.entries(state.cardSort)
  .map(([id, { by = 'label', dir = 'asc' }]) => (by === 'label' && dir === 'asc' ? null : `${id}:${by}:${dir}`))
  .filter(Boolean)
  .join(',');

/**
 * The state the hash describes: every URL-carried key, with its default where
 * the hash is silent. A key that was simply absent used to be left alone, so
 * a hash without `phase=` — Back after a filter, a hand-edited address — kept
 * the old filter while the address bar said otherwise.
 *
 * The language is not read: a shared link opens in the reader's own.
 */
export function readUrl() {
  const raw = location.hash.replace(/^#\/?\??/, '');
  const p = new URLSearchParams(raw);
  const list = k => (p.get(k) || '').split(',').filter(id => KNOWN[k]().has(id));
  const patch = {};

  // An unknown value falls back to the default, which is always renderable.
  for (const [key, allowed] of Object.entries(VOCAB)) {
    if (key === 'lang') continue;
    const v = p.get(key === 'sortDir' ? 'dir' : key);
    patch[key] = allowed.includes(v) ? v : DEFAULT_STATE[key];
  }
  /* The old bar plan's address still opens the bar plan, and the old name of
     the combined view still opens the combined view. */
  if (p.get('tab') === 'schedule') { patch.tab = 'overview'; if (!p.has('view')) patch.view = 'termine'; }
  if (p.get('view') === 'both') patch.view = 'pensum-termine';
  /* «Personen» was a section of the dashboard before it was a tab. */
  if (p.get('tab') === 'dashboard' && p.get('bi') === 'people') patch.tab = 'people';
  /*
   * A named view brings its layers; «custom» reads them off the hash, and a
   * layer the hash does not name is off. Layers without a view resolve to
   * whatever set they are; a link that says «custom» stays custom even where
   * its layers happen to equal a named view.
   */
  if (patch.view === 'custom' || p.has('layers')) {
    const on = new Set((p.get('layers') || '').split(','));
    patch.layers = Object.fromEntries(LAYER_KEYS.map(k => [k, on.has(k)]));
    if (patch.view !== 'custom') patch.view = viewOf(patch.layers);
  } else {
    patch.layers = { ...VIEW_PRESETS[patch.view] };
  }
  patch.sort = isSortKey(p.get('sort')) ? p.get('sort') : DEFAULT_STATE.sort;
  /* Clamped where it is read: an offset past the end left «Zurück» enabled
     with a first click that only found the edge. */
  const last = Math.max(0, allPeriods(patch.scale).length - windowColumns(patch.scale));
  patch.periodOffset = Math.min(last, Math.max(0, Math.trunc(Number(p.get('from')) || 0)));
  patch.page = Math.max(1, Math.trunc(Number(p.get('page')) || 1));
  patch.search = p.get('q') ?? '';
  patch.searchOpen = patch.search !== '';   // a link with a query opens the field
  patch.cols = readColumns(p, list);
  patch.hideZeros = p.get('zeros') === 'hide';
  patch.pSort = isPersonSort(p.get('psort') ?? '') ? p.get('psort') : DEFAULT_STATE.pSort;
  patch.pDir = p.get('pdir') === 'asc' ? 'asc' : DEFAULT_STATE.pDir;
  patch.cardSort = readCardSort(p);
  patch.phases = list('phase');
  patch.leads = list('lead');
  patch.portfolios = list('portfolio');
  patch.organisations = list('org');
  patch.teams = list('team');
  patch.cantons = list('canton');
  patch.offices = list('office');
  const tsort = p.get('tsort') ?? '';
  patch.tSort = T_SORT_IDS.includes(tsort) || /^q\d+$/.test(tsort) ? tsort : DEFAULT_STATE.tSort;
  patch.tDir = p.get('tdir') === 'desc' ? 'desc' : DEFAULT_STATE.tDir;
  return patch;
}

/**
 * The hash for the current state. A change of tab is a navigation step and
 * earns a history entry; anything else — a filter, a sort, a step of the
 * window — replaces the current one, so Back walks tabs rather than every
 * keystroke. The push used to happen in a listener after the replace, which
 * overwrote the previous tab's address and left Back on an identical hash.
 */
export function writeUrl({ push = false } = {}) {
  const p = new URLSearchParams();
  p.set('tab', state.tab);
  if (state.tab === 'export') p.set('sheet', state.sheet);
  if (state.tab === 'export' && state.paper !== 'a4') p.set('paper', state.paper);
  if (state.tab === 'export' && state.zoom !== 'fit') p.set('zoom', state.zoom);
  if (state.unit !== 'pct') p.set('unit', state.unit);
  if (state.view !== 'pensum') p.set('view', state.view);
  if (state.view === 'custom') p.set('layers', LAYER_KEYS.filter(k => state.layers[k]).join(','));
  if (state.colour !== 'pensum') p.set('colour', state.colour);
  for (const [set, key] of Object.entries(COLUMN_PARAMS)) {
    if (columnsDiffer(set)) p.set(key, Object.keys(state.cols[set]).filter(c => state.cols[set][c]).join(','));
  }
  if (state.hideZeros) p.set('zeros', 'hide');
  if (state.scale !== 'quarter') p.set('scale', state.scale);
  if (state.periodOffset) p.set('from', String(state.periodOffset));
  if (state.sort !== 'project') p.set('sort', state.sort);
  if (state.sortDir !== 'asc') p.set('dir', state.sortDir);
  if (state.group !== DEFAULT_STATE.group) p.set('group', state.group);
  if (state.tab === 'people' && state.pSort !== DEFAULT_STATE.pSort) p.set('psort', state.pSort);
  if (state.tab === 'people' && state.pDir !== DEFAULT_STATE.pDir) p.set('pdir', state.pDir);
  if (state.tab === 'dashboard' && cardSortParam()) p.set('csort', cardSortParam());
  if (state.tab === 'history' && state.page > 1) p.set('page', String(state.page));
  if (state.tab === 'history' && state.pageSize !== '25') p.set('pageSize', state.pageSize);
  if (state.search) p.set('q', state.search);
  if (state.phases.length) p.set('phase', state.phases.join(','));
  if (state.leads.length) p.set('lead', state.leads.join(','));
  if (state.portfolios.length) p.set('portfolio', state.portfolios.join(','));
  if (state.organisations.length) p.set('org', state.organisations.join(','));
  if (state.tgroup !== DEFAULT_STATE.tgroup) p.set('tgroup', state.tgroup);
  if (state.role !== DEFAULT_STATE.role) p.set('role', state.role);
  if (state.teams.length) p.set('team', state.teams.join(','));
  if (state.cantons.length) p.set('canton', state.cantons.join(','));
  if (state.offices.length) p.set('office', state.offices.join(','));
  if (state.tab === 'tenancy' && state.tSort !== DEFAULT_STATE.tSort) p.set('tsort', state.tSort);
  if (state.tab === 'tenancy' && state.tDir !== DEFAULT_STATE.tDir) p.set('tdir', state.tDir);
  const next = '#?' + p.toString();
  if (next === location.hash) return;
  if (push) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

/** Apply the URL to state without writing it back. */
export function syncFromUrl() {
  setState(readUrl(), { silent: true });
}

/* -----------------------------------------------------------------------------
   Loading
   -------------------------------------------------------------------------- */

export async function load() {
  const loaded = await Promise.all(
    DATA_FILES.map(async name => {
      const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`data/${name}.json — HTTP ${res.status}`);
      return [name, await res.json()];
    })
  );
  loaded.forEach(([name, json]) => { data[name] = json; });

  data.tenancy = Object.fromEntries(await Promise.all(
    TENANCY_FILES.map(async name => {
      const res = await fetch(`data/tenancy/${name}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`data/tenancy/${name}.json — HTTP ${res.status}`);
      return [name, await res.json()];
    })
  ));
  indexTenancy(data.tenancy);

  // Index lookups used all over the views.
  data.peopleById = Object.fromEntries(data.people.map(p => [p.id, p]));
  /*
   * A project's organisation is its assignee's: people belong to a unit, and
   * a project follows the person who carries it. The join is a getter so that
   * every reader of `p.organisation` — column, filter, grouping, the cards,
   * the export — sees the same answer, and a re-assignment moves the project
   * without anyone writing the field. Unassigned means no organisation.
   */
  for (const p of data.projects) {
    Object.defineProperty(p, 'organisation', {
      enumerable: true,
      get() { return data.peopleById[this.leadId]?.organisation ?? null; }
    });
  }
  data.projectsById = Object.fromEntries(data.projects.map(p => [p.id, p]));
  data.portfoliosById = Object.fromEntries(data.meta.portfolios.map(p => [p.id, p]));
  data.organisationsById = Object.fromEntries(data.meta.organisations.map(o => [o.id, o]));
  data.quarters = data.meta.quarters;
  data.quarterIndex = Object.fromEntries(data.quarters.map((q, i) => [q.id, i]));

  // Grouped once here rather than scanned per row in four different views.
  data.milestonesByProject = groupBy(data.milestones.items, m => m.projectId);
  data.milestoneCatalog = Object.fromEntries(data.milestones.catalog.map(c => [c.code, c]));
  return data;
}

/* The columns the Mietverträge grid sorts by; how each sorts is in tenancy.js. */
export const T_SORT_IDS = ['canton', 'office', 'team', 'contracts', 'rent', 'due'];

/*
 * The tenancy lookups. An allocation is one canton and one office, and its
 * contracts are the ones with that pair — joined here once, since neither
 * moves after load.
 */
function indexTenancy(tn) {
  tn.teamsById = Object.fromEntries(tn.meta.teams.map(x => [x.id, x]));
  tn.cantonsById = Object.fromEntries(tn.meta.cantons.map(x => [x.id, x]));
  tn.officesById = Object.fromEntries(tn.meta.offices.map(x => [x.id, x]));
  tn.rolesById = Object.fromEntries(tn.meta.roles.map(x => [x.id, x]));
  tn.peopleById = Object.fromEntries(tn.people.map(x => [x.id, x]));
  tn.allocationsById = Object.fromEntries(tn.allocations.map(x => [x.id, x]));
  tn.allocationsByTeam = groupBy(tn.allocations, a => a.teamId);
  tn.contractsByAllocation = groupBy(tn.contracts, c => `${c.canton.toLowerCase()}-${c.officeId}`);
}

/*
 * The projects a person leads. Derived per change of state rather than
 * indexed once at load: the picker and the rebooking move a lead, and an
 * index built at boot went on attributing that project's edits to the person
 * who used to have it.
 */
const leadIndex = memo(() => groupBy(data.projects, p => p.leadId ?? 'none'));
export const projectsOf = personId => leadIndex()[personId] ?? [];

/** The quarter that is «now» — the horizon happens to start there, but no view should count on it. */
export const nowIndex = () => data.quarterIndex[data.meta.todayQuarter] ?? 0;

/** Bucket a list by a key, preserving the order within each bucket. */
function groupBy(list, keyOf) {
  const out = {};
  for (const item of list) (out[keyOf(item)] ??= []).push(item);
  return out;
}

/* -----------------------------------------------------------------------------
   i18n — the mockup translates by looking up the German string.
   -------------------------------------------------------------------------- */

/*
 * The German string is the key and its own source; the file stores one entry
 * per term with every target beside it, so a translator never holds four files
 * open at once. An untranslated term falls back to the German rather than to a
 * blank or a key.
 */
export function t(de) {
  if (state.lang === 'de' || !data.i18n) return de;
  return data.i18n.terms?.[de]?.[state.lang] ?? de;
}

/* -----------------------------------------------------------------------------
   Number formatting.  Swiss convention: a space before the percent sign,
   comma as the decimal separator.
   -------------------------------------------------------------------------- */

/*
 * Swiss number grouping: an apostrophe every three digits, U+2019.
 *
 * This is cantonal practice, chosen deliberately and not the federal rule. The
 * Bundeskanzlei Schreibweisungen say the opposite — Rn 512 groups with a fixed
 * space and calls the apostrophe obsolete, and Rn 513 leaves four-digit numbers
 * ungrouped unless the same table carries five-digit ones. Revisit if this ever
 * has to satisfy a federal style review.
 *
 * U+2019 rather than a fixed space for a second reason: WinAnsi carries it at
 * 0x92, so it survives the PDF writer. U+202F and U+2009 do not — they would be
 * written as '?' on paper.
 */
const GROUP = '’';
const grouped = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);

export function num(v) {
  return state.unit === 'fte'
    ? grouped((v / 100).toFixed(2)).replace('.', ',')
    : grouped(String(Math.round(v)));
}

export function unitSuffix() {
  return state.unit === 'fte' ? ' FTE' : ' %';
}

export function fmt(v) {
  return num(v) + unitSuffix();
}

/** An ISO date the Swiss way round: 27.09.2026. */
export function deDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** A credit in Mio. CHF. One decimal for a headline; two under the credit column, as its cells print. */
export function fmtMio(v, digits = 1) {
  return v == null ? '—' : v.toFixed(digits).replace('.', ',') + ' Mio.';
}

/* -----------------------------------------------------------------------------
   Derived: pensum values with pending edits applied
   -------------------------------------------------------------------------- */

export function cellValue(project, q) {
  const o = state.overrides[`${project.id}:${q}`];
  return o === undefined ? project.demand[q] : o;
}

export function projectDemand(project) {
  return project.demand.map((_, q) => cellValue(project, q));
}

export function isEdited(project, q) {
  return state.overrides[`${project.id}:${q}`] !== undefined;
}

/*
 * How loaded a person is, in three steps, and the unit changes exactly once.
 *
 * A pensum point is a point of one project's demand. person.baseLoad is the sum
 * of those over the projects they lead, so loadDelta must be in the same unit —
 * it converted to utilisation points first, and personUtilisation then divided
 * by the contract a second time. For the nine part-time leads every edited
 * figure came out wrong: an 80 % lead taking on 20 more points read 138 %
 * instead of 131 %, which armed the over-capacity gate on a cell that was not
 * over capacity.
 */

/** A person's unsaved edits, summed. In pensum points, like baseLoad. */
export function loadDelta(personId, q) {
  if (!data.peopleById[personId]) return 0;
  let delta = 0;
  for (const p of projectsOf(personId)) {
    const o = state.overrides[`${p.id}:${q}`];
    if (o !== undefined) delta += o - p.demand[q];
  }
  return delta;
}

/** A person's booked pensum in a quarter, including unsaved edits. Pensum points. */
export function personLoad(personId, q) {
  const person = data.peopleById[personId];
  if (!person) return null;
  return Math.round(person.baseLoad[q] + loadDelta(personId, q));
}

/**
 * The share of a person's contract that may go to projects, in per cent. The
 * rest is line and administrative work, and how much that is differs by unit
 * — a project-management team keeps 20 % back, a portfolio manager may spend
 * no more than 20 % on projects at all. So the figure sits on the
 * organisation, and a person carries one only where theirs differs.
 */
export function projectShare(person) {
  return person.projectShare ?? data.organisationsById[person.organisation]?.projectShare ?? 100;
}

/** What a person can carry in projects: the contract times that share. Pensum points. */
export const projectCapacity = person => person.employment * projectShare(person) / 100;

/**
 * The same load against what the person can carry in projects — not against
 * the whole contract, which nobody has free for projects. The one place the
 * unit changes. `delta` is an edit not yet applied — the editor asks what the
 * person would be at — so that conversion happens here too and nowhere else.
 */
export function personUtilisation(personId, q, delta = 0) {
  const person = data.peopleById[personId];
  if (!person) return null;
  return Math.round((personLoad(personId, q) + delta) / projectCapacity(person) * 100);
}

/* -----------------------------------------------------------------------------
   Global settings — the few rules of the plan that hold for everyone
   -------------------------------------------------------------------------- */

/*
 * A setting is addressed by a key: «share:<organisation>» for a unit's project
 * share, «small» for the line between a small project and a large one. The
 * Einstellungen dialog keeps what is typed in state.settingsDraft, as text,
 * until it is saved: a rule that re-rates every person at once is not applied
 * per keystroke, and a half-typed «8» is not a value yet.
 */
export const settingKeys = () => [...data.meta.organisations.map(o => `share:${o.id}`), 'small'];

/** The saved value of a setting. */
export function settingValue(key) {
  if (key === 'small') return data.meta.settings.smallProjectMio;
  return data.organisationsById[key.slice('share:'.length)]?.projectShare ?? 100;
}

/** What its field shows: the text typed and not yet saved, or the saved value. */
export const settingText = key =>
  state.settingsDraft?.[key] ?? String(settingValue(key)).replace('.', ',');

/**
 * The typed text as a value, or null where it is not one the setting can take:
 * a share is a whole per cent from 1 to 100 — at 0 nobody in the unit could
 * carry a project and every load would divide by nothing — and the line is an
 * amount above zero.
 */
export function settingTyped(key) {
  const raw = settingText(key).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (key === 'small') return n > 0 ? n : null;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

/** The settings whose typed value differs from the saved one — or null while any field is not a value. */
export function settingChanges() {
  const out = [];
  for (const key of settingKeys()) {
    const to = settingTyped(key);
    if (to === null) return null;
    if (to !== settingValue(key)) out.push({ key, from: settingValue(key), to });
  }
  return out;
}

/* -----------------------------------------------------------------------------
   Derived: capacity roll-ups over the currently filtered project set
   -------------------------------------------------------------------------- */

export function netCapacity(q) {
  return data.capacity.gross[q] - data.capacity.absence[q];
}

/**
 * Demand is a property of the selection; capacity is a property of the
 * department. A ratio of one against the other only means something when both
 * describe the same people — so utilisation, free capacity and everything else
 * on the capacity side is always the whole portfolio. Filtering the view does
 * not change how busy the division is, and a filtered numerator over an
 * unfiltered denominator produced figures like «−2 %».
 */
export function totals(projects = filteredProjects()) {
  const qs = data.quarters.map((_, i) => i);
  const sum = (list, q) => list.reduce((a, p) => a + cellValue(p, q), 0);

  const demand = qs.map(q => sum(projects, q));
  const pending = projects.filter(p => p.preCredit);
  const preCredit = qs.map(q => sum(pending, q));

  const external = data.capacity.external;
  const net = qs.map(netCapacity);
  const portfolio = qs.map(q => sum(data.projects, q));
  const booked = qs.map(q => portfolio[q] - external[q]);
  const utilisation = qs.map(q => Math.round(booked[q] / net[q] * 100));
  const free = qs.map(q => net[q] - booked[q]);

  return {
    demand, preCredit, external, net, booked, utilisation, free, portfolio,
    // True when the demand row describes fewer projects than the capacity row.
    scoped: projects.length !== data.projects.length
  };
}

/**
 * Capacity status, identical wording in every tab.
 * The four words frei / ok / knapp / Überlast are part of the design system.
 */
export function loadStatus(pct) {
  if (pct > 100) return { key: 'danger', label: 'Überlast' };
  if (pct >= 95) return { key: 'warn', label: 'knapp' };
  if (pct >= 80) return { key: 'ok', label: 'ok' };
  return { key: 'neutral', label: 'frei' };
}

/*
 * The column charts name the same four bands differently. Derived rather than
 * spelled out: a second list of thresholds had already drifted — it called 82 %
 * «frei» while the table beside it, and the printed legend, called it «ok».
 */
const CHART_TONE = { danger: 'overload', warn: 'tight', ok: 'ok', neutral: 'free' };
export const chartTone = pct => CHART_TONE[loadStatus(pct).key];

/** Heat step for a pensum value — blue encodes size only, never status. */
export function heatStep(v) {
  if (v == null) return 'null';
  if (v < 0) return 'neg';
  if (v === 0) return '0';
  if (v < 40) return '1';
  if (v < 80) return '2';
  if (v < 120) return '3';
  return '4';
}

/**
 * Heat step for a person's utilisation. It runs to 245 % and beyond, where the
 * project ramp tops out at 120 — reused unchanged it put 64 % of the person
 * table into its two darkest steps and flattened 120 % and 245 % into one
 * blue. Same five tokens, own thresholds.
 */
export const personHeatStep = v => (v === 0 ? 0 : v <= 80 ? 1 : v <= 100 ? 2 : v <= 150 ? 3 : 4);

/**
 * What the person dialog's two fields say, as values: the contract in whole
 * per cent, and the person's own project share — `undefined` where the field
 * is empty, which means «as the unit has it». Null while either is not a
 * value yet.
 */
export function personDraft({ employment, share }) {
  const whole = (text, min) => (/^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= 100
    ? Number(text) : null);
  const contract = whole(employment, 10);
  const own = share.trim() === '' ? undefined : whole(share, 1);
  return contract === null || own === null ? null : { employment: contract, share: own };
}

/**
 * Traffic light for the row's project lead: their worst quarter in the period
 * the table is showing.
 *
 * The period matters: everything else in the tab — totals, chart, KPI — reports
 * on the visible window, so the light follows it too rather than reading
 * quarter 0 alone and disagreeing with the row it sits in.
 */
export function ampel(personId, range = windowQuarters()) {
  const person = data.peopleById[personId];
  if (!person) {
    return { key: 'none', word: 'ohne Bearbeitenden', title: 'Kein Bearbeitender zugewiesen — keine Ampel' };
  }
  let peak = range.from;
  for (let q = range.from + 1; q <= range.to; q++) {
    if (personUtilisation(personId, q) > personUtilisation(personId, peak)) peak = q;
  }
  const pct = personUtilisation(personId, peak);
  const key = pct > 100 ? 'over' : pct >= 95 ? 'tight' : 'ok';
  const word = key === 'over' ? 'Überlast' : key === 'tight' ? 'knapp' : 'im Rahmen';
  return { key, pct, peak, word, title: `${person.name}: ${pct} % der Projektkapazität in ${data.quarters[peak].label} — ${word}` };
}

/**
 * A SIA sub-phase by its code. An unknown code returns a stand-in rather than
 * undefined, so one bad record cannot take a whole view down.
 */
/*
 * A phase as ePPM names it — the value on the project, on every bar and on
 * every gate, and the one the filter, the grouping and the column speak. BBL's
 * list mixes SIA main phases with sub-phases and opens with «Vorstudien» of
 * its own, so it is a list of values in phases.json, in ePPM's order, rather
 * than anything derivable from SIA codes. An unknown id returns a stand-in
 * rather than undefined, so one bad record cannot take a whole view down.
 */
export function eppmOf(id) {
  return data.phases.eppm.find(e => e.id === id) ?? { id: String(id ?? '—'), label: String(id ?? '—') };
}

/** The same lookup under the name the bar plan has always used. */
export const phaseOf = eppmOf;

/** Where an ePPM phase stands in the list, for sorting — as a fixed-width string. */
const eppmRank = id => String(Math.max(0, data.phases.eppm.findIndex(e => e.id === id))).padStart(2, '0');

/* -----------------------------------------------------------------------------
   Derived: filtering, sorting, grouping
   -------------------------------------------------------------------------- */

/*
 * The search as one matcher, shared by the filter and by the marks the cells
 * draw. Two would drift — each folding case its own way — and a row would
 * match with nothing marked. It returns facts about a string, never markup;
 * ui.js turns the ranges into marks. The query is a plain substring, so its
 * regex characters are escaped, and the field's own trimming applies: a query
 * of spaces is no query.
 */
export const searchMatcher = memo(() => {
  const q = state.search.trim();
  if (!q) return null;
  const src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const one = new RegExp(src, 'i');
  const all = new RegExp(src, 'gi');
  return {
    test: text => one.test(String(text)),
    /** Every hit in a string, as [from, to) offsets in order. */
    ranges: text => [...String(text).matchAll(all)].map(m => [m.index, m.index + m[0].length])
  };
});

/** The projects in scope, filtered and sorted — once per change of state. */
export const filteredProjects = memo(() => {
  const match = searchMatcher();
  const list = data.projects.filter(p => {
    if (state.phases.length && !state.phases.includes(p.phase)) return false;
    if (state.leads.length) {
      const key = p.leadId ?? 'none';
      if (!state.leads.includes(key)) return false;
    }
    if (state.portfolios.length && !state.portfolios.includes(p.portfolio)) return false;
    if (state.organisations.length && !state.organisations.includes(p.organisation)) return false;
    if (match) {
      /* The words the cells show, translated: in English «unassigned» has to
         find the rows without a lead, and the mark has to land on what matched. */
      const lead = data.peopleById[p.leadId]?.name ?? t('nicht zugewiesen');
      const hay = `${p.title} ${p.number} ${lead} ${p.kind}`;
      if (!match.test(hay)) return false;
    }
    return true;
  });

  return sortProjects(list);
});

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/**
 * The columns the grid actually shows.
 *
 * A pensum is a *rate*, not a total: 80 % in Q3 means 80 % of that person's
 * time throughout Q3. So a month inside a quarter carries the same number, and
 * a year is the average of its quarters — never their sum.
 *
 * Every column also carries `from` and `to`: the slice of the quarter axis it
 * covers, as a fractional quarter index. At month scale three columns share one
 * quarter and each covers a third of it, which `quarters` alone cannot say —
 * and without it the today marker cannot be placed.
 */
export const periods = memo(() => markYears(buildPeriods()));

/**
 * A year starts wherever a column's year differs from the one before it. Both
 * grids draw their separator from this, so they cannot disagree — and it stays
 * right at every scale and wherever the window has been stepped to.
 */
function markYears(cols) {
  let previous = null;
  return cols.map(col => {
    const year = data.quarters[col.quarters[0]].year;
    const yearStart = previous === null || year !== previous;
    previous = year;
    return { ...col, year, yearStart };
  });
}

/*
 * How many time columns a grid builds, per scale — the same in either tab, so
 * the frozen block does not move when the reader switches between them.
 *
 * Not the whole horizon: at ten years that is eleven columns, forty or a
 * hundred and twenty in one grid, and nothing but the browser deciding what a
 * column is worth. Each scale instead builds a few more than fit, at a width
 * chosen for that scale — about four years, twelve quarters or eighteen months
 * on a small laptop — and the rest is reached the two ways every other overflow
 * in these grids is: the arrows step the window, and the grid pans.
 *
 * The whole plan at one glance is what the A0 report is for.
 */
const WINDOW_COLUMNS = { year: 12, quarter: 16, month: 24 };
export const windowColumns = (scale = state.scale) => WINDOW_COLUMNS[scale] ?? 12;

/**
 * Every column of the horizon at a scale, before the window is cut. The
 * horizon does not change after load, so each scale is built once: it used
 * to be rebuilt on every periods(), maxOffset() and windowEdges() call — at
 * least four times a render, and once more per group card.
 */
const horizon = new Map();
function allPeriods(scale = state.scale) {
  if (!horizon.has(scale)) horizon.set(scale, buildHorizon(scale));
  return horizon.get(scale);
}

function buildHorizon(scale) {
  const qs = data.quarters;

  if (scale === 'year') {
    const years = [...new Set(qs.map(q => q.year))];
    return years.map(year => {
      const idx = qs.map((q, i) => (q.year === year ? i : -1)).filter(i => i >= 0);
      return {
        id: String(year), label: String(year), short: String(year),
        quarters: idx, isNow: idx.includes(0),
        from: idx[0], to: idx[idx.length - 1] + 1
      };
    });
  }

  if (scale === 'month') {
    const out = [];
    const thisMonth = new Date(data.meta.today + 'T00:00:00').getMonth();
    for (let n = 0; n < qs.length * 3; n++) {
      const qi = Math.floor(n / 3);
      const q = qs[qi];
      const month = (Number(q.short.slice(1)) - 1) * 3 + (n % 3);
      const slice = n % 3;
      out.push({
        id: `${q.year}-${month + 1}`,
        label: `${MONTHS_DE[month]} ${q.year}`,
        short: `${MONTHS_DE[month]} ${String(q.year).slice(2)}`,
        quarters: [qi],
        isNow: qi === 0 && month === thisMonth,
        from: qi + slice / 3, to: qi + (slice + 1) / 3
      });
    }
    return out;
  }

  return qs.map((q, n) => ({
    id: q.id, label: q.label,
    short: `${q.short} ${String(q.year).slice(2)}`,
    quarters: [n], isNow: n === 0,
    from: n, to: n + 1
  }));
}

/** How far the window may be stepped before it runs off the end. */
export const maxOffset = (cols = allPeriods()) => Math.max(0, cols.length - windowColumns());

/** The arrows move most of a window, keeping a little of it for orientation. */
export const windowStep = () => Math.max(1, Math.round(windowColumns() * 0.75));

/*
 * Changing the scale keeps the reader where they were. Twelve columns mean one
 * year of months or twelve years of years, so the offset cannot simply carry
 * over; what carries over is the quarter the window opens on.
 */
export function offsetForScale(next) {
  const at = windowQuarters().from;
  const all = allPeriods(next);
  const found = all.findIndex(c => c.quarters.includes(at));
  return Math.max(0, Math.min(found < 0 ? 0 : found, Math.max(0, all.length - windowColumns(next))));
}

function buildPeriods(off = state.periodOffset) {
  const all = allPeriods();
  const start = Math.max(0, Math.min(off, maxOffset(all)));
  return all.slice(start, start + windowColumns());
}

/** A rate over several quarters is their average, rounded. */
export function periodValue(values, period) {
  const picked = period.quarters.map(i => values[i]).filter(v => v != null);
  if (!picked.length) return 0;
  return Math.round(picked.reduce((a, b) => a + b, 0) / picked.length);
}

/**
 * Is there time outside the visible window, and on which side? The arrows move
 * the window and the card scrolls inside it; both hide periods, and the reader
 * is owed the same signal either way.
 *
 * Returned as an attribute fragment so a card can carry it without the view
 * having to spell the two flags out.
 */
/*
 * Every column of the horizon at the current scale. A report prints the whole
 * plan and tiles it across sheets, so it starts where the plan starts rather
 * than where the reader has stepped the screen to.
 */
export const printPeriods = () => markYears(allPeriods());

export function windowQuarters(cols = periods()) {
  return { from: cols[0]?.quarters[0] ?? 0, to: cols.at(-1)?.quarters.at(-1) ?? 0 };
}

export function windowEdges(cols = periods()) {
  const { from, to } = windowQuarters(cols);
  return { before: from > 0, after: to < data.quarters.length - 1 };
}

/** Whether the window can still be stepped that way, in columns of this scale. */
export function canStep(dir) {
  return dir < 0 ? state.periodOffset > 0 : state.periodOffset < maxOffset();
}

/**
 * One sort key per column, so the header and the dropdown drive the same state.
 * A quarter is addressed as q0…q7.
 */
export const SORT_KEYS = {
  id:        { label: 'ID', numeric: false, value: p => p.number },
  project:   { label: 'Projekt', numeric: false, value: p => p.title },
  phase:     { label: 'Phase (ePPM)', numeric: false, value: p => eppmRank(p.phase) },
  lead:      { label: 'Bearbeitender', numeric: false, value: p => data.peopleById[p.leadId]?.name ?? '\uffff' },
  portfolio: { label: 'Teilportfolio', numeric: false, value: p => data.portfoliosById[p.portfolio]?.label ?? '' },
  organisation: { label: 'Organisation', numeric: false, value: p => data.organisationsById[p.organisation]?.label ?? '' },
  credit:    { label: 'Kredit CHF', numeric: true, value: p => p.credit ?? -1 }
};

/**
 * Resolve a sort key, including the per-period ones. A period column sorts by
 * the figure it shows — the average of its quarters — not by its first
 * quarter alone, which is what a year column used to do.
 */
export function sortKey(key = state.sort) {
  const q = /^q(\d+)(?:-(\d+))?$/.exec(key);
  if (q) {
    const from = Number(q[1]);
    const to = q[2] === undefined ? from : Number(q[2]);
    const span = { quarters: Array.from({ length: to - from + 1 }, (_, i) => from + i) };
    return {
      label: data.quarters[from]?.label ?? key, numeric: true,
      value: p => periodValue(projectDemand(p), span)
    };
  }
  return Object.hasOwn(SORT_KEYS, key) ? SORT_KEYS[key] : SORT_KEYS.project;
}

/** Numbers read high-to-low by default, names A–Z. */
export const defaultDir = key => (sortKey(key).numeric ? 'desc' : 'asc');

/** One collator for the whole app: localeCompare builds a fresh one per call. */
const collator = new Intl.Collator('de');
export const compareDe = (a, b) => collator.compare(String(a), String(b));

export function sortProjects(list) {
  const { numeric, value } = sortKey();
  const sign = state.sortDir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const cmp = numeric ? x - y : collator.compare(String(x), String(y));
    return cmp * sign;
  });
}

/*
 * Where a small project ends and a large one begins: its credit, in Mio. CHF.
 * Two buckets and no ladder between them — the question the office asks is how
 * many of its projects are small. A project whose credit is still open is
 * neither yet; counted as small it would inflate the one number the grouping
 * is there to give, so it says «Kredit offen» instead.
 *
 * The line is a setting, meta.settings.smallProjectMio.
 */
const sizeOf = p =>
  (p.credit == null ? 'open' : p.credit <= data.meta.settings.smallProjectMio ? 'small' : 'large');

/** Group the filtered projects for the grid and the gantt. */
export function groupProjects(list = filteredProjects()) {
  if (state.group === 'none') return [{ key: 'all', label: null, projects: list }];

  const keyOf = p => {
    if (state.group === 'lead') return p.leadId ?? 'none';
    if (state.group === 'phase') return p.phase;
    if (state.group === 'organisation') return p.organisation ?? 'none';
    if (state.group === 'size') return sizeOf(p);
    return p.portfolio;
  };
  const labelOf = key => {
    if (state.group === 'size') {
      if (key === 'open') return `(${t('Kredit offen')})`;
      const small = key === 'small';
      const line = String(data.meta.settings.smallProjectMio).replace('.', ',');
      return `${t(small ? 'Kleinprojekte' : 'Grossprojekte')} ${t(small ? 'bis' : 'über')} ${line} ${t('Mio. CHF')}`;
    }
    if (state.group === 'lead') {
      return key === 'none' ? `(${t('nicht zugewiesen')})` : (data.peopleById[key]?.name ?? key);
    }
    if (state.group === 'phase') {
      return t(eppmOf(key).label);
    }
    if (state.group === 'organisation') {
      return key === 'none' ? `(${t('nicht zugewiesen')})` : t(data.organisationsById[key]?.label ?? key);
    }
    return t(data.portfoliosById[key]?.label ?? key);
  };

  const buckets = new Map();
  for (const p of list) {
    const k = keyOf(p);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  // Keep people in roster order, phases in ePPM order, teams and portfolios in
  // data order — never in the order the projects happened to arrive in.
  const order = state.group === 'lead'
    ? [...data.people.map(p => p.id), 'none']
    : state.group === 'phase'
      ? data.phases.eppm.map(e => e.id)
      : state.group === 'organisation'
        ? [...data.meta.organisations.map(o => o.id), 'none']
        : state.group === 'size'
          ? ['small', 'large', 'open']
          : data.meta.portfolios.map(p => p.id);

  return order
    .filter(k => buckets.has(k))
    .map(k => ({ key: k, label: labelOf(k), projects: buckets.get(k) }));
}

/** Active filter chips, in the order the toolbar declares them. */
export function activeFilters() {
  const chips = [];
  state.phases.forEach(id => {
    const e = data.phases.eppm.find(x => x.id === id);
    if (e) chips.push({ kind: 'phase', id, label: `Phase ${e.label}` });
  });
  state.leads.forEach(id => {
    const label = id === 'none' ? 'nicht zugewiesen' : data.peopleById[id]?.name;
    if (label) chips.push({ kind: 'lead', id, label });
  });
  state.portfolios.forEach(id => {
    const p = data.portfoliosById[id];
    if (p) chips.push({ kind: 'portfolio', id, label: p.label });
  });
  state.organisations.forEach(id => {
    const o = data.organisationsById[id];
    if (o) chips.push({ kind: 'organisation', id, label: o.label });
  });
  if (state.search) chips.push({ kind: 'search', id: '1', label: `Suche: ${state.search}` });
  return chips;
}

export function removeFilter(kind, id) {
  const drop = arr => arr.filter(x => x !== id);
  if (kind === 'phase') setState({ phases: drop(state.phases) });
  else if (kind === 'lead') setState({ leads: drop(state.leads) });
  else if (kind === 'portfolio') setState({ portfolios: drop(state.portfolios) });
  else if (kind === 'organisation') setState({ organisations: drop(state.organisations) });
  else if (kind === 'team') setState({ teams: drop(state.teams) });
  else if (kind === 'canton') setState({ cantons: drop(state.cantons) });
  else if (kind === 'office') setState({ offices: drop(state.offices) });
  else if (kind === 'search') setState({ search: '' });
}

export function resetFilters() {
  setState({
    phases: [], leads: [], portfolios: [], organisations: [], search: '',
    teams: [], cantons: [], offices: []
  });
}

export function toggleIn(key, id) {
  const arr = state[key];
  setState({ [key]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] });
}

/* -----------------------------------------------------------------------------
   Derived: milestones
   -------------------------------------------------------------------------- */

/**
 * What the bell shows: the state of play addressed to the person signed in.
 *
 * Derived on every render and never stored, so the badge is this list's length
 * and cannot disagree with the panel it opens. The hand-written summary it
 * replaces had drifted from the data — it announced a moved gate that this
 * lead does not have.
 *
 * The scope is deliberately personal. Across the division there are 59 late
 * gates and 35 people over 100 %; a bell carrying those is a number, not a
 * message. Three questions matter to one project lead: am I over my own
 * contract, has a gate on one of my projects moved, and did somebody change my
 * project while I was away.
 */
export function notifications() {
  const me = data.meta.user.personId;
  const mine = data.projects.filter(p => p.leadId === me);
  const mineIds = new Set(mine.map(p => p.id));
  const out = [];

  const load = data.quarters.map((_, q) => personUtilisation(me, q));
  const firstOver = load.findIndex(v => v > 100);
  if (firstOver >= 0) {
    out.push({
      key: 'load', mark: 'over',
      title: 'Ihre Auslastung',
      text: `${load[firstOver]} % ${t('der Projektkapazität')} · ${t('Überlast in')} `
        + `${load.filter(v => v > 100).length} ${t('Quartalen')}`,
      meta: data.quarters[firstOver].label,
      act: 'filter-lead', val: me
    });
  }

  for (const m of data.milestones.items) {
    if (!mineIds.has(m.projectId) || m.status === 'ok') continue;
    out.push({
      key: m.id, mark: 'tight',
      title: data.milestoneCatalog[m.code]?.name ?? m.code,
      text: `${data.projectsById[m.projectId].title} · ${m.statusLabel}`,
      meta: data.quarters[data.quarterIndex[m.forecast ?? m.plan]]?.label ?? '',
      act: 'open-milestone', val: m.id
    });
  }

  const since = isoDate(data.meta.lastVisit);
  for (const c of data.changes) {
    if (!mineIds.has(c.projectId) || c.actor === data.meta.user.name || c.date < since) continue;
    out.push({
      key: c.id, mark: 'none',
      title: c.projectLabel,
      text: `${c.actor} · ${t(c.field)}: ${t(c.change)}`,
      meta: c.dateLabel,
      act: 'open-project', val: c.projectId
    });
  }

  return out;
}

/** «21.08.2026» as «2026-08-21», so change dates compare as plain strings. */
const isoDate = (de) => String(de).split('.').reverse().join('-');

export function milestones() {
  const projectIds = new Set(filteredProjects().map(p => p.id));
  return data.milestones.items
    .filter(m => projectIds.has(m.projectId))
    .map(m => {
      const project = data.projectsById[m.projectId];
      const cat = data.milestoneCatalog[m.code];
      return {
        ...m,
        project,
        name: cat?.name ?? m.code,
        short: cat?.short ?? m.code,
        lead: project.leadId ? data.peopleById[project.leadId] : null,
        planIdx: data.quarterIndex[m.plan],
        forecastIdx: m.forecast ? data.quarterIndex[m.forecast] : null
      };
    })
    .sort((a, b) => a.planDate.localeCompare(b.planDate) || a.code.localeCompare(b.code));
}

/**
 * One page of a list, and what a footer needs to describe it.
 *
 * The page is clamped rather than reset: a filter that shortens the list would
 * otherwise leave the reader on an empty page with nothing to say why.
 */
/*
 * The change log under the filters and the search box. It lives here rather
 * than in the view because it is the same question the project list answers,
 * asked of another collection — and because the pager has to know how long it
 * is before the view is built.
 */
export function visibleChanges() {
  const ids = new Set(filteredProjects().map(p => p.id));
  const match = searchMatcher();
  return data.changes.filter(c => {
    if (c.projectId && !ids.has(c.projectId)) return false;
    if (!match) return true;
    /* The translated words, as the rows print them. */
    const hay = `${c.projectLabel} ${c.actor} ${t(c.field)} ${t(c.change)} ${t(c.value)}`;
    return match.test(hay);
  });
}

/** How many pages that log has, at the chosen page size. */
export const pageCount = () =>
  Math.max(1, Math.ceil(visibleChanges().length / Number(state.pageSize)));

export function pageOf(rows) {
  const size = Number(state.pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(1, state.page), pages);
  const from = (page - 1) * size;
  return { rows: rows.slice(from, from + size), page, pages, from, total: rows.length };
}

/* -----------------------------------------------------------------------------
   Derived: the KPI strip, shared by every tab
   -------------------------------------------------------------------------- */

/**
 * Everything the person table shows, in one place: the load a person carries in
 * each period against their own project capacity, plus the peak — which is the
 * answer a single quarter cannot give.
 */
export function personRows() {
  const cols = periods();
  return data.people.map(person => {
    /* Through the accessor, so an unsaved edit shows here too. Read straight
       from baseLoad, this table answered 170 % while the grid beside it said
       220 % for the same person in the same session. */
    const load = data.quarters.map((_, q) => personLoad(person.id, q));
    const values = cols.map(col =>
      Math.round(periodValue(load, col) / projectCapacity(person) * 100));
    const leads = projectsOf(person.id).length;
    return {
      person, values, load, leads,
      peak: leads ? Math.max(...values) : null,
      now: values[0]
    };
  });
}

/**
 * The person table cut the way the planning grid is, as far as the grouping
 * is about people: a person has an organisation, and nothing else the menu
 * offers. Any other choice leaves the table in one piece.
 */
export function groupPeople(rows) {
  if (state.group !== 'organisation') return [{ key: 'all', label: null, rows }];
  return data.meta.organisations
    .map(o => ({
      /* Its own key: a group folded on the Planung tab stays open here. */
      key: `people:${o.id}`,
      label: t(o.label),
      rows: rows.filter(r => r.person.organisation === o.id)
    }))
    .filter(g => g.rows.length);
}

/** Sorters for the person table, one per column the header offers. */
export const P_SORTS = {
  name: r => r.person.name,
  organisation: r => data.organisationsById[r.person.organisation]?.label ?? '',
  employment: r => r.person.employment,
  share: r => projectShare(r.person),
  projects: r => r.leads,
  peak: r => r.peak ?? -1
};

export function sortPersonRows(rows) {
  const q = /^q(\d+)$/.exec(state.pSort);
  const value = q ? (r => r.values[Number(q[1])] ?? -1)
    : (Object.hasOwn(P_SORTS, state.pSort) ? P_SORTS[state.pSort] : P_SORTS.peak);
  const dir = state.pDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    return (typeof x === 'string' ? collator.compare(x, y) : x - y) * dir;
  });
}

/**
 * The figures at the head of the dashboard: how many projects are in scope,
 * what they add up to in credits, and how much of the office they take as FTE
 * in the current quarter.
 * Neutral by design. The strip used to lead with the overload — utilisation,
 * people over 100 %, unassigned demand — and the project managers it was
 * meant for read it as a verdict on themselves rather than a measure of the
 * work. The overload is still on the dashboard, in the charts that show
 * where and when.
 */
export function kpis() {
  const list = filteredProjects();
  const tot = totals(list);
  const now = nowIndex();
  const fte = grouped((tot.demand[now] / 100).toFixed(2)).replace('.', ',');
  const credit = list.reduce((a, p) => a + (p.credit ?? 0), 0);
  const funded = list.filter(p => p.credit !== null).length;
  const ids = new Set(list.map(p => p.id));
  const assigned = new Set(list.map(p => p.leadId).filter(Boolean)).size;
  return [
    {
      label: 'Bauprojekte',
      value: String(list.length),
      note: list.length === data.projects.length
        ? t('Gesamtportfolio')
        : `${t('von')} ${data.projects.length} ${t('im Gesamtportfolio')}`
    },
    {
      /* «Kredite», not «gebundene Kredite»: the qualifier asked the reader to
         know what binds a credit, and the number is the same either way. */
      label: 'Kredite CHF',
      value: fmtMio(credit),
      note: `${t('Total')} · ${funded} ${t('Projekte mit Kredit')}`
    },
    {
      label: 'Pensum total',
      value: `${fte} FTE`,
      note: `${data.quarters[now].label} · ${assigned} ${t('Bearbeitende zugewiesen')}`
    },
    {
      /* What is due, not who is short: the gates the projects in scope reach
         this quarter. Neutral, and the one figure here that changes what the
         reader does next. */
      label: 'Meilensteine im Quartal',
      value: String(data.milestones.items.filter(m => ids.has(m.projectId) && m.plan === data.quarters[now].id).length),
      note: `${data.quarters[now].label} · ${t('Gates mit Plantermin')}`
    }
  ];
}

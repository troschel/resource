/* =============================================================================
   app.js — bootstrap, routing and event dispatch.

   Rendering is a full re-render of #app into innerHTML. It keeps the views
   pure functions of state, at a measured ~65 ms for the 111-row grid, most of
   which is the browser rebuilding some 6 300 nodes. That is why search is
   debounced rather than rendered per keystroke. What survives a render — focus,
   caret, and both scroll offsets — is listed in docs/ARCHITECTURE.md; that list
   is the contract, and it is longer than it looks.
   ============================================================================= */

import {
  data, state, load, subscribe, setState, syncFromUrl, closeOverlays, touch, OVERLAYS_CLOSED,
  cellValue, toggleIn, removeFilter, resetFilters, defaultDir, t, columnSetKey, writeUrl,
  offsetForScale, maxOffset, windowStep, pageCount, viewPatch, layerPatch, settingChanges,
  personDraft, projectShare
} from './store.js';
import { loadIcons } from './icons.js';
import { html, appHeader, appFooter, toast, forgetTokens, signedOutView } from './ui.js';
import { renderOverview, editPopover, assignPicker } from './views-overview.js';
import { renderModal } from './views-modals.js';
import { renderPeople, renderDashboard, renderHistory } from './views-analysis.js';
import { renderApi, renderExport, mountSwagger } from './views-docs.js';
import { renderTenancy, tenancyPopover } from './views-tenancy.js';
import { roleValue, tDefaultDir, ROLE_IDS, cantonLabel, officeOf } from './tenancy.js';
import { exportCsv, exportXlsx } from './export.js';

const root = document.getElementById('app');

/* -----------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */

const VIEWS = {
  overview: renderOverview,
  people: renderPeople,
  dashboard: renderDashboard,
  history: renderHistory,
  tenancy: renderTenancy,
  api: renderApi,
  export: renderExport
};

/*
 * Where the reader had scrolled the plan to, sideways.
 *
 * Vertical scroll was already carried across a render; horizontal was not, so
 * every sort, filter, toast or resize threw the reader back to the first
 * quarter — on a ten-year plan, most of the way back to the start of the
 * decade. One value covers every card, because alignScrollers keeps them all on
 * the same part of the axis by design.
 *
 * Tied to the axis it was taken from: change the scale or step the window and
 * the same pixel offset means a different date, so it is dropped instead. The
 * comparison is against the axis the DOM is currently showing, not against
 * state — setState has already written the new scale by the time render runs,
 * so reading it here would compare the new value with itself.
 */
const axisKey = () => `${state.scale}:${state.periodOffset}`;
let renderedAxis = null;

function captureScroll() {
  const plan = root.querySelector('[data-scroll]');
  const toolbar = root.querySelector('.toolbar');
  return {
    axis: renderedAxis,
    plan: plan ? plan.scrollLeft : 0,
    toolbar: toolbar ? toolbar.scrollLeft : 0
  };
}

function restoreScroll(saved) {
  if (saved.plan && saved.axis === axisKey()) {
    for (const el of root.querySelectorAll('[data-scroll]')) el.scrollLeft = saved.plan;
  }
  const toolbar = root.querySelector('.toolbar');
  if (toolbar && saved.toolbar) toolbar.scrollLeft = saved.toolbar;
}

/*
 * A popover is anchored to the cell it was opened on, in viewport space, and
 * the anchor was taken at the click. A render that moves the cell — a resize,
 * a column switched on, a filter — left the popover where the cell used to
 * be. So the anchor is read again off the cell that is about to be replaced.
 */
function refreshAnchors() {
  if (state.editing) {
    const { projectId, q } = state.editing;
    const cell = root.querySelector(`[data-fk="${CSS.escape(`cell:${projectId}:${q}`)}"]`);
    if (cell) {
      const r = cell.getBoundingClientRect();
      state.editing.anchor = { top: r.top, bottom: r.bottom, right: r.right };
    }
  }
  if (state.picking) {
    const btn = root.querySelector(`[data-act="assign"][data-val="${CSS.escape(state.picking.projectId)}"]`);
    const cell = btn?.closest('.pcell') ?? btn;
    if (cell) {
      const r = cell.getBoundingClientRect();
      state.picking.anchor = { left: r.left, top: r.top, bottom: r.bottom };
    }
  }
  if (state.tEditing) {
    const { allocationId, q } = state.tEditing;
    const cell = root.querySelector(`[data-fk="${CSS.escape(`tcell:${allocationId}:${q}`)}"]`);
    if (cell) {
      const r = cell.getBoundingClientRect();
      state.tEditing.anchor = { top: r.top, bottom: r.bottom, right: r.right };
    }
  }
}

function render() {
  const focus = captureFocus();
  const scroll = captureScroll();
  const scrollY = window.scrollY;
  refreshAnchors();

  const view = VIEWS[state.tab] ?? renderOverview;

  /*
   * Before the view runs, not after: the stylesheet widens the shell for the
   * two planning grids, and those grids measure that width while they build
   * their column template. Set afterwards, the first render of a tab laid
   * itself out against the previous tab's width.
   */
  document.documentElement.dataset.tab = state.tab;
  /* Before the markup, not after: the grids measure their own columns as they
     build, and a scale set afterwards was measured one render too late. */
  if (document.documentElement.dataset.scale !== state.scale) {
    document.documentElement.dataset.scale = state.scale;
    forgetTokens();
  }

  /*
   * Signed out, the application draws nothing of its own: no tabs, no toolbar,
   * no figures. The header keeps only the wordmark, so the page still says
   * whose it is.
   */
  root.innerHTML = String(html`
    ${appHeader()}
    <main id="main">${state.signedIn ? view() : signedOutView()}</main>
    ${appFooter()}
    ${state.editing ? editPopover() : ''}
    ${state.picking ? assignPicker() : ''}
    ${state.tEditing ? tenancyPopover() : ''}
    ${renderModal()}
    ${toast()}
  `);

  document.documentElement.lang = state.lang;
  if (state.tab === 'api') mountSwagger();
  /* Before the fades are read: they are computed from scrollLeft. */
  restoreScroll(scroll);
  root.querySelectorAll('[data-scroll]').forEach(syncScrollFades);
  positionMenu();
  syncPageSize();
  syncZoom();
  restoreFocus(focus);
  syncModalFocus();
  if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo({ top: scrollY });
  renderedAxis = axisKey();
  lastRenderAt = performance.now();
}

/*
 * The page box the browser prints onto, kept the same size as the sheet.
 *
 * `@page` is a document-level rule, so it cannot be a class on the sheet — but
 * the millimetres belong in the stylesheet with the rest of the paper, so they
 * are read back off a rendered sheet rather than written down a second time.
 *
 * Without this the print stylesheet let an A4 sheet reflow to whatever width
 * the print container had (measured: 1440 x 962px), and the row budget worked
 * out for 210 x 297mm no longer described the page it landed on.
 */
const pageStyle = document.head.appendChild(document.createElement('style'));

function syncPageSize() {
  const sheet = root.querySelector('.sheet');
  if (!sheet) { pageStyle.textContent = ''; return; }
  const cs = getComputedStyle(sheet);
  const short = cs.getPropertyValue('--paper-short').trim();
  const long = cs.getPropertyValue('--paper-long').trim();
  if (!short || !long) return;
  const size = sheet.classList.contains('sheet--landscape') ? `${long} ${short}` : `${short} ${long}`;
  pageStyle.textContent = `@page { size: ${size}; margin: 0; }`;
}

/*
 * The preview scale. `zoom` rather than a transform, because the mount has to
 * know how much room the sheet takes: a transform leaves the layout box at the
 * unscaled size, so a magnified A0 would have nothing to scroll.
 *
 * «Anpassen» is measured, not declared — it is the pane's width over the
 * sheet's own, so it has to be read after the sheet is in the document.
 */
function syncZoom() {
  const mount = root.querySelector('.mount');
  if (!mount) return;
  const sheet = mount.querySelector('.sheet');
  if (!sheet) return;

  if (state.zoom !== 'fit') {
    mount.style.setProperty('--sheet-zoom', Number(state.zoom) / 100);
    return;
  }
  mount.style.setProperty('--sheet-zoom', 1);
  const paper = sheet.getBoundingClientRect().width;
  const room = mount.clientWidth;
  // Never magnify to fill: a sheet smaller than the pane stays its own size.
  mount.style.setProperty('--sheet-zoom', paper > room ? room / paper : 1);
}

/** Programmatic scroll restoration must not read as a user scroll. */
let lastRenderAt = 0;

/*
 * Place the open menu against its trigger, in window coordinates.
 *
 * The panel is `position: fixed`, so this is the only thing that positions it —
 * which is the point. Anchored by CSS to its own `.dd`, it inherited whatever
 * clipping that box lived inside, and on a phone that is a 34px sideways
 * scroller. Window coordinates have no such ancestor.
 */
const MENU_EDGE = 12;     // how close a panel may come to the window edge
const MENU_GAP = 6;       // clear of the trigger; mirrors --space-3

function positionMenu() {
  const panel = root.querySelector('.dd__panel');
  if (!panel) return;
  const trigger = panel.closest('.dd')?.querySelector('button');
  if (!trigger) return;

  panel.style.removeProperty('--dd-max-h');
  panel.classList.remove('dd__panel--up');
  panel.style.left = '0px';
  panel.style.top = '0px';

  const at = trigger.getBoundingClientRect();

  /*
   * Above or below. A landscape phone has no room under a trigger that sits
   * two thirds down the window, so the panel flips rather than being squeezed
   * into 40 pixels.
   */
  const below = window.innerHeight - at.bottom - MENU_GAP - MENU_EDGE;
  const above = at.top - MENU_GAP - MENU_EDGE;
  const up = below < 200 && above > below;
  panel.classList.toggle('dd__panel--up', up);
  panel.style.setProperty('--dd-max-h', `${Math.max(160, up ? above : below)}px`);

  /* Measured after the height cap, or a long list reports its unclamped size. */
  const box = panel.getBoundingClientRect();

  /*
   * Lined up with the edge the panel asks for, then clamped into the window.
   * A right-anchored panel used to be nudged with margin-left, which is only
   * half a lever — the margin enters the same equation `right` does, so a 376px
   * correction moved the box 188px and the Attribute menu still hung 176px off
   * the left edge of a phone.
   */
  const width = Math.min(box.width, window.innerWidth - 2 * MENU_EDGE);
  const wanted = panel.classList.contains('dd__panel--right') ? at.right - width : at.left;
  const left = Math.min(Math.max(wanted, MENU_EDGE), window.innerWidth - MENU_EDGE - width);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(up ? at.top - MENU_GAP - box.height : at.bottom + MENU_GAP)}px`;
}

/*
 * A full re-render replaces every node, so focus has to be found again by
 * identity rather than by reference. Only nine controls carry an explicit
 * data-fk; for the rest the dispatch attributes already form a unique name, so
 * the two are looked up the same way. Without this, nine of ten activations
 * dropped focus to <body> and the next Tab restarted at the skip link.
 */
const focusKey = (el) => {
  if (!el || !el.dataset) return null;
  if (el.dataset.fk) return { by: 'fk', key: el.dataset.fk };
  if (!el.dataset.act) return null;
  return { by: 'act', key: [el.dataset.act, el.dataset.val ?? '', el.dataset.q ?? ''].join('\u0001') };
};

const focusSelector = (found) => {
  if (found.by === 'fk') return `[data-fk="${CSS.escape(found.key)}"]`;
  const [act, val, q] = found.key.split('\u0001');
  return `[data-act="${CSS.escape(act)}"]`
    + (val ? `[data-val="${CSS.escape(val)}"]` : '')
    + (q ? `[data-q="${CSS.escape(q)}"]` : '');
};

function captureFocus() {
  const found = focusKey(document.activeElement);
  if (!found) return null;
  return {
    ...found,
    start: document.activeElement.selectionStart ?? null,
    end: document.activeElement.selectionEnd ?? null
  };
}

function restoreFocus(focus) {
  if (!focus) return;
  const el = root.querySelector(focusSelector(focus));
  if (!el) return;
  el.focus({ preventScroll: true });
  if (focus.start != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(focus.start, focus.end); } catch { /* number inputs refuse */ }
  }
}

/*
 * A dialog takes focus when it opens, keeps it while it is open and hands it
 * back to whatever opened it. aria-modal says all three are true, so they have
 * to be.
 */
let modalReturn = null;

function trapFocusables(scope) {
  return [...scope.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled),'
    + ' textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null);
}

let overlayWasOpen = false;

function syncModalFocus() {
  const overlay = root.querySelector('.modal') ?? root.querySelector('.pop');

  if (!overlay) {
    // Only on the render where it actually closed, so this never fights
    // restoreFocus during ordinary clicks.
    if (overlayWasOpen && modalReturn) {
      root.querySelector(focusSelector(modalReturn))?.focus({ preventScroll: true });
    }
    modalReturn = null;
    overlayWasOpen = false;
    return;
  }

  overlayWasOpen = true;
  if (overlay.contains(document.activeElement)) return;
  (trapFocusables(overlay)[0] ?? overlay.querySelector('.modal__close'))?.focus({ preventScroll: true });
}

/** Move the caret into the field the moment it expands. */
function focusSearch() {
  requestAnimationFrame(() => {
    const el = root.querySelector('[data-fk="search"]');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
}

/** Every app-owned change lands in the log, with both sides of it. */
function logChange(project, field, change, value) {
  data.changes.unshift({
    id: `c-${project.id}-${data.changes.length}`,
    date: data.meta.today, dateLabel: data.meta.todayLabel,
    actor: data.meta.user.name, projectId: project.id, projectLabel: project.location,
    field, change, value
  });
}

/*
 * A changed rule is logged too, with no project: the entry then stays in the
 * log under every filter, which is right for a change that moved figures on
 * projects nobody touched.
 */
function logSetting(field, change, value, area = t('Einstellungen')) {
  data.changes.unshift({
    id: `c-setting-${data.changes.length}`,
    date: data.meta.today, dateLabel: data.meta.todayLabel,
    actor: data.meta.user.name, projectId: null, projectLabel: area,
    field, change, value
  });
}

/*
 * A toast, and optionally the state change it reports, in one render. Both
 * timers are tracked: the exit timer used to be anonymous, so a toast arriving
 * during the previous one's fade was wiped by that fade's `toast: null`.
 */
let toastTimer;
function flash(message, patch = {}) {
  clearTimeout(toastTimer);
  setState({ ...patch, toast: message });
  // It arrives over 160ms; it should leave the same way rather than blink out.
  toastTimer = setTimeout(() => {
    const el = root.querySelector('.toast');
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return setState({ toast: null });
    }
    el.classList.add('is-leaving');
    toastTimer = setTimeout(() => {
      if (state.toast === message) setState({ toast: null });
    }, 160);
  }, 2600);
}

/* -----------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

const actions = {
  noop: () => flash(t('Im Prototyp nicht hinterlegt.')),

  tab: (val) => setState({ tab: val, ...OVERLAYS_CLOSED }),
  // The brand is a way back to a clean slate, not just to another route.
  home: () => setState({
    tab: 'overview', ...OVERLAYS_CLOSED,
    phases: [], leads: [], portfolios: [], organisations: [], search: '',
    teams: [], cantons: [], offices: [], searchOpen: false
  }),
  lang: (val) => setState({ lang: val, menu: null }),

  menu: (val, el) => {
    const opening = state.menu !== val;
    /*
     * Ask before rendering: setState() replaces the DOM synchronously, so by the
     * time the old code tested :focus-visible the element was detached and the
     * answer was always false — which is why arrow keys never reached the panel.
     */
    const byKeyboard = el.matches(':focus-visible');
    setState({ menu: opening ? val : null, menuSearch: '', picking: null });
    if (!opening) return;
    if (byKeyboard) {
      requestAnimationFrame(() => {
        const m = root.querySelector('.dd__panel');
        (m?.querySelector('[data-act="menu-search"]') ?? m?.querySelector(MENU_ITEMS))?.focus();
      });
    }
  },

  'search-toggle': () => {
    setState({ searchOpen: true, menu: null });
    focusSearch();
  },
  'search-close': () => setState({ searchOpen: false, search: '' }),

  sort: (val) => setState({ sort: val, sortDir: defaultDir(val), menu: null }),
  'sort-dir': (val) => setState({ sortDir: val, menu: null }),
  // A header click picks the column; clicking the active one flips direction.
  'sort-col': (val) => setState(s => (
    s.sort === val
      ? { sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' }
      : { sort: val, sortDir: defaultDir(val) }
  )),
  group: (val) => setState({ group: val, menu: null }),
  /* «card:by:value», «card:dir:desc» — one half of a card's sort at a time.
     The menu stays open: the other half is usually the next click. */
  'card-sort': (val) => {
    const [id, part, choice] = val.split(':');
    setState(s => ({ cardSort: { ...s.cardSort, [id]: { ...s.cardSort[id], [part]: choice } } }));
  },
  unit: (val) => setState({ unit: val }),
  scale: (val) => setState({ scale: val, periodOffset: offsetForScale(val) }),
  /* Stepped from where the window actually is — an offset that ran past the
     end would otherwise spend the first click getting back to it. */
  period: (val) => setState(s => ({
    periodOffset: val === 'today'
      ? 0
      : Math.max(0, Math.min(maxOffset(), Math.min(s.periodOffset, maxOffset()) + Number(val) * windowStep()))
  })),

  'my-projects': () => {
    const me = data.meta.user.personId;
    const mine = state.leads.length === 1 && state.leads[0] === me;
    setState({ leads: mine ? [] : [me] });
  },

  'toggle-phase': (val) => toggleIn('phases', val),
  'toggle-lead': (val) => toggleIn('leads', val),
  'toggle-portfolio': (val) => toggleIn('portfolios', val),
  'toggle-organisation': (val) => toggleIn('organisations', val),

  /* -- Mietverträge ------------------------------------------------------- */

  tgroup: (val) => setState({ tgroup: val, menu: null }),
  role: (val) => setState({ role: val }),
  'toggle-team': (val) => toggleIn('teams', val),
  'toggle-canton': (val) => toggleIn('cantons', val),
  'toggle-office': (val) => toggleIn('offices', val),
  'filter-tteam': (val) => setState({ tab: 'tenancy', ...OVERLAYS_CLOSED, teams: [val] }),
  'sort-tenancy': (val) => setState(s => (s.tSort === val
    ? { tDir: s.tDir === 'asc' ? 'desc' : 'asc' }
    : { tSort: val, tDir: tDefaultDir(val) })),
  'open-contracts': (val) => setState({ ...OVERLAYS_CLOSED, modal: { type: 'contracts', allocationId: val } }),
  'open-tperson': (val) => setState({ ...OVERLAYS_CLOSED, modal: { type: 'tperson', personId: val } }),

  /* A cell opens the editor for its quarter, with all three roles in it: the
     team splits the work between them, so they are set side by side. */
  tcell: (val, el) => {
    const q = Number(el.dataset.q);
    const a = data.tenancy.allocationsById[val];
    const r = el.getBoundingClientRect();
    setState({
      ...OVERLAYS_CLOSED,
      tEditing: {
        allocationId: val, q, anchor: { top: r.top, bottom: r.bottom, right: r.right }, reason: '',
        draft: Object.fromEntries(ROLE_IDS.map(role => [role, roleValue(a, role, q)]))
      }
    });
  },
  tdraft: (val) => {
    const [role, step] = val.split(':');
    setState(s => ({ tEditing: { ...s.tEditing,
      draft: { ...s.tEditing.draft, [role]: Math.max(0, Math.min(100, s.tEditing.draft[role] + Number(step))) } } }));
  },
  tcancel: () => setState({ tEditing: null }),
  tapply: () => {
    const { allocationId, q, draft, reason } = state.tEditing;
    const a = data.tenancy.allocationsById[allocationId];
    const overrides = { ...state.tOverrides };
    const changed = [];
    for (const role of ROLE_IDS) {
      const before = roleValue(a, role, q);
      const k = `${a.id}:${role}:${q}`;
      if (draft[role] === a.demand[role][q]) delete overrides[k];
      else overrides[k] = draft[role];
      if (draft[role] !== before) changed.push(`${t(data.tenancy.rolesById[role].short)} ${before} % → ${draft[role]} %`);
    }
    if (!changed.length) return setState({ tEditing: null });
    const label = `${officeOf(a.officeId).short} ${cantonLabel(a.canton)}`;
    logSetting('Pensum', `${data.quarters[q].label}: ${changed.join(', ')}${reason.trim() ? ` · ${reason.trim()}` : ''}`,
      changed.join(', '), `${t('Mietverträge')} · ${label}`);
    setState({ tOverrides: overrides });
    flash(`${t('Pensum übernommen')} — ${label}, ${data.quarters[q].label}`, { tEditing: null });
  },

  /*
   * «Alle» needs the full id list for the menu it sits in. A lookup rather than
   * a chain ending in a default: the chain quietly handed the portfolio ids to
   * whatever kind it did not recognise.
   */
  bulk: (val, el) => {
    const kind = el.dataset.kind;
    const every = {
      phases: () => data.phases.eppm.map(e => e.id),
      leads: () => [...data.people.map(p => p.id), 'none'],
      portfolios: () => data.meta.portfolios.map(p => p.id),
      organisations: () => data.meta.organisations.map(o => o.id),
      teams: () => data.tenancy.meta.teams.map(x => x.id),
      cantons: () => data.tenancy.meta.cantons.map(x => x.id),
      offices: () => data.tenancy.meta.offices.map(x => x.id)
    }[kind];
    if (!every) return;
    setState({ [kind]: val === 'all' ? every() : [] });
  },

  /* Writes into the set the visible grid is driven by, never the other one. */
  'toggle-col': (val) => setState(s => {
    const key = columnSetKey();
    return { cols: { ...s.cols, [key]: { ...s.cols[key], [val]: !s.cols[key][val] } } };
  }),
  'toggle-flag': (val) => setState(s => ({ [val]: !s[val] })),

  /* A view is a named set of layers; a layer switch renames the view to match. */
  view: (val) => setState(viewPatch(val)),
  'toggle-layer': (val) => setState(layerPatch(val)),
  colour: () => setState(s => ({ colour: s.colour === 'pensum' ? 'none' : 'pensum' })),

  'filter-remove': (val, el) => removeFilter(el.dataset.kind, val),
  'filters-reset': () => resetFilters(),
  /* Also the way out of the person dialog, so it closes whatever is open. */
  'filter-lead': (val) => setState({ tab: 'overview', ...OVERLAYS_CLOSED, leads: [val] }),

  'foot-details': () => setState(s => ({ footDetails: !s.footDetails })),
  'toggle-group': (val) => setState(s => ({
    collapsedGroups: { ...s.collapsedGroups, [val]: !s.collapsedGroups[val] }
  })),

  /*
   * A cell opens its editor on the first click. There is no edit mode to arm
   * first: the reader who wants the project record reaches it through the
   * title, and asking for two clicks before any number could move was the
   * single thing the prototype was most often faulted for.
   */
  cell: (val, el) => {
    const q = Number(el.dataset.q);
    const project = data.projectsById[val];
    const r = el.getBoundingClientRect();
    setState({
      editing: { projectId: val, q, anchor: { top: r.top, bottom: r.bottom, right: r.right } },
      draft: cellValue(project, q),
      reason: '',
      menu: null,
      picking: null
    });
  },

  draft: (val) => setState(s => ({ draft: Math.max(0, Math.min(200, s.draft + Number(val))) })),
  'cancel-edit': () => setState({ editing: null, reason: '' }),

  apply: () => {
    const { projectId, q } = state.editing;
    const key = `${projectId}:${q}`;
    const project = data.projectsById[projectId];
    /* Read before setState clears them. */
    const value = state.draft;
    const reason = state.reason.trim();
    const before = cellValue(project, q);

    const overrides = { ...state.overrides };
    if (value === project.demand[q]) delete overrides[key];
    else overrides[key] = value;

    /*
     * Logged, like every other edit. The popover demands a justification and
     * the banner above the grid promises that changes are recorded — and then
     * this threw the reason away and wrote nothing. Same shape as a rebooking:
     * one entry carrying both sides and the reason.
     */
    logChange(project, 'Pensum',
      `${data.quarters[q].label}: ${before} % → ${value} %${reason ? ` · ${reason}` : ''}`,
      `${value} %`);

    setState({ overrides, editing: null, reason: '' });
    flash(`${t('Pensum übernommen')} — ${project.location}, ${data.quarters[q].label}: ${value} %`);
  },

  rebook: () => {
    const { projectId, q } = state.editing;
    setState({
      modal: {
        type: 'rebook', projectId, q,
        amount: cellValue(data.projectsById[projectId], q),
        targetId: null, quarters: 2, search: '', reason: ''
      },
      editing: null
    });
  },
  'rebook-target': (val) => setState(s => ({ modal: { ...s.modal, targetId: val } })),
  'rebook-apply': () => {
    const { projectId, q, amount, targetId, quarters, reason } = state.modal;
    const project = data.projectsById[projectId];
    const target = data.peopleById[targetId];
    const from = project.leadId ? data.peopleById[project.leadId] : null;

    // The prototype moves the lead of this project; a real implementation would
    // split the allocation into two person-level rows — see docs/GAP-ANALYSIS.md.
    project.leadId = targetId;

    // One entry carrying both sides, as the wireframe asks.
    data.changes.unshift({
      id: `c-${projectId}-${q}-${data.changes.length}`,
      date: data.meta.today, dateLabel: data.meta.todayLabel,
      actor: data.meta.user.name, projectId, projectLabel: project.location,
      field: 'Bearbeitender',
      change: `${t('Umgebucht')}: ${from ? from.name : t('nicht zugewiesen')} → ${target.name} · ${reason.trim()}`,
      value: `${amount} % ${t('ab')} ${data.quarters[q].label}, ${quarters} ${t('Quartale')}`
    });

    touch();
    flash(`${amount} % ${t('umgebucht auf')} ${target.name} — ${project.location}, ${t('ab')} ${data.quarters[q].label}`,
      { modal: null });
  },

  /*
   * The picker opens on the cell, like the editor, and is anchored in viewport
   * space for the same reason: no scroll container can clip it.
   */
  assign: (val, el) => {
    const r = (el.closest('.pcell') ?? el).getBoundingClientRect();
    setState({
      picking: { projectId: val, anchor: { left: r.left, top: r.top, bottom: r.bottom }, search: '' },
      editing: null, menu: null
    });
  },
  /* The pick is the commit. An empty value clears the assignment. One render:
     the data is changed first and the toast carries the closing patch. */
  pick: (val) => {
    const project = data.projectsById[state.picking.projectId];
    const from = project.leadId ? data.peopleById[project.leadId] : null;
    const to = val ? data.peopleById[val] : null;
    if ((to ? to.id : null) === (from ? from.id : null)) return setState({ picking: null });
    project.leadId = to ? to.id : null;
    project.unassigned = !to;
    touch();
    if (to) {
      logChange(project, 'Bearbeitender',
        from ? `${from.name} → ${to.name}` : `${t('Zugewiesen an')} ${to.name}`, to.name);
      flash(`${project.location} — ${t('Bearbeitender')}: ${to.name}`, { picking: null });
    } else {
      logChange(project, 'Bearbeitender',
        from ? `${from.name} → ${t('nicht zugewiesen')}` : t('Zuweisung aufgehoben'), t('nicht zugewiesen'));
      flash(`${project.location} — ${t('Zuweisung aufgehoben')}`, { picking: null });
    }
  },

  'open-phase': (val) => {
    const [projectId, from] = val.split(':');
    setState({ ...OVERLAYS_CLOSED, modal: { type: 'phase', projectId, from: Number(from) } });
  },

  'open-milestone': (val) => setState({ ...OVERLAYS_CLOSED, modal: { type: 'milestone', milestoneId: val } }),

  'open-project': (val) => setState({ ...OVERLAYS_CLOSED, modal: { type: 'project', projectId: val } }),

  /* The dialog opens with the person's two figures in its fields, as text —
     an empty share means «as the unit has it». */
  'open-person': (val) => {
    const person = data.peopleById[val];
    if (!person) return;
    setState({
      ...OVERLAYS_CLOSED,
      modal: {
        type: 'person', personId: val,
        employment: String(person.employment),
        share: person.projectShare == null ? '' : String(person.projectShare)
      }
    });
  },
  'person-save': () => {
    const person = data.peopleById[state.modal.personId];
    const draft = personDraft(state.modal);
    if (!person || !draft) return;
    if (draft.employment !== person.employment) {
      /* Gross capacity is the sum of the contracts, so it moves with this one —
         or the office's utilisation would go on counting the old contract. */
      const delta = draft.employment - person.employment;
      data.capacity.gross = data.capacity.gross.map(v => v + delta);
      logSetting('Anstellung', person.name, `${person.employment} % → ${draft.employment} %`, t('Personen'));
      person.employment = draft.employment;
    }
    if (draft.share !== person.projectShare) {
      const before = projectShare(person);
      if (draft.share === undefined) delete person.projectShare;
      else person.projectShare = draft.share;
      logSetting('Projektanteil', person.name, `${before} % → ${projectShare(person)} %`, t('Personen'));
    }
    touch();
    flash(`${person.name} — ${t('Angaben gespeichert')}`, { modal: null });
  },
  /* The bar plan is a view of the Planung tab now, not a tab of its own. */
  'open-schedule': (val) => setState({
    tab: 'overview', ...OVERLAYS_CLOSED, search: data.projectsById[val].location, ...viewPatch('termine')
  }),

  share: () => setState({ ...OVERLAYS_CLOSED, modal: { type: 'share', copied: false } }),
  'share-select': (val, el) => el.select(),
  /* «Kopiert» only when it was: a denied clipboard leaves the link selected
     for the reader to copy by hand, and says nothing it cannot vouch for. */
  'share-copy': async () => {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      root.querySelector('[data-fk="share-url"]')?.select();
      return;
    }
    setState(s => ({ modal: { ...s.modal, copied: true } }));
    setTimeout(() => { if (state.modal?.type === 'share') setState(s => ({ modal: { ...s.modal, copied: false } })); }, 2000);
  },

  'close-modal': () => setState({ modal: null }),

  /* The account dialog — the reader's own mail and language. */
  settings: () => setState({ ...OVERLAYS_CLOSED, modal: { type: 'settings' } }),

  /*
   * The office's settings, behind the gear. The dialog opens on what is saved:
   * a draft left by closing it is dropped, so closing is the way to cancel.
   */
  rules: () => setState({ ...OVERLAYS_CLOSED, modal: { type: 'rules' }, settingsDraft: null }),

  /*
   * It saves all its fields at once. The data is changed first and the toast
   * carries the patch that closes the dialog, so it is one render — and every
   * figure that render draws is already the new one.
   */
  'settings-save': () => {
    const changes = settingChanges();
    if (!changes || !changes.length) return;
    const mio = v => `${String(v).replace('.', ',')} Mio.`;
    for (const { key, from, to } of changes) {
      if (key === 'small') {
        data.meta.settings.smallProjectMio = to;
        logSetting('Projektgrösse', `${t('Kleinprojekte')} ${t('bis')}`, `${mio(from)} → ${mio(to)}`);
      } else {
        const org = data.organisationsById[key.slice('share:'.length)];
        org.projectShare = to;
        logSetting('Projektanteil', org.label, `${from} % → ${to} %`);
      }
    }
    touch();
    flash(t('Einstellungen gespeichert'), { settingsDraft: null, modal: null });
  },

  /* Derived from state, not read back off the checkbox — the same way
     «Mir zugewiesen» does it, and independent of event ordering. */
  'mail-pref': (val) => setState(s => ({
    account: { ...s.account, mail: { ...s.account.mail, [val]: !s.account.mail[val] } }
  })),

  /* The account language is the language: a preference nobody can see applied
     is a preference nobody believes was saved. */
  'account-lang': (val) => setState(s => ({ account: { ...s.account, lang: val }, lang: val })),

  /*
   * Signing out. Unsaved pensum edits live only in memory, so they go with the
   * session rather than waiting behind a login for somebody else — and the
   * signed-out screen says that they did.
   */
  signout: () => setState({ signedIn: false, ...OVERLAYS_CLOSED, reason: '', overrides: {}, tOverrides: {}, settingsDraft: null }),

  signin: () => setState({ signedIn: true }),
  /* The print layout prints what is on screen: the bar plan when the reader is
     looking at the bar plan, the figures otherwise — it reads the same view. */
  'print-layout': () => setState({ tab: 'export', ...OVERLAYS_CLOSED }),
  export: (val) => {
    setState({ menu: null });
    try {
      const name = val === 'csv' ? exportCsv() : exportXlsx();
      flash(`${name} — ${t('heruntergeladen')}`);
    } catch (error) {
      console.error(error);
      flash(t('Export fehlgeschlagen.'));
    }
  },
  /* Clicking the sorted column flips it; a new column starts on its own default. */
  'sort-person': (val) => setState(s => (s.pSort === val
    ? { pDir: s.pDir === 'asc' ? 'desc' : 'asc' }
    : { pSort: val, pDir: val === 'name' || val === 'organisation' ? 'asc' : 'desc' })),

  sheet: (val) => setState({ sheet: val }),
  paper: (val) => setState({ paper: val, menu: null }),
  zoom: (val) => setState({ zoom: val, menu: null }),

  /*
   * Clamped where it is written. pageOf() clamps on read, so the display was
   * always right while state.page ran on past the end: nine clicks on a
   * four-page log left it at 10, and the next six «Vorherige Seite» clicks did
   * nothing at all because they were counting back down through pages that do
   * not exist.
   */
  page: (val) => setState(s => {
    /* Step from where the reader actually is. pageOf() clamps for display but
       leaves state.page where it ran to, so stepping back from a stale 10 over
       a four-page log spent the first click getting back to 4 — the page the
       screen had been showing all along. */
    const pages = pageCount();
    const at = Math.min(Math.max(1, s.page), pages);
    return { page: Math.max(1, Math.min(pages, at + Number(val))) };
  }),
  'page-size': (val) => setState({ pageSize: val, page: 1, menu: null }),

  /*
   * The file, not the dialog. A printer driver imposes its own paper and its
   * own unprintable margin, so an A3 sheet arrives scaled onto A4 and A0 is not
   * on offer at all. The writer is loaded on demand, like the API widget.
   */
  'export-pdf': async (val) => {
    if (state.exporting) return;
    /*
     * The lock lives in state, not on the button: set as el.disabled it sat on
     * a node the next render replaces, so it protected nothing.
     */
    setState({ exporting: true });
    try {
      const { sheetsToPdf } = await import('./pdf.js');
      /*
       * Collected after the await. A render during the dynamic import — a
       * resize, a toast — detaches everything gathered before it, and the
       * writer then measured nodes with no layout: a 12 KB file with no text
       * at all and a zero-sized page box.
       */
      const sheets = [...root.querySelectorAll('.sheet')].filter(s => s.isConnected);
      if (!sheets.length) return;
      const url = URL.createObjectURL(new Blob([sheetsToPdf(sheets)], { type: 'application/pdf' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: val });
      link.click();
      // Revoked on the next turn of the loop; Safari needs the URL to still be
      // there when the click is handled.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      /* A failed import or a writer error is said, as the spreadsheet export
         says it — not left as an unhandled rejection behind a stuck button. */
      console.error(error);
      flash(t('Export fehlgeschlagen.'));
    } finally {
      setState({ exporting: false });
    }
  }
};

/* -----------------------------------------------------------------------------
   Delegated events
   -------------------------------------------------------------------------- */

root.addEventListener('click', (event) => {
  const scrim = event.target.closest('.scrim');
  if (scrim && !event.target.closest('[data-stop]')) return actions['close-modal']();

  const el = event.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;

  const act = el.dataset.act;
  const fn = actions[act];
  if (!fn) return;
  event.preventDefault();
  // Remember the opener, but only while nothing is open — so the key belongs to
  // whatever is about to open, not to a click inside an open dialog.
  if (!state.modal && !state.editing && !state.picking && !state.tEditing) modalReturn = focusKey(el);
  fn(el.dataset.val, el);
});

/*
 * Typing. Five of these only write one field of the open dialog, so they are a
 * table rather than a chain: the field name and how to read the value.
 */
const MODAL_FIELDS = {
  'rebook-search':   { field: 'search' },
  'rebook-reason':   { field: 'reason' },
  'rebook-amount':   { field: 'amount', parse: v => Math.max(0, Number(v) || 0) },
  'rebook-quarters': { field: 'quarters', parse: v => Math.max(1, Number(v) || 1) },
  /* Kept as typed: personDraft() says whether they are values yet. */
  'person-employment': { field: 'employment' },
  'person-share':      { field: 'share' }
};

let searchTimer;
root.addEventListener('input', (event) => {
  const el = event.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  const target = MODAL_FIELDS[act];
  if (target) {
    const value = target.parse ? target.parse(el.value) : el.value;
    return setState(s => ({ modal: { ...s.modal, [target.field]: value } }));
  }

  if (act === 'search') {
    state.search = el.value;                 // written directly: no re-render per keystroke
    touch();                                 // but the memoised lists must know
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setState({}), 180);
  } else if (act === 'setting-input') {
    /* Kept as typed until «Speichern» — see settingsDraft in store.js. */
    setState(s => ({ settingsDraft: { ...s.settingsDraft, [el.dataset.val]: el.value } }));
  } else if (act === 'menu-search') {
    setState({ menuSearch: el.value });
  } else if (act === 'pick-search') {
    setState(s => ({ picking: { ...s.picking, search: el.value } }));
  } else if (act === 'reason') {
    setState({ reason: el.value });
  } else if (act === 'treason') {
    setState(s => ({ tEditing: { ...s.tEditing, reason: el.value } }));
  } else if (act === 'tdraft-input') {
    const n = Number(el.value);
    if (Number.isFinite(n)) {
      setState(s => ({ tEditing: { ...s.tEditing,
        draft: { ...s.tEditing.draft, [el.dataset.val]: Math.max(0, Math.min(100, Math.round(n))) } } }));
    }
  } else if (act === 'draft-input') {
    const n = Number(el.value);
    if (Number.isFinite(n)) setState({ draft: Math.max(0, Math.min(200, n)) });
  }
});

/* -----------------------------------------------------------------------------
   Listbox keyboard behaviour, used by the rebooking person picker.
   -------------------------------------------------------------------------- */

/**
 * Move focus along a list of controls, wrapping at both ends. `step` is 1 or
 * -1, or 'first' / 'last' to jump.
 */
function roam(items, step, from = items.indexOf(document.activeElement)) {
  if (!items.length) return null;
  /* From outside the list, ArrowDown enters at the top and ArrowUp at the
     bottom; the modulo alone sent ArrowUp to the second-to-last item. */
  const next = step === 'first' ? 0
    : step === 'last' ? items.length - 1
      : from < 0 ? (step > 0 ? 0 : items.length - 1)
        : (from + step + items.length) % items.length;
  items[next]?.focus();
  return items[next] ?? null;
}

function moveOption(step) {
  const list = root.querySelector('[role="listbox"]');
  if (!list) return null;
  const options = [...list.querySelectorAll('[role="option"]')];
  /* Where focus is, first; the selected row is only the entry point. */
  let from = options.indexOf(document.activeElement);
  if (from < 0) from = options.findIndex(o => o.classList.contains('is-on'));
  return roam(options, step, from);
}

/* -----------------------------------------------------------------------------
   Menu keyboard behaviour — the standard menu-button pattern.
   Arrow keys roam, Escape closes and hands focus back to the trigger, Tab
   leaves rather than walking into a tree that is about to be re-rendered.
   -------------------------------------------------------------------------- */

/* Live items only: a greyed switch cannot take focus, so roaming onto it stalled. */
const MENU_ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

function menuElements() {
  const panel = root.querySelector('.dd__panel');
  if (!panel) return null;
  const trigger = panel.closest('.dd')?.querySelector('[data-act="menu"]');
  return { panel, trigger, items: [...panel.querySelectorAll(MENU_ITEMS)] };
}

/** Give focus back to the button that opened the menu. */
function closeMenu({ restoreFocus = true } = {}) {
  const id = state.menu;
  setState({ menu: null, menuSearch: '' });
  if (!restoreFocus || !id) return;
  requestAnimationFrame(() => {
    root.querySelector(`[data-act="menu"][data-val="${CSS.escape(id)}"]`)?.focus();
  });
}

function moveMenuFocus(step) {
  const m = menuElements();
  if (m) roam(m.items, step);
}

document.addEventListener('keydown', (event) => {
  /*
   * A dialog owns Tab while it is open. Without this, six presses walked out of
   * an aria-modal dialog onto the brand link and the header search, behind the
   * scrim, with no way to tell you had left.
   */
  const modal = (state.modal || state.editing || state.picking || state.tEditing)
    && (root.querySelector('.modal') ?? root.querySelector('.pop'));
  if (modal && event.key === 'Tab') {
    const items = trapFocusables(modal);
    if (items.length) {
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (event.shiftKey && (at === first || !modal.contains(at))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (at === last || !modal.contains(at))) {
        event.preventDefault(); first.focus();
      }
    }
    return;
  }

  // A menu is open: it owns the arrow keys.
  if (state.menu !== null && root.contains(event.target)) {
    const inSearch = event.target.matches('[data-act="menu-search"]');
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); return moveMenuFocus(inSearch ? 'first' : 1);
      case 'ArrowUp': event.preventDefault(); return moveMenuFocus(inSearch ? 'last' : -1);
      case 'Home': if (!inSearch) { event.preventDefault(); return moveMenuFocus('first'); } break;
      case 'End': if (!inSearch) { event.preventDefault(); return moveMenuFocus('last'); } break;
      case 'Tab': event.preventDefault(); return closeMenu();
      case 'Escape': event.preventDefault(); return closeMenu();
      default: break;
    }
  }
  // Both person pickers follow the same contract: a listbox answers to the
  // keys a listbox answers to. Enter picks in the popover and selects in the
  // rebooking dialog, which still has a button to confirm.
  const list = root.querySelector('[role="listbox"]');
  if (list && root.contains(event.target) && event.target.closest('.rebook__to, .pop--assign, [role="listbox"]')) {
    if (event.key === 'ArrowDown') { event.preventDefault(); return moveOption(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); return moveOption(-1); }
    if (event.key === 'Enter') {
      const option = document.activeElement?.closest('[role="option"]');
      if (option) {
        event.preventDefault();
        return actions[state.picking ? 'pick' : 'rebook-target'](option.dataset.val);
      }
    }
  }

  if (event.key === 'Escape' && closeOverlays()) event.preventDefault();

  // Enter applies the pending pensum, matching the wireframe's stated contract.
  if (event.key === 'Enter' && state.editing && root.contains(event.target)
      && !event.target.matches('textarea, button')) {
    const apply = root.querySelector('.pop [data-act="apply"]');
    if (apply && !apply.disabled) { event.preventDefault(); actions.apply(); }
  }
  if (event.key === 'Enter' && state.tEditing && root.contains(event.target)
      && !event.target.matches('textarea, button')) {
    const apply = root.querySelector('.pop [data-act="tapply"]');
    if (apply && !apply.disabled) { event.preventDefault(); actions.tapply(); }
  }
});

/*
 * A click anywhere outside an open dropdown closes it — on click, not on
 * pointerdown.
 *
 * Closing on pointerdown re-rendered the page between the press and the
 * release, which detached the element under the finger. The browser then
 * produced no click event at all, so the delegated dispatch never ran: with a
 * menu open, the first click on a tab, a checkbox or a filter did nothing but
 * close the menu, and everything had to be clicked twice. Nine triggers shared
 * this. On click the dispatch has already run by the time we re-render.
 */
document.addEventListener('click', (event) => {
  const menu = state.menu !== null && !event.target.closest('.dd');
  /* The picker closes the same way. Its own trigger is exempt, because the
     dispatch above has just opened it on that very click. */
  const picker = state.picking !== null && !event.target.closest('.pop--assign, [data-act="assign"]');
  if (!menu && !picker) return;
  setState({ ...(menu ? { menu: null } : {}), ...(picker ? { picking: null } : {}) });
});

/**
 * An edge shadow means one thing: there is more of the time axis out of view on
 * that side. It can be out of view for two reasons — the card is scrolled, or
 * the arrows beside «Heute» moved the window — and the reader should not have
 * to know which. The view says what the window hides; this adds what only the
 * DOM knows.
 */
function syncScrollFades(scroller) {
  const card = scroller.closest('.scrollbox') ?? scroller.parentElement;
  if (!card) return;
  const room = scroller.scrollWidth - scroller.clientWidth;
  card.classList.toggle('has-less', scroller.scrollLeft > 1 || card.hasAttribute('data-before'));
  card.classList.toggle('has-more',
    (room > 1 && scroller.scrollLeft < room - 1) || card.hasAttribute('data-after'));
}

/**
 * Every group is its own card with its own scroller, so they have to be told to
 * agree: two cards showing different months are not one table any more. The
 * echo events this causes settle immediately, because a scroller already at the
 * new position is skipped.
 */
function alignScrollers(source) {
  for (const other of root.querySelectorAll('[data-scroll]')) {
    if (other !== source && other.scrollLeft !== source.scrollLeft) {
      other.scrollLeft = source.scrollLeft;
    }
  }
}

root.addEventListener('scroll', (event) => {
  /* A fixed panel stays where it was put, so it is re-placed while its trigger
     moves — the toolbar it hangs off is itself a scroller. */
  if (state.menu !== null) positionMenu();
  if (!event.target.hasAttribute?.('data-scroll')) return;
  syncScrollFades(event.target);
  alignScrollers(event.target);
}, true);

window.addEventListener('scroll', () => {
  if (state.menu !== null) positionMenu();
}, { passive: true });

/*
 * The grid drops master-data columns to fit the window, so a resize can change
 * what it draws. Debounced, because a drag fires this dozens of times and a
 * re-render is not free.
 */
let resizeTimer;
window.addEventListener('resize', () => {
  root.querySelectorAll('[data-scroll]').forEach(syncScrollFades);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => setState({}), 150);
});

/*
 * The popover is anchored in viewport space, so a scroll has to close it — but
 * not once there is work in it. One inertial trackpad tick used to discard a
 * typed reason with no way to get it back.
 */
document.addEventListener('scroll', (event) => {
  if (performance.now() - lastRenderAt < 150) return;
  /* A list scrolling inside the popover is not the page moving under it. */
  if (event.target instanceof Element && event.target.closest('.pop')) return;
  if (state.picking) {
    if (!state.picking.search) setState({ picking: null });
    return;
  }
  if (state.tEditing) {
    const { allocationId, q, draft, reason } = state.tEditing;
    const a = data.tenancy.allocationsById[allocationId];
    const started = reason.trim() !== '' || ROLE_IDS.some(r => draft[r] !== roleValue(a, r, q));
    if (!started) setState({ tEditing: null });
    return;
  }
  if (!state.editing) return;
  const project = data.projectsById[state.editing.projectId];
  const started = state.reason.trim() !== ''
    || (project && state.draft !== cellValue(project, state.editing.q));
  if (started) return;
  setState({ editing: null });
}, { capture: true, passive: true });

window.addEventListener('hashchange', () => {
  syncFromUrl();
});

/* -----------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

(async function boot() {
  try {
    await Promise.all([load(), loadIcons()]);
    syncFromUrl();
    /*
     * Canonicalise the entry point. The bare URL and any link still pointing at
     * a tab that no longer exists both resolve to the Übersicht, and the address
     * bar has to say so — otherwise a reader shares a hash that does not
     * describe what they are looking at. replaceState, so this is not a step
     * the Back button has to walk through.
     */
    writeUrl();
    subscribe(render);
    render();
  } catch (error) {
    root.innerHTML = String(html`<div class="boot boot--error">
      <strong>Die Anwendung konnte nicht geladen werden.</strong>
      <p>${error.message}</p>
      <p class="boot__hint">Der Prototyp lädt seine Daten per <code>fetch</code> aus <code>/data</code>.
        Über <code>file://</code> blockiert der Browser das — die Seite braucht einen Webserver,
        zum Beispiel <code>python -m http.server</code> im Projektordner.</p>
    </div>`);
    console.error(error);
  }
})();

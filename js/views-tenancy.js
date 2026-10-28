/* =============================================================================
   views-tenancy.js — Tab «Mietverträge»: the capacity plan for administering
   the tenancy agreements.

   One row per canton and federal office, grouped by the team that carries
   those cantons. The figures are the pensum the team books on that pair, for
   one role or all three; under each team its three people, as utilisation of
   their contract. The contracts are one click away, with the end dates that
   drive the peaks.
   ============================================================================= */

import {
  data, state, t, num, unitSuffix, periods, periodValue, loadStatus, windowQuarters, canStep, nowIndex
} from './store.js';
import {
  ROLE_IDS, roleValue, allocDemand, isEditedAlloc, memberOf, tPersonLoad, tPersonUtil, vacantLoad,
  contractsOf, dueCount, endsIn, isDue, monthsUntil, DUE_MONTHS, cantonLabel, officeOf,
  filteredAllocations, groupAllocations, tenancyKpis, tenancyFilters, chf, quarterOfDate
} from './tenancy.js';
import { card } from './views-overview.js';
import {
  html, raw, attr, icons, pageHeader, tokenPx, yearRule, pinCls, pinLeft, sortableHead,
  dropdown, menuRadio, menuTick, menuGroupLabel, divider, segmented, expandableSearch, chip, highlight,
  popoverPosition
} from './ui.js';

const tn = () => data.tenancy;
const roleShort = id => t(tn().rolesById[id].short);

/* =============================================================================
   The page
   ========================================================================== */

export function renderTenancy() {
  const list = filteredAllocations();
  return html`
    ${pageHeader({
      actions: html`<button type="button" class="btn" data-act="share">${icons.share(15)}${t('Teilen')}</button>`
    })}
    <div class="wrap"><div class="content">
      ${tenancyToolbar()}
      ${filterRow(list.length)}
      ${kpiStrip()}
      ${list.length ? grid(list) : empty()}
    </div></div>`;
}

function kpiStrip() {
  const k = tenancyKpis();
  const now = data.quarters[nowIndex()];
  const fte = (k.pensum / 100).toFixed(2).replace('.', ',');
  const role = state.role === 'all' ? t('alle Rollen') : roleShort(state.role);
  return html`<div class="kpi-strip">
    <div class="kpi"><div class="kpi__label">${t('Mietverträge')}</div>
      <div class="kpi__value">${k.contracts.toLocaleString('de-CH').replace(/[’,]/g, '’')}</div>
      <div class="kpi__note">${k.allocations} ${t('Kantone × Bundesämter')}</div></div>
    <div class="kpi"><div class="kpi__label">${t('Jahresmiete CHF')}</div>
      <div class="kpi__value">${chf(k.rent)}</div>
      <div class="kpi__note">${t('Total im Umfang')}</div></div>
    <div class="kpi"><div class="kpi__label">${t('Pensum total')}</div>
      <div class="kpi__value">${fte} FTE</div>
      <div class="kpi__note">${now.label} · ${role}</div></div>
    <div class="kpi"><div class="kpi__label">${t('Ablauf in 12 Monaten')}</div>
      <div class="kpi__value">${k.due}</div>
      <div class="kpi__note">${t('Verträge mit Enddatum bis')} ${dueLimitLabel()}</div></div>
  </div>`;
}

const dueLimitLabel = () => {
  const [y, m, d] = data.meta.today.split('-');
  return `${d}.${m}.${Number(y) + 1}`;
};

/* -----------------------------------------------------------------------------
   Toolbar — which rows, which role, which quarters
   -------------------------------------------------------------------------- */

const GROUPS = [
  { id: 'team', label: 'Team' },
  { id: 'canton', label: 'Kanton' },
  { id: 'office', label: 'Bundesamt' },
  { id: 'none', label: 'Keine' }
];

const ROLES = [
  { value: 'all', label: 'Alle' },
  { value: 'treuhand', label: 'Treuhand' },
  { value: 'bewirtschaftung', label: 'Bewirtschaftung' },
  { value: 'sachbearbeitung', label: 'Sachbearbeitung' }
];

const SCALES = [
  { value: 'year', label: 'Jahr' },
  { value: 'quarter', label: 'Quartal' },
  { value: 'month', label: 'Monat' }
];

/** A multi-select filter menu: «Alle · Keine», then one tick per entry. */
function filterMenu({ id, label, kind, act, entries, selected, width = 260 }) {
  return dropdown({
    id, lead: icons.filter(), label: t(label), count: selected.length, width,
    body: () => html`${menuGroupLabel(t('Mehrfachauswahl'))}
      <div class="dd__bulk">
        <button type="button" data-act="bulk" data-kind="${kind}" data-val="all">${t('Alle')}</button>
        <span aria-hidden="true">·</span>
        <button type="button" data-act="bulk" data-kind="${kind}" data-val="none">${t('Keine')}</button>
      </div>
      <div class="dd__scroll">
        ${entries.map(e => menuTick(e.label, selected.includes(e.id), act, e.id, e.meta))}
      </div>`
  });
}

function tenancyToolbar() {
  const group = GROUPS.find(g => g.id === state.tgroup) ?? GROUPS[0];
  return html`<div class="toolbar">
    ${expandableSearch({ placeholder: 'Kanton, Bundesamt, Vertrag oder Person' })}

    ${dropdown({
      id: 'tgroup', lead: icons.grid(), width: 240,
      label: html`<span class="btn__prefix">${t('Gruppieren nach')}:</span> <span>${t(group.label)}</span>`,
      title: `${t('Gruppieren nach')}: ${t(group.label)}`,
      body: () => html`${menuGroupLabel(t('Gruppieren nach'))}
        ${GROUPS.map(g => menuRadio(t(g.label), g.id === group.id, 'tgroup', g.id))}`
    })}

    <span class="toolbar__sep" aria-hidden="true"></span>

    ${filterMenu({
      id: 'tteam', label: 'Team', kind: 'teams', act: 'toggle-team', selected: state.teams, width: 300,
      entries: tn().meta.teams.map(x => ({ id: x.id, label: t(x.label), meta: x.cantons.join(' ') }))
    })}
    ${filterMenu({
      id: 'tcanton', label: 'Kanton', kind: 'cantons', act: 'toggle-canton', selected: state.cantons,
      entries: tn().meta.cantons.map(x => ({ id: x.id, label: t(x.label), meta: x.id }))
    })}
    ${filterMenu({
      id: 'toffice', label: 'Bundesamt', kind: 'offices', act: 'toggle-office', selected: state.offices, width: 320,
      entries: tn().meta.offices.map(x => ({ id: x.id, label: x.short, meta: x.department }))
    })}

    <span class="toolbar__sep" aria-hidden="true"></span>

    <div class="trole-switch">${segmented(ROLES, state.role, 'role', 'Rolle')}</div>

    <span class="toolbar__spacer"></span>

    <button type="button" class="btn btn--square" data-act="period" data-val="-1"
            ${attr(!canStep(-1), 'disabled')} aria-label="${t('Zurück')}">${icons.chevronLeft()}</button>
    <button type="button" class="btn" data-act="period" data-val="today"
            ${attr(state.periodOffset === 0, 'disabled')}>${t('Zu heute')}</button>
    <button type="button" class="btn btn--square" data-act="period" data-val="1"
            ${attr(!canStep(1), 'disabled')} aria-label="${t('Weiter')}">${icons.chevronRight()}</button>
    <span class="toolbar__sep" aria-hidden="true"></span>

    ${dropdown({
      id: 'tview', lead: icons.eye(), label: t('Ansicht'), width: 280, align: 'right',
      body: () => html`${menuGroupLabel(t('Zeitskala'))}
        <div class="dd__segmented">${segmented(SCALES, state.scale, 'scale')}</div>
        ${divider()}
        ${menuGroupLabel(t('Pensumwerte'))}
        <div class="dd__segmented">${segmented([{ value: 'pct', label: 'Pensum %' }, { value: 'fte', label: 'FTE' }], state.unit, 'unit')}</div>`
    })}
  </div>`;
}

function filterRow(shown) {
  const chips = tenancyFilters();
  const total = tn().allocations.length;
  return html`<div class="filterbar">
    ${chips.length
      ? html`<span class="filterbar__label">${t('Aktive Filter:')}</span>
             ${chips.map(c => chip(c.label, { kind: c.kind, id: c.id }))}
             <button type="button" class="linkbtn" data-act="filters-reset">${icons.close(13)} ${t('Alle Filter zurücksetzen')}</button>`
      : html`<span class="filterbar__label">${t('Aktive Filter:')} <span class="filterbar__none">${t('keine')}</span></span>`}
    <span class="toolbar__spacer"></span>
    <span class="filterbar__count">${shown === total
      ? `${total} ${t('Zuteilungen')}`
      : `${shown} ${t('von')} ${total} ${t('Zuteilungen')}`}</span>
  </div>`;
}

function empty() {
  return html`<div class="empty">
    <p class="empty__title">${t('Keine Zuteilungen im gesetzten Umfang')}</p>
    <p class="empty__text">${t('Die aktiven Filter schliessen alle Kantone und Bundesämter aus.')}</p>
    <button type="button" class="btn" data-act="filters-reset">${t('Alle Filter zurücksetzen')}</button>
  </div>`;
}

/* =============================================================================
   The grid
   ========================================================================== */

/* The frozen columns, in order, with their width token. */
const LEAD_COLS = [
  { key: 'canton', token: '--tenancy-col-canton' },
  { key: 'office', token: '--tenancy-col-office', grow: true },
  { key: 'contracts', token: '--tenancy-col-contracts' },
  { key: 'rent', token: '--tenancy-col-rent' },
  { key: 'due', token: '--tenancy-col-due' }
];

/* The same arithmetic as the person table: frozen offsets and the template
   come from one list of widths, so they cannot disagree. */
function layout(cols) {
  const parts = [];
  const sticky = {};
  let offset = 0;
  for (const c of LEAD_COLS) {
    const w = tokenPx(c.token);
    sticky[c.key] = offset;
    offset += w;
    parts.push(c.grow ? `minmax(${w}px, 1fr)` : `${w}px`);
  }
  sticky.width = offset;
  sticky.last = LEAD_COLS.at(-1).key;
  const quarterW = tokenPx('--grid-period');
  parts.push(`repeat(${cols.length}, minmax(${quarterW}px, ${tokenPx('--grid-period-max')}px))`);
  return { tpl: parts.join(' '), minWidth: offset + quarterW * cols.length, sticky };
}

/*
 * Heat for an allocation. One canton's share of one office is a small figure —
 * a few per cent of a person — so the project ramp, which tops out at 120,
 * would paint the whole grid in its palest step. Same five tokens, own steps,
 * three times as wide when the figure is the whole team's.
 */
function heat(v) {
  if (v <= 0) return '0';
  const k = state.role === 'all' ? 3 : 1;
  return v <= 2 * k ? '1' : v <= 5 * k ? '2' : v <= 10 * k ? '3' : '4';
}

const head = (key, label, sticky, cls = '', title = '') => sortableHead({
  key, label, act: 'sort-tenancy', cls: pinCls(sticky, key, cls), style: pinLeft(sticky, key), title,
  active: state.tSort === key, ascending: state.tDir === 'asc'
});

function grid(list) {
  const cols = periods();
  const { tpl, minWidth, sticky } = layout(cols);
  const groups = groupAllocations(list);
  const span = LEAD_COLS.length;
  const style = raw(`grid-template-columns:${tpl}`);

  const headRow = html`<div class="prow prow--head" style="${style}">
    ${head('canton', t('Kanton'), sticky)}
    ${head('office', t('Bundesamt'), sticky)}
    ${head('contracts', t('Verträge'), sticky, 'pcell--num align-end')}
    ${head('rent', t('Miete CHF'), sticky, 'pcell--num align-end', t('Jahresmiete aller Verträge, CHF'))}
    ${head('due', t('Ablauf'), sticky, 'pcell--num align-end',
      `${t('Verträge, deren Enddatum in den nächsten')} ${DUE_MONTHS} ${t('Monaten liegt')}`)}
    ${cols.map((col, i) => head(`q${i}`, col.short, sticky,
      `pcell--num pcell--period align-center ${col.isNow ? 'is-today' : ''} ${yearRule(col)}`,
      col.isNow ? `${t('Heute')}, ${data.meta.todayLabel} — ${t('laufendes Quartal')}` : col.label))}
  </div>`;

  const lead = (key, cls, body, title = '') => html`<span class="pcell ${cls} ${pinCls(sticky, key)}"
      style="${pinLeft(sticky, key)}" title="${title}">${body}</span>`;

  const row = a => {
    const office = officeOf(a.officeId);
    const due = dueCount(a);
    const values = allocDemand(a);
    const people = ROLE_IDS.map(r => memberOf(a.teamId, r)?.name ?? t('vakant')).join(', ');
    return html`<div class="prow" style="${style}">
      ${lead('canton', 'pcell--phase', highlight(a.canton), cantonLabel(a.canton))}
      ${lead('office', 'pcell--title', html`<button type="button" class="prow__title"
          data-act="open-contracts" data-val="${a.id}" title="${office.label} — ${t('Verträge anzeigen')}">
          ${highlight(office.short)}<span class="trow__sub">${highlight(t(office.label))}</span></button>`)}
      ${lead('contracts', 'pcell--target align-end', html`<button type="button" class="linkbtn"
          data-act="open-contracts" data-val="${a.id}" aria-label="${a.contracts} ${t('Verträge anzeigen')}">${a.contracts}</button>`)}
      ${lead('rent', 'pcell--target align-end', chf(a.rent), `CHF ${a.rentLabel.replace('CHF ', '')} ${t('pro Jahr')}`)}
      ${lead('due', `pcell--target align-end ${due ? 'is-due' : ''}`, due || '—',
        due ? `${due} ${t('Verträge laufen in den nächsten 12 Monaten ab')}` : '')}
      ${cols.map(period => {
        const q = period.quarters[0];
        const v = periodValue(values, period);
        const ends = endsIn(a, period);
        const editing = state.tEditing?.allocationId === a.id && state.tEditing.q === q;
        const description = `${office.short} ${a.canton} · ${people}, ${period.label}: ${num(v)}${unitSuffix()}`
          + (ends ? ` · ${ends} ${t(ends === 1 ? 'Vertrag endet' : 'Verträge enden')}` : '');
        return html`<button type="button"
          class="pcell pcell--val heat-${heat(v)} ${ends ? 'has-end' : ''} ${editing ? 'is-editing' : ''} ${isEditedAlloc(a, q) ? 'is-edited' : ''} ${yearRule(period)}"
          data-act="tcell" data-val="${a.id}" data-q="${q}" data-fk="tcell:${a.id}:${q}"
          aria-label="${description}" title="${description}"><span class="cellv">${num(v)}</span></button>`;
      })}
    </div>`;
  };

  const sumRow = (label, note, rows, cls = '') => html`<div class="prow prow--sum ${cls}" style="${style}">
    <div style="grid-column:span ${span}" class="prow__sumlabel is-frozen">
      ${label}${note && html`<span class="prow__sumnote">${note}</span>`}
    </div>
    ${cols.map(col => {
      const v = rows.reduce((acc, a) => acc + periodValue(allocDemand(a), col), 0);
      return html`<span class="pcell pcell--sum ${yearRule(col)}">${num(v)}</span>`;
    })}
  </div>`;

  /*
   * The team's three people, under its allocations: each one's load against
   * their contract, in the four words the rest of the app uses. A vacancy is a
   * row too — the work is there, nobody carries it.
   */
  const memberRows = teamId => ROLE_IDS.map(role => {
    const person = memberOf(teamId, role);
    const on = state.role === 'all' || state.role === role;
    const label = person
      ? html`<button type="button" class="linkbtn" data-act="open-tperson" data-val="${person.id}">${person.name}</button>
          <span class="prow__sumnote">${roleShort(role)} · ${person.employment} %</span>`
      : html`<span class="lead-open">${t('vakant')}</span><span class="prow__sumnote">${roleShort(role)}</span>`;
    return html`<div class="prow prow--load ${on ? '' : 'is-dimmed'}" style="${style}">
      <div style="grid-column:span ${span}" class="prow__sumlabel is-frozen">${label}</div>
      ${cols.map(col => {
        if (!person) {
          const v = periodValue(data.quarters.map((_, q) => vacantLoad(teamId, role, q)), col);
          return html`<span class="pcell pcell--load is-warn ${yearRule(col)}"
              title="${t('Unbesetzt')}: ${num(v)}${unitSuffix()} ${t('ohne Person')}">${num(v)}</span>`;
        }
        const util = Math.round(periodValue(data.quarters.map((_, q) => tPersonLoad(person, q)), col) / person.employment * 100);
        const st = loadStatus(util);
        return html`<span class="pcell pcell--load is-${st.key} ${yearRule(col)}"
            title="${person.name}, ${col.label}: ${util} % ${t('der Anstellung')} — ${t(st.label)}">${util > 100 ? '▲ ' : ''}${util} %</span>`;
      })}
    </div>`;
  });

  const body = groups.map(g => {
    const collapsed = g.label ? state.collapsedGroups[g.key] : false;
    const contracts = g.rows.reduce((a, x) => a + x.contracts, 0);
    const heading = g.label && html`<h2 class="pgrouphead">
      <button type="button" class="pgrouphead__toggle"
              data-act="toggle-group" data-val="${g.key}" aria-expanded="${!collapsed}">
        <span class="caret ${collapsed ? 'is-collapsed' : ''}" aria-hidden="true">${icons.chevronDown()}</span>
        <span class="pgrouphead__name">${g.label}</span>
        <span class="count-pill" title="${t('Verträge')}">${contracts} ${t('Verträge')}</span>
      </button>
    </h2>`;
    if (collapsed) return html`<section class="pgroup">${heading}</section>`;
    return html`<section class="pgroup">${heading}
      ${card(html`${headRow}${g.rows.map(row)}
        ${g.label && sumRow(`${t('Summe')} (${g.rows.length})`, roleLabel(), g.rows, 'prow--groupsum')}
        ${state.tgroup === 'team' && memberRows(g.id)}`,
        { minWidth, sticky })}
    </section>`;
  });

  const foot = sumRow(t('Summe Total'), `${list.length} ${t('Zuteilungen')} · ${roleLabel()}`, list);

  return html`<section class="grid-card is-bars-off is-gates-off tenancy-grid">
    ${body}
    ${card(foot, { minWidth, sticky, cls: 'pblock--foot' })}
    ${legend()}
  </section>`;
}

const roleLabel = () => (state.role === 'all' ? t('alle Rollen') : roleShort(state.role));

function legend() {
  return html`<dl class="legend tenancy-legend">
    <div class="legend__group"><dt>${t('Pensum')}</dt>
      <dd><span class="legend__item">${t('Je Kanton und Bundesamt, in % einer Vollzeitstelle; Klick zum Bearbeiten')}</span></dd></div>
    <div class="legend__group"><dt>${t('Enddatum')}</dt>
      <dd><span class="legend__item"><span class="tlegend-dot" aria-hidden="true"></span>${t('Mindestens ein Vertrag endet in dieser Periode')}</span></dd></div>
    <div class="legend__group"><dt>${t('Auslastung')}</dt>
      <dd><span class="legend__item">${t('Je Person, in % ihrer Anstellung: frei < 80 %, ok, knapp ab 95 %, Überlast über 100 %')}</span></dd></div>
  </dl>`;
}

/* =============================================================================
   The editor — one quarter of one allocation, all three roles at once
   ========================================================================== */

const POP_HEIGHT = 470;

export function tenancyPopover() {
  const { allocationId, q, anchor, draft, reason } = state.tEditing;
  const a = tn().allocationsById[allocationId];
  const office = officeOf(a.officeId);
  const width = tokenPx('--pop-tenancy-width');
  const after = ROLE_IDS.map(role => {
    const person = memberOf(a.teamId, role);
    const delta = draft[role] - roleValue(a, role, q);
    return { role, person, util: person ? tPersonUtil(person, q, delta) : null, delta };
  });
  const over = after.some(x => x.util !== null && x.util > 100 && x.delta > 0);
  const ends = contractsOf(a).filter(c => quarterOfDate(c.end) === q);

  return html`<div class="pop pop--tenancy" role="dialog" aria-modal="false" aria-label="${t('Pensum bearbeiten')}"
      style="${popoverPosition(anchor, { width, height: POP_HEIGHT, x: anchor.right - width })}">
    <div class="pop__kicker">${t('Pensum bearbeiten')}</div>
    <div class="pop__who">${office.short} · ${cantonLabel(a.canton)}</div>
    <div class="pop__what">${t(tn().teamsById[a.teamId].label)} · ${data.quarters[q].label}
      ${ends.length ? html` · <span class="is-due">${ends.length} ${t(ends.length === 1 ? 'Vertrag endet' : 'Verträge enden')}</span>` : ''}</div>

    <div class="troles">
      ${after.map(({ role, person, util }) => html`<div class="troles__row">
        <div class="troles__who">
          <span class="troles__role">${roleShort(role)}</span>
          <span class="troles__name">${person ? person.name : html`<span class="lead-open">${t('vakant')}</span>`}</span>
        </div>
        <div class="troles__stepper">
          <button type="button" class="pop__step" data-act="tdraft" data-val="${role}:-1"
                  aria-label="${roleShort(role)}: ${t('Pensum verringern')}">${icons.minus(13)}</button>
          <label class="pop__input">
            <span class="sr-only">${roleShort(role)}</span>
            <input type="number" min="0" max="100" step="1" value="${draft[role]}" inputmode="numeric"
                   data-act="tdraft-input" data-val="${role}" data-fk="tdraft:${role}">
            <span class="pop__unit">%</span>
          </label>
          <button type="button" class="pop__step" data-act="tdraft" data-val="${role}:1"
                  aria-label="${roleShort(role)}: ${t('Pensum erhöhen')}">${icons.plus(13)}</button>
        </div>
        <div class="troles__util ${util > 100 ? 'is-over' : ''}"
             title="${t('Auslastung der Person in diesem Quartal, mit der Änderung')}">
          ${util === null ? '—' : `${util > 100 ? '▲ ' : ''}${util} %`}</div>
      </div>`)}
    </div>

    <label class="pop__reason">
      <span class="pop__reasonlabel">${t('Begründung')}
        <span>${over ? t('— Pflicht bei Überlast') : t('— optional')}</span></span>
      <textarea rows="2" data-act="treason" data-fk="treason"
        placeholder="${t('Vertragsverlängerung vorgezogen, Verhandlung beginnt im Frühling.')}">${reason}</textarea>
    </label>

    <div class="pop__actions">
      <button type="button" class="btn btn--primary" data-act="tapply" ${attr(over && !reason.trim(), 'disabled')}>${t('Übernehmen')}</button>
      <button type="button" class="btn" data-act="tcancel">${t('Abbrechen')}</button>
    </div>
  </div>`;
}

/* =============================================================================
   Dialogs — the contracts of an allocation, and a person's load
   ========================================================================== */

function head2(kicker, title, meta = '') {
  return html`<header class="modal__head">
    <div>
      <p class="modal__kicker">${kicker}</p>
      <h2 class="modal__title" id="modal-title">${title}</h2>
      ${meta ? html`<p class="modal__meta-line">${meta}</p>` : ''}
    </div>
    <button type="button" class="modal__close" data-act="close-modal"
            aria-label="${t('Schliessen')}">${icons.close(15)}</button>
  </header>`;
}

/*
 * The contracts behind one row, soonest end first: the end date is what the
 * pensum follows, so it is what the list is ordered by. Unbefristete close it.
 */
export function contractsModal({ allocationId }) {
  const a = tn().allocationsById[allocationId];
  if (!a) return '';
  const office = officeOf(a.officeId);
  const team = tn().teamsById[a.teamId];
  const list = [...contractsOf(a)].sort((x, y) =>
    (x.end ?? '9999').localeCompare(y.end ?? '9999') || x.number.localeCompare(y.number));
  const members = ROLE_IDS.map(r => {
    const p = memberOf(a.teamId, r);
    return `${roleShort(r)}: ${p ? p.name : t('vakant')}`;
  }).join(' · ');

  return html`
    ${head2(`${t(team.label)} · ${cantonLabel(a.canton)}`, `${office.short} — ${t(office.label)}`,
      `${a.contracts} ${t('Verträge')} · ${t('Jahresmiete')} CHF ${chf(a.rent)} · ${dueCount(a)} ${t('mit Ablauf in 12 Monaten')}`)}
    <p class="modal__lead">${members}</p>
    <div class="modal__section">
      <div class="tcontracts" role="region" aria-label="${t('Verträge')}" tabindex="0">
        <table>
          <thead><tr>
            <th scope="col">${t('Vertrag')}</th>
            <th scope="col">${t('Gebäude')}</th>
            <th scope="col">${t('Vertragsbezeichnung')}</th>
            <th scope="col" class="num">${t('Miete CHF/Jahr')}</th>
            <th scope="col">${t('Enddatum')}</th>
          </tr></thead>
          <tbody>
            ${list.map(c => {
              const due = isDue(c);
              const months = c.end ? monthsUntil(c.end) : null;
              return html`<tr class="${due ? 'is-due' : ''}">
                <td>${highlight(c.number)}</td>
                <td>${highlight(c.buildingId)}</td>
                <td>${highlight(c.title)}</td>
                <td class="num">${c.rentLabel.replace('CHF ', '')}</td>
                <td>${c.end ? html`${c.endLabel}${due ? html`<span class="tcontracts__due">${t('in')} ${months} ${t('Mt.')}</span>` : ''}
                  <span class="tcontracts__term">${t('Laufzeit')} ${c.term} ${t('Jahre, verlängert sich')}</span>`
                  : html`<span class="tcontracts__open">${t('unbefristet')}</span>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>`;
}

/** One person of a team: their contract, and their load per quarter. */
export function tPersonModal({ personId }) {
  const person = tn().peopleById[personId];
  if (!person) return '';
  const team = tn().teamsById[person.teamId];
  const { from, to } = windowQuarters();
  const qs = Array.from({ length: Math.min(8, to - from + 1) }, (_, i) => from + i);
  const peak = Math.max(...data.quarters.map((_, q) => tPersonUtil(person, q)));
  return html`
    ${head2(`${t(team.label)} · ${team.cantons.join(', ')}`, person.name, t(person.roleLabel))}
    <dl class="facts">
      <div class="facts__row"><dt>${t('Anstellung')}</dt><dd>${person.employment} %</dd></div>
      <div class="facts__row"><dt>${t('Zuteilungen')}</dt><dd>${(tn().allocationsByTeam[team.id] ?? []).length}
        <span class="facts__sub">${t('Kantone × Bundesämter des Teams')}</span></dd></div>
      <div class="facts__row"><dt>${t('Spitze im Planungshorizont')}</dt>
        <dd class="${peak > 100 ? 'is-danger' : ''}">${peak} %<span class="facts__sub">${t('der Anstellung')}</span></dd></div>
    </dl>
    <section class="modal__section">
      <h3>${t('Auslastung je Quartal')}</h3>
      <div class="minigrid">
        ${qs.map(q => {
          const u = tPersonUtil(person, q);
          return html`<div class="minigrid__col">
            <span class="minigrid__q">${data.quarters[q].short}<span>/${String(data.quarters[q].year).slice(2)}</span></span>
            <span class="minigrid__v tutil is-${loadStatus(u).key}">${u} %</span>
          </div>`;
        })}
      </div>
    </section>
    <footer class="modal__foot">
      <button type="button" class="btn btn--primary" data-act="filter-tteam" data-val="${team.id}">${t('Nur dieses Team zeigen')}</button>
    </footer>`;
}

/* =============================================================================
   views-modals.js — the dialogs: a project's detail sheet, a person's, a
   phase, a gate, moving a pensum to somebody else, sharing the view, the
   account, and the office's settings.

   They share one shell (scrim, role="dialog", one close button) and differ
   only in their body, so they live together and away from the grid.
   ============================================================================= */

import {
  data, state, t, num, fmt, unitSuffix, cellValue, projectDemand, heatStep, personUtilisation, phaseOf, eppmOf,
  nowIndex, deDate, projectsOf, projectShare, projectCapacity, personHeatStep, personDraft,
  settingText, settingTyped, settingValue, settingChanges
} from './store.js';

import { html, icons, attr, personOption, personSearch } from './ui.js';
import { contractsModal, tPersonModal } from './views-tenancy.js';

/**
 * One dialog head for all four: the same close button was written out four
 * times, so it could drift four ways.
 */
/*
 * What the application would send by e-mail. Three switches rather than one,
 * because the three differ in how often they fire: a gate on your own project
 * is rare and worth an interruption, somebody else's edit is not, and the
 * digest is what somebody who wants neither still wants once a week.
 */
const MAIL_PREFS = [
  { key: 'milestones', label: 'Meilensteine meiner Projekte',
    note: 'Sobald ein Termin verschoben wird oder ein Auftrag hängig bleibt.' },
  { key: 'changes', label: 'Änderungen durch andere',
    note: 'Umbuchungen und Pensumsänderungen an Projekten, die ich führe.' },
  { key: 'digest', label: 'Wöchentliche Zusammenfassung',
    note: 'Montags: Auslastung, überfällige Meilensteine, offene Zuweisungen.' }
];

/*
 * Account settings. Two things, and a sentence about the third.
 *
 * There is no password field and no permissions tab, because there is nothing
 * here to change: access is federated through eIAM, and a dialog that offered
 * to change a password would be lying about where the account lives. Saying so
 * costs one line and stops the question being asked.
 */
function settingsModal() {
  const m = data.meta;
  const langs = data.i18n.languages;

  return html`
    ${modalHead(t('Konto'), m.user.name, `${t(m.user.role)} · ${t(m.org.unit)}`)}

    <div class="settings">
      <section class="settings__block">
        <h3 class="settings__title">${t('E-Mail-Benachrichtigungen')}</h3>
        ${MAIL_PREFS.map(pref => html`<label class="settings__row">
          <input type="checkbox" data-act="mail-pref" data-val="${pref.key}"
                 ${attr(state.account.mail[pref.key], 'checked')}>
          <span>
            <span class="settings__label">${t(pref.label)}</span>
            <span class="settings__note">${t(pref.note)}</span>
          </span>
        </label>`)}
      </section>

      <section class="settings__block">
        <h3 class="settings__title">${t('Sprache')}</h3>
        <p class="settings__note settings__note--lead">${t('Gilt für diese Anwendung und für E-Mails.')}</p>
        <div class="settings__langs" role="radiogroup" aria-label="${t('Sprache')}">
          ${langs.map(l => html`<label class="settings__row settings__row--inline">
            <input type="radio" name="account-lang" data-act="account-lang" data-val="${l.code}"
                   ${attr(state.account.lang === l.code, 'checked')}
                   ${attr(!l.available, 'disabled')}>
            <span>
              <span class="settings__label">${l.label}</span>
              ${l.available ? '' : html`<span class="settings__note">${t('noch nicht übersetzt')}</span>`}
            </span>
          </label>`)}
        </div>
      </section>

      <p class="settings__eiam">${t('Berechtigungen, Kennwort und Zwei-Faktor-Anmeldung werden über eIAM verwaltet.')}</p>
    </div>

    <footer class="modal__foot">
      <button type="button" class="btn btn--primary" data-act="close-modal">${t('Fertig')}</button>
    </footer>`;
}

/* -----------------------------------------------------------------------------
   The office's settings — the dialog behind the gear in the header
   -------------------------------------------------------------------------- */

/*
 * Not the account dialog above. That one is the reader's own — their mail,
 * their language. These are the office's: how much of a contract a unit may
 * spend on projects, and where a small project ends. Nobody expects them to
 * change — moving a project share means moving contracts — so the dialog is a
 * place to look the rule up first, and a form second. It saves all its fields
 * at once, and closing it any other way leaves the rules as they were.
 */

/** A pensum in FTE, the Swiss way round: 1,25. */
const fte = v => (v / 100).toFixed(2).replace('.', ',');

/*
 * One field. Text with a numeric keyboard rather than type="number": the
 * dialog re-renders as it is typed in, and a number input refuses the caret
 * position the render loop hands back to it.
 */
function settingField(key, { label, unit }) {
  const typed = settingTyped(key);
  const invalid = typed === null;
  const changed = !invalid && typed !== settingValue(key);
  return html`<span class="setfield ${invalid ? 'is-invalid' : ''} ${changed ? 'is-changed' : ''}">
    <input type="text" inputmode="decimal" autocomplete="off" value="${settingText(key)}"
           data-act="setting-input" data-val="${key}" data-fk="setting:${key}"
           aria-label="${label}" aria-invalid="${invalid}">
    <span>${unit}</span>
  </span>`;
}

function rulesModal() {
  const changes = settingChanges();
  const invalid = changes === null;
  const pending = !invalid && changes.length > 0;

  return html`
    ${modalHead(t(data.meta.org.app), t('Einstellungen'),
      t('Diese Regeln gelten für alle. Eine Änderung bewertet die Auslastung aller Personen und Quartale neu und wird im Verlauf festgehalten.'))}

    <section class="modal__section">
      <h3>${t('Projektanteil je Organisation')}</h3>
      <p class="settings__note settings__note--lead">${t('Anteil der Anstellung, der für Projekte eingesetzt werden darf')}.
        ${t('Der Rest ist Linien- und Administrationsarbeit.')}</p>
      <div class="settable">
        <div class="settable__row settable__row--head">
          <span>${t('Organisation')}</span>
          <span class="settable__num">${t('Personen')}</span>
          <span class="settable__num">${t('Projektanteil')}</span>
          <span class="settable__num settable__extra">${t('Für Projekte verfügbar')}</span>
        </div>
        ${data.meta.organisations.map(o => {
          const people = data.people.filter(p => p.organisation === o.id);
          const share = settingTyped(`share:${o.id}`);
          /* What the unit could then carry, as the field is typed. A person with
             a share of their own keeps it, whatever the unit's becomes. */
          const available = share === null ? null
            : people.reduce((a, p) => a + p.employment * (p.projectShare ?? share) / 100, 0);
          return html`<div class="settable__row">
            <span class="settable__name">${t(o.label)} <span class="settable__short">(${t(o.short)})</span></span>
            <span class="settable__num">${people.length}</span>
            <span class="settable__num">${settingField(`share:${o.id}`, { label: `${t('Projektanteil')} ${t(o.label)}`, unit: '%' })}</span>
            <span class="settable__num settable__extra">${available === null ? '—' : `${fte(available)} FTE`}</span>
          </div>`;
        })}
      </div>
    </section>

    <section class="modal__section">
      <h3>${t('Projektgrösse')}</h3>
      <p class="settings__note settings__note--lead">${t('Darüber gilt ein Projekt als Grossprojekt.')}</p>
      <div class="settable">
        <!-- The same table as above — a head and a row, in the same columns, with
             the count's left empty — so this field stands under theirs. -->
        <div class="settable__row settable__row--head">
          <span>${t('Kategorie')}</span>
          <span></span>
          <span class="settable__num">${t('Kredit')} ${t('bis')}</span>
        </div>
        <div class="settable__row">
          <span class="settable__name">${t('Kleinprojekte')}</span>
          <span></span>
          <span class="settable__num">${settingField('small', { label: `${t('Kleinprojekte')}: ${t('Kredit')} ${t('bis')}`, unit: t('Mio. CHF') })}</span>
        </div>
      </div>
    </section>

    <footer class="modal__foot">
      <span class="setnote ${invalid ? 'is-invalid' : ''}" role="status">${invalid
        ? t('Ungültiger Wert: Projektanteil 1 – 100 %, Schwelle grösser als 0.')
        : pending ? `${changes.length} ${t(changes.length === 1 ? 'ungespeicherte Änderung' : 'ungespeicherte Änderungen')}` : ''}</span>
      <button type="button" class="btn" data-act="close-modal">${t('Abbrechen')}</button>
      <button type="button" class="btn btn--primary" data-act="settings-save"
              ${attr(!pending, 'disabled')}>${t('Speichern')}</button>
    </footer>`;
}

function modalHead(kicker, title, meta = '') {
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

/* One entry per dialog; app.js sets state.modal.type to one of these keys.
   Assigning a person is not one of them any more: it is a popover on the cell,
   like the pensum editor — see assignPicker() in views-overview.js. */
const MODALS = {
  settings: settingsModal,     // the account: the reader's own mail and language
  rules: rulesModal,           // the office's settings, behind the gear
  phase: phaseModal,
  milestone: milestoneModal,
  project: projectModal,
  person: personModal,
  share: shareModal,
  rebook: rebookModal,
  contracts: contractsModal,   // the Mietverträge behind one canton and office
  tperson: tPersonModal        // a person of a tenancy team
};

/* The dialogs that carry a table and need the width for it. */
const WIDE = new Set(['contracts']);

export function renderModal() {
  if (!state.modal) return '';
  const build = MODALS[state.modal.type];
  if (!build) return '';
  const body = build(state.modal);
  /* A builder that found nothing to show returns nothing; an empty dialog
     with a label pointing nowhere is not a fallback. */
  if (!body) return '';
  return html`<div class="scrim" data-act="close-modal">
    <div class="modal ${WIDE.has(state.modal.type) ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-stop>${body}</div>
  </div>`;
}

/**
 * The URL already carries tab, view, filters, grouping, unit and search, so the
 * share dialog only has to show it and make it easy to take.
 */
function shareModal({ copied }) {
  return html`
    ${modalHead(t('Teilen'), t('Diese Ansicht teilen'))}

    <div class="share">
      <label class="share__field">
        <span class="sr-only">${t('Link')}</span>
        <input type="text" readonly value="${location.href}" data-fk="share-url"
               data-act="share-select" aria-label="${t('Link')}">
      </label>
      <button type="button" class="btn btn--primary" data-act="share-copy">
        ${copied ? icons.check(15) : icons.externalLink(15)}${copied ? t('Kopiert') : t('Link kopieren')}
      </button>
    </div>`;
}

/**
 * A gate is a date and a consequence, so the dialog stays at that: what it is,
 * when it was planned, when it is now expected, and why if those differ.
 */
function milestoneModal({ milestoneId }) {
  const m = data.milestones.items.find(x => x.id === milestoneId);
  if (!m) return '';
  const p = data.projectsById[m.projectId];
  const cat = data.milestoneCatalog[m.code];
  const lead = p.leadId ? data.peopleById[p.leadId] : null;
  const planQ = data.quarters[data.quarterIndex[m.plan]];
  const foreQ = m.forecast ? data.quarters[data.quarterIndex[m.forecast]] : null;
  const moved = m.forecast && m.forecast !== m.plan;

  const facts = [
    { term: 'Projekt', value: p.title, sub: `${p.number} · ${t(data.portfoliosById[p.portfolio].label)}` },
    { term: 'Phase (ePPM)', value: t(phaseOf(m.subPhase).label) },
    { term: 'Plantermin', value: `${planQ.label} · ${deDate(m.planDate)}` },
    {
      term: 'Prognose',
      value: foreQ ? `${foreQ.label} · ${deDate(m.forecastDate)}` : t('offen'),
      sub: m.impact ? t(m.impact) : null,
      tone: moved || !foreQ ? 'danger' : null
    },
    { term: 'Bearbeitender', value: lead ? lead.name : t('nicht zugewiesen') }
  ];

  return html`
    ${modalHead(t(m.statusLabel), cat ? t(cat.name) : m.code)}

    <dl class="facts">
      ${facts.map(f => html`<div class="facts__row">
        <dt>${t(f.term)}</dt>
        <dd class="${f.tone ? `is-${f.tone}` : ''}">${f.value}
          ${f.sub ? html`<span class="facts__sub">${f.sub}</span>` : ''}</dd>
      </div>`)}
    </dl>

    <footer class="modal__foot">
      <button type="button" class="btn" data-act="open-project" data-val="${p.id}">${t('Projekt öffnen')}</button>
      <button type="button" class="btn btn--primary" data-act="noop">${t('Im ePPM öffnen')}</button>
    </footer>`;
}

/**
 * A phase is a stretch of time with a workload attached, so the dialog answers
 * exactly that — and says plainly when the stretch is a delay rather than work.
 */
function phaseModal({ projectId, from }) {
  const p = data.projectsById[projectId];
  const bar = p?.bars.find(x => x.from === from);
  if (!bar) return '';
  const lead = p.leadId ? data.peopleById[p.leadId] : null;
  const sub = phaseOf(bar.phase);
  const cells = projectDemand(p);

  const first = Math.max(0, bar.from);
  const last = Math.min(data.quarters.length - 1, bar.to - 1);
  const within = cells.slice(first, last + 1);
  const peak = within.length ? Math.max(...within) : 0;
  const quarters = bar.to - bar.from;

  const facts = [
    { term: 'Projekt', value: p.title, sub: `${p.number} · ${t(data.portfoliosById[p.portfolio].label)}` },
    {
      term: 'Zeitraum',
      value: `${data.quarters[first].label} – ${data.quarters[last].label}`,
      sub: `${quarters} ${t(quarters === 1 ? 'Quartal' : 'Quartale')}${bar.continues ? ` · ${t('läuft weiter')}` : ''}`
    },
    {
      term: 'Pensum in dieser Phase',
      value: within.length ? `${t('Spitze')} ${num(peak)}${unitSuffix()}` : '—',
      sub: within.length ? within.map(v => num(v)).join(' · ') : null
    },
    { term: 'Bearbeitender', value: lead ? lead.name : t('nicht zugewiesen') }
  ];

  // The number is already in the title; the kicker names the kind of thing.
  const kicker = bar.delay ? t('Verzug') : t('Phase (ePPM)');
  const title = bar.delay ? bar.label : (sub ? t(sub.label) : bar.label);

  return html`
    ${modalHead(kicker, title)}

    <dl class="facts">
      ${facts.map(f => html`<div class="facts__row">
        <dt>${t(f.term)}</dt>
        <dd>${f.value}${f.sub ? html`<span class="facts__sub">${f.sub}</span>` : ''}</dd>
      </div>`)}
    </dl>

    <footer class="modal__foot">
      <button type="button" class="btn" data-act="open-project" data-val="${p.id}">${t('Projekt öffnen')}</button>
      <button type="button" class="btn btn--primary" data-act="noop">${t('Im ePPM öffnen')}</button>
    </footer>`;
}

function projectModal({ projectId }) {
  const p = data.projectsById[projectId];
  const lead = p.leadId ? data.peopleById[p.leadId] : null;
  const cells = projectDemand(p);
  const now = nowIndex();
  const q0 = data.quarters[now];
  const nextMs = data.milestones.items
    .filter(m => m.projectId === p.id)
    .sort((a, b) => a.planDate.localeCompare(b.planDate))[0];
  const nextName = nextMs && data.milestoneCatalog[nextMs.code]?.name;
  const log = data.changes.filter(c => c.projectId === p.id);
  const util = lead ? personUtilisation(lead.id, now) : null;

  // The wireframe is explicit: five facts, always the same, in this order.
  const facts = [
    {
      term: 'Phase (ePPM)',
      value: t(eppmOf(p.phase).label),
      sub: `${t('Phase')} ${data.phases.eppm.findIndex(e => e.id === p.phase) + 1} ${t('von')} ${data.phases.eppm.length}`
    },
    {
      term: 'Bearbeitender',
      value: lead ? lead.name : t('— nicht zugewiesen'),
      sub: lead ? `${t('Auslastung')} ${q0.short}: ${util > 100 ? '▲ ' : ''}${util} %` : t('Pensum offen'),
      tone: lead ? (util > 100 ? 'danger' : null) : 'warn'
    },
    {
      term: `${t('Pensum')} ${q0.label}`,
      value: fmt(cells[now]),
      sub: `${t('Soll')} ${fmt(p.target)} · ${cells[now] > p.target ? t('über Soll') : t('im Soll')}`,
      tone: cells[now] > p.target ? 'danger' : null
    },
    {
      term: 'Kredit CHF',
      value: t(p.creditLabel),
      sub: p.preCredit ? t('Freigabe steht aus') : t('Kredit freigegeben')
    },
    {
      term: 'Nächster Meilenstein',
      value: nextMs ? `${t(nextName ?? nextMs.code)} · ${deDate(nextMs.planDate)}` : '—',
      sub: nextMs ? t(nextMs.statusLabel).replace('▲ ', '') : t('kein Gate im Zeitraum'),
      tone: nextMs && nextMs.status !== 'ok' ? 'danger' : null
    }
  ];

  return html`
    ${modalHead(`${p.number} · ${t(data.portfoliosById[p.portfolio].label)} · ${p.location.split(',')[0]}`, p.title)}

    <dl class="facts">
      ${facts.map(f => html`<div class="facts__row">
        <dt>${t(f.term)}</dt>
        <dd class="${f.tone ? 'is-' + f.tone : ''}">${f.value}<span class="facts__sub">${f.sub}</span></dd>
      </div>`)}
    </dl>

    <section class="modal__section">
      <h3>${t('Pensum je Quartal')}</h3>
      <div class="minigrid">
        ${data.quarters.map((q, i) => html`<div class="minigrid__col">
          <span class="minigrid__q">${q.short}<span>/${String(q.year).slice(2)}</span></span>
          <span class="minigrid__v heat-${heatStep(cells[i])}">${num(cells[i])}</span>
        </div>`)}
      </div>
    </section>

    ${log.length ? html`<section class="modal__section">
      <h3>${t('Letzte Änderungen')}</h3>
      <ul class="modal__log">
        ${log.map(c => html`<li><span>${c.dateLabel}</span><span>${t(c.field)}</span><span>${c.change}</span><span>${c.value}</span></li>`)}
      </ul>
    </section>` : ''}

    <footer class="modal__foot">
      <button type="button" class="btn" data-act="open-schedule" data-val="${p.id}">${t('Termine anzeigen')}</button>
      <button type="button" class="btn btn--primary" data-act="noop">${t('Im ePPM öffnen')}</button>
    </footer>`;
}

/**
 * A person, the way the project dialog shows a project: what they are
 * contracted for, how much of that may go to projects, what they carry, and
 * how that sits against the ceiling quarter by quarter.
 *
 * It is also where the two figures of the person themselves are set — the
 * contract, and a project share of their own where it differs from the
 * unit's. Both are rare, so they are two plain fields behind one button, and
 * the facts above them show what is saved, not what is being typed.
 */
function personModal(modal) {
  const person = data.peopleById[modal.personId];
  if (!person) return '';
  const org = data.organisationsById[person.organisation];
  const now = nowIndex();
  const share = projectShare(person);
  const capacity = String(Math.round(projectCapacity(person) * 10) / 10).replace('.', ',');
  const projects = projectsOf(person.id);
  const carries = projects.length > 0;
  const util = data.quarters.map((_, q) => personUtilisation(person.id, q));
  const peak = util.indexOf(Math.max(...util));
  const own = person.projectShare != null;

  const facts = [
    { term: 'Organisation', value: org ? t(org.label) : '—', sub: org ? t(org.short) : '' },
    { term: 'Anstellung', value: `${person.employment} %` },
    {
      term: 'Projektanteil',
      value: `${share} %`,
      sub: `${t('Für Projekte verfügbar')}: ${capacity} % · ${t(own ? 'eigener Wert' : 'Vorgabe der Organisation')}`
    },
    /* Somebody who leads nothing has work this table does not model, so their
       figure is not a utilisation — the person table prints a dash for them too. */
    carries ? {
      term: `${t('Auslastung')} ${data.quarters[now].label}`,
      value: `${util[now] > 100 ? '▲ ' : ''}${util[now]} %`,
      sub: `${t('Spitze')} ${util[peak]} % · ${data.quarters[peak].label}`,
      tone: util[now] > 100 ? 'danger' : null
    } : {
      term: `${t('Auslastung')} ${data.quarters[now].label}`,
      value: '—', sub: t('Keine Projekte zugewiesen.')
    }
  ];

  const draft = personDraft(modal);
  const changed = draft && (draft.employment !== person.employment || draft.share !== person.projectShare);

  return html`
    ${modalHead(t(person.role), person.name)}

    <dl class="facts">
      ${facts.map(f => html`<div class="facts__row">
        <dt>${t(f.term)}</dt>
        <dd class="${f.tone ? 'is-' + f.tone : ''}">${f.value}<span class="facts__sub">${f.sub}</span></dd>
      </div>`)}
    </dl>

    <!-- Under the facts, with its own button: at the foot of the dialog the two
         fields sat below forty quarters, a screen and a half down a small laptop. -->
    <section class="modal__section">
      <h3>${t('Anstellung anpassen')}</h3>
      <div class="personedit">
        <div class="rebook__field">
          <label class="rebook__label" for="person-employment">${t('Anstellung')}</label>
          <span class="rebook__amount">
            <input id="person-employment" type="text" inputmode="numeric" autocomplete="off"
                   value="${modal.employment}" data-act="person-employment" data-fk="person-employment">
            <span>%</span>
          </span>
        </div>
        <div class="rebook__field">
          <label class="rebook__label" for="person-share">${t('Eigener Projektanteil')}</label>
          <span class="rebook__amount">
            <input id="person-share" type="text" inputmode="numeric" autocomplete="off"
                   value="${modal.share}" data-act="person-share" data-fk="person-share">
            <span>%</span>
          </span>
        </div>
        <button type="button" class="btn btn--primary" data-act="person-save" ${attr(!changed, 'disabled')}>${t('Speichern')}</button>
      </div>
      <p class="personedit__note">${t('Eigener Projektanteil leer: es gilt die Vorgabe der Organisation.')}</p>
      ${draft ? '' : html`<p class="personedit__error" role="status">${
        t('Ungültiger Wert: Anstellung 10 – 100 %, Projektanteil 1 – 100 % oder leer.')}</p>`}
    </section>

    <section class="modal__section">
      <h3>${t('Projekte')} (${projects.length})</h3>
      ${carries ? html`<ul class="modal__log modal__log--projects">
        ${projects.map(p => html`<li>
          <span>${p.number}</span>
          <button type="button" class="linkbtn" data-act="open-project" data-val="${p.id}">${p.title}</button>
          <span>${t(eppmOf(p.phase).label)}</span>
          <span>${fmt(cellValue(p, now))}</span>
        </li>`)}
      </ul>` : html`<p class="settings__note">${t('Keine Projekte zugewiesen.')}</p>`}
    </section>

    ${carries && html`<section class="modal__section">
      <h3>${t('Auslastung je Quartal')}</h3>
      <div class="minigrid">
        ${data.quarters.map((q, i) => html`<div class="minigrid__col">
          <span class="minigrid__q">${q.short}<span>/${String(q.year).slice(2)}</span></span>
          <span class="minigrid__v heat-${personHeatStep(util[i])}"
                title="${q.label}: ${util[i]} % ${t('der Projektkapazität')}">${util[i]}</span>
        </div>`)}
      </div>
    </section>`}

    <footer class="modal__foot">
      <button type="button" class="btn" data-act="filter-lead" data-val="${person.id}">${t('Projekte in der Planung anzeigen')}</button>
    </footer>`;
}

function rebookModal({ projectId, q, amount, targetId, quarters = 2, search = '', reason = '' }) {
  const p = data.projectsById[projectId];
  const from = p.leadId ? data.peopleById[p.leadId] : null;
  const quarter = data.quarters[q];
  const query = search.trim().toLowerCase();
  const candidates = data.people
    .filter(x => x.id !== p.leadId)
    .filter(x => !query || x.name.toLowerCase().includes(query));
  const target = targetId ? data.peopleById[targetId] : null;
  const ready = target && amount > 0 && reason.trim();

  return html`
    ${modalHead(t('Pensum umbuchen'), p.title,
      `${t('Bearbeitender')} · ${t('ab')} ${quarter.label}, ${quarters} ${t('Quartale')}`)}

    <p class="modal__lead">${t('Ein Vorgang statt zwei Transaktionen: von, an, Betrag und Zeitraum ergeben einen Verlaufseintrag mit beiden Seiten.')}</p>

    <div class="rebook">
      <div class="rebook__field">
        <span class="rebook__label">${t('Von')}</span>
        <span class="rebook__readonly">${from ? from.name : t('nicht zugewiesen')}</span>
      </div>
      <div class="rebook__field rebook__field--amount">
        <label class="rebook__label" for="rebook-amount">${t('Pensum')}</label>
        <span class="rebook__amount">
          <input id="rebook-amount" type="number" min="0" max="${cellValue(p, q)}" step="5"
                 value="${amount}" data-act="rebook-amount" data-fk="rebook-amount">
          <span>%</span>
        </span>
      </div>
      <div class="rebook__field rebook__field--quarters">
        <label class="rebook__label" for="rebook-quarters">${t('Dauer')}</label>
        <span class="rebook__amount">
          <input id="rebook-quarters" type="number" min="1" max="${data.quarters.length - q}" step="1"
                 value="${quarters}" data-act="rebook-quarters" data-fk="rebook-quarters">
          <span>${t('Quartale')}</span>
        </span>
      </div>
    </div>

    <div class="rebook__to">
      <span class="rebook__label">${t('An')}</span>
      ${personSearch({ act: 'rebook-search', fk: 'rebook-search', value: search, listId: 'rebook-list',
        placeholder: 'Person suchen — Name oder Kürzel' })}
      ${candidates.length ? '' : html`<p class="rebook__empty">${t('Keine Person gefunden.')}</p>`}
      <ul class="rebook__list" id="rebook-list" role="listbox" aria-label="${t('Person wählen')}">
        ${candidates.map(c => personOption({
          id: c.id, name: c.name, act: 'rebook-target', selected: c.id === targetId,
          meta: t(data.organisationsById[c.organisation]?.short ?? ''),
          metaTitle: t(data.organisationsById[c.organisation]?.label ?? '')
        }))}
      </ul>
    </div>

    <label class="pop__reason rebook__reason">
      <span class="pop__reasonlabel">${t('Begründung')}
        <span>${t('— Pflicht bei jeder Umbuchung')}</span></span>
      <textarea rows="2" data-act="rebook-reason" data-fk="rebook-reason"
        placeholder="${t('Entlastung des Bearbeitenden gemäss Beschluss Abteilungssitzung 24.08.2026.')}">${reason}</textarea>
    </label>

    <footer class="modal__foot">
      <button type="button" class="btn" data-act="close-modal">${t('Abbrechen')}</button>
      <button type="button" class="btn btn--primary" data-act="rebook-apply" ${attr(!ready, 'disabled')}>${t('Umbuchen')}</button>
    </footer>`;
}

/* =============================================================================
   generate-tenancy.js — the mock portfolio of tenancy agreements.

   The second planning domain next to the building projects: the contracts the
   BBL lets to the federal offices, and the people who administer them.

   The work is organised by canton. A team of three — Immobilientreuhänder
   (the lead), Immobilienbewirtschafter, Immobiliensachbearbeiter — takes every
   contract in its cantons. With some 2500 contracts nobody plans a pensum per
   contract, so the plan is one level up: per person, per canton, per federal
   office. The contracts are the evidence underneath — what is there, what it
   is worth, and when it runs out.

   Writes data/tenancy/. Reads only data/meta.json, for the quarter window and
   today, so both domains plan against the same forty quarters.

   Deterministic: one seeded generator, so re-running produces the same files.
   ============================================================================= */

const fs = require('fs');
process.chdir(require('path').join(__dirname, '..'));

const read = n => JSON.parse(fs.readFileSync(`data/${n}.json`, 'utf8'));
const write = (n, v) => {
  fs.mkdirSync('data/tenancy', { recursive: true });
  // A per-quarter array on one line: forty lines of one number each is what
  // made the allocations three times the size and unreadable.
  const json = JSON.stringify(v, null, 2)
    .replace(/\[\s+(-?\d+(?:,\s+-?\d+)*)\s+\]/g, (_, nums) => `[${nums.split(/,\s+/).join(', ')}]`);
  fs.writeFileSync(`data/tenancy/${n}.json`, json + '\n');
};

/* mulberry32 — small, seeded, and good enough for mock data */
let seed = 0x7e4a17;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = list => list[Math.floor(rnd() * list.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
};
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const round = (n, step) => Math.round(n / step) * step;

const META = read('meta');
const QUARTERS = META.quarters;
const Q = QUARTERS.length;
const TODAY = META.today;

/* -----------------------------------------------------------------------------
   Vocabulary — fictional places and people; the tenants and cantons are real
   -------------------------------------------------------------------------- */

/* Place and street names by language region, so a contract in Vaud reads French. */
const PLACES = {
  de: ['Musterlingen', 'Musterbiel', 'Musterthal', 'Musterberg', 'Mustersee', 'Musterau',
    'Musterbach', 'Musterwil', 'Musteregg', 'Musterdorf', 'Beispielstadt', 'Beispielhofen'],
  fr: ['Exempleville', 'Modèle-sur-Lac', 'Exemplens', 'Modèlerens', 'Exemplier', 'Mont-Modèle'],
  it: ['Esempiano', 'Modellino', 'Esempio Basso', 'Monte Esempio', 'Modellate']
};
const STREETS = {
  de: ['Ahornweg', 'Industriestrasse', 'Seestrasse', 'Hauptstrasse', 'Mühleweg', 'Bahnhofstrasse',
    'Lindenweg', 'Zollstrasse', 'Kasernenstrasse', 'Ringstrasse', 'Talstrasse', 'Amtshausgasse'],
  fr: ['Rue des Alpes', 'Chemin du Parc', 'Avenue de la Gare', 'Quai du Lac', 'Rue du Marché', 'Route de la Douane'],
  it: ['Via Cantonale', 'Via Motta', 'Via Sempione', 'Via della Stazione', 'Piazza Grande']
};

/*
 * The cantons, with the share of the contracts each holds. Bern carries the
 * most, being where the federal administration sits; the rest follows size and
 * the number of federal sites, roughly. `border` marks where the customs
 * office rents more than elsewhere.
 */
const CANTONS = [
  ['ZH', 'Zürich', 'de', 230], ['BE', 'Bern', 'de', 215], ['LU', 'Luzern', 'de', 90],
  ['UR', 'Uri', 'de', 25], ['SZ', 'Schwyz', 'de', 35], ['OW', 'Obwalden', 'de', 15],
  ['NW', 'Nidwalden', 'de', 15], ['GL', 'Glarus', 'de', 25], ['ZG', 'Zug', 'de', 30],
  ['FR', 'Freiburg', 'fr', 100], ['SO', 'Solothurn', 'de', 80], ['BS', 'Basel-Stadt', 'de', 110, true],
  ['BL', 'Basel-Landschaft', 'de', 60], ['SH', 'Schaffhausen', 'de', 45, true], ['AR', 'Appenzell Ausserrhoden', 'de', 15],
  ['AI', 'Appenzell Innerrhoden', 'de', 10], ['SG', 'St. Gallen', 'de', 120, true], ['GR', 'Graubünden', 'de', 160, true],
  ['AG', 'Aargau', 'de', 135], ['TG', 'Thurgau', 'de', 60, true], ['TI', 'Tessin', 'it', 210, true],
  ['VD', 'Waadt', 'fr', 235], ['VS', 'Wallis', 'fr', 180, true], ['NE', 'Neuenburg', 'fr', 100],
  ['GE', 'Genf', 'fr', 190, true], ['JU', 'Jura', 'fr', 30, true]
].map(([id, label, lang, weight, border = false]) => ({ id, label, lang, weight, border }));

/*
 * The teams, each taking every contract in its cantons. A canton belongs to
 * exactly one team; the small ones are grouped, so that the teams carry
 * comparable portfolios.
 */
const TEAMS = [
  { id: 'be', label: 'Team Bern', cantons: ['BE'] },
  { id: 'zh', label: 'Team Zürich', cantons: ['ZH'] },
  { id: 'nwch', label: 'Team Nordwestschweiz', cantons: ['BS', 'BL', 'JU', 'SH'] },
  { id: 'mitte', label: 'Team Mittelland', cantons: ['AG', 'SO'] },
  { id: 'zch', label: 'Team Zentralschweiz', cantons: ['LU', 'ZG', 'UR', 'SZ', 'OW', 'NW'] },
  { id: 'ost', label: 'Team Ostschweiz', cantons: ['SG', 'TG', 'AR', 'AI', 'GL'] },
  { id: 'gr', label: 'Team Graubünden', cantons: ['GR'] },
  { id: 'ti', label: 'Team Tessin', cantons: ['TI'] },
  { id: 'vd', label: 'Team Waadt', cantons: ['VD'] },
  { id: 'ge', label: 'Team Genf', cantons: ['GE'] },
  { id: 'frne', label: 'Team Freiburg–Neuenburg', cantons: ['FR', 'NE'] },
  { id: 'vs', label: 'Team Wallis', cantons: ['VS'] }
];

/*
 * The tenants. `uses` are what an office rents besides plain office space —
 * the line that makes a contract recognisably the office's own.
 */
const OFFICES = [
  { id: 'bakom', short: 'BAKOM', label: 'Bundesamt für Kommunikation', department: 'UVEK', weight: 6, uses: ['Sendeanlage', 'Messstation Funküberwachung'] },
  { id: 'baspo', short: 'BASPO', label: 'Bundesamt für Sport', department: 'VBS', weight: 8, uses: ['Sporthalle', 'Unterkunft', 'Trainingsanlage'] },
  { id: 'meteo', short: 'MeteoSchweiz', label: 'Bundesamt für Meteorologie und Klimatologie', department: 'EDI', weight: 6, uses: ['Wetterstation', 'Radarstandort'] },
  { id: 'bag', short: 'BAG', label: 'Bundesamt für Gesundheit', department: 'EDI', weight: 5, uses: ['Labor'] },
  { id: 'bfs', short: 'BFS', label: 'Bundesamt für Statistik', department: 'EDI', weight: 4, uses: ['Archiv'] },
  { id: 'bak', short: 'BAK', label: 'Bundesamt für Kultur', department: 'EDI', weight: 4, uses: ['Museum', 'Depot'] },
  { id: 'bafu', short: 'BAFU', label: 'Bundesamt für Umwelt', department: 'UVEK', weight: 5, uses: ['Messstation'] },
  { id: 'astra', short: 'ASTRA', label: 'Bundesamt für Strassen', department: 'UVEK', weight: 6, uses: ['Werkhof', 'Filiale'] },
  { id: 'bfe', short: 'BFE', label: 'Bundesamt für Energie', department: 'UVEK', weight: 3, uses: [] },
  { id: 'seco', short: 'SECO', label: 'Staatssekretariat für Wirtschaft', department: 'WBF', weight: 4, uses: [] },
  { id: 'blw', short: 'BLW', label: 'Bundesamt für Landwirtschaft', department: 'WBF', weight: 3, uses: ['Versuchsbetrieb'] },
  { id: 'estv', short: 'ESTV', label: 'Eidgenössische Steuerverwaltung', department: 'EFD', weight: 4, uses: ['Archiv'] },
  { id: 'bazg', short: 'BAZG', label: 'Bundesamt für Zoll und Grenzsicherheit', department: 'EFD', weight: 7, uses: ['Grenzübergang', 'Zollstelle', 'Unterkunft'] },
  { id: 'bit', short: 'BIT', label: 'Bundesamt für Informatik und Telekommunikation', department: 'EFD', weight: 4, uses: ['Rechenzentrum'] },
  { id: 'sem', short: 'SEM', label: 'Staatssekretariat für Migration', department: 'EJPD', weight: 6, uses: ['Bundesasylzentrum'] },
  { id: 'fedpol', short: 'fedpol', label: 'Bundesamt für Polizei', department: 'EJPD', weight: 4, uses: ['Ausbildungszentrum'] },
  { id: 'armasuisse', short: 'armasuisse', label: 'Bundesamt für Rüstung armasuisse', department: 'VBS', weight: 4, uses: ['Prüfstelle', 'Lager'] }
];
const BORDER_BOOST = 4;

/*
 * The three roles in every team, in the order the grid shows them. The
 * Treuhänder leads; the Bewirtschafter carries the most hours; the
 * Sachbearbeiter the steady paperwork.
 */
const ROLES = [
  { id: 'treuhand', label: 'Immobilientreuhänder', short: 'Treuhand', lead: true },
  { id: 'bewirtschaftung', label: 'Immobilienbewirtschafter', short: 'Bewirtschaftung', lead: false },
  { id: 'sachbearbeitung', label: 'Immobiliensachbearbeiter', short: 'Sachbearbeitung', lead: false }
];

const CONTRACT_COUNT = 2500;

/* Yearly rent in CHF: most contracts are small, a few carry the portfolio. */
const RENT_BANDS = [[[8e3, 60e3], 40], [[60e3, 300e3], 35], [[300e3, 1.5e6], 19], [[1.5e6, 8e6], 6]];

/*
 * How a contract runs. Most are fixed-term and roll over for the same term
 * when they end; the rest run until notice is given and have no end date.
 */
const TERMS = [[5, 30], [10, 30], [15, 10], [20, 5], [null, 25]];

/*
 * What a contract asks of each role, relative to the others, from the smallest
 * rent to the largest. Effort grows with the rent, but slower: a five-million
 * contract is not a hundred times the work of a fifty-thousand one.
 */
const EFFORT = { treuhand: [1, 8], bewirtschaftung: [2, 14], sachbearbeitung: [1.5, 9] };

/*
 * The renewal: in the quarters up to a contract's end the lead negotiates and
 * the paperwork piles up. Extra effort per role, in the same relative units,
 * for RENEWAL_SPAN quarters up to and including the quarter of the end date.
 */
const RENEWAL = { treuhand: 22, bewirtschaftung: 18, sachbearbeitung: 15 };
const RENEWAL_SPAN = 3;

/*
 * The relative units are scaled so that, over the window, the average team
 * member carries this much pensum. Employment is then set per person to fit,
 * which leaves some over their contract when renewals cluster.
 */
const MEAN_LOAD = 85;
const MEAN_UTILISATION = 0.9;

/* -----------------------------------------------------------------------------
   Dates
   -------------------------------------------------------------------------- */

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const label = date => date.split('-').reverse().join('.');
const FIRST = { year: +QUARTERS[0].id.slice(0, 4), q: +QUARTERS[0].id.slice(5) };

/* The index in the window of the quarter a date falls in; may be outside 0..Q-1. */
const quarterOf = date => {
  const [y, m] = date.split('-').map(Number);
  return (y - FIRST.year) * 4 + Math.floor((m - 1) / 3) - (FIRST.q - 1);
};

/* Leases end on a quarter's last day, the Swiss Kündigungstermin. */
const QUARTER_END = ['03-31', '06-30', '09-30', '12-31'];

/* -----------------------------------------------------------------------------
   Buildings and contracts
   -------------------------------------------------------------------------- */

const chf = n => `CHF ${Math.round(n).toLocaleString('de-CH').replace(/[’,]/g, '’')}`;

function contractTerms() {
  const term = weighted(TERMS);
  const startYear = between(1992, 2026);
  const end = QUARTER_END[between(0, 3)];
  const start = iso(startYear, +end.slice(0, 2) === 12 ? 1 : +end.slice(0, 2) + 1, 1);
  if (term === null) return { start, end: null, term: null };
  // The current end: the first roll-over that still lies ahead.
  let year = startYear + term;
  while (`${year}-${end}` < TODAY) year += term;
  return { start, end: `${year}-${end}`, term };
}

function buildingsAndContracts() {
  const buildings = [];
  const contracts = [];
  const usedAddresses = new Set();
  let buildingNo = 20001;
  let contractNo = 100001;

  while (contracts.length < CONTRACT_COUNT) {
    const canton = weighted(CANTONS.map(c => [c, c.weight]));
    const office = weighted(OFFICES.map(o => [o, o.weight * (o.id === 'bazg' && canton.border ? BORDER_BOOST : 1)]));
    let address;
    do {
      address = `${pick(PLACES[canton.lang])}, ${pick(STREETS[canton.lang])} ${between(1, 80)}`;
    } while (usedAddresses.has(address));
    usedAddresses.add(address);

    const building = { id: `G-${buildingNo++}`, label: address, canton: canton.id, officeId: office.id };
    buildings.push(building);

    // A building is let to one office, under the main lease and its additions.
    const special = office.uses.length && rnd() < 0.4 ? pick(office.uses) : null;
    const parts = [special || 'Büroflächen'];
    if (rnd() < 0.3) parts.push(pick(['Lagerflächen', 'Archivräume', 'Nebenräume']));
    if (rnd() < 0.25) parts.push('Parkplätze');

    for (const [i, part] of parts.entries()) {
      if (contracts.length >= CONTRACT_COUNT) break;
      const main = i === 0;
      const [lo, hi] = weighted(RENT_BANDS);
      const rent = round((lo + rnd() * (hi - lo)) * (main ? 1 : 0.08), 100);
      const { start, end, term } = contractTerms();
      const number = String(contractNo++);
      contracts.push({
        id: `mv${number}`,
        number,
        buildingId: building.id,
        canton: canton.id,
        officeId: office.id,
        title: `${address}, ${part} — ${main ? 'Hauptmietvertrag' : 'Nachtrag'}`,
        rent,
        rentLabel: chf(rent),
        start,
        end,
        endLabel: end ? label(end) : 'unbefristet',
        term
      });
    }
  }
  return { buildings, contracts };
}

/* -----------------------------------------------------------------------------
   Effort — what the contracts suggest, summed per canton and office
   -------------------------------------------------------------------------- */

/* 0 for the smallest rent, 1 for the largest, on a log scale. */
const sizeOf = rent => Math.min(1, Math.max(0, Math.log(rent / 8e3) / Math.log(8e6 / 8e3)));

/* Every quarter of the window in which this contract is up for renewal. */
function renewalQuarters(contract) {
  if (!contract.end) return [];
  const out = [];
  for (let end = quarterOf(contract.end); end < Q; end += contract.term * 4) {
    for (let q = end - RENEWAL_SPAN + 1; q <= end; q++) if (q >= 0 && q < Q) out.push(q);
  }
  return out;
}

/* A contract's effort per role and quarter, in relative units. */
function effortOf(contract) {
  const size = sizeOf(contract.rent);
  const renewals = renewalQuarters(contract);
  return Object.fromEntries(ROLES.map(({ id }) => {
    const [lo, hi] = EFFORT[id];
    const out = Array(Q).fill(lo + (hi - lo) * size);
    for (const q of renewals) out[q] += RENEWAL[id];
    return [id, out];
  }));
}

/* -----------------------------------------------------------------------------
   The team — three people per team, employment fitted to their load
   -------------------------------------------------------------------------- */

const FIRST_NAMES = ['Adrian', 'Barbara', 'Cédric', 'Doris', 'Emil', 'Franziska', 'Gian', 'Helen',
  'Ivo', 'Jasmin', 'Kurt', 'Lea', 'Marco', 'Nadja', 'Oliver', 'Priska', 'Roman',
  'Sabine', 'Thomas', 'Ursula', 'Valentin', 'Monika', 'Stefan', 'Nina', 'Lukas',
  'Regula', 'Matthias', 'Claudia', 'Pascal', 'Esther', 'Joël', 'Mélanie', 'Fabrice', 'Sandrine'];
const LAST_NAMES = ['Exempel', 'Vorlage', 'Probemann', 'Exempler', 'Vorlagli', 'Probst', 'Modèle', 'Esempi'];

const taken = new Set();
function person(i, role, teamId) {
  let name, guard = 0;
  do {
    name = `${FIRST_NAMES[(i * 7 + guard) % FIRST_NAMES.length]} ${LAST_NAMES[(i * 3 + guard) % LAST_NAMES.length]}`;
    guard++;
  } while (taken.has(name) && guard < 400);
  taken.add(name);
  const [first, last] = name.split(' ');
  return {
    id: (first + last).toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''),
    name,
    initials: first[0] + last[0],
    shortName: `${first} ${last[0]}.`,
    role: role.id,
    roleLabel: role.label,
    teamId,
    employment: 100,
    baseLoad: Array(Q).fill(0)
  };
}

/* -----------------------------------------------------------------------------
   Run
   -------------------------------------------------------------------------- */

const { buildings, contracts } = buildingsAndContracts();
const teamOf = Object.fromEntries(TEAMS.flatMap(t => t.cantons.map(c => [c, t])));

/*
 * The planning unit: one canton, one office. Its demand per role is what the
 * contracts underneath suggest, which is where a planner would start; the app
 * lets them overwrite it.
 */
const cells = new Map();
for (const c of contracts) {
  const key = `${c.canton.toLowerCase()}-${c.officeId}`;
  if (!cells.has(key)) {
    cells.set(key, {
      id: key, canton: c.canton, officeId: c.officeId, teamId: teamOf[c.canton].id,
      contracts: 0, rent: 0, renewals: 0,
      raw: Object.fromEntries(ROLES.map(r => [r.id, Array(Q).fill(0)]))
    });
  }
  const cell = cells.get(key);
  cell.contracts++;
  cell.rent += c.rent;
  if (c.end && quarterOf(c.end) < Q) cell.renewals++;
  const effort = effortOf(c);
  for (const { id } of ROLES) effort[id].forEach((v, q) => { cell.raw[id][q] += v; });
}

/*
 * One scale per role, so the average team member carries MEAN_LOAD. Every
 * allocation carries at least one per cent — a contract nobody spends time on
 * is not administered — and that floor adds load, so the scale is found by
 * a few rounds of correction rather than in one division.
 */
const FLOOR = 1;
const scaled = (v, k) => Math.max(FLOOR, Math.round(v * k));
const scale = Object.fromEntries(ROLES.map(({ id }) => {
  const target = MEAN_LOAD * TEAMS.length * Q;
  let k = target / [...cells.values()].reduce((a, cell) => a + cell.raw[id].reduce((s, v) => s + v, 0), 0);
  for (let round = 0; round < 8; round++) {
    const total = [...cells.values()].reduce((a, cell) => a + cell.raw[id].reduce((s, v) => s + scaled(v, k), 0), 0);
    k *= target / total;
  }
  return [id, k];
}));

const people = [];
for (const [t, team] of TEAMS.entries()) {
  team.members = {};
  for (const [r, role] of ROLES.entries()) {
    const p = person(t * ROLES.length + r, role, team.id);
    team.members[role.id] = p.id;
    people.push(p);
  }
}
const peopleById = Object.fromEntries(people.map(p => [p.id, p]));

const allocations = [...cells.values()]
  .sort((a, b) => a.canton.localeCompare(b.canton) || a.officeId.localeCompare(b.officeId))
  .map(cell => {
    const team = TEAMS.find(t => t.id === cell.teamId);
    const demand = Object.fromEntries(ROLES.map(({ id }) =>
      [id, cell.raw[id].map(v => scaled(v, scale[id]))]));
    for (const { id } of ROLES) demand[id].forEach((v, q) => { peopleById[team.members[id]].baseLoad[q] += v; });
    return {
      id: cell.id, canton: cell.canton, officeId: cell.officeId, teamId: cell.teamId,
      contracts: cell.contracts, rent: cell.rent, rentLabel: chf(cell.rent), renewals: cell.renewals,
      demand
    };
  });

/* Employment fitted to the load, in steps the HR system knows. */
for (const p of people) {
  const mean = p.baseLoad.reduce((a, b) => a + b, 0) / Q;
  p.employment = Math.min(100, Math.max(50, round(mean / MEAN_UTILISATION / (0.85 + rnd() * 0.3), 10)));
}

/*
 * A vacancy, as the projects have contracts without a lead: one team whose
 * Sachbearbeiter has left and not been replaced. The work does not go away;
 * the team's allocations still carry it, under nobody's name.
 */
const vacant = TEAMS.find(t => t.id === 'gr');
people.splice(people.findIndex(p => p.id === vacant.members.sachbearbeitung), 1);
vacant.members.sachbearbeitung = null;

write('meta', {
  domain: 'Mietverträge',
  unit: 'Immobilienmanagement',
  roles: ROLES,
  teams: TEAMS,
  cantons: CANTONS.map(({ id, label }) => ({ id, label })),
  offices: OFFICES.map(({ id, short, label, department }) => ({ id, short, label, department })),
  settings: { renewalSpan: RENEWAL_SPAN }
});
write('buildings', buildings);
write('contracts', contracts);
write('allocations', allocations);
write('people', people);

/* -----------------------------------------------------------------------------
   Report — enough to judge a run without opening the app
   -------------------------------------------------------------------------- */

const rentTotal = contracts.reduce((a, c) => a + c.rent, 0);
const dated = contracts.filter(c => c.end);
console.log(`${contracts.length} contracts in ${buildings.length} buildings, ${chf(rentTotal)} a year`);
console.log(`${dated.length} with an end date, ${dated.filter(c => quarterOf(c.end) < Q).length} of them ending inside the window; ` +
  `${contracts.length - dated.length} unbefristet`);
console.log(`${allocations.length} allocations (canton × office), ${people.length} people in ${TEAMS.length} teams\n`);
console.log('team'.padEnd(26) + 'cantons'.padEnd(18) + 'contracts  ' + ROLES.map(r => r.short.padEnd(18)).join(''));
for (const team of TEAMS) {
  const mine = allocations.filter(a => a.teamId === team.id);
  const cols = ROLES.map(({ id }) => {
    const p = peopleById[team.members[id]] && people.includes(peopleById[team.members[id]]) ? peopleById[team.members[id]] : null;
    const load = QUARTERS.map((_, q) => mine.reduce((a, m) => a + m.demand[id][q], 0));
    const tag = p ? `${Math.min(...load)}–${Math.max(...load)}/${p.employment}` : `${Math.min(...load)}–${Math.max(...load)}/vakant`;
    return tag.padEnd(18);
  });
  console.log(team.label.padEnd(26) + team.cantons.join(' ').padEnd(18) +
    String(mine.reduce((a, m) => a + m.contracts, 0)).padStart(9) + '  ' + cols.join(''));
}
const over = people.filter(p => Math.max(...p.baseLoad) > p.employment).length;
console.log(`\nload range per quarter / employment, in %; ${over} of ${people.length} people over their contract at some point`);

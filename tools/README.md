# tools

## `generate-portfolio.js`

Builds the demonstration portfolio in `data/`. Node, no dependencies:

```
node tools/generate-portfolio.js
```

It prints what it made — projects, roster, the demand and capacity curves,
utilisation per quarter, milestone counts — so a run can be judged without
opening the app.

### Repeatable

The generator reads its **seed** from `tools/seed/` and never from `data/`. That
matters: it used to read `data/projects.json`, append a hundred generated
projects and write the result back, so a second run produced two hundred and
eleven projects out of a hundred and eleven. The header claimed determinism; the
file was not reproducible.

`tools/seed/` holds the hand-written core the wireframe tells its story with —
eleven projects, six named people, their gates, and the nine change-log entries
the landing page shows. Those keep their identity (address, lead, credit,
priority) but their timelines are generated like every other, or they would be
the only projects in the portfolio still finishing inside a year.

The roster had the same fault as the projects and it was harder to see:
`makeTeam` read `data/people.json` and only ever *added* to it, so a team that
had once grown could not shrink again. A smaller portfolio kept the larger team
and the peak quietly slid from 112 % to 95 % — the one number the story rests
on, wrong for a reason nothing in the output pointed at.

Randomness comes from one seeded generator (`mulberry32`, seed `0x5bb1e1d`), so
the same input gives the same output. Changing anything that draws from it —
a weight, a duration, the order of two calls — reshuffles everything after it.

### The window

`QUARTERS = 40`, starting Q3/2026, so the plan runs to Q2/2036. The calendar, the
absence pattern and the hiring curve are all derived from that one number;
`meta.json`'s quarter list is written by the generator, so the app and the data
cannot disagree about how long the horizon is.

Ten years, because that is how long the thing being planned takes. At eighteen
quarters forty-two of a hundred and eleven projects simply ran off the edge, and
the load curve fell away in 2030 because the paper stopped, not because the work
did — which is the one thing a plan must never look like.

The app does not show all forty at once. `WINDOW_COLUMNS` in `js/store.js` fixes
how many columns a grid builds per scale — **12 years, 16 quarters, 24 months** —
at one shared column width, so the frozen block does not move when the reader
switches scale. What lies outside is reached by the arrows or by panning.

One consequence nothing else documents: the horizon is eleven calendar years, so
at year scale all of it already fits inside the twelve-column window. `maxOffset()`
is therefore 0 there and the arrows are inert — only the grid pans. Seeing the
whole plan at once is what the A0 report is for.

### The shape of a project

Every project has the whole chain, `Vorstudien` through `61`: the six
Teilphasen as ePPM names them — Vorstudien, 22, 31, 32, 53, 61. What differs
is how long each phase takes and when the first one began. The list is read
from `data/phases.json`; it is the one place the order lives, and the app
reads the same file for its filter and its grouping.

ePPM's full value list reads Vorstudien, 1, 22, 2, 31, 3, 32, 4, 53, 5, 61, 6:
phase, gate, phase, gate. The Hauptphasen 1 to 6 are not phases a project
sits in but the gates between the Teilphasen — 1 closes Vorstudien, 2 closes
22, and so on to 6, which closes 61 — and they are the milestone catalogue in
`tools/seed/milestones.json`. The last Teilphase, 61 Betrieb, is what happens
to the building afterwards; it carries next to no demand and is in the chain
so a finished project still has a phase.

`LAST_START = 2`: nothing begins after Q1/2027. A project two years out is not in
this tool, it is a line in a Botschaft — no Auftrag, no lead, no pensum. So the
portfolio drains: 112 % today, falling through the ten years as projects are
handed over and nothing new arrives to replace them. That taper is a finding,
not a gap in the data.

### How long a project takes

`DURATION` gives each phase a range in quarters, before the project's own pace
is applied:

| Phase (ePPM) | Quartale | woher |
|---|---|---|
| Vorstudien | 1–3 | |
| 22 Auswahlverfahren | 3–5 | an open design competition runs about twelve months, and the award follows it |
| 31 Vorprojekt | 2–4 | |
| 32 Bauprojekt | 4–8 | the Bauprojekt and its permit: 140–160 days on average in 2023, a year in the cities, much longer with an objection |
| 53 Inbetriebnahme | 6–16 | tender to commissioning: a Teilsanierung inside two years, a Gesamtsanierung of a building that stays in use, four or more |
| 61 Betrieb | 4–8 | |

The gates, each at the end of the Teilphase it closes: 1 Strategische Planung
closes Vorstudien, 2 Vorstudien closes 22, 3 Projektierung closes 31, 4
Ausschreibung closes 32 (the construction credit is released there), 5
Realisierung closes 53, 6 Bewirtschaftung closes 61.

`paceOf(size)` multiplies all of them. Money is half of it — a three-million
Instandsetzung is decided and built while a thirty-million Gesamtsanierung is
still in its permit procedure. The other half is a separate draw for everything
money does not explain: a listed façade, a site that stays in operation through
the work, an objection that goes to court. End to end a project runs roughly six
to fourteen years.

The chain always runs to the end, however far past the window that is. Stopping
at the edge meant a project beginning in 2029 was generated with two phases and
no end — the plan claimed it was finished when it had only run out of paper.
What lies beyond is dropped when the bars are written, and the last bar still
inside is marked as continuing.

Build the chain once and **shift** it; do not draw it twice. `chain()` rolls new
durations on every call, so measuring a chain and then rebuilding it placed a
twenty-quarter project as though it were thirty — far enough off the near edge
that one project came out with no bars at all.

### What is deliberately wrong

A demonstration portfolio has to show the problems the tool exists for:

- **Gates with no forecast at all.** Not late — undated. This is what actually
  stalls a project for years, and it clusters where the decision is not the
  office's to make: on the Bedürfnis and on the Baukredit.
- **Late gates**, each with a reason drawn from `REASONS`.
- **Projects with no lead**, because that case has to stay visible.
- **People over their contract**, because the peak is what the tool is for.

The team is not guessed at: the roster is solved for, so that the portfolio at
full stretch runs at `PEAK_UTILISATION`.

### Dates, not quarters

A gate falls on a day. `dayNearEnd(qi)` picks one in the last three weeks of
the quarter the phase ends in, because that is when boards sit and credits are
released — and because the view draws each diamond at its date: picked anywhere
in the quarter, a gate stood up to eleven weeks short of the bar it closes and
read as a milestone inside the phase. The view draws the plan date, not the
forecast; a late forecast is in the dialog and the dashboard, not on the bar.

### What it writes

`data/meta.json` (the quarter list only), `projects.json`, `people.json`,
`capacity.json`, `milestones.json`, `dashboard.json`, `changes.json`. A person
carries their organisation; a project does not — the app joins it on the
assignee (see `docs/DATAMODEL.md`). The organisations in `meta.json` come from
the generator's `TEAMS` table, each with its `projectShare`; the generator
writes that figure out but still sizes and balances the team against whole
contracts.

Everything else in `data/` is hand-written and untouched: `i18n.json`,
`phases.json`, `print.json`, `openapi.json`.

### After a run

The app reads the files directly, so a reload is enough. Worth checking:

- the utilisation line the generator prints — a peak somewhere above 100 with
  room around it, not a flat wall
- `docs/` for the review that covers whatever you changed
- the harness, if you have it: the flow suite asserts the horizon rather than a
  fixed number of quarters, so it survives a wider window

## `generate-tenancy.js`

Builds the mock portfolio of tenancy agreements in `data/tenancy/` — the second
planning domain next to the building projects. Node, no dependencies:

```
node tools/generate-tenancy.js
```

It reads only `data/meta.json`, for the quarter list and `today`, so both
domains plan against the same forty quarters. Seeded like the portfolio
generator, so a run is repeatable.

### The planning unit

The work is organised by canton: a team of three — Immobilientreuhänder (the
lead), Immobilienbewirtschafter, Immobiliensachbearbeiter — takes every contract
in its cantons. With some 2500 contracts nobody books a pensum per contract, so
the plan sits one level up: **one allocation per canton and federal office**,
with a per-quarter pensum for each of the three roles. Since a canton has one
team, the role names the person. The contracts stay underneath as the evidence:
what is let, at what rent, and when it runs out.

### What it writes

| File | Content |
| --- | --- |
| `meta.json` | `roles[]` (`treuhand`, `bewirtschaftung`, `sachbearbeitung`); `teams[]` — `{ id, label, cantons[], members }`, `members` maps role to person id, `null` for a vacancy; `cantons[]`; `offices[]` — `{ id, short, label, department }` |
| `contracts.json` | `{ id, number, buildingId, canton, officeId, title, rent, rentLabel, start, end, endLabel, term }` — `title` is the Vertragsbezeichnung, `rent` the yearly rent in CHF, `end` the Enddatum (ISO, `null` for unbefristet), `term` the roll-over term in years |
| `buildings.json` | `{ id, label, canton, officeId }`; a building is let to one office |
| `allocations.json` | `{ id, canton, officeId, teamId, contracts, rent, rentLabel, renewals, demand }` — `id` is `canton-office` (`be-bakom`), `contracts`/`rent`/`renewals` summarise the contracts underneath, `demand` is a per-quarter array per role in % of a full position |
| `people.json` | `{ id, name, initials, shortName, role, roleLabel, teamId, employment, baseLoad[] }` — `baseLoad` is the sum of the person's allocations |

### The shape of the work

An allocation's demand is what its contracts suggest — the starting value a
planner would overwrite. A contract's effort per role grows with the rent on a
log scale (`EFFORT`). On top comes the renewal: the `RENEWAL_SPAN` quarters up
to and including the quarter of the Enddatum carry extra effort (`RENEWAL`).
A fixed-term contract rolls over for the same term, so a five-year lease peaks
twice in the window; an unbefristet one never does. Leases end on a quarter's
last day.

The relative units are scaled so the average team member carries `MEAN_LOAD`,
and each person's employment is fitted to their load (50–100 %, in steps of
ten). Cantons are grouped into teams in `TEAMS` so the portfolios are
comparable; where a team's load is more than three full positions can carry,
the overload stays visible. Team Graubünden has no Sachbearbeiter.

The effort table, the renewal peak and the team grouping are assumptions of the
mock, not figures from the office.

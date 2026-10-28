# Architecture

What a new developer needs before touching anything. Rules and their reasons are
in `DECISIONS.md`; this file is the map.

## Shape

No bundler, no framework, no dependencies. `index.html` at the repository root
loads ES modules directly, which is what makes GitHub Pages enough to host it.
Data is static JSON under `data/`, fetched once at boot; nothing writes to disk.

The app must be served over HTTP — `fetch` refuses `file://`. Any static server
will do.

```
index.html
css/tokens.css      design tokens, two layers
css/main.css        everything else
js/                 twelve modules, see below
data/               eleven JSON files, seven of them generated
tools/              the portfolio generator; see tools/README.md
```

## Module layers

The graph is acyclic and each module imports only from lower layers. Keeping it
that way is the point.

| Layer | Module | Job |
|---|---|---|
| 0 | `store.js` | State, the URL, and every derived figure. **Imports nothing.** |
| 0 | `icons.js` | Lucide sprites |
| 0 | `pdf.js` | Writes a PDF by walking rendered sheets |
| 1 | `columns.js` | The column registry |
| 1 | `tenancy.js` | Derived figures of the Mietverträge tab: pensum with edits, people's load, end dates, filtering and grouping |
| 2 | `ui.js` | The `html` template layer, and every shared control |
| 3 | `views-schedule.js` | The bar plan's row: bars and gates on a time track, and the band the grid draws under its figures |
| 3 | `views-overview.js`, `views-analysis.js`, `views-modals.js`, `export.js` | One view each; the Planung grid imports the band from the row module |
| 3 | `views-tenancy.js` | The Mietverträge tab, its editor and its two dialogs (contracts, person) |
| 4 | `views-docs.js` | The printed sheets; reuses the Gantt row |
| 5 | `app.js` | Boot, render loop, event dispatch |

`store.js` importing nothing is a constraint, not an accident. It is why a
derived figure cannot quietly acquire a German label or a DOM identifier — see
the first finding in `CODE-REVIEW-3.md` for what happens when it does.

## Rendering

### The template layer

`ui.js` exports a tagged template literal:

```js
html`<span class="${cls}">${project.title}</span>`
```

- **Everything interpolated is escaped.** This is the default and it has no
  exceptions worth memorising.
- `raw(s)` opts out. Eighteen call sites; every one passes a literal or the
  output of another `html` call. **Never pass data through `raw()`** — and never
  into an attribute, which is the one hole a review found and closed.
- `attr(cond, 'disabled')` emits a bare attribute fragment, because a boolean in
  a `${}` slot renders the empty string and `disabled=""` is still disabled.

### The re-render

Every state change rebuilds the whole of `#app` into `innerHTML`. This is a
deliberate simplification — no diffing, no keys, no component lifecycle — and it
has consequences that are not bugs:

- **CSS `animation` replays on every render.** Measured: a 700 ms entrance
  animation restarts each time. Do not use animation to carry meaning.
- **CSS `transition` never fires on a state change**, because the element is new.
  Only `:hover` and `:focus` transitions work.

### What must survive a render

This list is the contract. Adding to it is cheap; discovering it one feature at a
time is what happened instead, four times.

1. **Focus**, keyed by `data-fk` — `captureFocus` / `restoreFocus` in `app.js`.
2. **The caret position** inside the focused field.
3. **Vertical scroll** — `window.scrollY`.
4. **Horizontal scroll** of every `[data-scroll]` container and the mobile
   toolbar — `captureScroll` / `restoreScroll`. Deliberately *dropped* when
   `scale` or `periodOffset` changes, because the same pixel offset then means a
   different date.

Anything that must outlive a render belongs in `state`, never on a DOM node.
A lock written as `el.disabled = true` protects nothing.

Anything that collects DOM nodes and then `await`s must collect **after** the
await and filter by `isConnected`.

## The Planung tab and its views

One tab draws both the pensum figures and the bar plan. The bar plan is a
*band* inside each pensum row — `phaseBand()` in `views-schedule.js`, placed
by the same `unitAt` arithmetic as the printed Gantt row — and what the row
shows is a set of four **layers**: `values`, `phases`, `gates`, `today`.

A **view** is a name for a set of layers (`VIEW_PRESETS` in `store.js`):
Pensum, Pensum + Termine, Termine, and Benutzerdefiniert for any other combination.
`state.view` and `state.layers` are always written together, through
`viewPatch()` and `layerPatch()`; flipping a layer renames the view from what
the layers now say, so the menu never claims a view it is not showing.
`tab=schedule` in an old link resolves to Planung in the Termine view.

The stylesheet reads the layers as classes on `.grid-card` (`is-values-off`,
`is-bars-off`, `is-gates-off`, `is-uncoloured`) and derives everything else
from two custom properties, `--band-h` and `--values-h`. Do not add a third
arrangement rule; change one of the two numbers.

Colouring by pensum (`state.colour`) is a switch of its own and means nothing
while the figures are hidden — `coloured()` is the one place that says so.

The chrome above the grid is measured for a 1366×768 laptop: one toolbar row
carries the filters, the time steps and the «Ansicht» menu; the tabs share a
line with the page actions; there is no breadcrumb bar and no page title.
The measurements are in the comments of the last three sections of
`main.css`, and in `docs/PLANUNG-MERGE.md`.

## The Mietverträge tab

A second planning domain beside the building projects, with its own data
(`data/tenancy/`, see `tools/README.md`) and its own roster. A team of three —
Treuhand, Bewirtschaftung, Sachbearbeitung — carries every contract in its
cantons, and the plan is one **allocation** per canton and federal office: a
pensum per role and quarter. The roughly 2500 contracts are not planned one by
one; they are listed behind each row, with the Enddatum that drives the peaks.

- The grid is grouped by team by default; under each team its three people
  as utilisation of their contract, a vacancy as the load nobody carries.
- The role switch shows one role's pensum or the team's (`all`, the sum).
- A cell opens an editor for that quarter with all three roles side by side;
  a raise that takes someone over 100 % needs a reason, as on Planung. Edits
  are `state.tOverrides`, keyed `allocationId:role:q`, and are logged to the
  Verlauf without a project.
- A dot marks a period in which a contract of that row ends; «Ablauf» counts
  the contracts ending within twelve months.

The search, the time window and the unit are shared with the project tabs; the
grouping, filters and sort are the tab's own. It has no export or print yet.

## Events

One delegated listener. Controls carry `data-act` (and usually `data-val`), and
`app.js` holds the dispatch table that maps the name to a function.

Dropdowns close on **`click`**, not `pointerdown`: closing on pointerdown
re-renders between press and release, the browser then produces no click event at
all, and every control needs clicking twice.

## State and the URL

`state` is one object in `store.js`, mirrored into the URL hash so a view can be
shared and reloaded — the Teilen dialog simply offers the address. A key is
written only when it differs from its default, so a plain `#?tab=overview` is
the untouched Planung tab. The language is not in it: a shared link opens in
the reader's own.

| Key | Carries | Values |
| --- | --- | --- |
| `tab` | the page | `overview`, `people`, `dashboard`, `history`, `tenancy`, `api`, `export` (`dashboard` with `bi=people` in old links still opens Personen) |
| `view` | the Ansicht preset | `pensum`, `pensum-termine`, `termine`, `custom` (`both` in old links still opens the combined view) |
| `layers` | the layers of Benutzerdefiniert, only with `view=custom` | any of `values,phases,gates,today` |
| `colour` | the heat ramp | `none` when off |
| `cols`, `barcols` | the columns of the pensum grid and of the bar plan on paper, when not the default | e.g. `title,lead,credit,organisation` |
| `zeros` | Nullwerte ausblenden | `hide` |
| `scale`, `from`, `unit` | the time scale, the window offset, the unit | `year`/`quarter`/`month`, a count, `pct`/`fte` |
| `sort`, `dir` | the grid sort | a column key or `q3`, `asc`/`desc` |
| `group` | Gruppieren nach | `portfolio`, `lead`, `phase`, `organisation`, `size`, `none` |
| `q`, `phase`, `lead`, `portfolio`, `org` | the search and the filters | ids, comma-separated |
| `psort`, `pdir`, `csort` | the person table's sort, the dashboard cards' order | a column or `q3`; `asc`/`desc`; `card:by:dir` per card |
| `page`, `pageSize` | the change log | numbers |
| `tgroup`, `role` | the Mietverträge grouping and the role its figures show | `team`/`canton`/`office`/`none`; `all`/`treuhand`/`bewirtschaftung`/`sachbearbeitung` |
| `team`, `canton`, `office` | the Mietverträge filters | ids, comma-separated |
| `tsort`, `tdir` | the Mietverträge sort | a column or `q3`; `asc`/`desc` |
| `sheet`, `paper`, `zoom` | the print preview | `portrait`/`landscape`, `a4`…`a0`, `fit`/`50`… |

`readUrl` returns a value for **every** URL-carried key — the hash's, or the
default — so a hash that has lost a key (Back, a hand-edited address) resets
that key rather than leaving the old value in place. Filter ids are checked
against the data, enumerated values against `VOCAB`, the window offset against
the horizon.

A change of tab pushes a history entry; every other change replaces the
current one. `setState` decides, by comparing the tab before and after, so no
action has to remember. Back and Forward arrive through `hashchange` and are
applied silently.

### Derived lists

`setState` counts every change of state. `filteredProjects()`, `periods()` and
the per-person project index are memoised against that counter, so a list is
computed once per change however many views ask for it in one render. Anything
that changes what a derived list would say **without** going through
`setState` — the search field, written per keystroke; a project's lead moved
by the picker — calls `touch()`. Every value read back from the hash is validated against
`VOCAB`, a closed vocabulary — an unknown value falls back to the default rather
than reaching a view.

Known gap: `writeUrl` enumerates its keys by hand and omits several, and the
history layer double-pushes. See “Still open” in `CODE-REVIEW-3.md`.

## Grids

The planning grid and the printed Gantt sheet are CSS Grid, one grid per row,
all rows sharing a single inline `grid-template-columns` string. Frozen columns
are `position: sticky` with an inline `left`.

**`columns.js` is the registry.** One declaration per column — width, alignment,
which tab shows it, how a cell renders, how it sorts, what the header says —
feeding six consumers. Add a column there and nowhere else.

`YIELD_ORDER` decides what is dropped as the window narrows. `id` is not in it:
it is the floor and never disappears.

## Time

`store.js` builds *period columns* for the current scale: `year`, `quarter` or
`month`. A period knows the quarters it covers and its `from`/`to` in fractional
quarter units.

- The horizon is 40 quarters, Q3/2026 – Q2/2036.
- A grid never shows all of it. `WINDOW_COLUMNS` fixes the count per scale —
  12 years, 16 quarters, 24 months — and the rest is reached by the arrows or by
  panning. All three use the same column width, so the frozen block does not move
  when the reader changes scale.
- **Positions inside the track are fractional.** A bar or a milestone is placed
  at its true position via `unitAt(cols, q)`, which reads a period's `from`/`to`.
  Rounding to whole columns is what put 212 bars on top of one another and every
  milestone on the wrong date.

## Print and PDF

`views-docs.js` lays out sheets in real millimetres, so what is on screen is what
prints. Five paper sizes, two orientations, both reports, three scales; the row
budget per combination is measured, not derived.

`js/pdf.js` walks those rendered sheets and writes a vector PDF by hand:
WinAnsi encoding, Helvetica width tables, horizontal scaling to the measured DOM
width. It exists because the browser print dialog cannot be steered — driver
paper size and unprintable margins override `@page`.

Two things to know before touching it:

- `getBoundingClientRect()` returns zoomed values and `getComputedStyle()` does
  not. The writer lifts `--sheet-zoom` to 1 for the duration of the walk. This
  trap has been hit twice.
- Only WinAnsi characters survive. `’` (U+2019) does; U+202F and U+2009 become
  `?`.

## i18n

`data/i18n.json` holds 388 terms in four languages, looked up through `t()` with
the German string as the key and as the fallback. A user-visible string that is
not passed through `t()` will be German in every language.

## Tokens

Two layers in `css/tokens.css`: primitives (`--blue-200`, `--steel-550`) feed
semantic roles (`--color-danger-bg`, `--color-bar-border`), and components use
the semantic layer. A component reaching a primitive directly is a smell; a new
meaning gets a new role.

Contrast is measured, not eyeballed: 4.5:1 for text, 3:1 for any boundary that
carries meaning (WCAG 1.4.11), 24 px minimum target height.

## Data

Seven of the eleven files in `data/` are generated — see `tools/README.md`.
`i18n.json`, `phases.json`, `print.json` and `openapi.json` are hand-written.

Which file carries which fact, and how they join, is in `DATAMODEL.md`.

Current fixtures: 111 projects, 50 people (4'540 % contracted), 40 quarters,
323 milestones (40 undated, 57 late), 249 history entries, 7 sub-portfolios,
6 organisations, 8 projects without a lead.

## Checks

The Playwright suites cited throughout `docs/` run from a harness that is **not
in this repository**. Figures quoted in the documents were measured with it; a
reader cannot currently reproduce them. Either commit the harness or stop citing
it — this is the weakest thing in the documentation and it is recorded here so it
is not forgotten.

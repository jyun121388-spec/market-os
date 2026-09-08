# V1 Delivery Gap Audit

Required by `[CHATGPT_DECISION][MARKET-V1-DELIVERY-DEFINITION-20260908]` (issue #2, comment
5576973065), which supersedes the core-only completion definition: backend, tests, provenance and
P0/P1 correctness being closed is explicitly **not** `100%` and **not** `V1 DELIVERED`.

Read-only. Performed on exact `bdecd3d976de1edefcf8ffe95d5534a324b931c0`, writer
`claude/ask-guardrail-architecture-20260823`, worktree clean. Nothing here was implemented; this
records what the tree actually contains.

State after this audit: `V1_CORE_CLOSED_CANDIDATE` + `V1_PRODUCTIZATION_OPEN`. Not delivered.

---

## The one-sentence finding

The engine is large and the product surface is nine pages, two server actions and zero API routes —
and the application's own root URL still serves the unmodified `create-next-app` starter.

---

## What actually exists

    src/app/page.tsx                    create-next-app template  (Next.js logo, "edit page.tsx")
    src/app/layout.tsx                  title "Create Next App", NO navigation chrome
    src/app/today/page.tsx              Morning Brief — regime, events, filings, changes, calendar
    src/app/company/page.tsx            flat list of every company with stored filings
    src/app/company/[corpCode]/page.tsx Company X-Ray — reported figures, filings, completeness
    src/app/ask/page.tsx                Ask Market — free-text box, guardrail redirect
    src/app/watchlist/page.tsx          add / list / remove
    src/app/login, /signup              auth
    src/app/admin/page.tsx              System Health — operator-only via ADMIN_EMAILS

    server actions   auth.ts, watchlist.ts                    (2)
    API routes       none                                     (0)
    components dir   none — every page is self-contained
    domain engines   43 modules under src/server/domain

Navigation exists **only** on `/today`, **only** when signed in, and links **only** to Companies,
Watchlist and Ask. There is no global nav, no route from `/` to anything, and no user-reachable
link to system health.

---

## Surface matrix

### 1. Home / Market Dashboard — `PRESENT_BUT_NOT_USER_READY`

|                     |                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing route      | `/today` (`src/app/today/page.tsx`, 175 lines)                                                                                                                                          |
| Engine behind it    | `buildMorningBrief` → `computeRegimeSnapshot`, `computeCalendar`, `getRecentObservationPair`, `evaluateStaleness`                                                                       |
| Current state       | Renders regime axes, recent events, recent filings, what-changed series and calendar, with `generatedAt`. Readable by anonymous visitors.                                               |
| Missing user wiring | It is not the home page — `/` is the starter template. No watchlist/interest items on it. No global nav to reach it. Freshness is a UTC timestamp, not a user-language staleness state. |
| V1 action           | Make this the root surface, add nav, surface the signed-in user's watchlist items, render staleness in words.                                                                           |

### 2. Korea / US Security & Company Search — `PRESENT_BUT_NOT_USER_READY`

|                     |                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing route      | `/company` (69 lines)                                                                                                                                                                                                                                                                                                               |
| Engine behind it    | `companyXray.listCompanies`, `findKnownCorpCodes`                                                                                                                                                                                                                                                                                   |
| Current state       | `listCompanies` groups over the `Filing` table and returns **every** company with stored filings, sorted by name. No search input, no filter, no pagination.                                                                                                                                                                        |
| Coverage, honestly  | Whatever has been ingested. DART supplies Korean issuers, EDGAR/EDGAR-XBRL supplies US issuers — but both are **credential- and run-gated**: DART needs `DART_API_KEY` (HG-004, `PENDING_USER`), EDGAR needs only a `EDGAR_USER_AGENT`. The universe is therefore _the filings this installation has ingested_, not "Korea and US". |
| Missing user wiring | A search box; an explicit statement of which universes are covered and why one may be empty; a per-source coverage indicator.                                                                                                                                                                                                       |
| V1 action           | Add search over the existing list; state coverage and its provider dependency on the page; never imply full Korea/US support.                                                                                                                                                                                                       |

### 3. Company Intelligence — split

| Element              | Classification               | Evidence                                                                                                                                      |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview             | `ALREADY_PRESENT_AND_USABLE` | `/company/[corpCode]`, 281 lines, `computeCompanyXray`                                                                                        |
| Key financials       | `ALREADY_PRESENT_AND_USABLE` | `ReportedFigure[]` from XBRL financial facts                                                                                                  |
| Sources / provenance | `PRESENT_BUT_NOT_USER_READY` | `listCompanySources` renders source codes; no link to the original filing                                                                     |
| Growth               | `UNSUPPORTED_BY_V1`          | No engine. `grep` for growth/profitability/margin in `src/server/domain` hits only NLP and guardrail modules, where they are query vocabulary |
| Profitability        | `UNSUPPORTED_BY_V1`          | as above                                                                                                                                      |
| Valuation summary    | `UNSUPPORTED_BY_V1`          | see surface 4                                                                                                                                 |
| Major risks          | `UNSUPPORTED_BY_V1`          | No engine                                                                                                                                     |

`companyXray.ts`'s own header states what it deliberately does not do: "no score, no rating, no
valuation", citing `docs/LEGAL_GUARDRAILS.md`. That is a design position, not an oversight.

### 4. Valuation — `UNSUPPORTED_BY_V1`

There is **no valuation engine in this repository**. No DCF, no multiples, no intrinsic-value
model, no assumptions structure, no output range. The only occurrences of the word are a
guardrail comment in `companyXray.ts` and a request-classification note in `askMarket.ts`.

This is the sharpest finding in the audit and it needs a decision rather than an implementation.
Building one is a new feature family with a legal surface — `docs/LEGAL_GUARDRAILS.md` forbids
definitive price predictions, and the delivery decision itself forbids adding new feature families
during productization. A valuation screen cannot be "wired up"; there is nothing behind it.

Escalated separately rather than guessed at.

### 5. Filings / Evidence — `ENGINE_EXISTS_UI_MISSING`

|            |                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engines    | `filingDiff` (5 exports), `claimLedger`, `claimStore`, `claimVerification`, adapters `edgar`, `edgar-xbrl`, `dart`                                                                                                                                                                                                                                            |
| Current UI | Recent filings listed on `/today` and on the company page — name, date, source code                                                                                                                                                                                                                                                                           |
| Missing    | **No link to any original filing.** The `Filing` model stores `receiptNo` (DART `rcept_no` / EDGAR accession), which is exactly what a canonical source URL is built from, and no page constructs one. `filingDiff` has a print script (`npm run filing-diff:print`) and no UI at all. Missing credentials surface as an empty list, not as a status message. |
| V1 action  | Render `receiptNo` as a source link per provider; add a filing-diff view over the existing engine; show a provider-status message where a list is empty because a key is absent.                                                                                                                                                                              |

### 6. Macro / Regime / Calendar — `ENGINE_EXISTS_UI_MISSING`

|                   |                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engines           | `macroRegime` (8 exports), `economicCalendar` (4), `seriesReadings`, `whatChanged`, `historicalAnalog` (4)                                                                                                                                                                                                                                                                                                 |
| Current UI        | Regime axes and calendar entries appear **inside** the Today brief. There is no dedicated macro page and no way to see a single indicator's history.                                                                                                                                                                                                                                                       |
| Missing           | A Macro surface; per-indicator detail; the existing uncertainty semantics (`UNVERIFIABLE`, refused dates, staleness) rendered rather than dropped.                                                                                                                                                                                                                                                         |
| Historical analog | **Must remain unavailable in the UI.** `[CHATGPT_DECISION][MARKET-ANALOG-ZERO-SPREAD-20260908]` and the delivery decision both hold it back until `[CLAUDE_APPLIED][MARKET-ANALOG-ZERO-SPREAD-20260908]` (comment 5584364561) is independently verified. `computeHistoricalAnalog` still has no production caller outside tests, which is currently the _reason_ its open limitations are not user-facing. |

### 7. Ask Market — `PRESENT_BUT_NOT_USER_READY` + `EXTERNALLY_GATED`

|                |                                                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing route | `/ask` (173 lines)                                                                                                                                                                                                                                                                      |
| Engine         | `askMarket` — subject authority, request grammar, guardrail screen, claim-backed factors                                                                                                                                                                                                |
| Current state  | Natural-language input; buy/sell requests are redirected, never answered; factors carry their sources. E2E proves both the refusal and the factual path.                                                                                                                                |
| Missing        | Provenance and uncertainty are present in the result type but thinly rendered; an unsupported request reads as a bare status rather than an explanation.                                                                                                                                |
| Gated          | Full free-text generation needs an LLM provider — **HG-006, `PENDING_USER`**. Not activated, and nothing here activates it. The GUI must say what the supported V1 behaviour is and that the fuller capability is unavailable, rather than leaving a terminal workaround as the answer. |

### 8. Data / System Health — `PRESENT_BUT_NOT_USER_READY`

|                |                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing route | `/admin` (129 lines), `computeSystemHealth`                                                                                                                                                                                                                         |
| Current state  | Source tiers, ingest completeness, ingest-run health, persisted ingest errors. Real content.                                                                                                                                                                        |
| Missing        | **Operator-only** — `isOperatorEmail` fails closed on an unset `ADMIN_EMAILS`, so on a normal install nobody can see it. No user-language version: an ordinary user has no way to learn that a provider is unconfigured or an ingest failed. No link from anywhere. |
| V1 action      | A user-facing status surface (last refresh, provider configured/not, stale sources, actionable wording), keeping `/admin` as the operator view it is.                                                                                                               |

---

## Windows delivery dependency inventory

| Requirement           | Present today                                                                                                                                                                         | Gap                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node runtime          | v24.14.0, developer-installed. `package.json` declares **no `engines` field**                                                                                                         | Must be pinned and bundled                                                                                               |
| Runtime dependencies  | Only **5**: `next`, `react`, `react-dom`, `@prisma/client`, `@prisma/adapter-pg`                                                                                                      | Small — this is what makes a light packaging layer viable                                                                |
| Database              | **Portable PostgreSQL 16.10 already vendored** at `.local/pgsql`, data dir `.local/pgdata`, port 55432                                                                                | Not installed system-wide, not service-registered, not started by anything but a developer command                       |
| Database creation     | Manual (`createdb` / psql)                                                                                                                                                            | Must be automated on first run                                                                                           |
| Migrations            | 17 under `prisma/migrations`                                                                                                                                                          | `prisma migrate deploy` is never run by anything but a person                                                            |
| Ingestion             | `npm run jobs:ingest-all` → `scripts/run-ingest-jobs.ts`, sequential subprocesses, 10-min timeout each                                                                                | Deliberately **not** a scheduler — the file says so, citing the deployment Human Gate. A user has no way to refresh data |
| Background services   | Control bus watcher (developer/agent tooling only)                                                                                                                                    | Not user-facing, must not ship enabled                                                                                   |
| Required config       | `DATABASE_URL`                                                                                                                                                                        | Must be produced by the installer, never typed by a user                                                                 |
| Optional config       | `FRED_API_KEY` (present, HG-002 resolved), `ECOS_API_KEY` (HG-003 pending), `DART_API_KEY` (HG-004 pending), `EDGAR_USER_AGENT` (keyless, just an identifying string), `ADMIN_EMAILS` | All are `.env` file edits today. Absent keys degrade to fixtures or empty lists with no explanation                      |
| Ports                 | `next` 3000 by default, PostgreSQL 55432                                                                                                                                              | No collision handling, no duplicate-launch detection                                                                     |
| Browser launch        | None                                                                                                                                                                                  | Launcher must open one _after_ readiness                                                                                 |
| Readiness             | None                                                                                                                                                                                  | Migrations and an HTTP probe must gate the browser                                                                       |
| Shutdown              | None                                                                                                                                                                                  | `pg_ctl stop` plus server stop must be a user action                                                                     |
| Restart / persistence | Data persists in `.local/pgdata`; sessions persist in the DB                                                                                                                          | Untested across a packaged install                                                                                       |
| Packaging artifact    | **None.** No `.bat`, `.cmd`, `.iss`, `.nsi`, no installer, no shortcut                                                                                                                | Everything                                                                                                               |
| `next.config.ts`      | Empty                                                                                                                                                                                 | `output: "standalone"` is the one line that makes a self-contained server bundle                                         |

### Smallest delivery architecture

Preserve Next.js/React exactly as it is. **Electron is not needed and is not proposed**: the
product is already a server plus a browser UI, the runtime dependency list is five packages, and
the database is already portable. A desktop rewrite would be a large architecture change bought
for nothing.

    Market OS shortcut  ->  launcher.exe / launcher.cmd
                            1. read config from %LOCALAPPDATA%\MarketOS\config.json
                            2. pg_ctl start on the bundled data dir (skip if already running)
                            3. wait for pg_isready
                            4. createdb if absent, then prisma migrate deploy
                            5. next start (standalone bundle, bundled node.exe) on a free port
                            6. poll until the server answers
                            7. open the default browser at the dashboard
                            8. tray/console window owns shutdown: stop server, pg_ctl stop

Installer: **Inno Setup**, one `.exe`, bundling the standalone Next build, a pinned portable Node,
and the already-vendored PostgreSQL 16.10. No paid hosting, no cloud dependency, no new service.

First-run configuration must be a GUI, and the honest way to do it without inventing a second
config system is: the launcher owns the config file and injects it as environment for the server
process; a `/setup` route writes that file and asks the launcher to restart the server. Secrets are
written to the user profile, never to the repository, never printed, never logged.

---

## Minimum serial implementation plan

Ordered. Each step is the smallest thing that makes the next one possible.

**A — Missing minimum GUI wiring.** Replace the starter `/` with the dashboard (or redirect to it);
give `layout.tsx` a real title and a global nav; add a company search input; render filing source
links from `receiptNo`; add a Macro/Regime/Calendar page over the existing engines; add a
user-facing Data/System Health surface; render provenance and uncertainty in Ask Market results.
No new engines. Historical analog stays out.

**B — First-run Setup GUI.** A `/setup` route: database status, provider configuration, an
`EDGAR_USER_AGENT` field, optional keys, and an explicit "what works without this" line per
provider. Reached automatically when required config is missing.

**C — Configuration and provider-status UX.** Every surface that can be empty because a provider is
unconfigured says so in user language and links to setup. No stack trace is ever the normal error
UX. Secret values are write-only in the GUI.

**D — Windows launcher and service readiness.** The eight-step sequence above, with duplicate-launch
detection by port and by a lock file, and the browser opened only after the readiness probe passes.

**E — Installation / packaging.** `output: "standalone"`, pin `engines.node`, bundle Node and the
vendored PostgreSQL, build the Inno Setup script, create desktop and Start-menu shortcuts.

**F — Safe shutdown and relaunch.** A user-visible stop that stops the server and the database
cleanly; relaunch reuses the same data directory.

**G — State persistence.** Config, ingested data and sessions survive a restart. Verified, not
assumed.

**H — Clean-install acceptance harness.** A written procedure plus the artifact identity, run from
an environment that is **not** this worktree, with no VS Code, Git, npm or Python step performed by
the user.

**I — GUI-only Golden Loop acceptance.** `Reality/Data → Company/Market Intelligence →
Decision/Analysis → Evidence/Verification → User Dashboard`, completed entirely through the browser
on the installed artifact, with stale still stale, unknown still unknown, unverifiable still
unverifiable, gated providers still visibly gated.

---

## What this audit does not authorise

No new provider families, no valuation engine, no advanced visualisation, no mobile app, no
Electron, no architecture expansion, no meta-autonomy, no speculative hardening. Core P2/P3 stays
V1.1 unless it blocks the delivery path above.

Two things need a decision before their surfaces can be built at all: **valuation** (surface 4, no
engine exists and the legal guardrails bear on it) and **historical analog** (surface 6, held until
`MARKET-ANALOG-ZERO-SPREAD-20260908` is independently verified).

# Current Task

MILESTONE: M20 — Today / Morning Intelligence

TASK: Per docs/PRODUCT_SPEC.md "Today / Morning Intelligence": a 5-minute daily brief covering
overnight events, KR-relevant variables, data to watch, filings, calendar, "what changed",
sources, confidence. This composes existing domain modules (eventClustering/M07,
whatChanged/M10, macroRegime/M11, economicCalendar/M12, Company X-Ray/M15, filingDiff/M16) into
one view — it does not ingest new data itself.

STATUS: Not started — M19 (Watchlist) complete and verified.

NEXT EXACT ACTION: Decide UI scope first (record in DECISIONS.md): the Next.js app currently
has only the M01 scaffold page, no real UI. Given the project's completion standard ("verify
the actual user path, not just code existing"), M20 should ship a real minimal page
(src/app/today/page.tsx or similar) that calls a server-side buildMorningBrief() composition
function and renders it — not just another untested data module. Keep the UI simple (per
docs/PRODUCT_SPEC.md's UX principle: show what changed and why, not everything) — a plain
server-rendered list is sufficient for V1, no client-side framework additions needed. Verify by
actually starting the dev server and loading the page, not just unit-testing the data function.

# Current Task

MILESTONE: M03 — FRED / US macro adapter

TASK: Build `src/server/adapters/fred/` — fetch a small set of key series (e.g. DGS10, DGS2,
DXY-equivalent series, CPI) from the FRED API, normalize into Observation rows via the M01/M02
schema, with a fixture-based test path when `FRED_API_KEY` is unset (see docs/DATA_POLICY.md
"Adapter architecture" — adapters must work without live secrets using mock/fixture data).

STATUS: Not started — M02 complete and verified.

NEXT EXACT ACTION: Design the adapter interface (fetch raw payload -> typed raw shape), add a
recorded-fixture integration test, then a normalization function feeding the Observation model
with correct timezone/date handling per docs/DATA_POLICY.md's financial-data checklist.

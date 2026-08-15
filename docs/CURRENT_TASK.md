# Current Task

MILESTONE: M04 — ECOS (Bank of Korea) macro adapter

TASK: Build `src/server/adapters/ecos/` mirroring the FRED adapter shape
(client.ts/types.ts/normalize.ts/ingest.ts/__fixtures__/) for Korean macro series (e.g. base
rate, KRW/USD). ECOS uses a different missing-value convention and KST-dated releases — do not
assume FRED's conventions carry over uncritically; verify against ECOS's actual documented API
response shape before writing normalize.ts.

STATUS: Not started — M03 (FRED adapter) complete and verified.

NEXT EXACT ACTION: Look up the real ECOS StatisticSearch API response shape (fields, date
format, missing-value marker) before writing types.ts, so the adapter isn't built against
assumptions. Then follow the same client/normalize/ingest/test structure as
src/server/adapters/fred/.

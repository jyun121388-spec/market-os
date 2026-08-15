# Data Policy

## Cost policy
No paid data source, paid crawling service, or paid API is activated without explicit human
approval — including "free tier requires a card" cases (treated as a Human Gate). Absence of
paid data does not block development: build the adapter + mock/fixture, mark the real
credential as a Human Gate.

## Priority sources (free, official-first)
**Korea**: 한국은행 ECOS, KOSIS, OpenDART, 공공데이터포털, 국토교통부(MOLIT) 공개데이터.
**USA**: FRED, SEC EDGAR, BLS, BEA, U.S. Treasury, Federal Reserve official releases.
**Global**: IMF, World Bank, OECD, other central banks / official statistics agencies.

## News policy
No paywall bypass, no access-restriction bypass, no bulk full-text republishing of articles as
own content. News/metadata is used as an **event-detection sensor**, verified against official
sources, and only then does Market OS add its own analysis:
```
NEWS/METADATA -> EVENT DETECTION -> OFFICIAL SOURCE VERIFICATION -> OWN ANALYSIS
```

## Source hierarchy (Tier S/A/B/C/D)
See `ARCHITECTURE.md` "Source hierarchy". Every stored source record carries a `source_tier`.

## Data conflicts
Never silently pick one of several disagreeing source values. Store a `DATA_CONFLICT` record
(source A, source B, official source if identifiable, timestamps, revision status) instead.

## Financial data correctness checklist (test every adapter/normalization against this)
timezone (UTC vs KST), observation date vs release date, revised vs preliminary/final,
percentage vs decimal, basis points, currency, thousand/million/billion scale, missing values
vs null, stale vs fresh data, duplicate observations, cross-source mismatch. Stale data must
never be displayed as current.

## Adapter architecture
One adapter per source under `src/server/adapters/<source>/`. Adapters only fetch + return raw
payloads in a documented shape; they do not interpret or infer. New sources — paid or free — are
added as new adapters without touching normalization/fact/inference layers.

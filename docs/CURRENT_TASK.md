# Current Task

MILESTONE: M18 — Real Estate Intelligence (Korea)

TASK: Per docs/PRODUCT_SPEC.md "Real Estate Intelligence": 매매/전세/거래량/실거래가/금리/
인허가/착공/입주/미분양/공급/경매 (sale/jeonse prices, transaction volume, actual transaction
prices, rates, permits, construction starts, move-ins, unsold inventory, supply, auctions)
using Korean public data. Candidate sources already in the M02 seed registry but never probed:
국토교통부(MOLIT) 실거래가 공개시스템, 공공데이터포털(data.go.kr).

STATUS: Not started — M17 (ETF X-Ray, schema+guardrail only) complete and verified.

NEXT EXACT ACTION: WebFetch-probe MOLIT's real-transaction-price API
(https://www.data.go.kr or a direct rt.molit.go.kr endpoint) for reachability before designing
anything — same discipline as every prior milestone. Given this session's pattern so far (every
Korean/US financial-data domain tested — ecos.bok.or.kr, opendart.fss.or.kr, data.sec.gov,
api.stlouisfed.org — has been egress-blocked), budget for the likely outcome: if blocked, scope
M18 down to schema + a deterministic domain-logic module (e.g. price-index change calculation
reusing seriesReadings.ts) tested against seeded fixture data, mirroring M12/M17's approach,
rather than spending excess effort on repeated reachability probes once the pattern is clear.

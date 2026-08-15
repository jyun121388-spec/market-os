# Current Task

MILESTONE: M12 — Economic Calendar

TASK: Per docs/PRODUCT_SPEC.md "Economic Calendar": release time, previous/consensus/actual/
surprise/revision, importance, linked variables, initial market reaction. This needs a data
shape none of the M03-M06 adapters provide as-is: FRED/ECOS give realized historical values,
not a forward-looking release schedule with consensus estimates. A real economic calendar
needs either (a) a dedicated calendar data source (many are paid — check
docs/DATA_POLICY.md's cost policy before assuming one is usable), or (b) a deterministically
derived calendar from known release patterns of already-tracked series (e.g. CPI/UNRATE release
on a predictable monthly schedule) without consensus/surprise data, which is a materially
smaller feature than the full spec describes.

STATUS: Not started — M11 (Macro Regime Engine) complete and verified.

NEXT EXACT ACTION: Research whether a genuinely free economic calendar data source exists
(check reachability first, same discipline as M04-M06 — several candidate domains in this
project have turned out to be egress-blocked in this dev environment). If nothing free and
reachable provides consensus/surprise data, scope M12 down explicitly (schema + "next expected
release date" derived from historical release cadence of tracked series, marking
consensus/surprise/actual as a documented future gap) rather than blocking the milestone
entirely or fabricating consensus numbers that don't exist. Record whichever path is chosen in
docs/DECISIONS.md before writing schema.

# Current Task

MILESTONE: M02 — Source/data model

TASK: Build on the M01 schema skeleton (Source, Series, Observation, DataConflict, Claim) with:
seed data for initial Tier S sources (FRED, ECOS, DART, SEC EDGAR, BOK, KOSIS...), any missing
fields identified while building the first real adapter (M03), and broaden integration test
coverage for DataConflict handling and revision tracking.

STATUS: Not started — M01 complete and verified.

NEXT EXACT ACTION: Add a seed script (`prisma/seed.ts`) registering the initial source registry
with correct SourceTier values, add an integration test for the DataConflict flow, then proceed
to M03 (FRED adapter) which will validate the schema against real data.

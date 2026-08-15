# Current Task

MILESTONE: M07 — Event model + news-intelligence foundation

TASK: Design and build the Event Intelligence groundwork per docs/ARCHITECTURE.md /
docs/PRODUCT_SPEC.md "Event Intelligence": cluster many articles/mentions of the same real-world
event into one Event record with confirmed facts, disputed claims, primary source, significance,
and affected variables (linking to Series/Filing where relevant). This is the first milestone
past the source-adapter pattern (M03-M06 are done) — it's new domain modeling, not another
adapter.

STATUS: Not started — M06 (SEC EDGAR adapter) complete and verified. All planned macro/filing
adapters (FRED, ECOS, DART, EDGAR) are now done.

NEXT EXACT ACTION: Design the Event/EventMention (or similar) Prisma schema addition — an Event
has a topic, first_seen, latest_update, source_count, significance, affected variable
references; an EventMention links a specific news/metadata item (title, url, source_tier,
published_at) to an Event. Per docs/DATA_POLICY.md "News policy", store metadata (title, url,
source, timestamp) — never bulk-copy full article text. No news API is wired yet in this
environment; the M07 scope for this dev environment is the schema + clustering logic + tests
using fixture data, not a live news source integration (that would be its own adapter,
analogous to M03-M06, and can follow once a suitable free news/metadata source is identified).

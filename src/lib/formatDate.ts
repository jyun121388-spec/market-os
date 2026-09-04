/**
 * Server-rendered timestamps must not depend on the server process's local timezone — Next.js
 * Server Components render `toLocaleString()` using the SERVER's timezone/locale, not the
 * viewing user's, and this codebase stores every date-only value (ECOS/DART/EDGAR observation
 * and receipt dates) as UTC midnight rather than as a KST instant (see
 * `src/server/adapters/ecos/normalize.ts`/`dart/normalize.ts`). Displaying with an unspecified
 * timezone would make the same underlying data render differently depending on where the app
 * happens to be deployed — explicit UTC keeps it deterministic. Whether user-facing display
 * should eventually be KST (this product's primary market) instead of UTC is a real product
 * decision, not made here — see docs/DECISIONS.md.
 */
export function formatTimestampUtc(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

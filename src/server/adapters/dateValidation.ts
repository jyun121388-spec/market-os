/**
 * P1 hardening (see docs/DECISIONS.md): `new Date(Date.UTC(year, month, day))` never throws on
 * an impossible calendar date — it silently rolls over (e.g. Feb 30 becomes Mar 2, month=13
 * becomes next January). For financial data (docs/DATA_POLICY.md), a source sending a malformed
 * date must be rejected loudly, never auto-corrected into a different, unrequested date and
 * stored as if it were what the source actually reported.
 *
 * `year`/`month` (1-indexed)/`day` are the calendar fields as read from the raw source payload;
 * `label` is the raw string form, used only for the error message.
 */
export function assertValidCalendarDate(
  year: number,
  month: number,
  day: number,
  label: string,
): void {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid calendar date "${label}": year/month/day must be integers`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const rolledOver =
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day;
  if (rolledOver) {
    throw new Error(
      `Invalid calendar date "${label}": ${year}-${month}-${day} does not exist ` +
        "(would silently roll over to a different date)",
    );
  }
}

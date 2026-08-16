/**
 * Raw shapes returned by the FRED (Federal Reserve Economic Data) API. This module only
 * describes the wire format — no interpretation happens here (docs/DATA_POLICY.md "Adapter
 * architecture").
 *
 * https://fred.stlouisfed.org/docs/api/fred/series_observations.html
 */

export interface FredObservationRaw {
  /** ISO date (YYYY-MM-DD) the observation describes — the period, not the release time. */
  date: string;
  /** First date this vintage of the value was known to FRED (used for revision tracking). */
  realtime_start: string;
  realtime_end: string;
  /** Numeric string, or "." for a missing observation. Never coerce "." to 0. */
  value: string;
  // Index signature so this shape can be stored directly in a Prisma Json column.
  [key: string]: string;
}

export interface FredObservationsResponse {
  observation_start: string;
  observation_end: string;
  units: string;
  /** Total observations matching the query — NOT necessarily how many are in `observations`. */
  count: number;
  /**
   * Page size and offset. Optional here because their presence has not been confirmed against a
   * real response yet (no FRED_API_KEY — `scripts/verify-fred-live.ts` checks this the moment
   * one exists). The adapter no longer depends on guessing: it sends an explicit `limit`/
   * `offset` and pages until it has `count` rows, so a documented-but-absent field cannot
   * silently truncate a series.
   */
  limit?: number;
  offset?: number;
  observations: FredObservationRaw[];
}

/** A tracked FRED series this adapter knows how to ingest. */
export interface FredSeriesDefinition {
  seriesId: string; // FRED series id, e.g. "DGS10"
  name: string;
  unit: string;
  frequency: string;
}

export const TRACKED_FRED_SERIES: FredSeriesDefinition[] = [
  {
    seriesId: "DGS10",
    name: "10-Year Treasury Constant Maturity Rate",
    unit: "percent",
    frequency: "daily",
  },
  {
    seriesId: "DGS2",
    name: "2-Year Treasury Constant Maturity Rate",
    unit: "percent",
    frequency: "daily",
  },
  {
    seriesId: "DTWEXBGS",
    name: "Trade Weighted U.S. Dollar Index: Broad, Goods and Services",
    unit: "index",
    frequency: "daily",
  },
  {
    seriesId: "CPIAUCSL",
    name: "Consumer Price Index for All Urban Consumers: All Items",
    unit: "index",
    frequency: "monthly",
  },
  {
    seriesId: "UNRATE",
    name: "Unemployment Rate",
    unit: "percent",
    frequency: "monthly",
  },
  {
    seriesId: "INDPRO",
    name: "Industrial Production Index",
    unit: "index",
    frequency: "monthly",
  },
  {
    seriesId: "M2SL",
    name: "M2 Money Stock",
    unit: "USD_billions",
    frequency: "monthly",
  },
  {
    seriesId: "WALCL",
    name: "Federal Reserve Total Assets (Balance Sheet)",
    unit: "USD_millions",
    frequency: "weekly",
  },
  {
    seriesId: "VIXCLS",
    name: "CBOE Volatility Index (VIX)",
    unit: "index",
    frequency: "daily",
  },
  {
    seriesId: "BAA10Y",
    name: "Moody's Baa Corporate Bond Yield Relative to 10-Year Treasury",
    unit: "percent",
    frequency: "daily",
  },
  {
    seriesId: "DCOILWTICO",
    name: "WTI Crude Oil Price",
    unit: "USD_per_barrel",
    frequency: "daily",
  },
];

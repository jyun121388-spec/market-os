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
  count: number;
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
];

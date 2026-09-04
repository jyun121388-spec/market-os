/**
 * Raw shapes returned by the Bank of Korea ECOS (경제통계시스템) Open API.
 * https://ecos.bok.or.kr/api/
 *
 * URL pattern: http://ecos.bok.or.kr/api/StatisticSearch/{apiKey}/json/kr/{startIdx}/{endIdx}/
 *   {statCode}/{cycle}/{startTime}/{endTime}/{itemCode1}/{itemCode2}/{itemCode3}/{itemCode4}
 *
 * NOTE: the exact convention ECOS uses for a missing/unavailable observation (empty string,
 * "-", or omission) could not be verified against a live response while building this adapter
 * (network access to ecos.bok.or.kr is blocked in this dev environment — see
 * docs/DECISIONS.md). normalize.ts is deliberately conservative: any DATA_VALUE that isn't a
 * finite number is treated as missing rather than guessed at. Revisit once a real API key and
 * live response are available (Human Gate — see docs/DATA_POLICY.md).
 */

export interface EcosStatisticSearchRow {
  STAT_CODE: string;
  STAT_NAME: string;
  ITEM_CODE1: string;
  ITEM_NAME1: string;
  ITEM_CODE2?: string;
  ITEM_NAME2?: string;
  ITEM_CODE3?: string;
  ITEM_NAME3?: string;
  ITEM_CODE4?: string;
  ITEM_NAME4?: string;
  UNIT_NAME: string;
  /** Format depends on cycle: "2026" (A), "2026Q1" (Q), "202601" (M), "20260101" (D). */
  TIME: string;
  /** Numeric string, or a non-numeric marker for a missing observation. */
  DATA_VALUE: string;
  // Index signature so this shape can be stored directly in a Prisma Json column.
  [key: string]: string | undefined;
}

export interface EcosStatisticSearchSuccess {
  StatisticSearch: {
    list_total_count: number;
    row: EcosStatisticSearchRow[];
  };
}

export interface EcosApiErrorResponse {
  RESULT: {
    CODE: string;
    MESSAGE: string;
  };
}

export type EcosStatisticSearchResponse = EcosStatisticSearchSuccess | EcosApiErrorResponse;

export function isEcosErrorResponse(
  response: EcosStatisticSearchResponse,
): response is EcosApiErrorResponse {
  return "RESULT" in response;
}

export type EcosCycle = "A" | "Q" | "M" | "D";

export interface EcosSeriesDefinition {
  statCode: string;
  itemCode1: string;
  cycle: EcosCycle;
  name: string;
  unit: string;
  frequency: string;
}

/** Base rate (기준금리), a Tier S series with a stable, well-documented stat/item code. */
export const TRACKED_ECOS_SERIES: EcosSeriesDefinition[] = [
  {
    statCode: "722Y001",
    itemCode1: "0101000",
    cycle: "M",
    name: "한국은행 기준금리 (BOK Base Rate)",
    unit: "percent",
    frequency: "monthly",
  },
];

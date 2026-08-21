/**
 * Initial Tier S source registry (docs/DATA_POLICY.md "Priority sources"). Pure data — no
 * side effects — so it can be imported by both the seed script and unit tests.
 */
export const SOURCES = [
  { code: "FRED", name: "Federal Reserve Economic Data", tier: "TIER_S" as const },
  { code: "SEC_EDGAR", name: "SEC EDGAR", tier: "TIER_S" as const },
  { code: "BLS", name: "U.S. Bureau of Labor Statistics", tier: "TIER_S" as const },
  { code: "BEA", name: "U.S. Bureau of Economic Analysis", tier: "TIER_S" as const },
  { code: "US_TREASURY", name: "U.S. Department of the Treasury", tier: "TIER_S" as const },
  { code: "FED", name: "Federal Reserve Board", tier: "TIER_S" as const },
  { code: "ECOS", name: "한국은행 경제통계시스템 (BOK ECOS)", tier: "TIER_S" as const },
  { code: "KOSIS", name: "국가통계포털 (KOSIS)", tier: "TIER_S" as const },
  { code: "DART", name: "OpenDART 전자공시시스템", tier: "TIER_S" as const },
  { code: "DATA_GO_KR", name: "공공데이터포털", tier: "TIER_S" as const },
  { code: "MOLIT", name: "국토교통부 실거래가 공개시스템", tier: "TIER_S" as const },
  { code: "IMF", name: "International Monetary Fund", tier: "TIER_S" as const },
  { code: "WORLD_BANK", name: "World Bank Open Data", tier: "TIER_S" as const },
  { code: "OECD", name: "OECD Data", tier: "TIER_S" as const },
];

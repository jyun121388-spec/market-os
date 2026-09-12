import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeCompanyXray, listCompanies } from "@/server/domain/companyXray";
import { computeBuffettOracleLens, type OracleChangeLens } from "@/server/domain/buffettOracle";
import { filterCompanies } from "@/lib/companySearch";

export const dynamic = "force-dynamic";

const panel =
  "rounded-xl border border-[#1A3248] bg-[#091420] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.18)]";

function pct(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function money(value: number | undefined, unit: string | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const scaled =
    absolute >= 1_000_000_000_000
      ? `${(value / 1_000_000_000_000).toFixed(2)}T`
      : absolute >= 1_000_000_000
        ? `${(value / 1_000_000_000).toFixed(2)}B`
        : absolute >= 1_000_000
          ? `${(value / 1_000_000).toFixed(2)}M`
          : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${scaled} ${unit ?? ""}`.trim();
}

function changeText(change: OracleChangeLens): string {
  if (change.status !== "COMPUTED") return "비교 가능한 동일 기간 데이터 부족";
  if (change.percentChange === null || change.percentChange === undefined) {
    return "이전 값이 0이어서 변화율 계산 불가";
  }
  return `${change.percentChange >= 0 ? "+" : ""}${change.percentChange.toFixed(2)}%`;
}

function availability(ok: boolean): string {
  return ok ? "근거 확인됨" : "검증 불가";
}

export default async function OraclePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; corp?: string; source?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { q, corp, source } = await searchParams;
  const query = (q ?? "").trim();
  const all = await listCompanies();
  const companies = filterCompanies(all, query).slice(0, 80);
  const selectedXray = corp ? await computeCompanyXray(corp, source) : null;
  const lens = selectedXray ? computeBuffettOracleLens(selectedXray) : null;

  const opMargin = lens?.profitability.find((r) => r.name === "OPERATING_MARGIN");
  const netMargin = lens?.profitability.find((r) => r.name === "NET_MARGIN");

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#04070D] text-[#BACED8]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-7 lg:px-8">
        <header className="overflow-hidden rounded-2xl border border-[#1A3248] bg-gradient-to-br from-[#07101A] via-[#091420] to-[#0C1822] p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.28em] text-[#C48800]">
                Market OS × Buffett Oracle
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                Oracle Research Workspace
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#7890A0]">
                버핏·린치식 질문을 Market OS의 실제 공시·재무·출처 체계 위에 올린 가치투자 리서치
                화면입니다. 하드코딩 시세, 임의 가격 시뮬레이션, 브라우저 API 키,
                목표가·매수수량·매매판정은 사용하지 않습니다.
              </p>
            </div>
            <div className="rounded-xl border border-[#C48800]/40 bg-[#C48800]/10 px-4 py-3 text-xs leading-5 text-[#E0A000]">
              <div className="font-semibold">FACT → CALCULATION → EVIDENCE</div>
              <div className="mt-1 text-[#A98531]">UNKNOWN은 UNKNOWN으로 유지</div>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-[#14283A] bg-[#07101A]">
            <div className="border-b border-[#14283A] p-4">
              <form method="get" className="flex gap-2">
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="기업명·티커·provider 검색"
                  className="min-w-0 flex-1 rounded-lg border border-[#1A3248] bg-[#0C1822] px-3 py-2 text-sm text-[#BACED8] outline-none placeholder:text-[#486070] focus:border-[#C48800]"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-[#C48800]/50 px-3 py-2 text-sm text-[#E0A000] hover:bg-[#C48800]/10"
                >
                  검색
                </button>
              </form>
              <div className="mt-3 flex items-center justify-between text-xs text-[#486070]">
                <span>{companies.length}개 표시</span>
                <span>저장된 데이터만</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {companies.length === 0 ? (
                <p className="p-4 text-sm leading-6 text-[#486070]">
                  이 설치본에 저장된 기업 중 검색 조건과 일치하는 항목이 없습니다. 존재하지 않는
                  기업이라는 뜻이 아니라 현재 저장 범위에 없다는 뜻입니다.
                </p>
              ) : (
                companies.map((company) => {
                  const active =
                    company.corpCode === corp && (!source || company.sourceCode === source);
                  const href = `/oracle?corp=${encodeURIComponent(company.corpCode)}&source=${encodeURIComponent(
                    company.sourceCode,
                  )}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
                  return (
                    <Link
                      key={`${company.sourceCode}:${company.corpCode}`}
                      href={href}
                      className={`block border-b border-[#14283A] px-4 py-3 transition hover:bg-[#0C1822] ${
                        active ? "border-l-2 border-l-[#C48800] bg-[#0C1822]" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[#DDE8EE]">
                            {company.corpName}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-[#486070]">
                            {company.stockCode ?? company.corpCode}
                          </div>
                        </div>
                        <span className="rounded border border-[#1A3248] px-1.5 py-0.5 font-mono text-[9px] text-[#688094]">
                          {company.sourceCode}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] text-[#486070]">
                        filings {company.filingCount}
                        {company.latestFilingDate ? ` · latest ${company.latestFilingDate}` : ""}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </aside>

          <main className="min-w-0">
            {!corp ? (
              <div className="flex min-h-[680px] items-center justify-center rounded-2xl border border-dashed border-[#1A3248] bg-[#07101A] p-8 text-center">
                <div>
                  <div className="text-4xl text-[#C48800]/40">◈</div>
                  <h2 className="mt-4 text-xl font-medium text-white">기업을 선택하세요</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#486070]">
                    왼쪽 목록에서 기업을 선택하면 수익성, 재무구조, 존속성, 변화 추적, 밸류에이션
                    준비도와 원문 증거를 하나의 화면에서 확인합니다.
                  </p>
                </div>
              </div>
            ) : !lens ? (
              <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-6 text-sm text-amber-200">
                해당 corpCode는 provider까지 포함해 하나의 기업으로 확정할 수 없습니다. Company
                Intelligence에서 provider를 다시 선택해 주세요.
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <section className="rounded-2xl border border-[#1A3248] bg-[#07101A] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold text-white">
                          {lens.company.corpName}
                        </h2>
                        <span className="rounded border border-[#C48800]/40 bg-[#C48800]/10 px-2 py-1 font-mono text-[10px] text-[#E0A000]">
                          {lens.company.sourceCode}
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-xs text-[#486070]">
                        {lens.company.stockCode ?? lens.company.corpCode} · {lens.company.corpCode}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-2xl font-semibold text-[#C48800]">
                        {lens.evidenceCoverage.supportedDimensions}/
                        {lens.evidenceCoverage.totalDimensions}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[#486070]">
                        evidence dimensions
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 rounded-lg border border-[#14283A] bg-[#0C1822] px-4 py-3 text-xs leading-5 text-[#7890A0]">
                    {lens.contract}
                  </p>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Profitability
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-[#07101A] p-3">
                        <div className="text-[11px] text-[#486070]">영업이익률</div>
                        <div className="mt-1 font-mono text-xl text-[#E0A000]">
                          {opMargin?.status === "COMPUTED" ? pct(opMargin.percent) : "—"}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#07101A] p-3">
                        <div className="text-[11px] text-[#486070]">순이익률</div>
                        <div className="mt-1 font-mono text-xl text-[#00B8AA]">
                          {netMargin?.status === "COMPUTED" ? pct(netMargin.percent) : "—"}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#486070]">
                      같은 기간·같은 단위의 공시 숫자가 기계적으로 맞을 때만 계산합니다.
                    </p>
                  </article>

                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Balance Sheet Context
                    </div>
                    {lens.balanceSheet.status === "AVAILABLE" ? (
                      <>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <div>
                            <div className="text-[11px] text-[#486070]">부채 / 자산</div>
                            <div className="mt-1 font-mono text-xl text-[#E0A000]">
                              {pct(lens.balanceSheet.liabilitiesToAssetsPct)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-[#486070]">현금 / 부채</div>
                            <div className="mt-1 font-mono text-base text-[#00B8AA]">
                              {pct(lens.balanceSheet.cashToLiabilitiesPct)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 text-[11px] text-[#486070]">
                          {lens.balanceSheet.periodEnd} · {lens.balanceSheet.unit}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 text-sm text-[#7890A0]">
                        검증 불가 · {lens.balanceSheet.reason}
                      </div>
                    )}
                    <p className="mt-3 text-xs leading-5 text-[#486070]">
                      {lens.balanceSheet.limitation}
                    </p>
                  </article>

                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Durability Evidence
                    </div>
                    <div className="mt-4 font-mono text-2xl text-[#E0A000]">
                      {lens.durability.coveredYears === null
                        ? "—"
                        : `${lens.durability.coveredYears.toFixed(1)}y`}
                    </div>
                    <div className="mt-2 text-xs text-[#7890A0]">
                      {lens.durability.filingCount} filings ·{" "}
                      {lens.durability.earliestFilingDate ?? "?"}
                      {" → "}
                      {lens.durability.latestFilingDate ?? "?"}
                    </div>
                    <div className="mt-3 rounded-lg border border-[#14283A] bg-[#07101A] p-3 text-xs text-[#7890A0]">
                      <span className="font-mono text-[#C48800]">
                        {lens.durability.completenessStatus}
                      </span>
                      <div className="mt-1 leading-5 text-[#486070]">
                        {lens.durability.completenessDetail}
                      </div>
                    </div>
                  </article>

                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Earnings Change
                    </div>
                    <div className="mt-4 font-mono text-2xl text-[#E0A000]">
                      {changeText(lens.earningsChange)}
                    </div>
                    <div className="mt-2 text-xs text-[#486070]">
                      {lens.earningsChange.concept}
                      {lens.earningsChange.currentPeriodEnd
                        ? ` · ${lens.earningsChange.previousPeriodEnd} → ${lens.earningsChange.currentPeriodEnd}`
                        : ""}
                    </div>
                    {lens.earningsChange.periodLengthMismatch ? (
                      <p className="mt-3 text-xs leading-5 text-amber-300">
                        같은 기간 bucket이지만 실제 일수 차이가 큽니다. 변화율을 그대로 비교할 때
                        주의가 필요합니다.
                      </p>
                    ) : null}
                  </article>

                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Revenue Change
                    </div>
                    <div className="mt-4 font-mono text-2xl text-[#00B8AA]">
                      {changeText(lens.revenueChange)}
                    </div>
                    <div className="mt-2 text-xs text-[#486070]">
                      {lens.revenueChange.concept}
                      {lens.revenueChange.currentPeriodEnd
                        ? ` · ${lens.revenueChange.previousPeriodEnd} → ${lens.revenueChange.currentPeriodEnd}`
                        : ""}
                    </div>
                    {lens.revenueChange.periodLengthMismatch ? (
                      <p className="mt-3 text-xs leading-5 text-amber-300">
                        실제 기간 길이가 달라 완전한 like-for-like 비교는 아닙니다.
                      </p>
                    ) : null}
                  </article>

                  <article className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Valuation Readiness
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                      <div className="flex items-center justify-between rounded-lg bg-[#07101A] px-3 py-2 text-sm">
                        <span>P/E scenario fact</span>
                        <span
                          className={
                            lens.valuationReadiness.pe === "FACT_READY"
                              ? "text-[#00A860]"
                              : "text-[#C83050]"
                          }
                        >
                          {availability(lens.valuationReadiness.pe === "FACT_READY")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-[#07101A] px-3 py-2 text-sm">
                        <span>P/S scenario fact</span>
                        <span
                          className={
                            lens.valuationReadiness.ps === "FACT_READY"
                              ? "text-[#00A860]"
                              : "text-[#C83050]"
                          }
                        >
                          {availability(lens.valuationReadiness.ps === "FACT_READY")}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#486070]">
                      {lens.valuationReadiness.limitation}
                    </p>
                  </article>
                </section>

                {lens.balanceSheet.status === "AVAILABLE" ? (
                  <section className={panel}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#486070]">
                      Source-backed balance sheet facts
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {[
                        ["Assets", lens.balanceSheet.assets],
                        ["Liabilities", lens.balanceSheet.liabilities],
                        ["Cash", lens.balanceSheet.cash],
                      ].map(([label, raw]) => {
                        const item = raw as typeof lens.balanceSheet.assets | undefined;
                        return (
                          <div
                            key={String(label)}
                            className="rounded-lg border border-[#14283A] bg-[#07101A] p-3"
                          >
                            <div className="text-[11px] text-[#486070]">{String(label)}</div>
                            <div className="mt-1 font-mono text-base text-[#DDE8EE]">
                              {money(item?.value, item?.unit)}
                            </div>
                            <div className="mt-2 break-all font-mono text-[9px] leading-4 text-[#486070]">
                              {item?.accessionNumber ?? "not available"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Link
                    href={`/company/${encodeURIComponent(lens.company.corpCode)}?source=${encodeURIComponent(
                      lens.company.sourceCode,
                    )}`}
                    className="rounded-xl border border-[#C48800]/40 bg-[#C48800]/10 px-4 py-3 text-center text-sm font-medium text-[#E0A000] hover:bg-[#C48800]/15"
                  >
                    Company Intelligence
                  </Link>
                  <Link
                    href={`/company/${encodeURIComponent(lens.company.corpCode)}/filings?source=${encodeURIComponent(
                      lens.company.sourceCode,
                    )}`}
                    className="rounded-xl border border-[#1A3248] bg-[#091420] px-4 py-3 text-center text-sm text-[#BACED8] hover:bg-[#0C1822]"
                  >
                    Filings / Evidence
                  </Link>
                  <Link
                    href="/ask"
                    className="rounded-xl border border-[#1A3248] bg-[#091420] px-4 py-3 text-center text-sm text-[#BACED8] hover:bg-[#0C1822]"
                  >
                    Ask Market
                  </Link>
                  <Link
                    href="/watchlist"
                    className="rounded-xl border border-[#1A3248] bg-[#091420] px-4 py-3 text-center text-sm text-[#BACED8] hover:bg-[#0C1822]"
                  >
                    Watchlist
                  </Link>
                </section>
              </div>
            )}
          </main>
        </section>
      </div>
    </div>
  );
}

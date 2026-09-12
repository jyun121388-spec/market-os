import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/actions/auth";
import { computeCompanyXray, listCompanies } from "@/server/domain/companyXray";
import { computeBuffettOracleProfile, type OracleTone } from "@/server/domain/buffettOracle";
import {
  computeValuationScenarios,
  type MultipleInput,
  type ValuationScenario,
} from "@/server/domain/valuationScenario";

export const dynamic = "force-dynamic";

type OracleQuery = {
  company?: string;
  corpCode?: string;
  source?: string;
  peLow?: string;
  peBase?: string;
  peHigh?: string;
  psLow?: string;
  psBase?: string;
  psHigh?: string;
};

const toneClass: Record<OracleTone, string> = {
  POSITIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  CAUTION: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  UNVERIFIABLE: "border-zinc-700 bg-zinc-900/70 text-zinc-300",
  NEUTRAL: "border-sky-500/30 bg-sky-500/10 text-sky-100",
};

function readMultiples(low?: string, base?: string, high?: string): MultipleInput | undefined {
  if (low == null && base == null && high == null) return undefined;
  if (!low || !base || !high) return undefined;
  return { low: Number(low), base: Number(base), high: Number(high) };
}

function scenarioValue(v: number | undefined, unit: string | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${unit ?? ""}`.trim();
}

function ScenarioCard({ scenario }: { scenario: ValuationScenario }) {
  return (
    <article className="rounded-xl border border-zinc-800 bg-black/30 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            {scenario.method === "PE_SCENARIO" ? "P/E scenario" : "P/S scenario"}
          </p>
          <p className="text-sm font-medium text-zinc-200">{scenario.status}</p>
        </div>
        <span className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400">
          USER ASSUMPTION
        </span>
      </div>

      {scenario.fact ? (
        <div className="mb-3 rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400">
          <div className="font-medium text-zinc-200">FACT · {scenario.fact.concept}</div>
          <div>
            {scenario.fact.value.toLocaleString("en-US")} {scenario.fact.unit} · {scenario.fact.periodEnd}
          </div>
          <div className="break-all">{scenario.fact.form} · {scenario.fact.accessionNumber}</div>
        </div>
      ) : null}

      {scenario.impliedEquityValue ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["LOW", scenario.impliedEquityValue.low],
            ["BASE", scenario.impliedEquityValue.base],
            ["HIGH", scenario.impliedEquityValue.high],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
              <div className="text-[10px] text-zinc-500">{label}</div>
              <div className="mt-1 text-sm font-semibold text-amber-300">
                {scenarioValue(value as number, scenario.impliedEquityValue?.unit)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {scenario.unverifiableBecause ?? scenario.assumptionsRefusedBecause ?? "Enter assumptions to calculate."}
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-zinc-600">{scenario.limitations}</p>
    </article>
  );
}

function parseCompanySelection(query: OracleQuery) {
  if (query.corpCode) return { corpCode: query.corpCode, source: query.source };
  if (!query.company) return null;
  const split = query.company.indexOf("|");
  if (split <= 0 || split === query.company.length - 1) return null;
  return { corpCode: query.company.slice(0, split), source: query.company.slice(split + 1) };
}

export default async function BuffettOraclePage({
  searchParams,
}: {
  searchParams: Promise<OracleQuery>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const companies = await listCompanies();
  const requested = parseCompanySelection(query);
  const selected = requested
    ? companies.find(
        (c) => c.corpCode === requested.corpCode && (!requested.source || c.sourceCode === requested.source),
      )
    : companies[0];

  const xray = selected ? await computeCompanyXray(selected.corpCode, selected.sourceCode) : null;
  const profile = xray ? computeBuffettOracleProfile(xray) : null;
  const valuation = xray
    ? computeValuationScenarios({
        figures: xray.latestFigures,
        sourceCode: xray.company.sourceCode,
        completeness: xray.completeness,
        peMultiples: readMultiples(query.peLow, query.peBase, query.peHigh),
        psMultiples: readMultiples(query.psLow, query.psBase, query.psHigh),
      })
    : null;

  return (
    <div className="min-h-screen bg-[#05080d] text-zinc-100">
      <header className="border-b border-amber-500/20 bg-[#071019]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="font-serif text-2xl tracking-tight text-amber-400">◈ Buffett Oracle × Market OS</p>
            <p className="mt-1 text-xs tracking-[0.18em] text-zinc-600">EVIDENCE-FIRST VALUE RESEARCH WORKSPACE</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-200">
            Market OS = evidence authority · Oracle = research lens
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <form method="get" className="rounded-xl border border-zinc-800 bg-[#09111a] p-4">
            <label htmlFor="oracle-company" className="mb-2 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Company evidence set
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                id="oracle-company"
                name="company"
                defaultValue={selected ? `${selected.corpCode}|${selected.sourceCode}` : ""}
                className="min-w-[280px] flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
              >
                {companies.map((c) => (
                  <option key={`${c.sourceCode}:${c.corpCode}`} value={`${c.corpCode}|${c.sourceCode}`}>
                    {c.corpName} · {c.stockCode ?? c.corpCode} · {c.sourceCode}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400">
                Open in Oracle
              </button>
              <Link href="/company" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-400">
                Company search
              </Link>
            </div>
          </form>

          <div className="rounded-xl border border-zinc-800 bg-[#09111a] p-4 text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Coverage</div>
            <div className="mt-1 text-xl font-semibold text-amber-300">{companies.length}</div>
            <div className="text-xs text-zinc-500">stored evidence sets</div>
          </div>
        </section>

        {!xray || !profile || !valuation ? (
          <section className="rounded-xl border border-zinc-800 bg-[#09111a] p-8 text-center text-zinc-500">
            No company evidence is stored yet. Oracle will not fabricate a demo company.
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-[#0d1721] to-[#070b10] p-6">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Selected company</p>
                  <h1 className="mt-1 font-serif text-3xl text-zinc-100">{xray.company.corpName}</h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    {xray.company.sourceCode} · {xray.company.stockCode ?? xray.company.corpCode} · {xray.company.filingCount} filings
                  </p>
                </div>
                <div className="min-w-[260px] rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Oracle readiness</div>
                  <div className="mt-1 text-lg font-semibold text-amber-300">{profile.readiness}</div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{profile.readinessReason}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={`/company/${encodeURIComponent(xray.company.corpCode)}?source=${encodeURIComponent(xray.company.sourceCode)}`}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-400"
                >
                  Company Intelligence
                </Link>
                <Link
                  href={`/company/${encodeURIComponent(xray.company.corpCode)}/filings?source=${encodeURIComponent(xray.company.sourceCode)}`}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-400"
                >
                  Filing Evidence
                </Link>
                <Link href="/macro" className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-400">
                  Macro context
                </Link>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Buffett research lens</p>
                  <h2 className="text-xl font-semibold">Quality before price</h2>
                </div>
                <p className="text-xs text-zinc-600">Hard-coded moat scores never enter a decision.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {profile.lenses.map((lens) => (
                  <article key={lens.id} className={`rounded-xl border p-4 ${toneClass[lens.tone]}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] opacity-70">{lens.label}</p>
                      <span className="rounded border border-current/20 px-2 py-0.5 text-[9px]">{lens.tone}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold">{lens.headline}</h3>
                    <p className="mt-2 text-xs leading-5 opacity-75">{lens.detail}</p>
                    {lens.provenance.length ? (
                      <p className="mt-3 break-all text-[10px] opacity-50">Evidence: {lens.provenance.join(" · ")}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-[#09111a] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Valuation laboratory</p>
                <h2 className="mt-1 text-lg font-semibold">Your multiples, Market OS facts</h2>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  The uploaded Oracle supplied its own DCF and valuation assumptions. This integration does not. Enter low/base/high P/E and P/S multiples yourself; Market OS applies them only to mechanically eligible annual facts.
                </p>
                <form method="get" className="mt-4 flex flex-col gap-3">
                  <input type="hidden" name="corpCode" value={xray.company.corpCode} />
                  <input type="hidden" name="source" value={xray.company.sourceCode} />
                  {(["pe", "ps"] as const).map((method) => (
                    <div key={method}>
                      <div className="mb-1 text-xs font-medium text-zinc-400">{method.toUpperCase()} multiples</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(["Low", "Base", "High"] as const).map((label) => {
                          const name = `${method}${label}` as keyof OracleQuery;
                          return (
                            <input
                              key={name}
                              name={name}
                              defaultValue={query[name] ?? ""}
                              inputMode="decimal"
                              placeholder={label}
                              className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-amber-400"
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400">
                    Calculate scenarios
                  </button>
                </form>
              </div>
              <div className="grid gap-3">
                <ScenarioCard scenario={valuation.pe} />
                <ScenarioCard scenario={valuation.ps} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-[#09111a] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Recent evidence</p>
                <h2 className="mt-1 text-lg font-semibold">Latest filings</h2>
                <div className="mt-4 flex flex-col gap-2">
                  {xray.recentFilings.slice(0, 6).map((f) => (
                    <div key={f.receiptNo} className="rounded-lg border border-zinc-800 bg-black/30 p-3">
                      <div className="text-sm text-zinc-200">{f.reportName}</div>
                      <div className="mt-1 text-[11px] text-zinc-600">{f.receiptDate} · {f.receiptNo}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-[#09111a] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Integration contract</p>
                <h2 className="mt-1 text-lg font-semibold">What changed</h2>
                <div className="mt-4 space-y-3 text-xs leading-5 text-zinc-400">
                  <p><strong className="text-emerald-300">KEPT:</strong> Buffett-style quality workflow, earnings/revenue durability, value-trap mindset and scenario-analysis UX.</p>
                  <p><strong className="text-amber-300">CORRECTED:</strong> static moat/conviction values are analyst notes only and cannot affect ranking or valuation until evidence-backed.</p>
                  <p><strong className="text-amber-300">CORRECTED:</strong> Oracle no longer calls DART/SEC/price providers directly. Market OS is the single provider/provenance authority.</p>
                  <p><strong className="text-sky-300">DEFERRED:</strong> Bottom/RSI and portfolio allocation require a verified security-price authority and a separate product decision before they drive normal-user ranking.</p>
                  <p><strong className="text-zinc-300">SAFETY:</strong> UNKNOWN stays unknown, stale stays stale, incomplete stays incomplete; this page needs no LLM or provider credential.</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-black/30 p-4 text-xs leading-5 text-zinc-500">
              <strong className="text-zinc-300">Limitations.</strong> {profile.limitations.join(" ")}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

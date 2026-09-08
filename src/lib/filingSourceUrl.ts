/**
 * The canonical URL for one stored filing, or null.
 *
 * Deliberately NOT a generic template with a per-provider base. A URL built for a provider whose
 * scheme nobody here has verified would be a fabricated citation that looks exactly like a real
 * one — worse than no link, because a reader who clicks it and lands nowhere cannot tell whether
 * the filing is missing or the link was invented. `docs/DATA_POLICY.md` treats a source reference
 * as part of the fact; an unverified one is the same failure as an unsourced number.
 *
 * So: two providers, each with the identifier shape asserted before a URL is built, and null for
 * everything else. The caller shows the raw identifier instead, which a reader can still check by
 * hand.
 *
 * The EDGAR branch is the one to read carefully. The first version of it used
 * `browse-edgar?action=getcompany&filenum=<accession>`, which is a company FILE-NUMBER search and
 * not an accession lookup at all — it would have rendered a confident link to the wrong kind of
 * page for every SEC filing in the product. It was caught by checking the URL shape against the
 * stored data rather than by anything failing.
 */
export function filingSourceUrl(
  sourceCode: string,
  corpCode: string,
  receiptNo: string,
): string | null {
  if (sourceCode === "DART") {
    // DART addresses a filing by its receipt number, which is exactly what `receiptNo` holds.
    if (!/^\d+$/.test(receiptNo)) return null;
    return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`;
  }

  if (sourceCode === "SEC_EDGAR") {
    // The Archives path is the only EDGAR URL that addresses ONE accession. It needs the CIK with
    // leading zeros STRIPPED — `corpCode` is stored zero-padded to ten digits, see the
    // `canonical_edgar_cik` migration — and the accession twice: without dashes for the directory,
    // intact for the index file.
    if (!/^\d{10}-\d{2}-\d{6}$/.test(receiptNo)) return null;
    if (!/^\d+$/.test(corpCode)) return null;
    const cik = String(Number(corpCode));
    const directory = receiptNo.replace(/-/g, "");
    return `https://www.sec.gov/Archives/edgar/data/${cik}/${directory}/${receiptNo}-index.htm`;
  }

  return null;
}

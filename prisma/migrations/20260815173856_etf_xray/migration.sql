-- CreateTable
CREATE TABLE "etfs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "trackedIndex" TEXT,
    "expenseRatio" DECIMAL(6,4),
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etf_holdings" (
    "id" TEXT NOT NULL,
    "etfId" TEXT NOT NULL,
    "holdingName" TEXT NOT NULL,
    "holdingTicker" TEXT,
    "weightPct" DECIMAL(8,5) NOT NULL,
    "sector" TEXT,
    "country" TEXT,
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etf_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etfs_sourceId_ticker_asOfDate_key" ON "etfs"("sourceId", "ticker", "asOfDate");

-- CreateIndex
CREATE INDEX "etf_holdings_etfId_idx" ON "etf_holdings"("etfId");

-- AddForeignKey
ALTER TABLE "etfs" ADD CONSTRAINT "etfs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etf_holdings" ADD CONSTRAINT "etf_holdings_etfId_fkey" FOREIGN KEY ("etfId") REFERENCES "etfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "filings" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "corpName" TEXT NOT NULL,
    "stockCode" TEXT,
    "reportName" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filings_sourceId_corpCode_idx" ON "filings"("sourceId", "corpCode");

-- CreateIndex
CREATE UNIQUE INDEX "filings_sourceId_receiptNo_key" ON "filings"("sourceId", "receiptNo");

-- AddForeignKey
ALTER TABLE "filings" ADD CONSTRAINT "filings_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "keywords" TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "latestUpdateAt" TIMESTAMP(3) NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 1,
    "distinctTierCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_mentions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_latestUpdateAt_idx" ON "events"("latestUpdateAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_mentions_url_key" ON "event_mentions"("url");

-- CreateIndex
CREATE INDEX "event_mentions_eventId_idx" ON "event_mentions"("eventId");

-- AddForeignKey
ALTER TABLE "event_mentions" ADD CONSTRAINT "event_mentions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_mentions" ADD CONSTRAINT "event_mentions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

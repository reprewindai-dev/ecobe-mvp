CREATE TABLE "X402PaymentEvent" (
    "id" TEXT NOT NULL,
    "routePath" TEXT NOT NULL,
    "routeMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payer" TEXT,
    "transactionHash" TEXT,
    "network" TEXT,
    "decisionFrameId" TEXT,
    "proofHash" TEXT,
    "upstreamStatus" INTEGER,
    "userAgent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "X402PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "X402PaymentEvent_routePath_createdAt_idx" ON "X402PaymentEvent"("routePath", "createdAt");
CREATE INDEX "X402PaymentEvent_payer_createdAt_idx" ON "X402PaymentEvent"("payer", "createdAt");
CREATE INDEX "X402PaymentEvent_transactionHash_idx" ON "X402PaymentEvent"("transactionHash");
CREATE INDEX "X402PaymentEvent_decisionFrameId_idx" ON "X402PaymentEvent"("decisionFrameId");

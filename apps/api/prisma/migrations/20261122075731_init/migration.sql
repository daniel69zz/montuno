-- CreateEnum
CREATE TYPE "ImporterStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ImporterRole" AS ENUM ('OWNER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN', 'ARBITER');

-- CreateEnum
CREATE TYPE "EscrowMode" AS ENUM ('FULL_ESCROW', 'PARTIAL_ADVANCE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('NOT_STARTED', 'RAMP_PENDING', 'WALLET_FUNDED', 'ESCROW_PENDING', 'ESCROW_FUNDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "LogisticState" AS ENUM ('NOT_PURCHASED', 'PURCHASED', 'IN_TRANSIT', 'ARRIVED_BOLIVIA', 'READY_FOR_DELIVERY', 'DELIVERED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "DisputeState" AS ENUM ('NONE', 'OPEN', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "OnchainStatus" AS ENUM ('NONE', 'FUNDED', 'ADVANCE_PAID', 'DISPUTED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PreparedTxStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('RECEIPT', 'TRACKING', 'DELIVERY_PROOF', 'OTHER');

-- CreateEnum
CREATE TYPE "RampStatus" AS ENUM ('QUOTED', 'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phone" TEXT,
    "displayName" TEXT,
    "identityProvider" TEXT NOT NULL,
    "externalSubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlatformRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "grantedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPlatformRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWallet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" UUID,
    "secretHash" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Importer" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "publicName" TEXT NOT NULL,
    "nit" TEXT,
    "status" "ImporterStatus" NOT NULL DEFAULT 'PENDING',
    "walletId" UUID,
    "maxOrderAmountAtomic" BIGINT NOT NULL DEFAULT 0,
    "maxAdvanceBps" INTEGER NOT NULL DEFAULT 0,
    "allowedModes" "EscrowMode"[] DEFAULT ARRAY['FULL_ESCROW']::"EscrowMode"[],
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Importer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterMember" (
    "id" UUID NOT NULL,
    "importerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ImporterRole" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "importerId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "productUrl" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productVariant" TEXT,
    "quantity" INTEGER NOT NULL,
    "destinationCity" TEXT NOT NULL,
    "deliveryEstimateDays" INTEGER NOT NULL,
    "purchaseTerms" TEXT NOT NULL,
    "fiatPrice" DECIMAL(20,2) NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "tokenContractId" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "serviceFeeAtomic" BIGINT NOT NULL DEFAULT 0,
    "rampFeeAtomic" BIGINT NOT NULL DEFAULT 0,
    "fxRate" DECIMAL(24,10),
    "fxSpreadBps" INTEGER,
    "fxSource" TEXT,
    "fxQuoteExpiresAt" TIMESTAMP(3),
    "escrowMode" "EscrowMode" NOT NULL,
    "advanceAmountAtomic" BIGINT NOT NULL DEFAULT 0,
    "fulfillmentDeadline" TIMESTAMP(3) NOT NULL,
    "riskDisclosureVersion" TEXT NOT NULL,
    "termsHash" TEXT,
    "canonicalTerms" JSONB,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutLink" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "opaqueTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "importerId" UUID NOT NULL,
    "buyerWallet" TEXT NOT NULL,
    "importerWallet" TEXT NOT NULL,
    "arbiterWallet" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "escrowContractId" TEXT NOT NULL,
    "tokenContractId" TEXT NOT NULL,
    "onchainOrderId" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "escrowMode" "EscrowMode" NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "advanceAmountAtomic" BIGINT NOT NULL,
    "fundingDeadline" TIMESTAMP(3) NOT NULL,
    "fulfillmentDeadline" TIMESTAMP(3) NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "paymentState" "PaymentState" NOT NULL DEFAULT 'NOT_STARTED',
    "logisticState" "LogisticState" NOT NULL DEFAULT 'NOT_PURCHASED',
    "disputeState" "DisputeState" NOT NULL DEFAULT 'NONE',
    "onchainStatus" "OnchainStatus" NOT NULL DEFAULT 'NONE',
    "advanceReleasedAtomic" BIGINT NOT NULL DEFAULT 0,
    "sellerReleasedAtomic" BIGINT NOT NULL DEFAULT 0,
    "buyerRefundedAtomic" BIGINT NOT NULL DEFAULT 0,
    "remainingEscrowAtomic" BIGINT NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncedLedger" INTEGER,
    "paidAt" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "termsHash" TEXT NOT NULL,
    "disclosureVersion" TEXT NOT NULL,
    "disclosureText" TEXT NOT NULL,
    "disclosureHash" TEXT NOT NULL,
    "advanceAmountAtomic" BIGINT NOT NULL,
    "protectedAmountAtomic" BIGINT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RampTransaction" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "corridor" TEXT NOT NULL,
    "providerReference" TEXT,
    "amountFiat" DECIMAL(20,2) NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "expectedAtomic" BIGINT NOT NULL,
    "destinationWallet" TEXT NOT NULL,
    "status" "RampStatus" NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "quoteExpiresAt" TIMESTAMP(3),
    "webhookReference" TEXT,
    "rawSafeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RampTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparedTransaction" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "signerRole" TEXT NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "signerUserId" UUID NOT NULL,
    "txHash" TEXT NOT NULL,
    "unsignedXdr" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "format" TEXT NOT NULL,
    "status" "PreparedTxStatus" NOT NULL DEFAULT 'PREPARED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "ledger" INTEGER,
    "error" TEXT,
    "disputeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowTransaction" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER,
    "eventType" TEXT NOT NULL,
    "amountAtomic" BIGINT,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confirmationAt" TIMESTAMP(3),
    "uniqueEventKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEvidence" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "openedBy" UUID NOT NULL,
    "openedByRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonHash" TEXT NOT NULL,
    "status" "DisputeState" NOT NULL DEFAULT 'OPEN',
    "onchainConfirmedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolutionHash" TEXT,
    "refundToBuyerAtomic" BIGINT,
    "releaseToImporterAtomic" BIGINT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "corridorId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "providerReference" TEXT,
    "simulated" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL,
    "lastLedger" INTEGER NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_identityProvider_externalSubject_key" ON "User"("identityProvider", "externalSubject");

-- CreateIndex
CREATE UNIQUE INDEX "UserPlatformRole_userId_role_key" ON "UserPlatformRole"("userId", "role");

-- CreateIndex
CREATE INDEX "UserWallet_userId_idx" ON "UserWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_address_network_key" ON "UserWallet"("address", "network");

-- CreateIndex
CREATE INDEX "AuthChallenge_kind_subject_idx" ON "AuthChallenge"("kind", "subject");

-- CreateIndex
CREATE INDEX "Importer_ownerUserId_idx" ON "Importer"("ownerUserId");

-- CreateIndex
CREATE INDEX "ImporterMember_userId_idx" ON "ImporterMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ImporterMember_importerId_userId_key" ON "ImporterMember"("importerId", "userId");

-- CreateIndex
CREATE INDEX "Quote_importerId_idx" ON "Quote"("importerId");

-- CreateIndex
CREATE INDEX "Quote_status_expiresAt_idx" ON "Quote"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLink_opaqueTokenHash_key" ON "CheckoutLink"("opaqueTokenHash");

-- CreateIndex
CREATE INDEX "CheckoutLink_quoteId_idx" ON "CheckoutLink"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_onchainOrderId_key" ON "Order"("onchainOrderId");

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "Order_importerId_idx" ON "Order"("importerId");

-- CreateIndex
CREATE INDEX "Order_paymentState_idx" ON "Order"("paymentState");

-- CreateIndex
CREATE INDEX "ConsentRecord_orderId_idx" ON "ConsentRecord"("orderId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RampTransaction_providerReference_key" ON "RampTransaction"("providerReference");

-- CreateIndex
CREATE INDEX "RampTransaction_orderId_idx" ON "RampTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparedTransaction_txHash_key" ON "PreparedTransaction"("txHash");

-- CreateIndex
CREATE INDEX "PreparedTransaction_orderId_action_idx" ON "PreparedTransaction"("orderId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowTransaction_uniqueEventKey_key" ON "EscrowTransaction"("uniqueEventKey");

-- CreateIndex
CREATE INDEX "EscrowTransaction_orderId_idx" ON "EscrowTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseEvidence_objectKey_key" ON "PurchaseEvidence"("objectKey");

-- CreateIndex
CREATE INDEX "PurchaseEvidence_orderId_idx" ON "PurchaseEvidence"("orderId");

-- CreateIndex
CREATE INDEX "Dispute_orderId_idx" ON "Dispute"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRecord_userId_provider_corridorId_key" ON "KycRecord"("userId", "provider", "corridorId");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_provider_externalId_key" ON "WebhookReceipt"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "UserPlatformRole" ADD CONSTRAINT "UserPlatformRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importer" ADD CONSTRAINT "Importer_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importer" ADD CONSTRAINT "Importer_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImporterMember" ADD CONSTRAINT "ImporterMember_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImporterMember" ADD CONSTRAINT "ImporterMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLink" ADD CONSTRAINT "CheckoutLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RampTransaction" ADD CONSTRAINT "RampTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedTransaction" ADD CONSTRAINT "PreparedTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowTransaction" ADD CONSTRAINT "EscrowTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvidence" ADD CONSTRAINT "PurchaseEvidence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

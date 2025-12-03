-- Add LINE integration models

-- Add customerId and lineNotificationSent to Booking
ALTER TABLE "Booking" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "lineNotificationSent" BOOLEAN NOT NULL DEFAULT false;

-- Create index for customerId
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- Create LineConfig table
CREATE TABLE "LineConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSecret" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "notifyOnConfirm" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnCancel" BOOLEAN NOT NULL DEFAULT true,
    "notifyReminder" BOOLEAN NOT NULL DEFAULT false,
    "reminderHours" INTEGER NOT NULL DEFAULT 24,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Create unique index for LineConfig shopId
CREATE UNIQUE INDEX "LineConfig_shopId_key" ON "LineConfig"("shopId");

-- Create LineUserLink table
CREATE TABLE "LineUserLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "lineUserId" TEXT NOT NULL,
    "lineDisplayName" TEXT,
    "linePictureUrl" TEXT,
    "isLinked" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Create unique indexes for LineUserLink
CREATE UNIQUE INDEX "LineUserLink_shopId_customerId_key" ON "LineUserLink"("shopId", "customerId");
CREATE UNIQUE INDEX "LineUserLink_shopId_lineUserId_key" ON "LineUserLink"("shopId", "lineUserId");

-- Create indexes for LineUserLink
CREATE INDEX "LineUserLink_shopId_idx" ON "LineUserLink"("shopId");
CREATE INDEX "LineUserLink_customerId_idx" ON "LineUserLink"("customerId");
CREATE INDEX "LineUserLink_lineUserId_idx" ON "LineUserLink"("lineUserId");


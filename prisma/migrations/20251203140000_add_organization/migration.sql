-- Add Organization and Staff models for multi-shop management

-- Create Organization table
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerName" TEXT,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Create index for Organization
CREATE INDEX "Organization_ownerEmail_idx" ON "Organization"("ownerEmail");

-- Create StaffMember table
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "allowedShopIds" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes for StaffMember
CREATE UNIQUE INDEX "StaffMember_organizationId_email_key" ON "StaffMember"("organizationId", "email");
CREATE INDEX "StaffMember_organizationId_idx" ON "StaffMember"("organizationId");
CREATE INDEX "StaffMember_email_idx" ON "StaffMember"("email");

-- Add organizationId to Shop table
ALTER TABLE "Shop" ADD COLUMN "organizationId" TEXT REFERENCES "Organization"("id") ON DELETE SET NULL;

-- Create index for Shop.organizationId
CREATE INDEX "Shop_organizationId_idx" ON "Shop"("organizationId");


-- AlterTable: Add quota management fields to Shop
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "planType" TEXT NOT NULL DEFAULT 'FREE',
    "planName" TEXT,
    "billingId" TEXT,
    "currentMonthUsage" INTEGER NOT NULL DEFAULT 0,
    "usageCycleStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Shop" ("id", "name", "createdAt", "updatedAt") 
SELECT "id", "name", "createdAt", "updatedAt" FROM "Shop";

DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


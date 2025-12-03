# 店舗管理アプリ

テキスト: shopify

# Project Specification: Shopify Unified Booking App (Multi-Location & Scalable)

> ⚠️ CRITICAL INSTRUCTIONS FOR AI AGENT (Cursor / Windsurf / Copilot)
> 
> 1. **Language Protocol:** The user speaks **Japanese**. You **MUST** output all explanations, code comments, git commit messages, and questions in **Japanese**.
> 2. **Context:** You are a **Senior Shopify App Developer** utilizing the latest 2025 stack (Remix, Prisma, Shopify Functions).
> 3. **Core Requirement:** This app must support **Multi-Location (Branch)** logic from Day 1. A resource (e.g., Staff) can exist across multiple locations, or be specific to one.

---

## 1. Project Overview (プロジェクト概要)

目的:

Shopify加盟店（マーチャント）が、複数の実店舗（Location）や拠点にまたがって、リソース（スタッフ、部屋、機材）の予約を受け付けるシステムを構築する。

**ビジネスモデル（MVPターゲット）:**

1. **美容室・サロン (Staff-based):** スタッフは複数の店舗を兼務する場合がある（例：月・水は渋谷店、金は原宿店）。
2. **レンタルスペース (Room-based):** 部屋は特定の店舗（Location）に物理的に固定される。

**技術スタック (2025 Standard):**

- **Framework:** Shopify App Remix Template (SSR/Loader/Action pattern)
- **Database:** PostgreSQL (via Prisma ORM)
- **Frontend:** Shopify App Embed Block (React/Preact) for Storefront
- **API:** Shopify Admin GraphQL API (2025-10 or latest stable)
- **Validation:** Shopify Functions (Cart & Checkout Validation API)

---

## 2. Database Schema (データベース設計)

Instruction for AI:

Implement the following schema.prisma. It strictly separates "Resource Definition" from "Availability".

Key Logic: A Resource belongs to a Shop. A Schedule belongs to a specific Resource at a specific Location.

コード スニペット

```jsx
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id          String    @id
  shop        String
  state       String
  isOnline    Boolean   @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?
}

// --- Domain Models ---

model Shop {
  id          String     @id // Shopify Domain (e.g. store.myshopify.com)
  name        String?
  plan        String?
  
  // Relations
  locations   Location
  resources   Resource
  bookings    Booking
  
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

// Synced from Shopify Admin API (LOCATIONS_CREATE/UPDATE webhook)
model Location {
  id                String   @id @default(uuid())
  shopifyLocationId String   @unique // gid://shopify/Location/12345
  shopId            String
  name              String
  isActive          Boolean  @default(true)
  timezone          String   @default("Asia/Tokyo")

  shop              Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  
  // Relations
  schedules         Schedule
  bookings          Booking

  @@index([shopId])
}

enum ResourceType {
  STAFF           // Capacity = 1, Can move between locations
  ROOM            // Capacity = 1, Fixed to location
  EQUIPMENT       // Capacity >= 1
}

model Resource {
  id          String        @id @default(uuid())
  shopId      String
  name        String        // "Stylist Sato", "Room A"
  type        ResourceType
  
  // Base attributes
  metadata    Json?         // { "skills": ["cut"], "floor": 1 }

  shop        Shop          @relation(fields: [shopId], references: [id], onDelete: Cascade)

  // Relations
  schedules        Schedule
  resourceServices ResourceService
  bookings         Booking

  @@index([shopId])
}

model Service {
  id            String   @id @default(uuid())
  shopId        String
  
  // Link to Shopify Product
  productId     String   // gid://shopify/Product/12345
  variantId     String?  
  
  name          String   // "Cut & Color 60min"
  durationMin   Int      // Base duration
  bufferTimeMin Int      @default(0)

  // Relations
  resourceServices ResourceService
  bookings         Booking
}

// Junction: Who can perform what service?
model ResourceService {
  id          String   @id @default(uuid())
  resourceId  String
  serviceId   String
  
  // Overrides per staff
  customDuration Int?  
  customPrice    Decimal?

  resource    Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  service     Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([resourceId, serviceId])
}

// Availability Logic: "Resource X is available at Location Y on Monday"
model Schedule {
  id          String   @id @default(uuid())
  resourceId  String
  locationId  String   // Critical for multi-location
  
  dayOfWeek   Int      // 0=Sun, 1=Mon...
  startTime   String   // "09:00"
  endTime     String   // "18:00"
  
  // Specific Date Override (High Priority)
  specificDate DateTime? @db.Date 
  
  isAvailable Boolean  @default(true)

  resource    Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  location    Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@index([resourceId, locationId])
}

enum BookingStatus {
  PENDING_PAYMENT // In cart
  CONFIRMED       // Paid
  CANCELLED
}

model Booking {
  id            String        @id @default(uuid())
  shopId        String
  locationId    String        // Where this booking happens
  
  resourceId    String
  resource      Resource      @relation(fields: [resourceId], references: [id])
  
  serviceId     String
  service       Service       @relation(fields: [serviceId], references: [id])
  
  startAt       DateTime      // UTC
  endAt         DateTime      // UTC
  
  status        BookingStatus @default(PENDING_PAYMENT)
  
  // Shopify Integration
  orderId       String?       
  lineItemId    String?       
  
  shop          Shop          @relation(fields: [shopId], references: [id])
  location      Location      @relation(fields: [locationId], references: [id])

  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@index([resourceId, startAt, endAt])
  @@index([locationId])
}
```

---

## 3. Core Logic Specification (ロジック仕様)

### 3.1 Availability Engine (空き枠計算)

**Function:** `getAvailableSlots(locationId, resourceId, date, serviceDuration)`

1. **Filter by Location:** Must only fetch `Schedule` records where `locationId` matches. This prevents booking a staff member in Tokyo when they are scheduled in Osaka.
2. **Shift Priority:**
    - Look for `specificDate` (Holiday/Special shift) first.
    - If null, look for `dayOfWeek` (Regular shift).
3. **Buffer Handling:**
    - `BlockStart = Booking.startAt - Buffer`
    - `BlockEnd = Booking.endAt + Buffer`
4. **Output:** Return slots valid ONLY for the requested Location.

### 3.2 Shopify Integration (データ同期)

1. **Locations Sync:**
    - Use `LOCATIONS_CREATE`, `LOCATIONS_UPDATE` webhooks to keep the Prisma `Location` table in sync with Shopify settings.
2. **Cart Line Properties:**
    - Inject `_BookingStart`, `_ResourceId`, `_LocationId` into the cart item.
    - `_` (underscore) hides these properties from the customer checkout UI but keeps them visible to the backend.

---

## 4. Implementation Phases (開発工程)

**Note to AI:** Execute in order. Do not skip testing steps.

### Phase 1: Foundation & Location Sync

1. Setup Remix app & Prisma with the schema above.
2. **Critical:** Implement `webhooks/app.locations_update.tsx` to pull initial Locations from Shopify Admin API.
3. Create Admin UI to view synced Locations (`/app/locations`).

### Phase 2: Resource & Schedule Management

1. Create `Resources` CRUD page.
2. Create `Schedule` assignment UI.
    - *UI Requirement:* When editing a Resource's schedule, allow selecting *which Location* the shift applies to.
    - e.g., "Monday: 09:00-18:00 @ Tokyo Store", "Tuesday: 09:00-18:00 @ Osaka Store".

### Phase 3: Public API (App Proxy)

1. Create `app/routes/app.proxy.availability.tsx`.
2. Accept `?date=YYYY-MM-DD&locationId=...&resourceId=...`.
3. Return JSON availability. Ensure proper JSON headers are set to avoid Liquid rendering issues.

### Phase 4: Storefront UI (Theme Extension)

1. Create App Embed Block `booking-widget`.
2. **UI Flow:**
    - Step 1: Select Location (if multiple exist).
    - Step 2: Select Resource (Staff/Room).
    - Step 3: Select Date & Time.
    - Step 4: Add to Cart (with Line Item Properties).

---

## 5. Technical Constraints (技術制約)

1. **Timezone:** DB must store all times in **UTC**. Conversion to "Asia/Tokyo" happens only at the presentation layer (Admin UI / Storefront UI).
2. **Validation:** Use **Shopify Functions (Cart Validation)** to prevent tampering with `_BookingStart` time in the cart.
3. **Authentication:**
    - Admin: `authenticate.admin(request)`
    - Proxy: `authenticate.public.appProxy(request)`
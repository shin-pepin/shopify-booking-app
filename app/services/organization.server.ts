/**
 * 組織・多店舗管理サービス
 *
 * Maxプラン向けの複数店舗管理機能
 */

import db from "../db.server";
import type { StaffRole } from "@prisma/client";

// === Types ===

export interface OrganizationInfo {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName: string | null;
  logoUrl: string | null;
  shops: Array<{
    id: string;
    name: string | null;
  }>;
  staffCount: number;
}

export interface StaffPermissions {
  canAccessShop: (shopId: string) => boolean;
  canManageShop: (shopId: string) => boolean;
  canViewAllShops: boolean;
  canManageStaff: boolean;
  canManageOrganization: boolean;
  role: StaffRole;
  allowedShopIds: string[];
}

export interface AccessCheckResult {
  allowed: boolean;
  error?: string;
  permissions?: StaffPermissions;
}

// === Helper Functions ===

/**
 * Maxプランかどうかをチェック
 */
export async function isMaxPlan(shopId: string): Promise<boolean> {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { planType: true },
  });

  return shop?.planType === "MAX";
}

/**
 * ショップが組織に所属しているかチェック
 */
export async function getShopOrganization(shopId: string) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: {
      organization: {
        include: {
          shops: { select: { id: true, name: true } },
          _count: { select: { staffMembers: true } },
        },
      },
    },
  });

  if (!shop?.organization) {
    return null;
  }

  return {
    id: shop.organization.id,
    name: shop.organization.name,
    ownerEmail: shop.organization.ownerEmail,
    ownerName: shop.organization.ownerName,
    logoUrl: shop.organization.logoUrl,
    shops: shop.organization.shops,
    staffCount: shop.organization._count.staffMembers,
  };
}

/**
 * メールアドレスからスタッフメンバーを取得
 */
export async function getStaffMemberByEmail(
  organizationId: string,
  email: string
) {
  return db.staffMember.findFirst({
    where: {
      organizationId,
      email,
      isActive: true,
    },
  });
}

/**
 * スタッフの権限を取得
 */
export function getStaffPermissions(
  role: StaffRole,
  allowedShopIds: string[] = []
): StaffPermissions {
  const isOwner = role === "OWNER";
  const isManager = role === "MANAGER";

  return {
    canAccessShop: (shopId: string) => {
      if (isOwner) return true;
      return allowedShopIds.includes(shopId);
    },
    canManageShop: (shopId: string) => {
      if (isOwner) return true;
      if (isManager) return allowedShopIds.includes(shopId);
      return false;
    },
    canViewAllShops: isOwner,
    canManageStaff: isOwner,
    canManageOrganization: isOwner,
    role,
    allowedShopIds,
  };
}

/**
 * allowedShopIdsをパース（カンマ区切り文字列から配列へ）
 */
export function parseAllowedShopIds(allowedShopIds: string | null): string[] {
  if (!allowedShopIds) return [];
  return allowedShopIds.split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * allowedShopIdsをシリアライズ（配列からカンマ区切り文字列へ）
 */
export function serializeAllowedShopIds(shopIds: string[]): string {
  return shopIds.filter(Boolean).join(",");
}

// === Organization CRUD ===

/**
 * 組織を作成
 */
export async function createOrganization(data: {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  initialShopId: string;
}) {
  // Maxプランチェック
  if (!(await isMaxPlan(data.initialShopId))) {
    throw new Error("組織機能はMaxプランでのみ利用可能です");
  }

  // 組織を作成し、オーナーをスタッフとして追加
  const organization = await db.organization.create({
    data: {
      name: data.name,
      ownerEmail: data.ownerEmail,
      ownerName: data.ownerName,
      shops: {
        connect: { id: data.initialShopId },
      },
      staffMembers: {
        create: {
          email: data.ownerEmail,
          name: data.ownerName,
          role: "OWNER",
          isActive: true,
          acceptedAt: new Date(),
        },
      },
    },
    include: {
      shops: true,
      staffMembers: true,
    },
  });

  return organization;
}

/**
 * 組織に店舗を追加
 */
export async function addShopToOrganization(
  organizationId: string,
  shopId: string
) {
  // 対象店舗がMaxプランかチェック
  if (!(await isMaxPlan(shopId))) {
    throw new Error("追加する店舗はMaxプランである必要があります");
  }

  return db.shop.update({
    where: { id: shopId },
    data: { organizationId },
  });
}

/**
 * 組織から店舗を削除
 */
export async function removeShopFromOrganization(shopId: string) {
  return db.shop.update({
    where: { id: shopId },
    data: { organizationId: null },
  });
}

/**
 * 組織情報を更新
 */
export async function updateOrganization(
  organizationId: string,
  data: {
    name?: string;
    ownerName?: string;
    logoUrl?: string;
    timezone?: string;
  }
) {
  return db.organization.update({
    where: { id: organizationId },
    data,
  });
}

// === Staff Management ===

/**
 * スタッフを招待
 */
export async function inviteStaffMember(data: {
  organizationId: string;
  email: string;
  name?: string;
  role: StaffRole;
  allowedShopIds?: string[];
}) {
  // 既存チェック
  const existing = await db.staffMember.findFirst({
    where: {
      organizationId: data.organizationId,
      email: data.email,
    },
  });

  if (existing) {
    throw new Error("このメールアドレスは既に招待されています");
  }

  return db.staffMember.create({
    data: {
      organizationId: data.organizationId,
      email: data.email,
      name: data.name,
      role: data.role,
      allowedShopIds: data.allowedShopIds
        ? serializeAllowedShopIds(data.allowedShopIds)
        : null,
      isActive: true,
    },
  });
}

/**
 * スタッフメンバーを更新
 */
export async function updateStaffMember(
  staffMemberId: string,
  data: {
    name?: string;
    role?: StaffRole;
    allowedShopIds?: string[];
    isActive?: boolean;
  }
) {
  return db.staffMember.update({
    where: { id: staffMemberId },
    data: {
      name: data.name,
      role: data.role,
      allowedShopIds: data.allowedShopIds
        ? serializeAllowedShopIds(data.allowedShopIds)
        : undefined,
      isActive: data.isActive,
    },
  });
}

/**
 * スタッフメンバーを削除
 */
export async function removeStaffMember(staffMemberId: string) {
  return db.staffMember.delete({
    where: { id: staffMemberId },
  });
}

/**
 * 組織のスタッフ一覧を取得
 */
export async function getOrganizationStaff(organizationId: string) {
  return db.staffMember.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

// === Access Control ===

/**
 * 現在のユーザーのアクセス権限をチェック
 */
export async function checkAccess(
  shopId: string,
  userEmail: string
): Promise<AccessCheckResult> {
  // ショップ情報を取得
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: { organization: true },
  });

  if (!shop) {
    return { allowed: false, error: "ショップが見つかりません" };
  }

  // 組織に所属していない場合は常にアクセス可能（単一店舗）
  if (!shop.organizationId || !shop.organization) {
    return {
      allowed: true,
      permissions: getStaffPermissions("OWNER", [shopId]),
    };
  }

  // スタッフメンバーを検索
  const staffMember = await getStaffMemberByEmail(
    shop.organizationId,
    userEmail
  );

  if (!staffMember) {
    return { allowed: false, error: "アクセス権限がありません" };
  }

  if (!staffMember.isActive) {
    return { allowed: false, error: "アカウントが無効化されています" };
  }

  const allowedShopIds = parseAllowedShopIds(staffMember.allowedShopIds);
  const permissions = getStaffPermissions(staffMember.role, allowedShopIds);

  // このショップへのアクセス権があるかチェック
  if (!permissions.canAccessShop(shopId)) {
    return { allowed: false, error: "この店舗へのアクセス権限がありません" };
  }

  return { allowed: true, permissions };
}

/**
 * 組織の全店舗の予約を取得（統合ダッシュボード用）
 */
export async function getOrganizationBookings(
  organizationId: string,
  options: {
    status?: string;
    fromDate?: Date;
    toDate?: Date;
    shopIds?: string[]; // 特定の店舗のみ
    limit?: number;
  } = {}
) {
  // 組織の店舗IDを取得
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: { shops: { select: { id: true } } },
  });

  if (!organization) {
    throw new Error("組織が見つかりません");
  }

  const allShopIds = organization.shops.map((s) => s.id);
  const targetShopIds = options.shopIds
    ? options.shopIds.filter((id) => allShopIds.includes(id))
    : allShopIds;

  // 予約を取得
  const bookings = await db.booking.findMany({
    where: {
      shopId: { in: targetShopIds },
      ...(options.status ? { status: options.status as any } : {}),
      ...(options.fromDate || options.toDate
        ? {
            startAt: {
              ...(options.fromDate ? { gte: options.fromDate } : {}),
              ...(options.toDate ? { lte: options.toDate } : {}),
            },
          }
        : {}),
    },
    include: {
      shop: { select: { id: true, name: true } },
      resource: { select: { name: true } },
      location: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startAt: "desc" },
    take: options.limit || 100,
  });

  return bookings;
}

/**
 * 組織の統計情報を取得
 */
export async function getOrganizationStats(organizationId: string) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      shops: {
        select: {
          id: true,
          name: true,
          currentMonthUsage: true,
          planType: true,
        },
      },
      _count: { select: { staffMembers: true } },
    },
  });

  if (!organization) {
    throw new Error("組織が見つかりません");
  }

  const shopIds = organization.shops.map((s) => s.id);

  // 今日の予約数
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayBookings = await db.booking.count({
    where: {
      shopId: { in: shopIds },
      status: "CONFIRMED",
      startAt: { gte: today, lt: tomorrow },
    },
  });

  // 今月の総予約数
  const totalMonthUsage = organization.shops.reduce(
    (sum, shop) => sum + shop.currentMonthUsage,
    0
  );

  // 各店舗の今日の予約数
  const shopStats = await Promise.all(
    organization.shops.map(async (shop) => {
      const todayCount = await db.booking.count({
        where: {
          shopId: shop.id,
          status: "CONFIRMED",
          startAt: { gte: today, lt: tomorrow },
        },
      });

      return {
        id: shop.id,
        name: shop.name || shop.id,
        todayBookings: todayCount,
        monthUsage: shop.currentMonthUsage,
      };
    })
  );

  return {
    organization: {
      id: organization.id,
      name: organization.name,
    },
    totalShops: organization.shops.length,
    totalStaff: organization._count.staffMembers,
    todayBookings,
    totalMonthUsage,
    shopStats,
  };
}


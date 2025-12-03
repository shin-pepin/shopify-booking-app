/**
 * Quota Service - 使用量管理
 *
 * 予約数のカウントと制限ロジックを管理
 */

import db from "../db.server";
import { BILLING_PLANS, type PlanKey } from "../shopify.server";
import type { PlanType } from "@prisma/client";

// === Types ===

export interface UsageInfo {
  /** 現在の使用量 */
  currentUsage: number;
  /** 上限 */
  usageLimit: number;
  /** 残り */
  remaining: number;
  /** 使用率（%） */
  usagePercentage: number;
  /** 上限到達フラグ */
  isLimitReached: boolean;
  /** プランタイプ */
  planType: PlanType;
  /** プラン名 */
  planName: string;
  /** サイクル開始日 */
  cycleStart: Date;
  /** サイクル終了日（予測） */
  cycleEnd: Date;
}

export interface QuotaCheckResult {
  /** 予約可能かどうか */
  allowed: boolean;
  /** エラーメッセージ（許可されない場合） */
  error?: string;
  /** 使用量情報 */
  usage: UsageInfo;
}

// === Helper Functions ===

/**
 * PlanTypeからプラン設定を取得
 */
function getPlanConfig(planType: PlanType) {
  const planMap: Record<PlanType, (typeof BILLING_PLANS)[PlanKey]> = {
    FREE: BILLING_PLANS.FREE,
    STANDARD: BILLING_PLANS.STANDARD,
    PRO: BILLING_PLANS.PRO,
    MAX: BILLING_PLANS.MAX,
  };
  return planMap[planType] || BILLING_PLANS.FREE;
}

/**
 * 使用量サイクルをリセットする必要があるかチェック
 * 30日ごとにリセット
 */
function shouldResetCycle(cycleStart: Date): boolean {
  const now = new Date();
  const daysSinceCycleStart = Math.floor(
    (now.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysSinceCycleStart >= 30;
}

/**
 * サイクル終了日を計算
 */
function calculateCycleEnd(cycleStart: Date): Date {
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + 30);
  return cycleEnd;
}

// === Main Functions ===

/**
 * ショップの使用量情報を取得
 */
export async function getShopUsageInfo(shopId: string): Promise<UsageInfo> {
  let shop = await db.shop.findUnique({
    where: { id: shopId },
  });

  if (!shop) {
    // ショップが存在しない場合は作成
    shop = await db.shop.create({
      data: {
        id: shopId,
        name: shopId,
        planType: "FREE",
        currentMonthUsage: 0,
        usageCycleStart: new Date(),
      },
    });
  }

  // サイクルリセットが必要かチェック
  if (shouldResetCycle(shop.usageCycleStart)) {
    shop = await db.shop.update({
      where: { id: shopId },
      data: {
        currentMonthUsage: 0,
        usageCycleStart: new Date(),
      },
    });
  }

  const planConfig = getPlanConfig(shop.planType);
  const usageLimit = planConfig.usageLimit;
  const currentUsage = shop.currentMonthUsage;
  const remaining = Math.max(0, usageLimit - currentUsage);
  const usagePercentage =
    usageLimit === Infinity ? 0 : Math.min(100, (currentUsage / usageLimit) * 100);

  return {
    currentUsage,
    usageLimit,
    remaining,
    usagePercentage,
    isLimitReached: usageLimit !== Infinity && currentUsage >= usageLimit,
    planType: shop.planType,
    planName: planConfig.name,
    cycleStart: shop.usageCycleStart,
    cycleEnd: calculateCycleEnd(shop.usageCycleStart),
  };
}

/**
 * 予約が可能かチェック（Quota確認）
 */
export async function checkQuota(shopId: string): Promise<QuotaCheckResult> {
  const usage = await getShopUsageInfo(shopId);

  if (usage.isLimitReached) {
    return {
      allowed: false,
      error: `予約上限（${usage.usageLimit}件/月）に達しました。プランをアップグレードしてください。`,
      usage,
    };
  }

  return {
    allowed: true,
    usage,
  };
}

/**
 * 使用量をインクリメント（予約確定時に呼び出し）
 */
export async function incrementUsage(
  shopId: string,
  count: number = 1
): Promise<UsageInfo> {
  // まず現在の情報を取得（サイクルリセットを含む）
  await getShopUsageInfo(shopId);

  // 使用量をインクリメント
  const shop = await db.shop.update({
    where: { id: shopId },
    data: {
      currentMonthUsage: {
        increment: count,
      },
    },
  });

  // 更新後の情報を返却
  return getShopUsageInfo(shopId);
}

/**
 * 使用量をデクリメント（予約キャンセル時に呼び出し）
 */
export async function decrementUsage(
  shopId: string,
  count: number = 1
): Promise<UsageInfo> {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  // 0以下にならないようにする
  const newUsage = Math.max(0, shop.currentMonthUsage - count);

  await db.shop.update({
    where: { id: shopId },
    data: {
      currentMonthUsage: newUsage,
    },
  });

  return getShopUsageInfo(shopId);
}

/**
 * プランを更新
 */
export async function updateShopPlan(
  shopId: string,
  planType: PlanType,
  billingId?: string
): Promise<void> {
  const planConfig = getPlanConfig(planType);

  await db.shop.upsert({
    where: { id: shopId },
    update: {
      planType,
      planName: planConfig.name,
      billingId,
    },
    create: {
      id: shopId,
      name: shopId,
      planType,
      planName: planConfig.name,
      billingId,
      currentMonthUsage: 0,
      usageCycleStart: new Date(),
    },
  });
}

/**
 * 直近30日間の予約数を計算（より正確なカウント）
 */
export async function getLast30DaysBookingCount(shopId: string): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const count = await db.booking.count({
    where: {
      shopId,
      status: "CONFIRMED",
      createdAt: {
        gte: thirtyDaysAgo,
      },
    },
  });

  return count;
}

/**
 * 使用量を再計算してDBを更新（整合性チェック用）
 */
export async function recalculateUsage(shopId: string): Promise<UsageInfo> {
  const actualCount = await getLast30DaysBookingCount(shopId);

  await db.shop.update({
    where: { id: shopId },
    data: {
      currentMonthUsage: actualCount,
    },
  });

  return getShopUsageInfo(shopId);
}

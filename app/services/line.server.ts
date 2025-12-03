/**
 * LINE Messaging API サービス
 *
 * Proプラン以上で利用可能なLINE連携機能
 */

import crypto from "crypto";
import db from "../db.server";

// === Types ===

export interface LineMessageRequest {
  shopId: string;
  lineUserId: string;
  messages: LineMessage[];
}

export interface LineMessage {
  type: "text" | "flex";
  text?: string;
  altText?: string;
  contents?: unknown; // Flex Message contents
}

export interface LinePushResult {
  success: boolean;
  error?: string;
}

export interface LineWebhookEvent {
  type: string;
  timestamp: number;
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  message?: {
    type: string;
    id: string;
    text?: string;
  };
  postback?: {
    data: string;
  };
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

// === Helper Functions ===

/**
 * LINE Webhook署名を検証
 */
export function verifyLineSignature(
  body: string,
  signature: string,
  channelSecret: string
): boolean {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

/**
 * プランがLINE連携可能かチェック
 */
export async function canUseLine(shopId: string): Promise<boolean> {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { planType: true },
  });

  if (!shop) return false;

  // PRO または MAX プランのみ
  return shop.planType === "PRO" || shop.planType === "MAX";
}

/**
 * LINE設定を取得（存在しない場合はnull）
 */
export async function getLineConfig(shopId: string) {
  return db.lineConfig.findUnique({
    where: { shopId },
  });
}

/**
 * LINE設定を保存
 */
export async function saveLineConfig(
  shopId: string,
  config: {
    channelId: string;
    channelSecret: string;
    accessToken: string;
    notifyOnConfirm?: boolean;
    notifyOnCancel?: boolean;
    notifyReminder?: boolean;
    reminderHours?: number;
    isEnabled?: boolean;
  }
) {
  return db.lineConfig.upsert({
    where: { shopId },
    update: {
      channelId: config.channelId,
      channelSecret: config.channelSecret,
      accessToken: config.accessToken,
      notifyOnConfirm: config.notifyOnConfirm ?? true,
      notifyOnCancel: config.notifyOnCancel ?? true,
      notifyReminder: config.notifyReminder ?? false,
      reminderHours: config.reminderHours ?? 24,
      isEnabled: config.isEnabled ?? false,
    },
    create: {
      shopId,
      channelId: config.channelId,
      channelSecret: config.channelSecret,
      accessToken: config.accessToken,
      notifyOnConfirm: config.notifyOnConfirm ?? true,
      notifyOnCancel: config.notifyOnCancel ?? true,
      notifyReminder: config.notifyReminder ?? false,
      reminderHours: config.reminderHours ?? 24,
      isEnabled: config.isEnabled ?? false,
    },
  });
}

// === LINE API Functions ===

/**
 * LINEにプッシュメッセージを送信
 */
export async function sendLinePushMessage(
  request: LineMessageRequest
): Promise<LinePushResult> {
  const config = await getLineConfig(request.shopId);

  if (!config || !config.isEnabled) {
    return { success: false, error: "LINE連携が設定されていません" };
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        to: request.lineUserId,
        messages: request.messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE] Push message failed:", errorText);
      return { success: false, error: `LINE API Error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error("[LINE] Push message error:", error);
    return { success: false, error: "LINE送信に失敗しました" };
  }
}

/**
 * LINEにリプライメッセージを送信
 */
export async function sendLineReplyMessage(
  shopId: string,
  replyToken: string,
  messages: LineMessage[]
): Promise<LinePushResult> {
  const config = await getLineConfig(shopId);

  if (!config || !config.isEnabled) {
    return { success: false, error: "LINE連携が設定されていません" };
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE] Reply message failed:", errorText);
      return { success: false, error: `LINE API Error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error("[LINE] Reply message error:", error);
    return { success: false, error: "LINE送信に失敗しました" };
  }
}

// === User Link Functions ===

/**
 * ShopifyカスタマーとLINEユーザーを連携
 */
export async function linkLineUser(
  shopId: string,
  customerId: string,
  lineUserId: string,
  customerEmail?: string,
  lineDisplayName?: string,
  linePictureUrl?: string
) {
  return db.lineUserLink.upsert({
    where: {
      shopId_customerId: { shopId, customerId },
    },
    update: {
      lineUserId,
      customerEmail,
      lineDisplayName,
      linePictureUrl,
      isLinked: true,
      linkedAt: new Date(),
    },
    create: {
      shopId,
      customerId,
      lineUserId,
      customerEmail,
      lineDisplayName,
      linePictureUrl,
      isLinked: true,
    },
  });
}

/**
 * LINE連携を解除
 */
export async function unlinkLineUser(shopId: string, customerId: string) {
  return db.lineUserLink.updateMany({
    where: { shopId, customerId },
    data: { isLinked: false },
  });
}

/**
 * Shopify Customer IDからLINE User IDを取得
 */
export async function getLineUserIdByCustomerId(
  shopId: string,
  customerId: string
): Promise<string | null> {
  const link = await db.lineUserLink.findFirst({
    where: {
      shopId,
      customerId,
      isLinked: true,
      notifyEnabled: true,
    },
  });

  return link?.lineUserId || null;
}

/**
 * LINE User IDからShopify Customer IDを取得
 */
export async function getCustomerIdByLineUserId(
  shopId: string,
  lineUserId: string
): Promise<string | null> {
  const link = await db.lineUserLink.findFirst({
    where: {
      shopId,
      lineUserId,
      isLinked: true,
    },
  });

  return link?.customerId || null;
}

// === Notification Functions ===

/**
 * 予約確定時のLINE通知を送信
 */
export async function sendBookingConfirmationNotification(
  shopId: string,
  booking: {
    id: string;
    customerId?: string | null;
    customerName?: string | null;
    startAt: Date;
    endAt: Date;
    resourceName: string;
    locationName: string;
    serviceName?: string;
  }
): Promise<LinePushResult> {
  // プランチェック
  if (!(await canUseLine(shopId))) {
    return { success: false, error: "LINE連携はPro/Maxプランで利用可能です" };
  }

  // 設定チェック
  const config = await getLineConfig(shopId);
  if (!config || !config.isEnabled || !config.notifyOnConfirm) {
    return { success: false, error: "LINE通知が無効です" };
  }

  // 顧客IDがない場合はスキップ
  if (!booking.customerId) {
    return { success: false, error: "顧客IDがありません" };
  }

  // LINE User IDを取得
  const lineUserId = await getLineUserIdByCustomerId(shopId, booking.customerId);
  if (!lineUserId) {
    return { success: false, error: "LINE連携されていません" };
  }

  // 日時フォーマット
  const dateStr = booking.startAt.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timeStr = `${booking.startAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} - ${booking.endAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;

  // メッセージ作成
  const message: LineMessage = {
    type: "text",
    text: `🎉 ご予約が確定しました

📅 ${dateStr}
🕐 ${timeStr}
📍 ${booking.locationName}
👤 ${booking.resourceName}
${booking.serviceName ? `📋 ${booking.serviceName}` : ""}

ご来店をお待ちしております。`,
  };

  // 送信
  const result = await sendLinePushMessage({
    shopId,
    lineUserId,
    messages: [message],
  });

  // 送信成功時にフラグを更新
  if (result.success) {
    await db.booking.update({
      where: { id: booking.id },
      data: { lineNotificationSent: true },
    });
  }

  return result;
}

/**
 * 予約キャンセル時のLINE通知を送信
 */
export async function sendBookingCancellationNotification(
  shopId: string,
  booking: {
    id: string;
    customerId?: string | null;
    customerName?: string | null;
    startAt: Date;
    locationName: string;
    serviceName?: string;
  }
): Promise<LinePushResult> {
  // プランチェック
  if (!(await canUseLine(shopId))) {
    return { success: false, error: "LINE連携はPro/Maxプランで利用可能です" };
  }

  // 設定チェック
  const config = await getLineConfig(shopId);
  if (!config || !config.isEnabled || !config.notifyOnCancel) {
    return { success: false, error: "LINE通知が無効です" };
  }

  // 顧客IDがない場合はスキップ
  if (!booking.customerId) {
    return { success: false, error: "顧客IDがありません" };
  }

  // LINE User IDを取得
  const lineUserId = await getLineUserIdByCustomerId(shopId, booking.customerId);
  if (!lineUserId) {
    return { success: false, error: "LINE連携されていません" };
  }

  // 日時フォーマット
  const dateStr = booking.startAt.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  // メッセージ作成
  const message: LineMessage = {
    type: "text",
    text: `📢 ご予約がキャンセルされました

📅 ${dateStr}
📍 ${booking.locationName}
${booking.serviceName ? `📋 ${booking.serviceName}` : ""}

またのご予約をお待ちしております。`,
  };

  // 送信
  return sendLinePushMessage({
    shopId,
    lineUserId,
    messages: [message],
  });
}

/**
 * ID連携用のURLを生成
 */
export function generateLineLinkUrl(
  shopId: string,
  customerId: string,
  baseUrl: string
): string {
  // stateパラメータに顧客情報をエンコード
  const state = Buffer.from(
    JSON.stringify({ shopId, customerId, ts: Date.now() })
  ).toString("base64url");

  return `${baseUrl}/apps/booking/line/link?state=${state}`;
}

/**
 * LINE連携用のstateをデコード
 */
export function decodeLinkState(state: string): {
  shopId: string;
  customerId: string;
  ts: number;
} | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}


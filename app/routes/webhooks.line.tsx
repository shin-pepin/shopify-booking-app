import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import {
  verifyLineSignature,
  getLineConfig,
  linkLineUser,
  sendLineReplyMessage,
  decodeLinkState,
  type LineWebhookBody,
  type LineWebhookEvent,
} from "../services/line.server";

/**
 * LINE Webhook Handler
 *
 * LINEからのイベント（メッセージ、フォロー、ポストバック等）を受け取る
 * 署名検証を必ず行う
 *
 * @endpoint POST /webhooks/line
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // POSTメソッドのみ許可
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // リクエストボディを取得
  const bodyText = await request.text();

  // X-Line-Signatureヘッダーを取得
  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    console.error("[LINE Webhook] Missing signature header");
    return new Response("Missing signature", { status: 401 });
  }

  // リクエストボディをパース
  let body: LineWebhookBody;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    console.error("[LINE Webhook] Invalid JSON body");
    return new Response("Invalid JSON", { status: 400 });
  }

  // destinationからショップを特定
  // LINE Webhook URLにショップ情報を含めるか、destinationで判別する
  // ここではすべてのショップのLINE設定をチェック
  const lineConfigs = await db.lineConfig.findMany({
    where: { isEnabled: true },
  });

  // 署名検証
  let matchedConfig = null;
  for (const config of lineConfigs) {
    if (verifyLineSignature(bodyText, signature, config.channelSecret)) {
      matchedConfig = config;
      break;
    }
  }

  if (!matchedConfig) {
    console.error("[LINE Webhook] Signature verification failed");
    return new Response("Invalid signature", { status: 401 });
  }

  const shopId = matchedConfig.shopId;
  console.log(`[LINE Webhook] Received events for shop: ${shopId}`);

  // イベント処理
  for (const event of body.events) {
    try {
      await processLineEvent(shopId, event);
    } catch (error) {
      console.error("[LINE Webhook] Event processing error:", error);
    }
  }

  return new Response("OK", { status: 200 });
};

/**
 * LINEイベントを処理
 */
async function processLineEvent(
  shopId: string,
  event: LineWebhookEvent
): Promise<void> {
  console.log(`[LINE Webhook] Processing event: ${event.type}`);

  switch (event.type) {
    case "follow":
      // ユーザーがBotを友だち追加
      await handleFollowEvent(shopId, event);
      break;

    case "unfollow":
      // ユーザーがBotをブロック
      await handleUnfollowEvent(shopId, event);
      break;

    case "message":
      // メッセージ受信
      await handleMessageEvent(shopId, event);
      break;

    case "postback":
      // ポストバックイベント（ボタンクリック等）
      await handlePostbackEvent(shopId, event);
      break;

    default:
      console.log(`[LINE Webhook] Unhandled event type: ${event.type}`);
  }
}

/**
 * フォローイベント処理
 */
async function handleFollowEvent(
  shopId: string,
  event: LineWebhookEvent
): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;

  console.log(`[LINE Webhook] User followed: ${lineUserId}`);

  // ウェルカムメッセージを送信
  if (event.replyToken) {
    await sendLineReplyMessage(shopId, event.replyToken, [
      {
        type: "text",
        text: `友だち追加ありがとうございます！🎉

予約通知を受け取るには、ショップのマイページから「LINE連携」を行ってください。

連携が完了すると、予約確定・キャンセル時にLINEでお知らせします。`,
      },
    ]);
  }
}

/**
 * アンフォローイベント処理
 */
async function handleUnfollowEvent(
  shopId: string,
  event: LineWebhookEvent
): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;

  console.log(`[LINE Webhook] User unfollowed: ${lineUserId}`);

  // LINE連携を無効化
  await db.lineUserLink.updateMany({
    where: { shopId, lineUserId },
    data: { isLinked: false, notifyEnabled: false },
  });
}

/**
 * メッセージイベント処理
 */
async function handleMessageEvent(
  shopId: string,
  event: LineWebhookEvent
): Promise<void> {
  const lineUserId = event.source.userId;
  const message = event.message;

  if (!lineUserId || !message) return;

  console.log(`[LINE Webhook] Message from ${lineUserId}: ${message.text}`);

  // テキストメッセージの場合
  if (message.type === "text" && message.text) {
    const text = message.text.toLowerCase().trim();

    // 連携コード受信の場合
    if (text.startsWith("link:")) {
      const state = text.replace("link:", "").trim();
      await handleLinkRequest(shopId, lineUserId, state, event.replyToken);
      return;
    }

    // 予約確認コマンド
    if (text === "予約確認" || text === "予約" || text === "booking") {
      await handleBookingInquiry(shopId, lineUserId, event.replyToken);
      return;
    }

    // ヘルプコマンド
    if (text === "ヘルプ" || text === "help") {
      if (event.replyToken) {
        await sendLineReplyMessage(shopId, event.replyToken, [
          {
            type: "text",
            text: `📖 使い方ガイド

【予約確認】
「予約確認」と送信すると、今後の予約を確認できます。

【LINE連携】
ショップのマイページから連携コードを取得し、「link:コード」の形式で送信してください。

【通知設定】
予約の確定・キャンセル時にLINEでお知らせします。`,
          },
        ]);
      }
      return;
    }

    // 不明なメッセージ
    if (event.replyToken) {
      await sendLineReplyMessage(shopId, event.replyToken, [
        {
          type: "text",
          text: `メッセージありがとうございます。

「ヘルプ」と送信すると、使い方を確認できます。`,
        },
      ]);
    }
  }
}

/**
 * ポストバックイベント処理
 */
async function handlePostbackEvent(
  shopId: string,
  event: LineWebhookEvent
): Promise<void> {
  const lineUserId = event.source.userId;
  const postback = event.postback;

  if (!lineUserId || !postback) return;

  console.log(`[LINE Webhook] Postback from ${lineUserId}: ${postback.data}`);

  // ポストバックデータをパース
  const params = new URLSearchParams(postback.data);
  const action = params.get("action");

  switch (action) {
    case "confirm_booking":
      // 予約確認
      await handleBookingInquiry(shopId, lineUserId, event.replyToken);
      break;

    case "unlink":
      // 連携解除
      await handleUnlinkRequest(shopId, lineUserId, event.replyToken);
      break;

    default:
      console.log(`[LINE Webhook] Unknown postback action: ${action}`);
  }
}

/**
 * LINE連携リクエストを処理
 */
async function handleLinkRequest(
  shopId: string,
  lineUserId: string,
  state: string,
  replyToken?: string
): Promise<void> {
  // stateをデコード
  const decoded = decodeLinkState(state);

  if (!decoded) {
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "連携コードが無効です。再度マイページから取得してください。",
        },
      ]);
    }
    return;
  }

  // タイムスタンプチェック（30分以内）
  if (Date.now() - decoded.ts > 30 * 60 * 1000) {
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "連携コードの有効期限が切れています。再度マイページから取得してください。",
        },
      ]);
    }
    return;
  }

  // ショップIDチェック
  if (decoded.shopId !== shopId) {
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "連携コードが正しくありません。",
        },
      ]);
    }
    return;
  }

  try {
    // LINE連携を保存
    await linkLineUser(shopId, decoded.customerId, lineUserId);

    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: `✅ LINE連携が完了しました！

今後、予約の確定やキャンセル時にLINEでお知らせします。

「予約確認」と送信すると、現在の予約を確認できます。`,
        },
      ]);
    }
  } catch (error) {
    console.error("[LINE Webhook] Link error:", error);
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "連携処理中にエラーが発生しました。しばらく経ってから再度お試しください。",
        },
      ]);
    }
  }
}

/**
 * 連携解除リクエストを処理
 */
async function handleUnlinkRequest(
  shopId: string,
  lineUserId: string,
  replyToken?: string
): Promise<void> {
  try {
    await db.lineUserLink.updateMany({
      where: { shopId, lineUserId },
      data: { isLinked: false },
    });

    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "LINE連携を解除しました。",
        },
      ]);
    }
  } catch (error) {
    console.error("[LINE Webhook] Unlink error:", error);
  }
}

/**
 * 予約確認リクエストを処理
 */
async function handleBookingInquiry(
  shopId: string,
  lineUserId: string,
  replyToken?: string
): Promise<void> {
  // LINE連携を確認
  const link = await db.lineUserLink.findFirst({
    where: { shopId, lineUserId, isLinked: true },
  });

  if (!link) {
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "LINE連携が完了していません。ショップのマイページから連携を行ってください。",
        },
      ]);
    }
    return;
  }

  // 今後の予約を取得
  const bookings = await db.booking.findMany({
    where: {
      shopId,
      customerId: link.customerId,
      status: "CONFIRMED",
      startAt: { gte: new Date() },
    },
    include: {
      resource: { select: { name: true } },
      location: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startAt: "asc" },
    take: 5,
  });

  if (bookings.length === 0) {
    if (replyToken) {
      await sendLineReplyMessage(shopId, replyToken, [
        {
          type: "text",
          text: "現在、予約はありません。",
        },
      ]);
    }
    return;
  }

  // 予約一覧をメッセージ化
  const bookingList = bookings
    .map((b, i) => {
      const dateStr = b.startAt.toLocaleDateString("ja-JP", {
        month: "long",
        day: "numeric",
        weekday: "short",
      });
      const timeStr = b.startAt.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${i + 1}. ${dateStr} ${timeStr}\n   📍${b.location.name} / ${b.resource.name}`;
    })
    .join("\n\n");

  if (replyToken) {
    await sendLineReplyMessage(shopId, replyToken, [
      {
        type: "text",
        text: `📅 今後の予約（${bookings.length}件）\n\n${bookingList}`,
      },
    ]);
  }
}


import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  canUseLine,
  getLineConfig,
  generateLineLinkUrl,
} from "../services/line.server";

/**
 * App Proxy: LINE連携コード生成API
 *
 * ストアフロント（マイページ等）から呼び出され、
 * LINE連携用のコードを生成して返す
 *
 * @endpoint GET /apps/booking/line/link
 * @query {string} customerId - Shopify Customer ID
 *
 * @returns JSON形式のレスポンス
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // App Proxy認証
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonResponse(
      { success: false, error: "認証に失敗しました" },
      401
    );
  }

  const shop = session.shop;

  // プランチェック
  if (!(await canUseLine(shop))) {
    return jsonResponse(
      { success: false, error: "LINE連携はPro/Maxプランで利用可能です" },
      403
    );
  }

  // LINE設定チェック
  const config = await getLineConfig(shop);
  if (!config || !config.isEnabled) {
    return jsonResponse(
      { success: false, error: "LINE連携が有効になっていません" },
      403
    );
  }

  // クエリパラメータを取得
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return jsonResponse(
      { success: false, error: "customerId パラメータは必須です" },
      400
    );
  }

  // 既存の連携をチェック
  const existingLink = await db.lineUserLink.findFirst({
    where: {
      shopId: shop,
      customerId,
      isLinked: true,
    },
  });

  if (existingLink) {
    return jsonResponse({
      success: true,
      isLinked: true,
      message: "すでにLINE連携済みです",
    });
  }

  // 連携コードを生成
  // Base URLはApp Proxy経由のURLから推測
  const baseUrl = url.origin;
  const linkState = Buffer.from(
    JSON.stringify({ shopId: shop, customerId, ts: Date.now() })
  ).toString("base64url");

  // LINE公式アカウントの友だち追加URL（Bot Basic ID）
  // 実際にはLINE Developersで取得したBot Basic IDを使用
  // ここでは連携コードのみを返す
  return jsonResponse({
    success: true,
    isLinked: false,
    linkCode: `link:${linkState}`,
    instructions: [
      "1. 公式LINEアカウントを友だち追加してください",
      "2. トーク画面で以下のコードを送信してください",
    ],
    expiresIn: 1800, // 30分
  });
};

/**
 * JSON形式のレスポンスを生成
 */
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}


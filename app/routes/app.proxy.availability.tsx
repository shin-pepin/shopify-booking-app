import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getAvailableSlots } from "../services/availability.server";
import db from "../db.server";

/**
 * App Proxy: 空き枠取得API
 *
 * ストアフロント（テーマ）から呼び出される公開API
 * Shopify App Proxyを通じて認証・リクエストのプロキシが行われる
 *
 * @endpoint GET /apps/booking/availability
 *
 * @query {string} date - 対象日付 (YYYY-MM-DD形式)
 * @query {string} resourceId - リソースID
 * @query {string} locationId - ロケーションID
 * @query {string} [serviceId] - サービスID（省略時はデフォルト60分）
 * @query {number} [duration] - 所要時間（分）- serviceIdがない場合に使用
 * @query {number} [buffer] - バッファ時間（分）
 * @query {number} [interval] - スロット間隔（分）- デフォルト30
 *
 * @returns JSON形式の空き枠情報
 *
 * @example
 * // リクエスト例
 * GET https://store.myshopify.com/apps/booking/availability?date=2025-01-15&resourceId=xxx&locationId=yyy
 *
 * // レスポンス例
 * {
 *   "success": true,
 *   "date": "2025-01-15",
 *   "resourceId": "xxx",
 *   "locationId": "yyy",
 *   "slots": [
 *     { "startTime": "09:00", "endTime": "10:00", "available": true },
 *     { "startTime": "09:30", "endTime": "10:30", "available": true },
 *     ...
 *   ]
 * }
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // App Proxy認証（署名検証）
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonResponse(
      { success: false, error: "認証に失敗しました" },
      401
    );
  }

  const shop = session.shop;

  // クエリパラメータを取得
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const resourceId = url.searchParams.get("resourceId");
  const locationId = url.searchParams.get("locationId");
  const serviceId = url.searchParams.get("serviceId");
  const durationParam = url.searchParams.get("duration");
  const bufferParam = url.searchParams.get("buffer");
  const intervalParam = url.searchParams.get("interval");

  // 必須パラメータのバリデーション
  if (!date) {
    return jsonResponse(
      { success: false, error: "date パラメータは必須です" },
      400
    );
  }

  if (!resourceId) {
    return jsonResponse(
      { success: false, error: "resourceId パラメータは必須です" },
      400
    );
  }

  if (!locationId) {
    return jsonResponse(
      { success: false, error: "locationId パラメータは必須です" },
      400
    );
  }

  // 日付形式のバリデーション
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return jsonResponse(
      { success: false, error: "date は YYYY-MM-DD 形式で指定してください" },
      400
    );
  }

  try {
    // リソースとロケーションの存在確認
    const [resource, location] = await Promise.all([
      db.resource.findFirst({
        where: { id: resourceId, shopId: shop },
      }),
      db.location.findFirst({
        where: { id: locationId, shopId: shop, isActive: true },
      }),
    ]);

    if (!resource) {
      return jsonResponse(
        { success: false, error: "指定されたリソースが見つかりません" },
        404
      );
    }

    if (!location) {
      return jsonResponse(
        { success: false, error: "指定されたロケーションが見つかりません" },
        404
      );
    }

    // サービス情報の取得（durationとbufferの決定）
    let durationMinutes = 60; // デフォルト60分
    let bufferMinutes = 0;

    if (serviceId) {
      // サービスIDが指定されている場合、サービス情報を取得
      const service = await db.service.findFirst({
        where: { id: serviceId, shopId: shop },
      });

      if (service) {
        durationMinutes = service.durationMin;
        bufferMinutes = service.bufferTimeMin;

        // リソース固有のカスタム時間があれば上書き
        const resourceService = await db.resourceService.findFirst({
          where: { resourceId, serviceId },
        });

        if (resourceService?.customDuration) {
          durationMinutes = resourceService.customDuration;
        }
      }
    } else {
      // サービスIDがない場合はパラメータから取得
      if (durationParam) {
        const parsed = parseInt(durationParam, 10);
        if (!isNaN(parsed) && parsed > 0) {
          durationMinutes = parsed;
        }
      }
    }

    // バッファ時間（パラメータで上書き可能）
    if (bufferParam) {
      const parsed = parseInt(bufferParam, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        bufferMinutes = parsed;
      }
    }

    // スロット間隔
    let slotInterval = 30;
    if (intervalParam) {
      const parsed = parseInt(intervalParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        slotInterval = parsed;
      }
    }

    // ロケーションのタイムゾーンを取得
    const timezone = location.timezone || "Asia/Tokyo";

    // 空き枠を計算（shopIdを渡してクォータチェックを有効化）
    const result = await getAvailableSlots({
      shopId: shop,
      locationId,
      resourceId,
      date,
      durationMinutes,
      bufferMinutes,
      slotInterval,
      timezone,
    });

    if (!result.success) {
      // クォータ制限の場合は専用エラーを返す
      if (result.quotaLimitReached) {
        return jsonResponse(
          { 
            success: false, 
            error: "予約上限に達しています。しばらく経ってから再度お試しください。",
            quotaLimitReached: true,
          },
          429
        );
      }
      return jsonResponse(
        { success: false, error: result.error || "空き枠の取得に失敗しました" },
        500
      );
    }

    // レスポンスを整形
    const response = {
      success: true,
      date,
      resourceId,
      resourceName: resource.name,
      locationId,
      locationName: location.name,
      timezone,
      duration: durationMinutes,
      buffer: bufferMinutes,
      interval: slotInterval,
      slots: result.slots.map((slot) => ({
        startTime: slot.startTimeDisplay,
        endTime: slot.endTimeDisplay,
        startTimeUTC: slot.startTime.toISOString(),
        endTimeUTC: slot.endTime.toISOString(),
        available: true,
      })),
      totalSlots: result.slots.length,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("[App Proxy] Error:", error);
    return jsonResponse(
      { success: false, error: "内部エラーが発生しました" },
      500
    );
  }
};

/**
 * JSON形式のレスポンスを生成
 * App Proxyではレスポンスヘッダーの設定が重要
 */
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // CORSヘッダー（App Proxyでは通常不要だが、デバッグ用に追加）
      "Access-Control-Allow-Origin": "*",
      // キャッシュ制御（空き枠は頻繁に変わるためキャッシュしない）
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}


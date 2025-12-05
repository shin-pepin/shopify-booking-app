import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * App Proxy: ロケーション一覧取得API
 *
 * ストアフロントから利用可能なロケーション一覧を取得
 *
 * @endpoint GET /apps/booking/locations
 *
 * @query {string} [resourceId] - リソースIDでフィルタ（そのリソースがスケジュールを持つロケーションのみ）
 *
 * @returns JSON形式のロケーション一覧
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[App Proxy Locations] Request received");
  
  try {
    // App Proxy認証
    const authResult = await authenticate.public.appProxy(request);
    console.log("[App Proxy Locations] Auth result:", JSON.stringify(authResult, null, 2));
    
    // sessionが存在するか確認
    const session = authResult?.session;
    if (!session || !session.shop) {
      console.error("[App Proxy Locations] No session or shop found");
      return jsonResponse({ success: false, error: "認証に失敗しました" }, 401);
    }

    const shop = session.shop;
    console.log("[App Proxy Locations] Shop:", shop);
    
    const url = new URL(request.url);
    const resourceId = url.searchParams.get("resourceId");

    // フィルタ条件を構築
    const whereCondition: {
      shopId: string;
      isActive: boolean;
      schedules?: { some: { resourceId: string } };
    } = {
      shopId: shop,
      isActive: true,
    };

    // リソースでフィルタ（そのリソースがスケジュールを持つロケーション）
    if (resourceId) {
      whereCondition.schedules = {
        some: { resourceId },
      };
    }

    console.log("[App Proxy Locations] Query condition:", JSON.stringify(whereCondition));

    const locations = await db.location.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        address1: true,
        address2: true,
        city: true,
        province: true,
        country: true,
        zip: true,
        phone: true,
        timezone: true,
      },
      orderBy: { name: "asc" },
    });

    console.log("[App Proxy Locations] Found locations:", locations.length);

    const response = {
      success: true,
      locations: locations.map((loc) => ({
        id: loc.id,
        name: loc.name,
        address: [loc.address1, loc.address2].filter(Boolean).join(" "),
        city: loc.city,
        province: loc.province,
        country: loc.country,
        zip: loc.zip,
        phone: loc.phone,
        timezone: loc.timezone,
        // フルアドレスを生成
        fullAddress: [
          loc.address1,
          loc.address2,
          loc.city,
          loc.province,
          loc.zip,
          loc.country,
        ]
          .filter(Boolean)
          .join(", "),
      })),
      total: locations.length,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("[App Proxy Locations] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "内部エラーが発生しました";
    return jsonResponse({ success: false, error: errorMessage }, 500);
  }
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    },
  });
}

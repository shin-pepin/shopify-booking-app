import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * App Proxy: サービス一覧取得API
 *
 * ストアフロントから利用可能なサービス一覧を取得
 *
 * @endpoint GET /apps/booking/services
 *
 * @query {string} [resourceId] - リソースIDでフィルタ（そのリソースが提供できるサービスのみ）
 *
 * @returns JSON形式のサービス一覧
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonResponse({ success: false, error: "認証に失敗しました" }, 401);
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const resourceId = url.searchParams.get("resourceId");

  try {
    // フィルタ条件を構築
    const whereCondition: {
      shopId: string;
      resourceServices?: { some: { resourceId: string } };
    } = {
      shopId: shop,
    };

    // リソースでフィルタ（そのリソースが提供できるサービス）
    if (resourceId) {
      whereCondition.resourceServices = {
        some: { resourceId },
      };
    }

    const services = await db.service.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        productId: true,
        variantId: true,
        durationMin: true,
        bufferTimeMin: true,
        resourceServices: resourceId
          ? {
              where: { resourceId },
              select: {
                customDuration: true,
                customPrice: true,
              },
            }
          : false,
      },
      orderBy: { name: "asc" },
    });

    const response = {
      success: true,
      services: services.map((s) => {
        const customService = resourceId ? s.resourceServices?.[0] : null;
        return {
          id: s.id,
          name: s.name,
          productId: s.productId,
          variantId: s.variantId,
          duration: customService?.customDuration || s.durationMin,
          baseDuration: s.durationMin,
          buffer: s.bufferTimeMin,
          customPrice: customService?.customPrice?.toString() || null,
        };
      }),
      total: services.length,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("[App Proxy Services] Error:", error);
    return jsonResponse({ success: false, error: "内部エラーが発生しました" }, 500);
  }
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60", // サービス一覧は1分キャッシュ
    },
  });
}


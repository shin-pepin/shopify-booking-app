import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * App Proxy: リソース一覧取得API
 *
 * ストアフロントから利用可能なリソース一覧を取得
 *
 * @endpoint GET /apps/booking/resources
 *
 * @query {string} [locationId] - ロケーションIDでフィルタ（そのロケーションにスケジュールがあるリソースのみ）
 * @query {string} [type] - リソースタイプでフィルタ（STAFF, ROOM, EQUIPMENT）
 * @query {string} [serviceId] - サービスIDでフィルタ（そのサービスを提供できるリソースのみ）
 *
 * @returns JSON形式のリソース一覧
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonResponse({ success: false, error: "認証に失敗しました" }, 401);
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const type = url.searchParams.get("type");
  const serviceId = url.searchParams.get("serviceId");

  try {
    // フィルタ条件を構築
    const whereCondition: {
      shopId: string;
      type?: "STAFF" | "ROOM" | "EQUIPMENT";
      schedules?: { some: { locationId: string } };
      resourceServices?: { some: { serviceId: string } };
    } = {
      shopId: shop,
    };

    // タイプでフィルタ
    if (type && ["STAFF", "ROOM", "EQUIPMENT"].includes(type)) {
      whereCondition.type = type as "STAFF" | "ROOM" | "EQUIPMENT";
    }

    // ロケーションでフィルタ（そのロケーションにスケジュールがあるリソース）
    if (locationId) {
      whereCondition.schedules = {
        some: { locationId },
      };
    }

    // サービスでフィルタ（そのサービスを提供できるリソース）
    if (serviceId) {
      whereCondition.resourceServices = {
        some: { serviceId },
      };
    }

    const resources = await db.resource.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        type: true,
        metadata: true,
        schedules: locationId
          ? {
              where: { locationId },
              select: {
                dayOfWeek: true,
                startTime: true,
                endTime: true,
                isAvailable: true,
              },
            }
          : false,
        resourceServices: serviceId
          ? {
              where: { serviceId },
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
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        metadata: r.metadata,
        ...(locationId && r.schedules
          ? {
              schedules: r.schedules.map((s) => ({
                dayOfWeek: s.dayOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                isAvailable: s.isAvailable,
              })),
            }
          : {}),
        ...(serviceId && r.resourceServices?.[0]
          ? {
              customDuration: r.resourceServices[0].customDuration,
              customPrice: r.resourceServices[0].customPrice?.toString(),
            }
          : {}),
      })),
      total: resources.length,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("[App Proxy Resources] Error:", error);
    return jsonResponse({ success: false, error: "内部エラーが発生しました" }, 500);
  }
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60", // リソース一覧は1分キャッシュ
    },
  });
}


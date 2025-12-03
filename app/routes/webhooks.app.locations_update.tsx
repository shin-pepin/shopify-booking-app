import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * LOCATIONS_UPDATE Webhook Handler
 *
 * Shopifyでロケーションが更新されたときに発火。
 * ローカルDBのLocationテーブルを同期する。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} received for shop: ${shop}`);

  if (!payload) {
    console.error("[Webhook] No payload received");
    return new Response("No payload", { status: 400 });
  }

  try {
    // ショップが存在しない場合は作成
    await db.shop.upsert({
      where: { id: shop },
      update: {},
      create: {
        id: shop,
        name: shop,
      },
    });

    // Shopify Location IDを gid 形式に変換
    const shopifyLocationId = `gid://shopify/Location/${payload.id}`;

    // Locationを更新（存在しない場合は作成）
    await db.location.upsert({
      where: { shopifyLocationId },
      update: {
        name: payload.name || "Unnamed Location",
        address1: payload.address1 || null,
        address2: payload.address2 || null,
        city: payload.city || null,
        province: payload.province || null,
        country: payload.country_code || null,
        zip: payload.zip || null,
        phone: payload.phone || null,
        isActive: payload.active ?? true,
        updatedAt: new Date(),
      },
      create: {
        shopifyLocationId,
        shopId: shop,
        name: payload.name || "Unnamed Location",
        address1: payload.address1 || null,
        address2: payload.address2 || null,
        city: payload.city || null,
        province: payload.province || null,
        country: payload.country_code || null,
        zip: payload.zip || null,
        phone: payload.phone || null,
        isActive: payload.active ?? true,
      },
    });

    console.log(
      `[Webhook] Location updated: ${payload.name} (${shopifyLocationId})`
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Error processing LOCATIONS_UPDATE:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};


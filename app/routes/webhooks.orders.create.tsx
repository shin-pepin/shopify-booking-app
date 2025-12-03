import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { incrementUsage } from "../services/quota.server";

/**
 * ORDERS_CREATE Webhook Handler
 *
 * 注文が作成されたときに発火。
 * 予約情報（Line Item Properties）を含む注文の場合、
 * 予約をCONFIRMEDに更新し、使用量をインクリメントする。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} received for shop: ${shop}`);

  if (!payload) {
    console.error("[Webhook] No payload received");
    return new Response("No payload", { status: 400 });
  }

  try {
    const lineItems = payload.line_items || [];

    // 予約情報を含むラインアイテムを処理
    for (const item of lineItems) {
      const properties = item.properties || [];

      // _BookingStart プロパティを探す
      const bookingStartProp = properties.find(
        (p: { name: string; value: string }) => p.name === "_BookingStart"
      );

      if (!bookingStartProp?.value) {
        continue; // 予約情報がないアイテムはスキップ
      }

      const resourceIdProp = properties.find(
        (p: { name: string; value: string }) => p.name === "_ResourceId"
      );
      const locationIdProp = properties.find(
        (p: { name: string; value: string }) => p.name === "_LocationId"
      );

      if (!resourceIdProp?.value || !locationIdProp?.value) {
        console.warn("[Webhook] Missing resourceId or locationId in booking");
        continue;
      }

      const bookingStart = new Date(bookingStartProp.value);
      const orderId = `gid://shopify/Order/${payload.id}`;
      const lineItemId = `gid://shopify/LineItem/${item.id}`;

      // 既存の予約を探す（PENDING_PAYMENTステータスのもの）
      const existingBooking = await db.booking.findFirst({
        where: {
          shopId: shop,
          resourceId: resourceIdProp.value,
          locationId: locationIdProp.value,
          startAt: bookingStart,
          status: "PENDING_PAYMENT",
        },
      });

      if (existingBooking) {
        // 既存の予約をCONFIRMEDに更新
        await db.booking.update({
          where: { id: existingBooking.id },
          data: {
            status: "CONFIRMED",
            orderId,
            lineItemId,
            customerEmail: payload.email || null,
            customerName: payload.customer?.first_name
              ? `${payload.customer.first_name} ${payload.customer.last_name || ""}`
              : null,
            customerPhone: payload.phone || payload.customer?.phone || null,
          },
        });

        console.log(
          `[Webhook] Booking confirmed: ${existingBooking.id} for order ${orderId}`
        );
      } else {
        // 予約が見つからない場合は新規作成
        // （ウィジェット経由でない場合のフォールバック）

        // まずServiceを取得（productIdから）
        const productId = `gid://shopify/Product/${item.product_id}`;
        const service = await db.service.findFirst({
          where: {
            shopId: shop,
            productId,
          },
        });

        if (!service) {
          console.warn(
            `[Webhook] Service not found for product ${productId}, skipping booking creation`
          );
          continue;
        }

        // _BookingEnd を取得、なければ60分後
        const bookingEndProp = properties.find(
          (p: { name: string; value: string }) => p.name === "_BookingEnd"
        );
        const bookingEnd = bookingEndProp?.value
          ? new Date(bookingEndProp.value)
          : new Date(bookingStart.getTime() + service.durationMin * 60 * 1000);

        await db.booking.create({
          data: {
            shopId: shop,
            locationId: locationIdProp.value,
            resourceId: resourceIdProp.value,
            serviceId: service.id,
            startAt: bookingStart,
            endAt: bookingEnd,
            status: "CONFIRMED",
            orderId,
            lineItemId,
            customerEmail: payload.email || null,
            customerName: payload.customer?.first_name
              ? `${payload.customer.first_name} ${payload.customer.last_name || ""}`
              : null,
            customerPhone: payload.phone || payload.customer?.phone || null,
          },
        });

        console.log(
          `[Webhook] New booking created for order ${orderId}`
        );
      }

      // 使用量をインクリメント
      await incrementUsage(shop);
      console.log(`[Webhook] Usage incremented for shop: ${shop}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Error processing ORDERS_CREATE:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};


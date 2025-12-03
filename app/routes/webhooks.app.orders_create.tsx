import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { incrementUsage } from "../services/quota.server";

/**
 * ORDERS_CREATE Webhook Handler
 *
 * 注文が作成されたときに発火。
 * カート内の予約情報（Line Item Properties）を読み取り、
 * 予約を確定（CONFIRMED）にする。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} received for shop: ${shop}`);

  if (!payload) {
    console.error("[Webhook] No payload received");
    return new Response("No payload", { status: 400 });
  }

  try {
    const orderId = `gid://shopify/Order/${payload.id}`;
    const lineItems = payload.line_items || [];
    let bookingsConfirmed = 0;

    for (const item of lineItems) {
      // Line Item Propertiesから予約情報を取得
      const properties = item.properties || [];
      const bookingStart = properties.find(
        (p: any) => p.name === "_BookingStart"
      )?.value;
      const bookingEnd = properties.find(
        (p: any) => p.name === "_BookingEnd"
      )?.value;
      const resourceId = properties.find(
        (p: any) => p.name === "_ResourceId"
      )?.value;
      const locationId = properties.find(
        (p: any) => p.name === "_LocationId"
      )?.value;

      // 予約情報がない場合はスキップ
      if (!bookingStart || !resourceId || !locationId) {
        continue;
      }

      // 該当する予約を検索（PENDING_PAYMENTステータスのもの）
      const existingBooking = await db.booking.findFirst({
        where: {
          shopId: shop,
          resourceId,
          locationId,
          startAt: new Date(bookingStart),
          status: "PENDING_PAYMENT",
        },
      });

      if (existingBooking) {
        // 既存の予約を確定
        await db.booking.update({
          where: { id: existingBooking.id },
          data: {
            status: "CONFIRMED",
            orderId,
            lineItemId: `gid://shopify/LineItem/${item.id}`,
            customerEmail: payload.email || null,
            customerName: payload.customer?.first_name
              ? `${payload.customer.first_name} ${payload.customer.last_name || ""}`
              : null,
            customerPhone: payload.customer?.phone || null,
          },
        });
        bookingsConfirmed++;
      } else {
        // 新規予約を作成（PENDING_PAYMENTが見つからない場合）
        // まずリソースが存在するか確認
        const resource = await db.resource.findFirst({
          where: { id: resourceId, shopId: shop },
        });

        const location = await db.location.findFirst({
          where: { id: locationId, shopId: shop },
        });

        if (resource && location) {
          // サービスを探す（商品IDから）
          const productId = `gid://shopify/Product/${item.product_id}`;
          const service = await db.service.findFirst({
            where: { shopId: shop, productId },
          });

          await db.booking.create({
            data: {
              shopId: shop,
              locationId,
              resourceId,
              serviceId: service?.id || "", // サービスが見つからない場合は空
              startAt: new Date(bookingStart),
              endAt: bookingEnd ? new Date(bookingEnd) : new Date(bookingStart),
              status: "CONFIRMED",
              orderId,
              lineItemId: `gid://shopify/LineItem/${item.id}`,
              customerEmail: payload.email || null,
              customerName: payload.customer?.first_name
                ? `${payload.customer.first_name} ${payload.customer.last_name || ""}`
                : null,
              customerPhone: payload.customer?.phone || null,
            },
          });
          bookingsConfirmed++;
        }
      }
    }

    // 予約が確定された場合、使用量をインクリメント
    if (bookingsConfirmed > 0) {
      await incrementUsage(shop, bookingsConfirmed);
      console.log(
        `[Webhook] ${bookingsConfirmed} booking(s) confirmed for ${shop}`
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] Error processing ORDERS_CREATE:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};


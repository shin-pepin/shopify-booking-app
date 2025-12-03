import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { incrementUsage, decrementUsage } from "../services/quota.server";
import {
  sendBookingConfirmationNotification,
  sendBookingCancellationNotification,
} from "../services/line.server";

// === Types ===
interface BookingData {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  resource: { name: string };
  location: { name: string };
  service: { name: string } | null;
  createdAt: string;
}

interface LoaderData {
  bookings: BookingData[];
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const bookings = await db.booking.findMany({
    where: { shopId: shop },
    include: {
      resource: { select: { name: true } },
      location: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startAt: "desc" },
    take: 100,
  });

  return {
    bookings: bookings.map((b) => ({
      id: b.id,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      resource: b.resource,
      location: b.location,
      service: b.service,
      createdAt: b.createdAt.toISOString(),
    })),
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const bookingId = formData.get("bookingId") as string;

  if (!bookingId) {
    return { success: false, error: "予約IDが指定されていません" };
  }

  const booking = await db.booking.findFirst({
    where: { id: bookingId, shopId: shop },
  });

  if (!booking) {
    return { success: false, error: "予約が見つかりません" };
  }

  try {
    if (action === "confirm") {
      const updatedBooking = await db.booking.update({
        where: { id: bookingId },
        data: { status: "CONFIRMED" },
        include: {
          resource: { select: { name: true } },
          location: { select: { name: true } },
          service: { select: { name: true } },
        },
      });
      await incrementUsage(shop);

      sendBookingConfirmationNotification(shop, {
        id: updatedBooking.id,
        customerId: updatedBooking.customerId,
        customerName: updatedBooking.customerName,
        startAt: updatedBooking.startAt,
        endAt: updatedBooking.endAt,
        resourceName: updatedBooking.resource.name,
        locationName: updatedBooking.location.name,
        serviceName: updatedBooking.service?.name,
      }).catch((err) => console.error("[LINE] Notification error:", err));

      return { success: true, message: "予約を確定しました" };
    } else if (action === "cancel") {
      const wasConfirmed = booking.status === "CONFIRMED";
      const updatedBooking = await db.booking.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" },
        include: {
          location: { select: { name: true } },
          service: { select: { name: true } },
        },
      });
      if (wasConfirmed) {
        await decrementUsage(shop);
      }

      sendBookingCancellationNotification(shop, {
        id: updatedBooking.id,
        customerId: updatedBooking.customerId,
        customerName: updatedBooking.customerName,
        startAt: updatedBooking.startAt,
        locationName: updatedBooking.location.name,
        serviceName: updatedBooking.service?.name,
      }).catch((err) => console.error("[LINE] Notification error:", err));

      return { success: true, message: "予約をキャンセルしました" };
    } else if (action === "delete") {
      const wasConfirmed = booking.status === "CONFIRMED";
      await db.booking.delete({ where: { id: bookingId } });
      if (wasConfirmed) {
        await decrementUsage(shop);
      }
      return { success: true, message: "予約を削除しました" };
    }

    return { success: false, error: "不明なアクションです" };
  } catch (error) {
    console.error("[Bookings] Error:", error);
    return { success: false, error: "処理に失敗しました" };
  }
};

// === Component ===
export default function BookingsPage() {
  const { bookings } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; message?: string; error?: string }>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleAction = (bookingId: string, action: string) => {
    fetcher.submit({ bookingId, action }, { method: "POST" });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return <s-badge tone="success">確定</s-badge>;
      case "PENDING_PAYMENT":
        return <s-badge tone="warning">支払い待ち</s-badge>;
      case "CANCELLED":
        return <s-badge tone="critical">キャンセル</s-badge>;
      default:
        return <s-badge>{status}</s-badge>;
    }
  };

  return (
    <s-page heading="予約管理">
      <s-section heading={`予約一覧（${bookings.length}件）`}>
        {bookings.length === 0 ? (
          <s-box padding="loose" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>予約がありません</s-heading>
              <s-paragraph>
                ストアフロントから予約が入ると、ここに表示されます。
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {bookings.map((booking) => (
              <s-box
                key={booking.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading>{formatDateTime(booking.startAt)}</s-heading>
                    {getStatusBadge(booking.status)}
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-text>リソース: {booking.resource.name}</s-text>
                    <s-text>場所: {booking.location.name}</s-text>
                    {booking.service && (
                      <s-text>サービス: {booking.service.name}</s-text>
                    )}
                  </s-stack>
                  {(booking.customerName || booking.customerEmail) && (
                    <s-text>
                      顧客: {booking.customerName || "名前なし"} ({booking.customerEmail || "メールなし"})
                    </s-text>
                  )}
                  <s-stack direction="inline" gap="base">
                    {booking.status === "PENDING_PAYMENT" && (
                      <s-button
                        variant="primary"
                        onClick={() => handleAction(booking.id, "confirm")}
                      >
                        確定する
                      </s-button>
                    )}
                    {booking.status !== "CANCELLED" && (
                      <s-button
                        tone="critical"
                        onClick={() => handleAction(booking.id, "cancel")}
                      >
                        キャンセル
                      </s-button>
                    )}
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => handleAction(booking.id, "delete")}
                    >
                      削除
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="ヘルプ">
        <s-stack direction="block" gap="base">
          <s-text>
            <strong>支払い待ち</strong>: カートに追加されたが、まだ決済されていない予約
          </s-text>
          <s-text>
            <strong>確定</strong>: 決済完了または手動で確定された予約
          </s-text>
          <s-text>
            <strong>キャンセル</strong>: キャンセルされた予約
          </s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="注意">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-text>
            開発中は「orders/create」webhookが無効のため、
            予約確定は手動で行う必要があります。
            本番環境では自動確定されます。
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}

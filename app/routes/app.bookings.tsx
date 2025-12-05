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

      return { success: true, message: "予約を確定しました！" };
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
      timeZone: "Asia/Tokyo",
    });
  };

  const formatDateOnly = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
      weekday: "short",
      timeZone: "Asia/Tokyo",
    });
  };

  const formatTimeOnly = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return <s-badge tone="success">✓ 確定</s-badge>;
      case "PENDING_PAYMENT":
        return <s-badge tone="warning">💳 お支払い待ち</s-badge>;
      case "CANCELLED":
        return <s-badge tone="critical">✕ キャンセル済み</s-badge>;
      default:
        return <s-badge>{status}</s-badge>;
    }
  };

  // 今後の予約（確定済み）を抽出
  const upcomingBookings = bookings.filter(
    (b) => b.status === "CONFIRMED" && new Date(b.startAt) > new Date()
  );

  // 対応が必要な予約（お支払い待ち）
  const pendingBookings = bookings.filter(
    (b) => b.status === "PENDING_PAYMENT"
  );

  return (
    <s-page heading="予約を見る">
      {/* 対応が必要な予約 */}
      {pendingBookings.length > 0 && (
        <s-section heading="⚡ 対応が必要（お支払い待ち）">
          <s-stack direction="block" gap="base">
            {pendingBookings.map((booking) => (
              <s-box
                key={booking.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading>
                      {formatDateOnly(booking.startAt)} {formatTimeOnly(booking.startAt)}〜
                    </s-heading>
                    {getStatusBadge(booking.status)}
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-text>👤 {booking.resource.name}</s-text>
                    <s-text>📍 {booking.location.name}</s-text>
                    {booking.service && (
                      <s-text>✂️ {booking.service.name}</s-text>
                    )}
                  </s-stack>
                  {(booking.customerName || booking.customerEmail) && (
                    <s-text>
                      お客様: {booking.customerName || "お名前なし"}
                      {booking.customerEmail && ` (${booking.customerEmail})`}
                    </s-text>
                  )}
                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="primary"
                      onClick={() => handleAction(booking.id, "confirm")}
                    >
                      ✓ 確定にする
                    </s-button>
                    <s-button
                      onClick={() => handleAction(booking.id, "cancel")}
                    >
                      キャンセルにする
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      {/* メインセクション: 全予約一覧 */}
      <s-section heading={`📅 すべての予約（${bookings.length}件）`}>
        {bookings.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>🎉 まだ予約がありません</s-heading>
              <s-paragraph>
                お客様から予約が入ると、ここに表示されます。
              </s-paragraph>
              <s-paragraph>
                <s-text>
                  ストアに予約カレンダーを設置して、お客様からの予約を受け付けましょう！
                </s-text>
              </s-paragraph>
              <s-button variant="primary" href="/app/guide">使い方ガイドを見る</s-button>
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
                    <s-heading>
                      {formatDateOnly(booking.startAt)} {formatTimeOnly(booking.startAt)}〜
                    </s-heading>
                    {getStatusBadge(booking.status)}
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-text>👤 {booking.resource.name}</s-text>
                    <s-text>📍 {booking.location.name}</s-text>
                    {booking.service && (
                      <s-text>✂️ {booking.service.name}</s-text>
                    )}
                  </s-stack>
                  {(booking.customerName || booking.customerEmail) && (
                    <s-text>
                      お客様: {booking.customerName || "お名前なし"}
                      {booking.customerEmail && ` (${booking.customerEmail})`}
                    </s-text>
                  )}
                  <s-stack direction="inline" gap="base">
                    {booking.status === "PENDING_PAYMENT" && (
                      <s-button
                        variant="primary"
                        onClick={() => handleAction(booking.id, "confirm")}
                      >
                        ✓ 確定にする
                      </s-button>
                    )}
                    {booking.status !== "CANCELLED" && (
                      <s-button
                        onClick={() => handleAction(booking.id, "cancel")}
                      >
                        キャンセルにする
                      </s-button>
                    )}
                    <s-button
                      variant="tertiary"
                      onClick={() => handleAction(booking.id, "delete")}
                    >
                      🗑️ 削除
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: 今後の予約 */}
      <s-section slot="aside" heading="📆 今後の予約">
        {upcomingBookings.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>今後の確定予約はありません</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {upcomingBookings.slice(0, 5).map((booking) => (
              <s-box key={booking.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-text><strong>{formatDateOnly(booking.startAt)}</strong></s-text>
                  <s-text>{formatTimeOnly(booking.startAt)}〜 {booking.resource.name}</s-text>
                </s-stack>
              </s-box>
            ))}
            {upcomingBookings.length > 5 && (
              <s-text>他 {upcomingBookings.length - 5}件</s-text>
            )}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="📖 ステータスの意味">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>💳 お支払い待ち</strong>
              </s-text>
              <s-text>お客様がカートに入れたけど、まだお支払いされていない状態です</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>✓ 確定</strong>
              </s-text>
              <s-text>お支払い完了！予約が確定しています</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>✕ キャンセル済み</strong>
              </s-text>
              <s-text>予約がキャンセルされました</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="💡 ヒント">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-text>
            お支払いが完了すると、自動的に「確定」になります。
            現金払いなど手動で確定する場合は「確定にする」ボタンを押してください。
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}

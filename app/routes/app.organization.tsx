import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  isMaxPlan,
  getShopOrganization,
  createOrganization,
  getOrganizationStats,
  getOrganizationBookings,
  type OrganizationInfo,
} from "../services/organization.server";

// === Types ===
interface BookingData {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  customerName: string | null;
  shop: { id: string; name: string | null };
  resource: { name: string };
  location: { name: string };
  service: { name: string } | null;
}

interface LoaderData {
  shop: string;
  canUse: boolean;
  planType: string;
  organization: OrganizationInfo | null;
  stats: {
    totalShops: number;
    totalStaff: number;
    todayBookings: number;
    totalMonthUsage: number;
    shopStats: Array<{
      id: string;
      name: string;
      todayBookings: number;
      monthUsage: number;
    }>;
  } | null;
  recentBookings: BookingData[];
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopData = await db.shop.findUnique({
    where: { id: shop },
    select: { planType: true },
  });

  const canUse = await isMaxPlan(shop);

  if (!canUse) {
    return {
      shop,
      canUse: false,
      planType: shopData?.planType || "FREE",
      organization: null,
      stats: null,
      recentBookings: [],
    };
  }

  const organization = await getShopOrganization(shop);

  let stats = null;
  let recentBookings: BookingData[] = [];

  if (organization) {
    stats = await getOrganizationStats(organization.id);

    const bookings = await getOrganizationBookings(organization.id, {
      limit: 20,
    });

    recentBookings = bookings.map((b) => ({
      id: b.id,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
      customerName: b.customerName,
      shop: b.shop,
      resource: b.resource,
      location: b.location,
      service: b.service,
    }));
  }

  return {
    shop,
    canUse: true,
    planType: shopData?.planType || "MAX",
    organization,
    stats,
    recentBookings,
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (!(await isMaxPlan(shop))) {
    return { success: false, error: "複数店舗管理はMaxプランでご利用いただけます" };
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const name = formData.get("name") as string;
    const ownerEmail = formData.get("ownerEmail") as string;
    const ownerName = formData.get("ownerName") as string;

    if (!name || !ownerEmail) {
      return { success: false, error: "グループ名とメールアドレスを入力してください" };
    }

    try {
      await createOrganization({
        name,
        ownerEmail,
        ownerName: ownerName || undefined,
        initialShopId: shop,
      });

      return { success: true, message: "グループを作成しました！" };
    } catch (error) {
      console.error("[Organization] Create error:", error);
      return { success: false, error: "グループの作成に失敗しました" };
    }
  }

  return { success: false, error: "不明なアクションです" };
};

// === Component ===
export default function OrganizationPage() {
  const { canUse, planType, organization, stats, recentBookings } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; message?: string; error?: string }>();
  const shopify = useAppBridge();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    ownerEmail: "",
    ownerName: "",
  });

  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
      setShowCreateForm(false);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleCreate = () => {
    fetcher.submit(
      {
        action: "create",
        name: formData.name,
        ownerEmail: formData.ownerEmail,
        ownerName: formData.ownerName,
      },
      { method: "POST" }
    );
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
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
        return <s-badge tone="warning">💳 支払い待ち</s-badge>;
      case "CANCELLED":
        return <s-badge tone="critical">✕ キャンセル</s-badge>;
      default:
        return <s-badge>{status}</s-badge>;
    }
  };

  // Maxプラン以外
  if (!canUse) {
    return (
      <s-page heading="複数店舗の管理">
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>🔒 Maxプランでご利用いただけます</s-heading>
              <s-paragraph>
                複数のお店を運営されている方向けの機能です。
                すべての店舗の予約を1つの画面で確認・管理できます！
              </s-paragraph>
              <s-stack direction="block" gap="base">
                <s-text>✓ 全店舗の予約を一覧で確認</s-text>
                <s-text>✓ 店舗ごとの予約数を比較</s-text>
                <s-text>✓ スタッフごとに見られる店舗を制限</s-text>
                <s-text>✓ 本部での一括管理</s-text>
              </s-stack>
              <s-paragraph>
                現在のプラン: <s-badge>{planType}</s-badge>
              </s-paragraph>
              <s-button variant="primary" href="/app/billing">
                プランを見る →
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  // グループ未作成
  if (!organization) {
    return (
      <s-page heading="複数店舗の管理">
        <s-section heading="🎉 はじめての設定">
          {!showCreateForm ? (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-heading>まずは「グループ」を作りましょう</s-heading>
                <s-paragraph>
                  複数のお店をまとめて「グループ」として登録すると、
                  すべての予約を1つの画面で確認できるようになります。
                </s-paragraph>
                <s-stack direction="block" gap="base">
                  <s-text>💡 「◯◯美容室グループ」「株式会社◯◯」など、わかりやすい名前を付けてください</s-text>
                </s-stack>
                <s-button variant="primary" onClick={() => setShowCreateForm(true)}>
                  グループを作成する
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="グループ名（会社名・店舗グループ名など）"
                  value={formData.name}
                  onChange={(e: any) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例: ◯◯美容室グループ"
                />
                <s-text-field
                  label="オーナーのメールアドレス"
                  value={formData.ownerEmail}
                  onChange={(e: any) => setFormData({ ...formData, ownerEmail: e.target.value })}
                  placeholder="owner@example.com"
                />
                <s-text-field
                  label="オーナーの名前（任意）"
                  value={formData.ownerName}
                  onChange={(e: any) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="山田 太郎"
                />
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    onClick={handleCreate}
                    {...(isSubmitting ? { loading: true, disabled: true } : {})}
                  >
                    ✓ 作成する
                  </s-button>
                  <s-button variant="tertiary" onClick={() => setShowCreateForm(false)}>
                    キャンセル
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          )}
        </s-section>
      </s-page>
    );
  }

  // グループダッシュボード
  return (
    <s-page heading={`🏢 ${organization.name}`}>
      <s-button slot="primary-action" variant="primary" href="/app/organization/staff">
        👥 スタッフ管理
      </s-button>

      {/* 統計サマリー */}
      <s-section heading="📊 グループ全体の状況">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>🏪 店舗数</s-text>
              <s-heading>{stats?.totalShops || 0}店舗</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>👤 スタッフ</s-text>
              <s-heading>{stats?.totalStaff || 0}人</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>📅 今日の予約</s-text>
              <s-heading>{stats?.todayBookings || 0}件</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>📈 今月の合計</s-text>
              <s-heading>{stats?.totalMonthUsage || 0}件</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* 店舗別統計 */}
      <s-section heading="🏪 店舗ごとの予約状況">
        <s-stack direction="block" gap="base">
          {stats?.shopStats.map((shop) => (
            <s-box key={shop.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="inline" gap="base">
                <s-stack direction="block" gap="base">
                  <s-heading>📍 {shop.name}</s-heading>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="base">
                    <s-text>今日</s-text>
                    <s-text><strong>{shop.todayBookings}件</strong></s-text>
                  </s-stack>
                  <s-stack direction="block" gap="base">
                    <s-text>今月</s-text>
                    <s-text><strong>{shop.monthUsage}件</strong></s-text>
                  </s-stack>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
          {(!stats?.shopStats || stats.shopStats.length === 0) && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-text>店舗データがありません</s-text>
            </s-box>
          )}
        </s-stack>
      </s-section>

      {/* 全店舗予約一覧 */}
      <s-section heading="📋 最新の予約（全店舗）">
        {recentBookings.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>まだ予約がありません</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {recentBookings.map((booking) => (
              <s-box key={booking.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-text><strong>{formatDateTime(booking.startAt)}</strong></s-text>
                      {getStatusBadge(booking.status)}
                      <s-badge tone="info">{booking.shop.name || booking.shop.id}</s-badge>
                    </s-stack>
                    <s-text>
                      📍 {booking.location.name} / 👤 {booking.resource.name}
                      {booking.service && ` / ${booking.service.name}`}
                    </s-text>
                    {booking.customerName && (
                      <s-text>お客様: {booking.customerName}</s-text>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー */}
      <s-section slot="aside" heading="📋 グループ情報">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="base">
            <s-text><strong>オーナー</strong></s-text>
            <s-text>{organization.ownerEmail}</s-text>
            {organization.ownerName && <s-text>{organization.ownerName}</s-text>}
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-text><strong>所属店舗</strong></s-text>
            {organization.shops.map((shop) => (
              <s-text key={shop.id}>📍 {shop.name || shop.id}</s-text>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="🔗 クイックリンク">
        <s-stack direction="block" gap="base">
          <s-button variant="tertiary" href="/app/organization/staff">
            👥 スタッフ管理
          </s-button>
          <s-button variant="tertiary" href="/app/bookings">
            📅 予約を見る
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

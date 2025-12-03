import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, redirect } from "react-router";
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

  // プランチェック
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

  // 組織情報を取得
  const organization = await getShopOrganization(shop);

  let stats = null;
  let recentBookings: BookingData[] = [];

  if (organization) {
    // 統計情報を取得
    stats = await getOrganizationStats(organization.id);

    // 最近の予約を取得
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

  // プランチェック
  if (!(await isMaxPlan(shop))) {
    return { success: false, error: "組織機能はMaxプランで利用可能です" };
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const name = formData.get("name") as string;
    const ownerEmail = formData.get("ownerEmail") as string;
    const ownerName = formData.get("ownerName") as string;

    if (!name || !ownerEmail) {
      return { success: false, error: "組織名とオーナーメールアドレスは必須です" };
    }

    try {
      await createOrganization({
        name,
        ownerEmail,
        ownerName: ownerName || undefined,
        initialShopId: shop,
      });

      return { success: true, message: "組織を作成しました" };
    } catch (error) {
      console.error("[Organization] Create error:", error);
      return { success: false, error: "組織の作成に失敗しました" };
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

  // Maxプラン以外
  if (!canUse) {
    return (
      <s-page
        heading="多店舗管理"
        backAction={{
          url: "/app",
          accessibilityLabel: "ダッシュボードに戻る",
        }}
      >
        <s-section>
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>Maxプラン専用機能</s-heading>
              <s-paragraph>
                多店舗管理機能はMaxプラン（$79/月）でご利用いただけます。
              </s-paragraph>
              <s-paragraph>
                複数の店舗を1つの組織として管理し、スタッフ権限やクロス店舗分析が可能になります。
              </s-paragraph>
              <s-paragraph>
                現在のプラン: <s-badge>{planType}</s-badge>
              </s-paragraph>
              <s-button variant="primary" url="/app/billing">
                プランをアップグレード
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  // 組織未作成
  if (!organization) {
    return (
      <s-page
        heading="多店舗管理"
        backAction={{
          url: "/app",
          accessibilityLabel: "ダッシュボードに戻る",
        }}
      >
        <s-section heading="組織を作成">
          {!showCreateForm ? (
            <s-box
              padding="loose"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-heading>組織を作成して多店舗管理を開始</s-heading>
                <s-paragraph>
                  組織を作成すると、複数の店舗を1つのダッシュボードから管理できます。
                </s-paragraph>
                <s-unordered-list>
                  <s-list-item>全店舗の予約を一括確認</s-list-item>
                  <s-list-item>スタッフごとのアクセス権限管理</s-list-item>
                  <s-list-item>クロス店舗の売上分析</s-list-item>
                </s-unordered-list>
                <s-button
                  variant="primary"
                  onClick={() => setShowCreateForm(true)}
                >
                  組織を作成する
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="組織名"
                  value={formData.name}
                  onChange={(e: any) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="例: 株式会社ABC美容室"
                />
                <s-text-field
                  label="オーナーメールアドレス"
                  type="email"
                  value={formData.ownerEmail}
                  onChange={(e: any) =>
                    setFormData({ ...formData, ownerEmail: e.target.value })
                  }
                  placeholder="owner@example.com"
                />
                <s-text-field
                  label="オーナー名（任意）"
                  value={formData.ownerName}
                  onChange={(e: any) =>
                    setFormData({ ...formData, ownerName: e.target.value })
                  }
                  placeholder="山田 太郎"
                />
                <s-stack direction="inline" gap="tight">
                  <s-button
                    variant="primary"
                    onClick={handleCreate}
                    {...(isSubmitting ? { loading: true, disabled: true } : {})}
                  >
                    作成する
                  </s-button>
                  <s-button
                    variant="plain"
                    onClick={() => setShowCreateForm(false)}
                  >
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

  // 組織ダッシュボード
  return (
    <s-page
      heading={organization.name}
      backAction={{
        url: "/app",
        accessibilityLabel: "ダッシュボードに戻る",
      }}
    >
      <s-button slot="primary-action" url="/app/organization/staff">
        スタッフ管理
      </s-button>

      {/* 統計サマリー */}
      <s-section heading="概要">
        <s-stack direction="inline" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            style={{ flex: 1 }}
          >
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">店舗数</s-text>
              <s-heading>{stats?.totalShops || 0}</s-heading>
            </s-stack>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            style={{ flex: 1 }}
          >
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">スタッフ数</s-text>
              <s-heading>{stats?.totalStaff || 0}</s-heading>
            </s-stack>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            style={{ flex: 1 }}
          >
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">今日の予約</s-text>
              <s-heading>{stats?.todayBookings || 0}</s-heading>
            </s-stack>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            style={{ flex: 1 }}
          >
            <s-stack direction="block" gap="tight">
              <s-text tone="subdued">今月の予約</s-text>
              <s-heading>{stats?.totalMonthUsage || 0}</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* 店舗別統計 */}
      <s-section heading="店舗別実績">
        <s-stack direction="block" gap="base">
          {stats?.shopStats.map((shop) => (
            <s-box
              key={shop.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="inline" gap="base" wrap={false}>
                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                  <s-heading>{shop.name}</s-heading>
                  <s-text tone="subdued">{shop.id}</s-text>
                </s-stack>
                <s-stack direction="inline" gap="loose">
                  <s-stack direction="block" gap="tight">
                    <s-text tone="subdued">今日</s-text>
                    <s-text fontWeight="bold">{shop.todayBookings}件</s-text>
                  </s-stack>
                  <s-stack direction="block" gap="tight">
                    <s-text tone="subdued">今月</s-text>
                    <s-text fontWeight="bold">{shop.monthUsage}件</s-text>
                  </s-stack>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      {/* 全店舗予約一覧 */}
      <s-section heading="全店舗予約一覧（最新20件）">
        {recentBookings.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-text tone="subdued">予約がありません</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="tight">
            {recentBookings.map((booking) => (
              <s-box
                key={booking.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base" wrap={false}>
                  <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-stack direction="inline" gap="tight">
                      <s-text fontWeight="bold">
                        {formatDateTime(booking.startAt)}
                      </s-text>
                      {getStatusBadge(booking.status)}
                      <s-badge tone="info">{booking.shop.name || booking.shop.id}</s-badge>
                    </s-stack>
                    <s-text tone="subdued">
                      {booking.location.name} / {booking.resource.name}
                      {booking.service && ` / ${booking.service.name}`}
                    </s-text>
                    {booking.customerName && (
                      <s-text tone="subdued">顧客: {booking.customerName}</s-text>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー */}
      <s-section slot="aside" heading="組織情報">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">オーナー</s-text>
            <s-text tone="subdued">{organization.ownerEmail}</s-text>
            {organization.ownerName && (
              <s-text tone="subdued">{organization.ownerName}</s-text>
            )}
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">所属店舗</s-text>
            {organization.shops.map((shop) => (
              <s-text key={shop.id} tone="subdued">
                {shop.name || shop.id}
              </s-text>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="クイックリンク">
        <s-stack direction="block" gap="tight">
          <s-button variant="plain" url="/app/organization/staff">
            スタッフ管理
          </s-button>
          <s-button variant="plain" url="/app/organization/shops">
            店舗管理
          </s-button>
          <s-button variant="plain" url="/app/organization/settings">
            組織設定
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}


import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, BILLING_PLANS } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getShopUsageInfo, type UsageInfo } from "../services/quota.server";

// === Types ===
interface LocationData {
  id: string;
  shopifyLocationId: string;
  name: string;
  address1: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface LoaderData {
  shop: string;
  locations: LocationData[];
  lastSyncedAt: string | null;
  resourceCount: number;
  usage: {
    currentUsage: number;
    usageLimit: number;
    remaining: number;
    usagePercentage: number;
    isLimitReached: boolean;
    planName: string;
    cycleEnd: string;
  };
}

// === Loader: DBからロケーション一覧と使用量を取得 ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // ショップが存在しない場合は作成
  await db.shop.upsert({
    where: { id: shop },
    update: {},
    create: {
      id: shop,
      name: shop,
    },
  });

  // 使用量情報を取得
  const usageInfo = await getShopUsageInfo(shop);

  // リソース数を取得
  const resourceCount = await db.resource.count({
    where: { shopId: shop },
  });

  // ロケーション一覧を取得
  const locations = await db.location.findMany({
    where: { shopId: shop },
    orderBy: { name: "asc" },
    select: {
      id: true,
      shopifyLocationId: true,
      name: true,
      address1: true,
      city: true,
      province: true,
      country: true,
      isActive: true,
      updatedAt: true,
    },
  });

  // 最終更新日時を取得
  const lastSyncedAt =
    locations.length > 0
      ? locations.reduce((latest, loc) => {
          const locDate = new Date(loc.updatedAt);
          return locDate > latest ? locDate : latest;
        }, new Date(0))
      : null;

  return {
    shop,
    locations: locations.map((loc) => ({
      ...loc,
      updatedAt: loc.updatedAt.toISOString(),
    })),
    lastSyncedAt: lastSyncedAt?.toISOString() || null,
    resourceCount,
    usage: {
      currentUsage: usageInfo.currentUsage,
      usageLimit: usageInfo.usageLimit,
      remaining: usageInfo.remaining,
      usagePercentage: usageInfo.usagePercentage,
      isLimitReached: usageInfo.isLimitReached,
      planName: usageInfo.planName,
      cycleEnd: usageInfo.cycleEnd.toISOString(),
    },
  };
};

// === Action: Shopify Admin APIからロケーションを手動同期 ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Shopify Admin GraphQL APIでロケーション一覧を取得
    const response = await admin.graphql(
      `#graphql
        query getLocations {
          locations(first: 50) {
            edges {
              node {
                id
                name
                address {
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                isActive
              }
            }
          }
        }
      `
    );

    const responseJson = await response.json();
    const locations = responseJson.data?.locations?.edges || [];

    // 各ロケーションをDBに同期
    for (const { node } of locations) {
      await db.location.upsert({
        where: { shopifyLocationId: node.id },
        update: {
          name: node.name || "Unnamed Location",
          address1: node.address?.address1 || null,
          address2: node.address?.address2 || null,
          city: node.address?.city || null,
          province: node.address?.province || null,
          country: node.address?.country || null,
          zip: node.address?.zip || null,
          phone: node.address?.phone || null,
          isActive: node.isActive ?? true,
          updatedAt: new Date(),
        },
        create: {
          shopifyLocationId: node.id,
          shopId: shop,
          name: node.name || "Unnamed Location",
          address1: node.address?.address1 || null,
          address2: node.address?.address2 || null,
          city: node.address?.city || null,
          province: node.address?.province || null,
          country: node.address?.country || null,
          zip: node.address?.zip || null,
          phone: node.address?.phone || null,
          isActive: node.isActive ?? true,
        },
      });
    }

    return { success: true, syncedCount: locations.length };
  } catch (error) {
    console.error("[Sync] Error syncing locations:", error);
    return { success: false, error: "同期に失敗しました" };
  }
};

// === Component ===
export default function Index() {
  const { locations, lastSyncedAt, usage, resourceCount } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; syncedCount?: number }>();
  const shopify = useAppBridge();

  const isSyncing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(`${fetcher.data.syncedCount}件の店舗を読み込みました！`);
    }
  }, [fetcher.data, shopify]);

  const syncLocations = () => {
    fetcher.submit({}, { method: "POST" });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "まだ読み込んでいません";
    return new Date(dateString).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  };

  const formatAddress = (location: LocationData) => {
    const parts = [location.city, location.province, location.country].filter(
      Boolean
    );
    return parts.length > 0 ? parts.join(", ") : "住所は未登録です";
  };

  const getProgressBarTone = (percentage: number): "success" | "critical" | "highlight" | "primary" => {
    if (percentage >= 90) return "critical";
    if (percentage >= 70) return "highlight";
    return "success";
  };

  // オンボーディング状態の判定
  const isOnboardingComplete = locations.length > 0 && resourceCount > 0;

  return (
    <s-page heading="ホーム">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={syncLocations}
        {...(isSyncing ? { loading: true } : {})}
      >
        ロケーションを読み込む
      </s-button>

      {/* オンボーディング（未完了の場合のみ表示） */}
      {!isOnboardingComplete && (
        <s-section heading="🎉 はじめに設定しましょう">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>あと少しで予約を受け付けられます！</s-heading>
              <s-paragraph>
                かんたん3ステップで、お客様からの予約を受け付けられるようになります。
                むずかしい作業は何もありません。順番に進めてみましょう！
              </s-paragraph>
              
              <s-stack direction="block" gap="base">
                <s-box padding="base" borderWidth="base" borderRadius="base" background={locations.length > 0 ? "subdued" : "transparent"}>
                  <s-stack direction="inline" gap="base">
                    <s-text>{locations.length > 0 ? "✅" : "1️⃣"}</s-text>
                    <s-stack direction="block" gap="base">
                      <s-text><strong>店舗情報を読み込む</strong></s-text>
                      {locations.length === 0 && (
                        <s-text>👆 右上の「店舗情報を読み込む」ボタンを押してください</s-text>
                      )}
                      {locations.length > 0 && (
                        <s-text>できました！{locations.length}件の店舗を読み込みました</s-text>
                      )}
                    </s-stack>
                  </s-stack>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base" background={resourceCount > 0 ? "subdued" : "transparent"}>
                  <s-stack direction="inline" gap="base">
                    <s-text>{resourceCount > 0 ? "✅" : "2️⃣"}</s-text>
                      <s-stack direction="block" gap="base">
                        <s-text><strong>予約を受ける人・場所を登録</strong></s-text>
                        {resourceCount === 0 ? (
                          <s-text>
                            予約を受けるスタッフや部屋・設備を登録しましょう
                            <br />
                            <s-link href="/app/resources">👉 登録ページへ</s-link>
                          </s-text>
                        ) : (
                          <s-text>できました！{resourceCount}件登録されています</s-text>
                        )}
                    </s-stack>
                  </s-stack>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base" background="transparent">
                  <s-stack direction="inline" gap="base">
                    <s-text>3️⃣</s-text>
                    <s-stack direction="block" gap="base">
                      <s-text><strong>予約カレンダーをお店のページに設置</strong></s-text>
                      <s-text>使い方ガイドでわかりやすく説明しています</s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-stack>

              <s-button href="/app/guide" variant="primary">
                使い方ガイドを見る
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* 使用量セクション */}
      <s-section heading="📊 今月の予約">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-heading>
                    {usage.currentUsage} / {usage.usageLimit === Infinity ? "無制限" : usage.usageLimit}件
                  </s-heading>
                  <s-badge tone={usage.isLimitReached ? "critical" : "info"}>
                    {usage.planName}プラン
                  </s-badge>
                </s-stack>
                <s-text>
                  今月受け付けた予約の数です ｜ {formatDate(usage.cycleEnd)}にリセットされます
                </s-text>
              </s-stack>
              {usage.isLimitReached && (
                <s-button variant="primary" href="/app/billing">プランを変更する</s-button>
              )}
            </s-stack>

            {/* プログレスバー */}
            {usage.usageLimit !== Infinity && (
              <s-box padding="none">
                <s-progress-bar
                  progress={Math.min(usage.usagePercentage, 100)}
                  tone={getProgressBarTone(usage.usagePercentage)}
                />
                <s-stack direction="inline" gap="base">
                  <s-text>
                    {usage.remaining > 0 
                      ? `あと${usage.remaining}件まで受付できます`
                      : "今月の上限に達しました"}
                  </s-text>
                  <s-text>（{Math.round(usage.usagePercentage)}%使用）</s-text>
                </s-stack>
              </s-box>
            )}

            {usage.isLimitReached && (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text>
                  ⚠️ 今月の予約受付が上限に達しました。
                  <br />
                  新しい予約を受け付けるには、プランの変更をご検討ください。
                  すでに入っている予約には影響ありませんのでご安心ください。
                </s-text>
              </s-box>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* 店舗セクション */}
      <s-section heading="🏪 登録済みの店舗">
        <s-paragraph>
          予約を受け付ける店舗の一覧です。
          {lastSyncedAt && (
            <>
              <br />
              <s-text>（最終更新: {formatDate(lastSyncedAt)}）</s-text>
            </>
          )}
        </s-paragraph>

        {/* ロケーション一覧 */}
        {locations.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>まだ店舗が登録されていません</s-heading>
              <s-paragraph>
                右上の「🔄 ロケーションを読み込む」ボタンを押して、
                Shopifyに登録している店舗情報を取り込んでください。
              </s-paragraph>
              <s-paragraph>
                <s-text>
                  ※ Shopify管理画面の「設定」→「ロケーション」に
                  店舗が登録されている必要があります
                </s-text>
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {locations.map((location) => (
              <s-box
                key={location.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{location.name}</s-heading>
                      {location.isActive ? (
                        <s-badge tone="success">受付OK</s-badge>
                      ) : (
                        <s-badge tone="critical">受付停止中</s-badge>
                      )}
                    </s-stack>
                    <s-text>📍 {formatAddress(location)}</s-text>
                    {location.address1 && <s-text>{location.address1}</s-text>}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: プラン情報 */}
      <s-section slot="aside" heading="💎 ご利用中のプラン">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>{usage.planName}</s-heading>
              <s-text>
                {usage.usageLimit === Infinity
                  ? "予約数の上限なし！"
                  : `毎月${usage.usageLimit}件まで受付OK`}
              </s-text>
            </s-stack>
          </s-box>
          <s-stack direction="block" gap="base">
            <s-text><strong>プランの比較</strong></s-text>
            <s-text>🆓 Free: 月10件まで・無料</s-text>
            <s-text>⭐ Standard: 月50件・$29</s-text>
            <s-text>🚀 Pro: 月300件・$49・LINE通知付き</s-text>
            <s-text>👑 Max: 無制限・$120・複数店舗対応</s-text>
          </s-stack>
          <s-button variant="tertiary" href="/app/billing">
            プランを詳しく見る →
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="📈 かんたん統計">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text>登録店舗:</s-text>
            <s-text><strong>{locations.length}件</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>受付中:</s-text>
            <s-text><strong>{locations.filter((l) => l.isActive).length}件</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>スタッフ・部屋:</s-text>
            <s-text><strong>{resourceCount}件</strong></s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

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
}

// === Loader: DBからロケーション一覧を取得 ===
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
  const { locations, lastSyncedAt } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; syncedCount?: number }>();
  const shopify = useAppBridge();
  const [isAnimating, setIsAnimating] = useState(false);

  const isSyncing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(`${fetcher.data.syncedCount}件のロケーションを同期しました`);
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    // 初回ロード時のアニメーション
    setIsAnimating(true);
  }, []);

  const syncLocations = () => {
    fetcher.submit({}, { method: "POST" });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "未同期";
    return new Date(dateString).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatAddress = (location: LocationData) => {
    const parts = [location.city, location.province, location.country].filter(
      Boolean
    );
    return parts.length > 0 ? parts.join(", ") : "住所未設定";
  };

  return (
    <s-page heading="予約システム管理">
      <s-button
        slot="primary-action"
        onClick={syncLocations}
        {...(isSyncing ? { loading: true } : {})}
      >
        Shopifyから同期
      </s-button>

      {/* ヘッダーセクション */}
      <s-section heading="店舗ロケーション">
        <s-paragraph>
          Shopifyに登録されている店舗ロケーションを管理します。
          {lastSyncedAt && (
            <>
              <br />
              <s-text tone="subdued">
                最終同期: {formatDate(lastSyncedAt)}
              </s-text>
            </>
          )}
        </s-paragraph>

        {/* ロケーション一覧 */}
        {locations.length === 0 ? (
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>ロケーションが見つかりません</s-heading>
              <s-paragraph>
                「Shopifyから同期」ボタンをクリックして、
                Shopifyに登録されているロケーションを取得してください。
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {locations.map((location, index) => (
              <s-box
                key={location.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background={location.isActive ? "subdued" : "subdued"}
                style={{
                  opacity: isAnimating ? 1 : 0,
                  transform: isAnimating ? "translateY(0)" : "translateY(10px)",
                  transition: `opacity 0.3s ease ${index * 0.05}s, transform 0.3s ease ${index * 0.05}s`,
                }}
              >
                <s-stack direction="inline" gap="base" wrap={false}>
                  <s-stack direction="block" gap="tight">
                    <s-stack direction="inline" gap="tight">
                      <s-heading>{location.name}</s-heading>
                      {location.isActive ? (
                        <s-badge tone="success">有効</s-badge>
                      ) : (
                        <s-badge tone="critical">無効</s-badge>
                      )}
                    </s-stack>
                    <s-text tone="subdued">{formatAddress(location)}</s-text>
                    {location.address1 && (
                      <s-text tone="subdued">{location.address1}</s-text>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: クイックガイド */}
      <s-section slot="aside" heading="セットアップガイド">
        <s-stack direction="block" gap="base">
          <s-text tone="subdued">Phase 1: ロケーション同期</s-text>
          <s-unordered-list>
            <s-list-item>
              <s-text
                {...(locations.length > 0
                  ? { fontWeight: "bold" }
                  : {})}
              >
                ✓ ロケーション同期
              </s-text>
            </s-list-item>
            <s-list-item>
              <s-text tone="subdued">リソース管理（次のステップ）</s-text>
            </s-list-item>
            <s-list-item>
              <s-text tone="subdued">スケジュール設定</s-text>
            </s-list-item>
          </s-unordered-list>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="統計">
        <s-stack direction="block" gap="tight">
          <s-stack direction="inline" gap="base">
            <s-text>登録ロケーション数:</s-text>
            <s-text fontWeight="bold">{locations.length}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>有効なロケーション:</s-text>
            <s-text fontWeight="bold">
              {locations.filter((l) => l.isActive).length}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

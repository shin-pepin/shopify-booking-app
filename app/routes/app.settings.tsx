import { useState, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getSellingPlanGroups,
  createDepositSellingPlanGroup,
  deleteSellingPlanGroup,
  addProductsToSellingPlanGroup,
  removeProductsFromSellingPlanGroup,
  type SellingPlanGroupInfo,
  type DepositType,
} from "../services/selling_plan.server";

// === Types ===
interface LoaderData {
  sellingPlanGroups: SellingPlanGroupInfo[];
  products: Array<{
    id: string;
    title: string;
    hasSellingPlan: boolean;
  }>;
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const sellingPlanGroups = await getSellingPlanGroups(admin);

  const productsResponse = await admin.graphql(`
    query {
      products(first: 50) {
        edges {
          node {
            id
            title
            sellingPlanGroups(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `);

  const productsData = await productsResponse.json();
  const products = (productsData.data?.products?.edges || []).map(
    (edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      hasSellingPlan: edge.node.sellingPlanGroups.edges.length > 0,
    })
  );

  return {
    sellingPlanGroups,
    products,
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
      case "createSellingPlan": {
        const name = formData.get("name") as string;
        const depositType = formData.get("depositType") as DepositType;
        const depositValue = parseFloat(formData.get("depositValue") as string);

        if (!name || !depositType || isNaN(depositValue)) {
          return { success: false, error: "必須項目を入力してください" };
        }

        const merchantCode = `booking-${depositType.toLowerCase()}-${depositValue}`;

        const result = await createDepositSellingPlanGroup(admin, {
          name,
          merchantCode,
          depositType,
          depositValue,
          currencyCode: "JPY",
        });

        return result;
      }

      case "deleteSellingPlan": {
        const sellingPlanGroupId = formData.get("sellingPlanGroupId") as string;

        if (!sellingPlanGroupId) {
          return { success: false, error: "Selling Plan IDが必要です" };
        }

        return await deleteSellingPlanGroup(admin, sellingPlanGroupId);
      }

      case "addProductToSellingPlan": {
        const sellingPlanGroupId = formData.get("sellingPlanGroupId") as string;
        const productId = formData.get("productId") as string;

        if (!sellingPlanGroupId || !productId) {
          return { success: false, error: "パラメータが不足しています" };
        }

        return await addProductsToSellingPlanGroup(admin, sellingPlanGroupId, [productId]);
      }

      case "removeProductFromSellingPlan": {
        const sellingPlanGroupId = formData.get("sellingPlanGroupId") as string;
        const productId = formData.get("productId") as string;

        if (!sellingPlanGroupId || !productId) {
          return { success: false, error: "パラメータが不足しています" };
        }

        return await removeProductsFromSellingPlanGroup(admin, sellingPlanGroupId, [productId]);
      }

      default:
        return { success: false, error: "不明な操作です" };
    }
  } catch (error) {
    console.error("[Settings] Action error:", error);
    return { success: false, error: "操作に失敗しました" };
  }
};

// === Component ===
export default function SettingsPage() {
  const { sellingPlanGroups, products } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; error?: string }>();
  const shopify = useAppBridge();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newDepositType, setNewDepositType] = useState<DepositType>("PERCENTAGE");
  const [newDepositValue, setNewDepositValue] = useState("20");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const createModalRef = useRef<HTMLDialogElement>(null);
  const isLoading = fetcher.state !== "idle";

  // モーダルの開閉を制御
  useEffect(() => {
    if (showCreateModal) {
      createModalRef.current?.showModal();
    } else {
      createModalRef.current?.close();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("設定を保存しました！");
      setShowCreateModal(false);
      setNewPlanName("");
      setNewDepositValue("20");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const handleCreatePlan = () => {
    if (!newPlanName.trim()) {
      shopify.toast.show("プラン名を入力してください");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "createSellingPlan");
    formData.append("name", newPlanName.trim());
    formData.append("depositType", newDepositType);
    formData.append("depositValue", newDepositValue);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDeletePlan = (groupId: string) => {
    if (!confirm("この前払いプランを削除しますか？")) return;

    const formData = new FormData();
    formData.append("intent", "deleteSellingPlan");
    formData.append("sellingPlanGroupId", groupId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleAddProduct = (groupId: string, productId: string) => {
    const formData = new FormData();
    formData.append("intent", "addProductToSellingPlan");
    formData.append("sellingPlanGroupId", groupId);
    formData.append("productId", productId);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="前払い（デポジット）設定">
      <s-button slot="primary-action" variant="primary" onClick={() => setShowCreateModal(true)}>
        ＋ 新しいプランを作る
      </s-button>

      {/* 説明セクション */}
      <s-section>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>💡 前払い（デポジット）とは？</s-heading>
            <s-paragraph>
              予約時に全額ではなく、<strong>一部だけ先にお支払い</strong>いただく仕組みです。
              残りは来店時にお支払いいただきます。
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-badge tone="success">✓ 無断キャンセル防止</s-badge>
              <s-badge tone="success">✓ 予約率アップ</s-badge>
              <s-badge tone="success">✓ 安定した売上</s-badge>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* Selling Plan 一覧 */}
      <s-section heading="📋 登録済みの前払いプラン">
        {sellingPlanGroups.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>まだプランがありません</s-heading>
              <s-paragraph>
                「＋ 新しいプランを作る」ボタンから、前払いプランを作成しましょう。
                <br />
                例えば「予約時に20%だけお支払い」のような設定ができます。
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {sellingPlanGroups.map((group) => (
              <s-box key={group.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="block" gap="base">
                      <s-heading>💰 {group.name}</s-heading>
                      <s-text>適用中の商品: {group.productCount}件</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="primary"
                        onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                      >
                        {selectedGroupId === group.id ? "閉じる" : "商品に適用"}
                      </s-button>
                      <s-button variant="tertiary" onClick={() => handleDeletePlan(group.id)}>
                        🗑️
                      </s-button>
                    </s-stack>
                  </s-stack>

                  {/* 商品追加UI */}
                  {selectedGroupId === group.id && (
                    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                      <s-stack direction="block" gap="base">
                        <s-text><strong>どの予約商品に適用しますか？</strong></s-text>
                        <s-paragraph>
                          <s-text>
                            チェックを入れた商品は、お客様が予約する時に前払いが適用されます。
                          </s-text>
                        </s-paragraph>
                        {products.length === 0 ? (
                          <s-text>商品が見つかりません</s-text>
                        ) : (
                          products.map((product) => (
                            <s-stack key={product.id} direction="inline" gap="base">
                              <s-text>{product.title}</s-text>
                              {product.hasSellingPlan ? (
                                <s-badge tone="success">✓ 適用中</s-badge>
                              ) : (
                                <s-button
                                  variant="tertiary"
                                  onClick={() => handleAddProduct(group.id, product.id)}
                                  {...(isLoading ? { loading: true } : {})}
                                >
                                  + 適用する
                                </s-button>
                              )}
                            </s-stack>
                          ))
                        )}
                      </s-stack>
                    </s-box>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー */}
      <s-section slot="aside" heading="📖 使い方の例">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>例1: 20%前払い</strong></s-text>
              <s-text>
                10,000円の施術の場合...
                <br />
                ・予約時: 2,000円
                <br />
                ・当日: 8,000円
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>例2: 固定1,000円</strong></s-text>
              <s-text>
                どんな施術でも予約時に1,000円だけお支払いいただきます。
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="💡 ヒント">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-text>
              前払いを設定すると、無断キャンセルが<strong>大幅に減る</strong>というデータがあります。
            </s-text>
            <s-text>
              高額メニューには高めの前払い、
              気軽なメニューには低めの前払いを設定するのがおすすめです。
            </s-text>
          </s-stack>
        </s-box>
      </s-section>

      {/* 作成モーダル */}
      <dialog
        ref={createModalRef}
        onClose={() => {
          setShowCreateModal(false);
          setNewPlanName("");
          setNewDepositValue("20");
        }}
        style={{
          border: "none",
          borderRadius: "16px",
          padding: "28px",
          maxWidth: "480px",
          width: "90%",
          boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        }}
      >
        <h2 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: "600" }}>✨ 新しい前払いプラン</h2>
        <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: "14px" }}>
          予約時に受け取る前払い金額を設定します
        </p>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "14px" }}>
            プランの名前（管理用）
          </label>
          <input
            type="text"
            value={newPlanName}
            onChange={(e) => setNewPlanName(e.target.value)}
            placeholder="例: 予約デポジット20%"
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              fontSize: "15px",
              boxSizing: "border-box",
            }}
          />
          <p style={{ margin: "6px 0 0 0", color: "#888", fontSize: "13px" }}>
            この名前はお客様には表示されません
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "10px", fontWeight: "600", fontSize: "14px" }}>
            前払いの計算方法
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { label: "📊 割合で計算", desc: "例: 施術代金の20%", value: "PERCENTAGE" },
              { label: "💴 固定金額", desc: "例: 一律3,000円", value: "FIXED_AMOUNT" },
            ].map((option) => (
              <label 
                key={option.value} 
                style={{ 
                  display: "flex", 
                  alignItems: "flex-start", 
                  gap: "10px", 
                  cursor: "pointer",
                  padding: "12px",
                  borderRadius: "8px",
                  border: newDepositType === option.value ? "2px solid #008060" : "1px solid #ddd",
                  backgroundColor: newDepositType === option.value ? "#f0fdf4" : "white",
                }}
              >
                <input
                  type="radio"
                  name="depositType"
                  value={option.value}
                  checked={newDepositType === option.value}
                  onChange={(e) => setNewDepositType(e.target.value as DepositType)}
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <div style={{ fontWeight: "500" }}>{option.label}</div>
                  <div style={{ fontSize: "13px", color: "#666" }}>{option.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "14px" }}>
            {newDepositType === "PERCENTAGE" ? "前払いの割合（%）" : "前払い金額（円）"}
          </label>
          <input
            type="number"
            value={newDepositValue}
            onChange={(e) => setNewDepositValue(e.target.value)}
            placeholder={newDepositType === "PERCENTAGE" ? "20" : "3000"}
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              fontSize: "15px",
              boxSizing: "border-box",
            }}
          />
          <p style={{ margin: "6px 0 0 0", color: "#888", fontSize: "13px" }}>
            {newDepositType === "PERCENTAGE" 
              ? "例: 20と入力すると、施術代金の20%が前払いになります"
              : "例: 3000と入力すると、予約時に3,000円をお支払いいただきます"}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "28px", paddingTop: "20px", borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(false);
              setNewPlanName("");
              setNewDepositValue("20");
            }}
            style={{
              padding: "10px 20px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              backgroundColor: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleCreatePlan}
            disabled={isLoading}
            style={{
              padding: "10px 24px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: "#008060",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            {isLoading ? "作成中..." : "✓ 作成する"}
          </button>
        </div>
      </dialog>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

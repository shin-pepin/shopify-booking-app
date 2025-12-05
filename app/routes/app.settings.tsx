import { useState, useEffect } from "react";
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

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("操作が完了しました");
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
    if (!confirm("このSelling Planを削除しますか？")) return;

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
    <s-page heading="手付金設定">
      <s-button slot="primary-action" variant="primary" onClick={() => setShowCreateModal(true)}>
        新規プラン作成
      </s-button>

      {/* Selling Plan 一覧 */}
      <s-section heading="手付金プラン一覧">
        <s-paragraph>
          予約時に手付金のみを決済するプランを管理します。
          商品にプランを紐付けると、チェックアウト時に「今支払う金額」と「後で支払う金額」が表示されます。
        </s-paragraph>

        {sellingPlanGroups.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>プランが登録されていません</s-heading>
              <s-paragraph>「新規プラン作成」ボタンから手付金プランを作成してください。</s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {sellingPlanGroups.map((group) => (
              <s-box key={group.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="block" gap="base">
                      <s-heading>{group.name}</s-heading>
                      <s-text>コード: {group.merchantCode} | 適用商品: {group.productCount}件</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="tertiary"
                        onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                      >
                        {selectedGroupId === group.id ? "閉じる" : "商品を追加"}
                      </s-button>
                      <s-button variant="tertiary" onClick={() => handleDeletePlan(group.id)}>
                        削除
                      </s-button>
                    </s-stack>
                  </s-stack>

                  {/* 商品追加UI */}
                  {selectedGroupId === group.id && (
                    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                      <s-stack direction="block" gap="base">
                        <s-text><strong>商品を選択して追加:</strong></s-text>
                        {products.map((product) => (
                          <s-stack key={product.id} direction="inline" gap="base">
                            <s-text>{product.title}</s-text>
                            {product.hasSellingPlan ? (
                              <s-badge tone="success">適用済み</s-badge>
                            ) : (
                              <s-button
                                variant="tertiary"
                                onClick={() => handleAddProduct(group.id, product.id)}
                                {...(isLoading ? { loading: true } : {})}
                              >
                                追加
                              </s-button>
                            )}
                          </s-stack>
                        ))}
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
      <s-section slot="aside" heading="手付金について">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text>
              手付金プランを使用すると、予約時に全額ではなく一部のみを決済し、
              残額は後日請求することができます。
            </s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text>
              例: 20%の手付金プランの場合
              <br />
              ・チェックアウト時: 商品価格の20%
              <br />
              ・後日（7日後）: 残りの80%
            </s-text>
          </s-paragraph>
        </s-stack>
      </s-section>

      {/* 作成モーダル */}
      {showCreateModal && (
        <s-modal
          heading="新規手付金プラン作成"
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
        >
          <s-stack direction="block" gap="base">
            <s-text-field
              label="プラン名"
              value={newPlanName}
              onChange={(e: CustomEvent) => setNewPlanName(e.detail as string)}
              placeholder="例: 予約手付金 (20%)"
            />

            <s-choice-list
              title="手付金タイプ"
              name="depositType"
              choices={[
                { label: "定率（%）", value: "PERCENTAGE" },
                { label: "定額（円）", value: "FIXED_AMOUNT" },
              ]}
              selected={[newDepositType]}
              onChange={(e: CustomEvent) => {
                const selected = e.detail as string[];
                if (selected.length > 0) {
                  setNewDepositType(selected[0] as DepositType);
                }
              }}
            />

            <s-text-field
              label={newDepositType === "PERCENTAGE" ? "手付金率 (%)" : "手付金額 (円)"}
              type="number"
              value={newDepositValue}
              onChange={(e: CustomEvent) => setNewDepositValue(e.detail as string)}
              placeholder={newDepositType === "PERCENTAGE" ? "20" : "5000"}
            />
          </s-stack>

          <s-stack slot="footer" direction="inline" gap="base">
            <s-button variant="tertiary" onClick={() => setShowCreateModal(false)}>
              キャンセル
            </s-button>
            <s-button variant="primary" onClick={handleCreatePlan} {...(isLoading ? { loading: true } : {})}>
              作成
            </s-button>
          </s-stack>
        </s-modal>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

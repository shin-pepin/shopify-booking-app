import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, BILLING_PLANS, type PlanKey } from "../shopify.server";
import db from "../db.server";
import { getShopUsageInfo, updateShopPlan } from "../services/quota.server";
import { useEffect } from "react";

// === Types ===
interface LoaderData {
  shop: string;
  currentPlan: string;
  usage: {
    currentUsage: number;
    usageLimit: number;
    usagePercentage: number;
    isLimitReached: boolean;
    planName: string;
  };
  plans: Array<{
    key: string;
    name: string;
    amount: number;
    usageLimit: number;
    features: readonly string[];
    lineEnabled: boolean;
    multiShopEnabled: boolean;
    isCurrent: boolean;
  }>;
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // 使用量情報を取得
  const usageInfo = await getShopUsageInfo(shop);

  // 現在のプラン情報を取得（planTypeはマイグレーション後に追加されるフィールド）
  const shopData = await db.shop.findUnique({
    where: { id: shop },
  }) as { planType?: string } | null;

  const currentPlanType = shopData?.planType || "FREE";

  const plans = Object.entries(BILLING_PLANS).map(([key, plan]) => ({
    key,
    name: plan.name,
    amount: plan.amount,
    usageLimit: plan.usageLimit,
    features: [...plan.features],
    lineEnabled: plan.lineEnabled,
    multiShopEnabled: plan.multiShopEnabled,
    isCurrent: currentPlanType === key,
  }));

  return {
    shop,
    currentPlan: currentPlanType,
    usage: {
      currentUsage: usageInfo.currentUsage,
      usageLimit: usageInfo.usageLimit,
      usagePercentage: usageInfo.usagePercentage,
      isLimitReached: usageInfo.isLimitReached,
      planName: usageInfo.planName,
    },
    plans,
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const planKey = formData.get("planKey") as PlanKey;

  if (!planKey || !(planKey in BILLING_PLANS)) {
    return { success: false, error: "無効なプランです" };
  }

  const plan = BILLING_PLANS[planKey];

  // Freeプランの場合は直接更新
  if (planKey === "FREE") {
    await updateShopPlan(shop, "FREE");
    return { success: true, message: "Freeプランに変更しました" };
  }

  // 有料プランの場合はShopify Billingを使用
  try {
    // 課金リクエストを作成（Billing APIの型はshopify.server.tsの設定に依存）
    const billingParams = { plan: plan.name, isTest: true };
    const billingResponse = await (billing.request as Function)(billingParams) as { confirmationUrl: string };

    // 確認URLにリダイレクト
    return redirect(billingResponse.confirmationUrl);
  } catch (error) {
    console.error("[Billing] Error:", error);
    return { success: false, error: "課金処理に失敗しました" };
  }
};

// === Component ===
export default function BillingPage() {
  const { plans, currentPlan, usage } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; error?: string; message?: string }>();
  const shopify = useAppBridge();

  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSelectPlan = (planKey: string) => {
    fetcher.submit({ planKey }, { method: "POST" });
  };

  const getPlanBadgeTone = (planKey: string): "info" | "success" | "warning" | "critical" => {
    switch (planKey) {
      case "FREE":
        return "info";
      case "STANDARD":
        return "success";
      case "PRO":
        return "warning";
      case "MAX":
        return "critical";
      default:
        return "info";
    }
  };

  return (
    <s-page heading="料金プラン">
      {/* 現在の使用状況 */}
      <s-section heading="現在の使用状況">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-heading>
                {usage.currentUsage} / {usage.usageLimit === Infinity ? "∞" : usage.usageLimit}
              </s-heading>
              <s-badge tone={usage.isLimitReached ? "critical" : "success"}>
                {usage.planName}プラン
              </s-badge>
            </s-stack>
            {usage.usageLimit !== Infinity && (
              <div style={{ width: "100%" }}>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    backgroundColor: "#E5E7EB",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(usage.usagePercentage, 100)}%`,
                      height: "100%",
                      backgroundColor: usage.usagePercentage >= 90 ? "#EF4444" : usage.usagePercentage >= 70 ? "#F59E0B" : "#10B981",
                      borderRadius: "4px",
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* プラン一覧 */}
      <s-section heading="プラン選択">
        <s-stack direction="block" gap="base">
          {plans.map((plan) => (
            <s-box
              key={plan.key}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="inline" gap="base">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading>{plan.name}</s-heading>
                    <s-badge tone={getPlanBadgeTone(plan.key)}>
                      {plan.usageLimit === Infinity ? "無制限" : `${plan.usageLimit}件/月`}
                    </s-badge>
                    {plan.isCurrent && (
                      <s-badge tone="success">現在のプラン</s-badge>
                    )}
                  </s-stack>
                  <s-text>
                    <strong>{plan.amount === 0 ? "無料" : `$${plan.amount}/月`}</strong>
                  </s-text>
                  
                  {/* 機能アイコン */}
                  <s-stack direction="inline" gap="base">
                    <s-badge tone="info">手付金 ✓</s-badge>
                    <s-badge tone={plan.lineEnabled ? "success" : "warning"}>
                      LINE {plan.lineEnabled ? "✓" : "×"}
                    </s-badge>
                    <s-badge tone={plan.multiShopEnabled ? "success" : "warning"}>
                      複数店舗 {plan.multiShopEnabled ? "✓" : "×"}
                    </s-badge>
                  </s-stack>
                  
                  <s-stack direction="block" gap="base">
                    {plan.features.map((feature, idx) => (
                      <s-text key={idx}>✓ {feature}</s-text>
                    ))}
                  </s-stack>
                </s-stack>
                {!plan.isCurrent && (
                  <s-button
                    variant={plan.amount > 0 ? "primary" : "tertiary"}
                    onClick={() => handleSelectPlan(plan.key)}
                    {...(isSubmitting ? { loading: true, disabled: true } : {})}
                  >
                    {plan.amount > 0 ? "アップグレード" : "ダウングレード"}
                  </s-button>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      {/* FAQ */}
      <s-section slot="aside" heading="よくある質問">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="base">
            <s-text><strong>プラン変更はいつ反映されますか？</strong></s-text>
            <s-text>
              アップグレードは即座に反映されます。ダウングレードは次の請求サイクルから適用されます。
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-text><strong>上限を超えた場合はどうなりますか？</strong></s-text>
            <s-text>
              新しい予約の受付が停止されます。既存の予約には影響ありません。
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-text><strong>使用量はいつリセットされますか？</strong></s-text>
            <s-text>30日ごとにリセットされます。</s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

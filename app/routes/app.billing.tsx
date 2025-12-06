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

  const getProgressBarTone = (percentage: number): "success" | "critical" | "highlight" | "primary" => {
    if (percentage >= 90) return "critical";
    if (percentage >= 70) return "highlight";
    return "success";
  };

  const getPlanIcon = (planKey: string): string => {
    switch (planKey) {
      case "FREE":
        return "🆓";
      case "STANDARD":
        return "⭐";
      case "PRO":
        return "🚀";
      case "MAX":
        return "👑";
      default:
        return "📦";
    }
  };

  const getPlanColor = (planKey: string): string => {
    switch (planKey) {
      case "FREE":
        return "#6b7280";
      case "STANDARD":
        return "#059669";
      case "PRO":
        return "#8b5cf6";
      case "MAX":
        return "#f59e0b";
      default:
        return "#6b7280";
    }
  };

  return (
    <s-page heading="プラン・料金">
      {/* 現在の使用状況 */}
      <s-section heading="📊 今月のご利用状況">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-heading>
                {usage.currentUsage} / {usage.usageLimit === Infinity ? "無制限" : usage.usageLimit}件
              </s-heading>
              <s-badge tone={usage.isLimitReached ? "critical" : "success"}>
                {usage.planName}プラン利用中
              </s-badge>
            </s-stack>
            {usage.usageLimit !== Infinity && (
              <s-box padding="none">
                <div style={{
                  width: "100%",
                  height: "8px",
                  backgroundColor: "#e5e7eb",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "8px"
                }}>
                  <div style={{
                    width: `${Math.min(usage.usagePercentage, 100)}%`,
                    height: "100%",
                    backgroundColor: usage.usagePercentage >= 90 ? "#dc2626" : usage.usagePercentage >= 70 ? "#f59e0b" : "#10b981",
                    borderRadius: "4px",
                    transition: "width 0.3s ease"
                  }} />
                </div>
                <s-text>
                  {usage.usageLimit - usage.currentUsage > 0
                    ? `あと${usage.usageLimit - usage.currentUsage}件の予約を受け付けられます`
                    : "今月の上限に達しました"}
                </s-text>
              </s-box>
            )}
            {usage.usageLimit === Infinity && (
              <s-text>✨ 無制限プランなので、予約数に上限がありません！</s-text>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* プラン一覧 */}
      <s-section heading="🎯 あなたに合ったプランを選びましょう">
        <s-paragraph>
          お店の規模や必要な機能に合わせて、最適なプランをお選びください。
          いつでも変更できます。
        </s-paragraph>

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
                    <s-heading>{getPlanIcon(plan.key)} {plan.name}</s-heading>
                    <s-badge tone={plan.isCurrent ? "success" : "info"}>
                      {plan.usageLimit === Infinity ? "無制限" : `月${plan.usageLimit}件まで`}
                    </s-badge>
                    {plan.isCurrent && (
                      <s-badge tone="success">✓ 現在のプラン</s-badge>
                    )}
                  </s-stack>
                  <s-text>
                    <strong>{plan.amount === 0 ? "無料" : `月額 $${plan.amount}`}</strong>
                  </s-text>
                  
                  {/* 主な特徴 */}
                  <s-stack direction="inline" gap="base">
                    <s-badge tone="info">💰 前払い機能</s-badge>
                    <s-badge tone={plan.lineEnabled ? "success" : "neutral"}>
                      💬 LINE {plan.lineEnabled ? "対応" : "なし"}
                    </s-badge>
                    <s-badge tone={plan.multiShopEnabled ? "success" : "neutral"}>
                      🏢 複数店舗 {plan.multiShopEnabled ? "対応" : "なし"}
                    </s-badge>
                  </s-stack>
                  
                  {/* 機能リスト */}
                  <s-stack direction="block" gap="base">
                    {plan.features.map((feature, idx) => (
                      <s-text key={idx}>✓ {feature}</s-text>
                    ))}
                  </s-stack>
                </s-stack>
                {!plan.isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleSelectPlan(plan.key)}
                    disabled={isSubmitting}
                    style={{
                      padding: "10px",
                      border: plan.amount > 0 ? "none" : "1px solid #ddd",
                      borderRadius: "8px",
                      backgroundColor: plan.amount > 0 ? "#008060" : "white",
                      color: plan.amount > 0 ? "white" : "#333",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      opacity: isSubmitting ? 0.6 : 1,
                      whiteSpace: "nowrap",
                      alignSelf: "flex-start",
                      height: "fit-content",
                      marginLeft: "auto",
                    }}
                  >
                    {isSubmitting ? "処理中..." : (plan.amount > 0 ? "このプランにする" : "無料に戻す")}
                  </button>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      {/* おすすめ */}
      <s-section slot="aside" heading="💡 どのプランがいい？">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>🆓 まずは無料で試したい</strong></s-text>
              <s-text>→ Freeプランでお試しください</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>⭐ 個人サロンで使いたい</strong></s-text>
              <s-text>→ 月50件のStandardがおすすめ</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>🚀 LINE通知も使いたい</strong></s-text>
              <s-text>→ Pro以上でLINE通知が使えます</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>👑 複数店舗を運営</strong></s-text>
              <s-text>→ Maxで全店舗を一括管理！</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* FAQ */}
      <s-section slot="aside" heading="❓ よくある質問">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>プラン変更はすぐ反映される？</strong></s-text>
              <s-text>
                はい！アップグレードはすぐに使えます。
                ダウングレードは翌月から適用されます。
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>上限に達したらどうなる？</strong></s-text>
              <s-text>
                新しい予約の受付が停止します。
                すでに入っている予約はそのままです。
              </s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>予約数はいつリセット？</strong></s-text>
              <s-text>毎月1日に0件にリセットされます。</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

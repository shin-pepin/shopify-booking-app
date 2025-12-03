import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * App Proxy: Selling Plan取得API
 *
 * 商品に紐づくSelling Plan（手付金プラン）を取得
 *
 * @endpoint GET /apps/booking/selling-plans
 *
 * @query {string} productId - 商品ID (gid://shopify/Product/...)
 *
 * @returns JSON形式のSelling Plan情報
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonResponse({ success: false, error: "認証に失敗しました" }, 401);
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return jsonResponse(
      { success: false, error: "productId パラメータは必須です" },
      400
    );
  }

  try {
    // 商品のSelling Plansを取得
    const response = await admin!.graphql(
      `#graphql
        query getProductSellingPlans($id: ID!) {
          product(id: $id) {
            id
            title
            sellingPlanGroups(first: 10) {
              edges {
                node {
                  id
                  name
                  sellingPlans(first: 10) {
                    edges {
                      node {
                        id
                        name
                        options
                        pricingPolicies {
                          ... on SellingPlanFixedPricingPolicy {
                            adjustmentType
                            adjustmentValue {
                              ... on SellingPlanPricingPolicyPercentageValue {
                                percentage
                              }
                              ... on MoneyV2 {
                                amount
                                currencyCode
                              }
                            }
                          }
                        }
                        billingPolicy {
                          ... on SellingPlanFixedBillingPolicy {
                            checkoutCharge {
                              type
                              value {
                                ... on SellingPlanCheckoutChargePercentageValue {
                                  percentage
                                }
                                ... on MoneyV2 {
                                  amount
                                  currencyCode
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: productId } }
    );

    const data = await response.json();
    const product = data.data?.product;

    if (!product) {
      return jsonResponse(
        { success: false, error: "商品が見つかりません" },
        404
      );
    }

    const sellingPlanGroups = product.sellingPlanGroups.edges.map(
      (groupEdge: any) => ({
        id: groupEdge.node.id,
        name: groupEdge.node.name,
        sellingPlans: groupEdge.node.sellingPlans.edges.map((planEdge: any) => {
          const plan = planEdge.node;
          const billingPolicy = plan.billingPolicy;
          const checkoutCharge = billingPolicy?.checkoutCharge;

          // 手付金の情報を抽出
          let depositInfo = {
            type: "PERCENTAGE" as "PERCENTAGE" | "FIXED_AMOUNT",
            value: 100,
            displayText: "全額支払い",
          };

          if (checkoutCharge) {
            if (checkoutCharge.type === "PERCENTAGE") {
              const percentage = checkoutCharge.value?.percentage || 100;
              depositInfo = {
                type: "PERCENTAGE",
                value: percentage,
                displayText: `手付金 ${percentage}%（残額は後日請求）`,
              };
            } else if (checkoutCharge.type === "PRICE") {
              const amount = checkoutCharge.value?.amount || 0;
              const currency = checkoutCharge.value?.currencyCode || "JPY";
              depositInfo = {
                type: "FIXED_AMOUNT",
                value: parseFloat(amount),
                displayText: `手付金 ${currency} ${amount}（残額は後日請求）`,
              };
            }
          }

          return {
            id: plan.id,
            name: plan.name,
            options: plan.options,
            deposit: depositInfo,
          };
        }),
      })
    );

    return jsonResponse({
      success: true,
      productId,
      productTitle: product.title,
      sellingPlanGroups,
      hasSellingPlans: sellingPlanGroups.length > 0,
    });
  } catch (error) {
    console.error("[App Proxy Selling Plans] Error:", error);
    return jsonResponse(
      { success: false, error: "内部エラーが発生しました" },
      500
    );
  }
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}


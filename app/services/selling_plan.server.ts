/**
 * Selling Plan Service - 手付金（Deposit）決済機能
 *
 * Shopify Selling Plans APIを使用して、予約時に手付金のみを
 * 決済させるプランを作成・管理する
 *
 * @see https://shopify.dev/docs/apps/selling-strategies/subscriptions/selling-plans
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// === Types ===

/**
 * 手付金タイプ
 */
export type DepositType = "FIXED_AMOUNT" | "PERCENTAGE";

/**
 * Selling Plan Group作成パラメータ
 */
export interface CreateSellingPlanGroupParams {
  /** プラングループ名 */
  name: string;
  /** マーチャントコード（識別子） */
  merchantCode: string;
  /** オプション名（顧客表示用） */
  optionName?: string;
  /** 手付金タイプ */
  depositType: DepositType;
  /** 手付金額（FIXED_AMOUNTの場合）または割合（PERCENTAGEの場合） */
  depositValue: number;
  /** 通貨コード（FIXED_AMOUNTの場合のみ） */
  currencyCode?: string;
}

/**
 * Selling Plan Group作成結果
 */
export interface CreateSellingPlanGroupResult {
  success: boolean;
  sellingPlanGroupId?: string;
  sellingPlanId?: string;
  error?: string;
}

/**
 * Selling Plan Groupの情報
 */
export interface SellingPlanGroupInfo {
  id: string;
  name: string;
  merchantCode: string;
  sellingPlans: Array<{
    id: string;
    name: string;
  }>;
  productCount: number;
}

// === GraphQL Mutations ===

const CREATE_SELLING_PLAN_GROUP_MUTATION = `#graphql
  mutation sellingPlanGroupCreate($input: SellingPlanGroupInput!) {
    sellingPlanGroupCreate(input: $input) {
      sellingPlanGroup {
        id
        name
        merchantCode
        sellingPlans(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_SELLING_PLAN_GROUP_MUTATION = `#graphql
  mutation sellingPlanGroupDelete($id: ID!) {
    sellingPlanGroupDelete(id: $id) {
      deletedSellingPlanGroupId
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_PRODUCTS_TO_SELLING_PLAN_GROUP_MUTATION = `#graphql
  mutation sellingPlanGroupAddProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup {
        id
        productCount
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REMOVE_PRODUCTS_FROM_SELLING_PLAN_GROUP_MUTATION = `#graphql
  mutation sellingPlanGroupRemoveProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_SELLING_PLAN_GROUPS_QUERY = `#graphql
  query getSellingPlanGroups($first: Int!, $query: String) {
    sellingPlanGroups(first: $first, query: $query) {
      edges {
        node {
          id
          name
          merchantCode
          productCount
          sellingPlans(first: 10) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const GET_SELLING_PLAN_GROUP_BY_ID_QUERY = `#graphql
  query getSellingPlanGroup($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      merchantCode
      productCount
      products(first: 50) {
        edges {
          node {
            id
            title
          }
        }
      }
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
          }
        }
      }
    }
  }
`;

// === Functions ===

/**
 * 予約用手付金Selling Plan Groupを作成
 *
 * @param admin - Shopify Admin API コンテキスト
 * @param params - 作成パラメータ
 * @returns 作成結果
 *
 * @example
 * ```ts
 * // 20%の手付金プランを作成
 * const result = await createDepositSellingPlanGroup(admin, {
 *   name: "予約手付金 (20%)",
 *   merchantCode: "booking-deposit-20pct",
 *   depositType: "PERCENTAGE",
 *   depositValue: 20,
 * });
 *
 * // $50の固定手付金プランを作成
 * const result = await createDepositSellingPlanGroup(admin, {
 *   name: "予約手付金 ($50)",
 *   merchantCode: "booking-deposit-50usd",
 *   depositType: "FIXED_AMOUNT",
 *   depositValue: 50,
 *   currencyCode: "USD",
 * });
 * ```
 */
export async function createDepositSellingPlanGroup(
  admin: AdminApiContext,
  params: CreateSellingPlanGroupParams
): Promise<CreateSellingPlanGroupResult> {
  const {
    name,
    merchantCode,
    optionName = "支払いプラン",
    depositType,
    depositValue,
    currencyCode = "JPY",
  } = params;

  try {
    // 手付金後の残額を計算するための調整値
    // ShopifyのSelling Planでは「残額」として設定するため、
    // 手付金20%なら残額80%として設定
    const remainingPercentage =
      depositType === "PERCENTAGE" ? 100 - depositValue : null;

    // Selling Plan入力を構築
    const input = {
      name,
      merchantCode,
      options: [optionName],
      sellingPlansToCreate: [
        {
          name:
            depositType === "PERCENTAGE"
              ? `手付金 ${depositValue}%`
              : `手付金 ${currencyCode} ${depositValue}`,
          options: ["手付金支払い"],
          category: "PRE_ORDER",
          billingPolicy: {
            fixed: {
              checkoutCharge: {
                type: depositType === "PERCENTAGE" ? "PERCENTAGE" : "PRICE",
                value:
                  depositType === "PERCENTAGE"
                    ? { percentage: depositValue }
                    : { fixedValue: depositValue },
              },
              remainingBalanceChargeTrigger: "TIME_AFTER_CHECKOUT",
              remainingBalanceChargeTimeAfterCheckout: "P7D", // 7日後に残額請求
            },
          },
          deliveryPolicy: {
            fixed: {
              fulfillmentTrigger: "ASAP",
            },
          },
          pricingPolicies: [
            {
              fixed: {
                adjustmentType: "PERCENTAGE",
                adjustmentValue: {
                  percentage: 0, // 価格調整なし（全額が対象）
                },
              },
            },
          ],
        },
      ],
    };

    const response = await admin.graphql(CREATE_SELLING_PLAN_GROUP_MUTATION, {
      variables: { input },
    });

    const data = await response.json();
    const result = data.data?.sellingPlanGroupCreate;

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: any) => e.message).join(", "),
      };
    }

    const sellingPlanGroup = result?.sellingPlanGroup;
    const sellingPlan = sellingPlanGroup?.sellingPlans?.edges?.[0]?.node;

    return {
      success: true,
      sellingPlanGroupId: sellingPlanGroup?.id,
      sellingPlanId: sellingPlan?.id,
    };
  } catch (error) {
    console.error("[SellingPlan] Error creating selling plan group:", error);
    return {
      success: false,
      error: "Selling Planの作成に失敗しました",
    };
  }
}

/**
 * Selling Plan Groupを削除
 */
export async function deleteSellingPlanGroup(
  admin: AdminApiContext,
  sellingPlanGroupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(DELETE_SELLING_PLAN_GROUP_MUTATION, {
      variables: { id: sellingPlanGroupId },
    });

    const data = await response.json();
    const result = data.data?.sellingPlanGroupDelete;

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: any) => e.message).join(", "),
      };
    }

    return { success: true };
  } catch (error) {
    console.error("[SellingPlan] Error deleting selling plan group:", error);
    return {
      success: false,
      error: "Selling Planの削除に失敗しました",
    };
  }
}

/**
 * 商品をSelling Plan Groupに追加
 */
export async function addProductsToSellingPlanGroup(
  admin: AdminApiContext,
  sellingPlanGroupId: string,
  productIds: string[]
): Promise<{ success: boolean; productCount?: number; error?: string }> {
  try {
    const response = await admin.graphql(
      ADD_PRODUCTS_TO_SELLING_PLAN_GROUP_MUTATION,
      {
        variables: {
          id: sellingPlanGroupId,
          productIds,
        },
      }
    );

    const data = await response.json();
    const result = data.data?.sellingPlanGroupAddProducts;

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: any) => e.message).join(", "),
      };
    }

    return {
      success: true,
      productCount: result?.sellingPlanGroup?.productCount,
    };
  } catch (error) {
    console.error("[SellingPlan] Error adding products:", error);
    return {
      success: false,
      error: "商品の追加に失敗しました",
    };
  }
}

/**
 * 商品をSelling Plan Groupから削除
 */
export async function removeProductsFromSellingPlanGroup(
  admin: AdminApiContext,
  sellingPlanGroupId: string,
  productIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(
      REMOVE_PRODUCTS_FROM_SELLING_PLAN_GROUP_MUTATION,
      {
        variables: {
          id: sellingPlanGroupId,
          productIds,
        },
      }
    );

    const data = await response.json();
    const result = data.data?.sellingPlanGroupRemoveProducts;

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: any) => e.message).join(", "),
      };
    }

    return { success: true };
  } catch (error) {
    console.error("[SellingPlan] Error removing products:", error);
    return {
      success: false,
      error: "商品の削除に失敗しました",
    };
  }
}

/**
 * Selling Plan Groupの一覧を取得
 */
export async function getSellingPlanGroups(
  admin: AdminApiContext,
  options?: { query?: string; first?: number }
): Promise<SellingPlanGroupInfo[]> {
  try {
    const response = await admin.graphql(GET_SELLING_PLAN_GROUPS_QUERY, {
      variables: {
        first: options?.first || 50,
        query: options?.query || null,
      },
    });

    const data = await response.json();
    const groups = data.data?.sellingPlanGroups?.edges || [];

    return groups.map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.name,
      merchantCode: edge.node.merchantCode,
      productCount: edge.node.productCount,
      sellingPlans: edge.node.sellingPlans.edges.map((sp: any) => ({
        id: sp.node.id,
        name: sp.node.name,
      })),
    }));
  } catch (error) {
    console.error("[SellingPlan] Error fetching selling plan groups:", error);
    return [];
  }
}

/**
 * Selling Plan Groupの詳細を取得
 */
export async function getSellingPlanGroupById(
  admin: AdminApiContext,
  id: string
): Promise<any | null> {
  try {
    const response = await admin.graphql(GET_SELLING_PLAN_GROUP_BY_ID_QUERY, {
      variables: { id },
    });

    const data = await response.json();
    return data.data?.sellingPlanGroup || null;
  } catch (error) {
    console.error("[SellingPlan] Error fetching selling plan group:", error);
    return null;
  }
}

/**
 * 予約用のデフォルトSelling Plan Groupを取得または作成
 *
 * @param admin - Shopify Admin API コンテキスト
 * @param depositPercentage - 手付金の割合（デフォルト: 20%）
 */
export async function getOrCreateBookingSellingPlanGroup(
  admin: AdminApiContext,
  depositPercentage: number = 20
): Promise<CreateSellingPlanGroupResult> {
  const merchantCode = `booking-deposit-${depositPercentage}pct`;

  try {
    // 既存のプランを検索
    const existingGroups = await getSellingPlanGroups(admin, {
      query: `merchant_code:${merchantCode}`,
    });

    if (existingGroups.length > 0) {
      const existing = existingGroups[0];
      return {
        success: true,
        sellingPlanGroupId: existing.id,
        sellingPlanId: existing.sellingPlans[0]?.id,
      };
    }

    // 存在しなければ新規作成
    return await createDepositSellingPlanGroup(admin, {
      name: `予約手付金 (${depositPercentage}%)`,
      merchantCode,
      depositType: "PERCENTAGE",
      depositValue: depositPercentage,
    });
  } catch (error) {
    console.error("[SellingPlan] Error in getOrCreate:", error);
    return {
      success: false,
      error: "Selling Planの取得/作成に失敗しました",
    };
  }
}


import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

/**
 * 料金プラン定義
 *
 * | プラン名   | 価格/月 | 月間予約上限 | 手付金 | LINE連携      | 複数店舗 | 備考                         |
 * |-----------|--------|-------------|-------|--------------|---------|------------------------------|
 * | Free      | $0     | 10件        | ○     | ×            | ×       | コンセプト実証用・小規模店向け |
 * | Standard  | $29    | 50件        | ○     | ×            | ×       | 成長期の店舗向け              |
 * | Pro       | $49    | 300件       | ○     | ○ (自動化)    | ×       | 本格的な運営向け・LINE活用前提 |
 * | Max       | $120   | 無制限       | ○     | ○ (複数Ch)   | ○       | 多店舗展開向け               |
 */
export const BILLING_PLANS = {
  FREE: {
    name: "Free",
    amount: 0,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 10,
    features: [
      "10件/月の予約",
      "手付金機能",
      "基本的なカレンダーウィジェット",
      "メールサポート",
    ],
    lineEnabled: false,
    multiShopEnabled: false,
  },
  STANDARD: {
    name: "Standard",
    amount: 29,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 50,
    features: [
      "50件/月の予約",
      "手付金機能",
      "複数リソース管理",
      "優先メールサポート",
    ],
    lineEnabled: false,
    multiShopEnabled: false,
  },
  PRO: {
    name: "Pro",
    amount: 49,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 300,
    features: [
      "300件/月の予約",
      "手付金機能",
      "LINE連携（自動通知）",
      "予約リマインダー",
      "チャットサポート",
    ],
    lineEnabled: true,
    multiShopEnabled: false,
  },
  MAX: {
    name: "Max",
    amount: 120,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: Infinity,
    features: [
      "無制限の予約",
      "手付金機能",
      "LINE連携（複数チャネル）",
      "多店舗管理",
      "スタッフ権限管理",
      "統合ダッシュボード"
    ],
    lineEnabled: true,
    multiShopEnabled: true,
  },
} as const;

export type PlanKey = keyof typeof BILLING_PLANS;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BILLING_PLANS.STANDARD.name]: {
      amount: BILLING_PLANS.STANDARD.amount,
      currencyCode: BILLING_PLANS.STANDARD.currencyCode,
      interval: BILLING_PLANS.STANDARD.interval,
    },
    [BILLING_PLANS.PRO.name]: {
      amount: BILLING_PLANS.PRO.amount,
      currencyCode: BILLING_PLANS.PRO.currencyCode,
      interval: BILLING_PLANS.PRO.interval,
    },
    [BILLING_PLANS.MAX.name]: {
      amount: BILLING_PLANS.MAX.amount,
      currencyCode: BILLING_PLANS.MAX.currencyCode,
      interval: BILLING_PLANS.MAX.interval,
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

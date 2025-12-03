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
 * | プラン   | 月額   | 予約上限 | 主な機能 |
 * |---------|--------|---------|---------|
 * | Free    | $0     | 30件/月  | 基本機能 |
 * | Standard| $9/月  | 100件/月 | + 複数ロケーション |
 * | Pro     | $29/月 | 500件/月 | + 優先サポート |
 * | Max     | $79/月 | 無制限   | + カスタム機能 |
 */
export const BILLING_PLANS = {
  FREE: {
    name: "Free",
    amount: 0,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 30,
    features: ["基本的な予約機能", "1ロケーション", "メールサポート"],
  },
  STANDARD: {
    name: "Standard",
    amount: 9,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 100,
    features: ["100件/月の予約", "複数ロケーション", "優先メールサポート"],
  },
  PRO: {
    name: "Pro",
    amount: 29,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: 500,
    features: ["500件/月の予約", "無制限ロケーション", "チャットサポート", "分析ダッシュボード"],
  },
  MAX: {
    name: "Max",
    amount: 79,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    usageLimit: Infinity,
    features: ["無制限の予約", "全機能", "電話サポート", "カスタム連携"],
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

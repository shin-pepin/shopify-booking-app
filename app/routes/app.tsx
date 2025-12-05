import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">🏠 ホーム</s-link>
        <s-link href="/app/bookings">📅 予約を見る</s-link>
        <s-link href="/app/resources">👤 スタッフ・部屋</s-link>
        <s-link href="/app/settings">💰 前払い</s-link>
        <s-link href="/app/line">💬 LINE通知</s-link>
        <s-link href="/app/organization">🏢 複数店舗</s-link>
        <s-link href="/app/billing">💎 プラン</s-link>
        <s-link href="/app/guide">❓ 使い方</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

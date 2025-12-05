import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  canUseLine,
  getLineConfig,
  saveLineConfig,
} from "../services/line.server";

// === Types ===
interface LoaderData {
  shop: string;
  canUse: boolean;
  planType: string;
  config: {
    channelId: string;
    channelSecret: string;
    accessToken: string;
    notifyOnConfirm: boolean;
    notifyOnCancel: boolean;
    notifyReminder: boolean;
    reminderHours: number;
    isEnabled: boolean;
  } | null;
  webhookUrl: string;
  linkedUsersCount: number;
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopData = await db.shop.findUnique({
    where: { id: shop },
    select: { planType: true },
  });

  const canUse = await canUseLine(shop);
  const config = await getLineConfig(shop);

  const linkedUsersCount = await db.lineUserLink.count({
    where: { shopId: shop, isLinked: true },
  });

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhooks/line`;

  return {
    shop,
    canUse,
    planType: shopData?.planType || "FREE",
    config: config
      ? {
          channelId: config.channelId,
          channelSecret: "********",
          accessToken: "********",
          notifyOnConfirm: config.notifyOnConfirm,
          notifyOnCancel: config.notifyOnCancel,
          notifyReminder: config.notifyReminder,
          reminderHours: config.reminderHours,
          isEnabled: config.isEnabled,
        }
      : null,
    webhookUrl,
    linkedUsersCount,
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (!(await canUseLine(shop))) {
    return { success: false, error: "LINE通知はPro/Maxプランでご利用いただけます" };
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "save") {
    const channelId = formData.get("channelId") as string;
    const channelSecret = formData.get("channelSecret") as string;
    const accessToken = formData.get("accessToken") as string;
    const notifyOnConfirm = formData.get("notifyOnConfirm") === "true";
    const notifyOnCancel = formData.get("notifyOnCancel") === "true";
    const notifyReminder = formData.get("notifyReminder") === "true";
    const reminderHours = parseInt(formData.get("reminderHours") as string) || 24;

    if (!channelId || !channelSecret || !accessToken) {
      return { success: false, error: "必須項目を入力してください" };
    }

    try {
      const existingConfig = await getLineConfig(shop);

      await saveLineConfig(shop, {
        channelId,
        channelSecret:
          channelSecret === "********" && existingConfig
            ? existingConfig.channelSecret
            : channelSecret,
        accessToken:
          accessToken === "********" && existingConfig
            ? existingConfig.accessToken
            : accessToken,
        notifyOnConfirm,
        notifyOnCancel,
        notifyReminder,
        reminderHours,
      });

      return { success: true, message: "設定を保存しました！" };
    } catch (error) {
      console.error("[LINE Settings] Save error:", error);
      return { success: false, error: "保存に失敗しました" };
    }
  }

  if (action === "toggle") {
    const config = await getLineConfig(shop);
    if (!config) {
      return { success: false, error: "先に設定を保存してください" };
    }

    try {
      await db.lineConfig.update({
        where: { shopId: shop },
        data: { isEnabled: !config.isEnabled },
      });

      return {
        success: true,
        message: config.isEnabled ? "LINE通知を停止しました" : "LINE通知を開始しました！",
      };
    } catch (error) {
      return { success: false, error: "切り替えに失敗しました" };
    }
  }

  return { success: false, error: "不明なアクションです" };
};

// === Component ===
export default function LineSettingsPage() {
  const { canUse, planType, config, webhookUrl, linkedUsersCount } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; message?: string; error?: string }>();
  const shopify = useAppBridge();

  const [formData, setFormData] = useState({
    channelId: config?.channelId || "",
    channelSecret: config?.channelSecret || "",
    accessToken: config?.accessToken || "",
    notifyOnConfirm: config?.notifyOnConfirm ?? true,
    notifyOnCancel: config?.notifyOnCancel ?? true,
    notifyReminder: config?.notifyReminder ?? false,
    reminderHours: config?.reminderHours ?? 24,
  });

  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSave = () => {
    fetcher.submit(
      {
        action: "save",
        channelId: formData.channelId,
        channelSecret: formData.channelSecret,
        accessToken: formData.accessToken,
        notifyOnConfirm: String(formData.notifyOnConfirm),
        notifyOnCancel: String(formData.notifyOnCancel),
        notifyReminder: String(formData.notifyReminder),
        reminderHours: String(formData.reminderHours),
      },
      { method: "POST" }
    );
  };

  const handleToggle = () => {
    fetcher.submit({ action: "toggle" }, { method: "POST" });
  };

  // Pro/Maxプラン以外はアクセス不可
  if (!canUse) {
    return (
      <s-page heading="LINE通知">
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>🔒 Proプラン以上でご利用いただけます</s-heading>
              <s-paragraph>
                LINE通知を使うと、予約が入った時にお客様のLINEに自動でお知らせを送れます。
              </s-paragraph>
              <s-stack direction="block" gap="base">
                <s-text>✓ 予約確定のお知らせ</s-text>
                <s-text>✓ 予約日の前日にリマインダー</s-text>
                <s-text>✓ キャンセル通知</s-text>
              </s-stack>
              <s-paragraph>
                <s-text>
                  LINEで連絡が届くと、お客様は予約を忘れにくくなり、
                  無断キャンセルが減ります！
                </s-text>
              </s-paragraph>
              <s-paragraph>
                現在のプラン: <s-badge>{planType}</s-badge>
              </s-paragraph>
              <s-button variant="primary" href="/app/billing">
                プランを見る →
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="LINE通知の設定">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true, disabled: true } : {})}
      >
        💾 設定を保存
      </s-button>

      {/* ステータス */}
      <s-section heading="📊 現在の状態">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="inline" gap="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-heading>LINE通知</s-heading>
                <s-badge tone={config?.isEnabled ? "success" : "warning"}>
                  {config?.isEnabled ? "✓ 送信中" : "停止中"}
                </s-badge>
              </s-stack>
              <s-text>LINE連携済みのお客様: {linkedUsersCount}人</s-text>
            </s-stack>
            {config && (
              <s-button
                variant={config.isEnabled ? "tertiary" : "primary"}
                onClick={handleToggle}
                {...(isSubmitting ? { loading: true, disabled: true } : {})}
              >
                {config.isEnabled ? "通知を停止する" : "通知を開始する"}
              </s-button>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* API設定 */}
      <s-section heading="🔧 LINE Developerの設定情報">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>📋 Webhook URL（これをLINEに設定します）</strong></s-text>
              <s-paragraph>
                <s-text>
                  LINE Developers Consoleで「Webhook URL」にこのURLを設定してください。
                </s-text>
              </s-paragraph>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text>{webhookUrl}</s-text>
              </s-box>
              <s-text>↑ このURLをコピーして貼り付けてください</s-text>
            </s-stack>
          </s-box>

          <s-text-field
            label="Channel ID（チャネルID）"
            value={formData.channelId}
            onChange={(e: any) => setFormData({ ...formData, channelId: e.target.value })}
            placeholder="1234567890"
          />

          <s-text-field
            label="Channel Secret（チャネルシークレット）"
            value={formData.channelSecret}
            onChange={(e: any) => setFormData({ ...formData, channelSecret: e.target.value })}
            placeholder="半角英数字32文字"
            type="password"
          />

          <s-text-field
            label="Access Token（アクセストークン）"
            value={formData.accessToken}
            onChange={(e: any) => setFormData({ ...formData, accessToken: e.target.value })}
            placeholder="長いトークン文字列"
            type="password"
          />
        </s-stack>
      </s-section>

      {/* 通知設定 */}
      <s-section heading="📬 いつ通知を送りますか？">
        <s-stack direction="block" gap="base">
          <s-checkbox
            checked={formData.notifyOnConfirm}
            onChange={(e: any) => setFormData({ ...formData, notifyOnConfirm: e.target.checked })}
          >
            ✅ 予約が確定した時
          </s-checkbox>

          <s-checkbox
            checked={formData.notifyOnCancel}
            onChange={(e: any) => setFormData({ ...formData, notifyOnCancel: e.target.checked })}
          >
            ❌ 予約がキャンセルされた時
          </s-checkbox>

          <s-checkbox
            checked={formData.notifyReminder}
            onChange={(e: any) => setFormData({ ...formData, notifyReminder: e.target.checked })}
          >
            ⏰ 予約日の前にリマインダーを送る
          </s-checkbox>

          {formData.notifyReminder && (
            <s-text-field
              label="何時間前にリマインダーを送りますか？"
              type="number"
              value={String(formData.reminderHours)}
              onChange={(e: any) =>
                setFormData({ ...formData, reminderHours: parseInt(e.target.value) || 24 })
              }
              min="1"
              max="72"
            />
          )}
        </s-stack>
      </s-section>

      {/* セットアップガイド */}
      <s-section slot="aside" heading="📖 設定のしかた">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>かんたん5ステップ</strong></s-text>
              <s-text>
                ① <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">LINE Developers</a> にログイン
              </s-text>
              <s-text>② 「新規チャネル作成」→「Messaging API」を選択</s-text>
              <s-text>③ チャネル基本情報からID・シークレットをコピー</s-text>
              <s-text>④ Messaging API設定から「アクセストークン」を発行</s-text>
              <s-text>⑤ Webhook URLを設定してONにする</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="💡 お客様への案内">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>
                LINE通知を送るには、お客様に<strong>お店のLINE公式アカウント</strong>を
                友だち追加してもらう必要があります。
              </s-text>
              <s-text>
                店頭やウェブサイトにQRコードを置いたり、
                予約完了ページに案内を表示するのがおすすめです！
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

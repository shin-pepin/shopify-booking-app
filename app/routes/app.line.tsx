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
    return { success: false, error: "LINE連携はPro/Maxプランで利用可能です" };
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

      return { success: true, message: "設定を保存しました" };
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
        message: config.isEnabled ? "LINE連携を無効にしました" : "LINE連携を有効にしました",
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
      <s-page heading="LINE連携設定">
        <s-section>
          <s-box padding="loose" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>Pro/Maxプラン専用機能</s-heading>
              <s-paragraph>
                LINE連携機能はProプラン（$49/月）またはMaxプラン（$120/月）でご利用いただけます。
              </s-paragraph>
              <s-paragraph>
                現在のプラン: <s-badge>{planType}</s-badge>
              </s-paragraph>
              <s-button variant="primary" url="/app/billing">
                プランをアップグレード
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="LINE連携設定">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true, disabled: true } : {})}
      >
        設定を保存
      </s-button>

      {/* ステータス */}
      <s-section heading="連携ステータス">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="inline" gap="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-heading>LINE通知</s-heading>
                <s-badge tone={config?.isEnabled ? "success" : "warning"}>
                  {config?.isEnabled ? "有効" : "無効"}
                </s-badge>
              </s-stack>
              <s-text>連携ユーザー数: {linkedUsersCount}人</s-text>
            </s-stack>
            {config && (
              <s-button
                variant={config.isEnabled ? "tertiary" : "primary"}
                tone={config.isEnabled ? "critical" : undefined}
                onClick={handleToggle}
                {...(isSubmitting ? { loading: true, disabled: true } : {})}
              >
                {config.isEnabled ? "無効にする" : "有効にする"}
              </s-button>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* API設定 */}
      <s-section heading="LINE Messaging API設定">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>Webhook URL</strong></s-text>
              <s-text>LINE Developers ConsoleでこのURLを設定してください</s-text>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text>{webhookUrl}</s-text>
              </s-box>
            </s-stack>
          </s-box>

          <s-text-field
            label="Channel ID"
            value={formData.channelId}
            onChange={(e: any) => setFormData({ ...formData, channelId: e.target.value })}
            placeholder="LINE Channel ID"
          />

          <s-text-field
            label="Channel Secret"
            value={formData.channelSecret}
            onChange={(e: any) => setFormData({ ...formData, channelSecret: e.target.value })}
            placeholder="LINE Channel Secret"
            type="password"
          />

          <s-text-field
            label="Channel Access Token"
            value={formData.accessToken}
            onChange={(e: any) => setFormData({ ...formData, accessToken: e.target.value })}
            placeholder="LINE Channel Access Token"
            type="password"
          />
        </s-stack>
      </s-section>

      {/* 通知設定 */}
      <s-section heading="通知設定">
        <s-stack direction="block" gap="base">
          <s-checkbox
            checked={formData.notifyOnConfirm}
            onChange={(e: any) => setFormData({ ...formData, notifyOnConfirm: e.target.checked })}
          >
            予約確定時に通知する
          </s-checkbox>

          <s-checkbox
            checked={formData.notifyOnCancel}
            onChange={(e: any) => setFormData({ ...formData, notifyOnCancel: e.target.checked })}
          >
            予約キャンセル時に通知する
          </s-checkbox>

          <s-checkbox
            checked={formData.notifyReminder}
            onChange={(e: any) => setFormData({ ...formData, notifyReminder: e.target.checked })}
          >
            予約リマインダーを送信する
          </s-checkbox>

          {formData.notifyReminder && (
            <s-text-field
              label="リマインダー送信タイミング（時間前）"
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
      <s-section slot="aside" heading="セットアップ手順">
        <s-stack direction="block" gap="base">
          <s-ordered-list>
            <s-list-item>
              <s-text>
                <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">
                  LINE Developers Console
                </a>
                でチャネルを作成
              </s-text>
            </s-list-item>
            <s-list-item><s-text>Channel ID, Secret, Access Tokenを取得</s-text></s-list-item>
            <s-list-item><s-text>Webhook URLを設定</s-text></s-list-item>
            <s-list-item><s-text>Webhookの利用を「ON」に設定</s-text></s-list-item>
            <s-list-item><s-text>自動応答を「OFF」に設定</s-text></s-list-item>
          </s-ordered-list>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="ユーザー連携">
        <s-stack direction="block" gap="base">
          <s-text>
            顧客がLINE通知を受け取るには、ショップのマイページまたは
            チェックアウト完了画面から「LINE連携」を行う必要があります。
          </s-text>
          <s-text>
            連携済みユーザーには、予約確定・キャンセル時に自動でLINE通知が送信されます。
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

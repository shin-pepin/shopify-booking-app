import { useAppBridge } from "@shopify/app-bridge-react";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function GuidePage() {
  return (
    <s-page heading="使い方ガイド">
      <s-section>
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-heading>ようこそ！予約システムのセットアップへ</s-heading>
            <s-paragraph>
              このアプリを使えば、Shopifyストアで簡単に予約受付を開始できます。
              まずは以下のステップに従って設定を進めましょう。
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      {/* STEP 1: 店舗の設定 */}
      <s-section heading="STEP 1: 店舗（ロケーション）の準備">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="base">
                <s-badge tone="info">必須</s-badge>
                <s-text><strong>Shopifyのロケーションを同期する</strong></s-text>
              </s-stack>
              <s-paragraph>
                <s-text tone="subdued">
                  まずは予約を受け付ける「場所」をアプリに認識させる必要があります。
                </s-text>
              </s-paragraph>
              <s-ordered-list>
                <s-list-item>メニューの「ホーム」をクリックします。</s-list-item>
                <s-list-item>「Shopifyから同期」ボタンを押します。</s-list-item>
                <s-list-item>登録済みの店舗が表示されれば完了です。</s-list-item>
              </s-ordered-list>
              <s-button url="/app">ホームへ移動</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* STEP 2: スタッフ・部屋の登録 */}
      <s-section heading="STEP 2: スタッフや部屋の登録">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="base">
                <s-badge tone="info">必須</s-badge>
                <s-text><strong>リソース（スタッフ・部屋）を作成する</strong></s-text>
              </s-stack>
              <s-paragraph>
                <s-text tone="subdued">
                  予約の対象となる「人（美容師など）」や「場所（会議室など）」を登録し、シフト（営業時間）を決めます。
                </s-text>
              </s-paragraph>
              <s-ordered-list>
                <s-list-item>メニューの「リソース管理」をクリックします。</s-list-item>
                <s-list-item>「新規作成」ボタンを押し、名前とタイプ（スタッフ/部屋）を入力して保存します。</s-list-item>
                <s-list-item>作成された名前をクリックし、「シフト設定」で働ける曜日と時間を設定します。</s-list-item>
              </s-ordered-list>
              <s-button url="/app/resources">リソース管理へ移動</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* STEP 3: ストアへの表示 */}
      <s-section heading="STEP 3: 予約カレンダーの表示">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-stack direction="inline" gap="base">
                <s-badge tone="success">仕上げ</s-badge>
                <s-text><strong>テーマエディタで設定する</strong></s-text>
              </s-stack>
              <s-paragraph>
                <s-text tone="subdued">
                  最後に、お客様が見る商品ページに予約カレンダーを表示させます。
                </s-text>
              </s-paragraph>
              <s-ordered-list>
                <s-list-item>Shopify管理画面の「オンラインストア」＞「テーマ」＞「カスタマイズ」を開きます。</s-list-item>
                <s-list-item>予約を受け付けたい商品ページに移動します。</s-list-item>
                <s-list-item>「ブロックを追加」から「Booking Calendar」を選択します。</s-list-item>
                <s-list-item>保存して、実際にストアでカレンダーが表示されるか確認してください。</s-list-item>
              </s-ordered-list>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* 応用機能 */}
      <s-section heading="さらに便利に使う">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="tight">
                <s-text><strong>💰 手付金を設定する</strong></s-text>
                <s-text tone="subdued">
                  予約時に「20%だけ前払い」のような設定が可能です。「手付金設定」メニューからプランを作成し、商品に追加してください。
                </s-text>
              </s-stack>
              <s-stack direction="block" gap="tight">
                <s-text><strong>💬 LINEで通知を送る（Proプラン以上）</strong></s-text>
                <s-text tone="subdued">
                  予約が入った時に自動でお客様にLINEを送れます。「LINE連携」メニューから設定できます。
                </s-text>
              </s-stack>
              <s-stack direction="block" gap="tight">
                <s-text><strong>🏢 複数店舗を管理する（Maxプラン）</strong></s-text>
                <s-text tone="subdued">
                  支店が増えても大丈夫。「多店舗管理」メニューで、全店舗の予約を一括管理できます。
                </s-text>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="サポート">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            設定でご不明な点がありましたら、サポートまでお問い合わせください。
          </s-paragraph>
          <s-button variant="plain">お問い合わせフォーム</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};


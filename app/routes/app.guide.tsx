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
            <s-heading>🎉 ようこそ！予約システムへ</s-heading>
            <s-paragraph>
              このアプリを使えば、あなたのお店のウェブサイトで予約を受け付けられるようになります！
            </s-paragraph>
            <s-paragraph>
              <s-text>
                むずかしい作業は何もありません。
                <strong>たった3ステップ</strong>で、お客様からの予約を受け付けられます。
              </s-text>
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      {/* STEP 1: 店舗の設定 */}
      <s-section heading="ステップ1 🏪 店舗情報を読み込む">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-badge tone="success">かんたん！</s-badge>
                <s-text><strong>ボタンを1回押すだけ</strong></s-text>
              </s-stack>
              <s-paragraph>
                Shopifyに登録されているお店の情報を取り込みます。
                すでに登録されている店舗情報を使うので、入力の手間はありません。
              </s-paragraph>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-text><strong>やりかた</strong></s-text>
                  <s-text>① 左メニューの「🏠 ホーム」をクリック</s-text>
                  <s-text>② 右上の「🔄 ロケーションを読み込む」ボタンをクリック</s-text>
                  <s-text>③ お店の名前が表示されたら成功です！</s-text>
                </s-stack>
              </s-box>
              <s-button href="/app" variant="primary">🏠 ホームへ行く</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* STEP 2: スタッフ・部屋の登録 */}
      <s-section heading="ステップ2 👤 予約を受けるスタッフや部屋を登録">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-badge tone="info">大切！</s-badge>
                <s-text><strong>誰が（何が）予約を受けるか決めましょう</strong></s-text>
              </s-stack>
              <s-paragraph>
                予約を受け付けたい美容師さんや部屋を登録します。
                お一人ずつ、または部屋ごとに登録してください。
              </s-paragraph>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-text><strong>やりかた</strong></s-text>
                  <s-text>① 左メニューの「👤 スタッフ・部屋」をクリック</s-text>
                  <s-text>② 「＋ 新しく追加」ボタンを押す</s-text>
                  <s-text>③ 名前と種類（スタッフ/部屋など）を入力</s-text>
                  <s-text>④ 登録したら「シフトを設定」で出勤日と時間を設定</s-text>
                </s-stack>
              </s-box>
              <s-paragraph>
                <s-text>
                  💡 <strong>ヒント:</strong> 「田中さん」「山田さん」のように、
                  お客様がわかりやすい名前で登録してください。
                </s-text>
              </s-paragraph>
              <s-button href="/app/resources" variant="primary">👤 スタッフ・部屋の登録へ</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* STEP 3: ストアへの表示 */}
      <s-section heading="ステップ3 📅 予約カレンダーをお店のページに表示">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-badge tone="warning">最後のステップ！</s-badge>
                <s-text><strong>お客様が予約できるようにする</strong></s-text>
              </s-stack>
              <s-paragraph>
                ここまでできたら、あとはお店のページに予約カレンダーを表示するだけ！
                Shopifyの画面から設定できます。
              </s-paragraph>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-text><strong>やりかた</strong></s-text>
                  <s-text>① Shopify管理画面で「オンラインストア」→「テーマ」を開く</s-text>
                  <s-text>② 「カスタマイズ」をクリック</s-text>
                  <s-text>③ 予約カレンダーを表示したいページ（商品ページなど）へ移動</s-text>
                  <s-text>④ 「ブロックを追加」から「Booking Calendar」を選ぶ</s-text>
                  <s-text>⑤ 「保存」を押して完了！</s-text>
                </s-stack>
              </s-box>
              <s-paragraph>
                <s-text>
                  ✨ 設置が終わったら、実際にストアを開いて
                  カレンダーが表示されているか確認してくださいね。
                </s-text>
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* これで完了！ */}
      <s-section heading="🎊 設定完了！">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>お疲れさまでした！</s-heading>
            <s-paragraph>
              これで予約システムの基本設定は完了です。
              お客様がカレンダーから予約を入れると、「📅 予約を見る」に表示されます。
            </s-paragraph>
            <s-button variant="primary" href="/app/bookings">📅 予約を見る</s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* 応用機能 */}
      <s-section heading="✨ もっと便利に使う">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>💰 前払い（デポジット）を受け取る</strong></s-text>
              <s-text>
                「予約時に20%だけ前払い」のような設定ができます。
                無断キャンセル防止に効果的！
              </s-text>
              <s-button variant="tertiary" href="/app/settings">前払いを設定する →</s-button>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>💬 LINEで予約通知を送る</strong></s-text>
              <s-text>
                予約が入った時や、予約日の前日に、
                お客様のLINEに自動でお知らせを送れます。
              </s-text>
              <s-text>※ Proプラン以上でご利用いただけます</s-text>
              <s-button variant="tertiary" href="/app/line">LINE通知を設定する →</s-button>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text><strong>🏢 複数のお店をまとめて管理</strong></s-text>
              <s-text>
                2店舗目、3店舗目...と増えても大丈夫。
                すべての予約を1つの画面で見られます。
              </s-text>
              <s-text>※ Maxプランでご利用いただけます</s-text>
              <s-button variant="tertiary" href="/app/organization">複数店舗管理を見る →</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* サイドバー */}
      <s-section slot="aside" heading="🆘 困ったときは">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            設定でわからないことがあれば、
            お気軽にお問い合わせください。
          </s-paragraph>
          <s-paragraph>
            <s-text>
              日本語でサポートいたします！
            </s-text>
          </s-paragraph>
          <s-button variant="tertiary">📧 お問い合わせする</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="💡 おすすめの使い方">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-text>
              最初は<strong>「Free」プラン（無料）</strong>で試してみて、
              予約が増えてきたらプランを変更するのがおすすめです！
            </s-text>
            <s-button variant="tertiary" href="/app/billing">プランを見る →</s-button>
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="📋 クイックリンク">
        <s-stack direction="block" gap="base">
          <s-button variant="tertiary" href="/app">🏠 ホーム</s-button>
          <s-button variant="tertiary" href="/app/resources">👤 スタッフ・部屋</s-button>
          <s-button variant="tertiary" href="/app/bookings">📅 予約を見る</s-button>
          <s-button variant="tertiary" href="/app/billing">💎 プラン</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

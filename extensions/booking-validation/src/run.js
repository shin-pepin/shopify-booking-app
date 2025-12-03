/**
 * Booking Validation - Cart Validation Function
 * 
 * カート内の予約情報を検証し、不正な予約をブロック
 * 
 * 検証内容:
 * 1. 予約日時が過去でないか
 * 2. （将来的に）ダブルブッキングしていないか
 * 
 * @see https://shopify.dev/docs/api/functions/reference/cart-checkout-validation
 */

/**
 * メインのバリデーション関数
 * @param {Object} input - GraphQLクエリの結果
 * @returns {Object} バリデーション結果
 */
export function run(input) {
  const errors = [];
  const cart = input?.cart;

  if (!cart?.lines) {
    return { errors: [] };
  }

  // 現在時刻を取得（UTC）
  const now = new Date();

  // カート内の各商品をチェック
  for (const line of cart.lines) {
    const bookingStartAttr = line.attribute;
    
    // 予約情報がない商品はスキップ
    if (!bookingStartAttr?.value) {
      continue;
    }

    const bookingStartStr = bookingStartAttr.value;
    
    // 予約日時をパース
    const bookingStart = parseBookingDateTime(bookingStartStr);
    
    if (!bookingStart) {
      // パースに失敗した場合
      errors.push({
        localizedMessage: "予約日時の形式が正しくありません。もう一度選択してください。",
        target: "cart"
      });
      continue;
    }

    // バリデーション 1: 過去日時チェック
    const pastDateError = validateNotPastDate(bookingStart, now, line);
    if (pastDateError) {
      errors.push(pastDateError);
    }

    // バリデーション 2: 最小予約時間チェック（現在時刻から1時間以上先）
    const minLeadTimeError = validateMinLeadTime(bookingStart, now, line);
    if (minLeadTimeError) {
      errors.push(minLeadTimeError);
    }

    // バリデーション 3: 最大予約期間チェック（90日以内）
    const maxAdvanceError = validateMaxAdvanceBooking(bookingStart, now, line);
    if (maxAdvanceError) {
      errors.push(maxAdvanceError);
    }
  }

  return { errors };
}

/**
 * 予約日時文字列をDateオブジェクトにパース
 * ISO 8601形式またはカスタム形式に対応
 * 
 * @param {string} dateStr - 予約日時文字列
 * @returns {Date|null} Dateオブジェクトまたはnull
 */
function parseBookingDateTime(dateStr) {
  if (!dateStr) {
    return null;
  }

  try {
    // ISO 8601形式 (例: 2025-01-15T09:00:00.000Z)
    const date = new Date(dateStr);
    
    // Invalid Dateチェック
    if (isNaN(date.getTime())) {
      return null;
    }
    
    return date;
  } catch (e) {
    return null;
  }
}

/**
 * バリデーション: 過去日時でないことを確認
 * 
 * @param {Date} bookingStart - 予約開始日時
 * @param {Date} now - 現在時刻
 * @param {Object} line - カートライン
 * @returns {Object|null} エラーオブジェクトまたはnull
 */
function validateNotPastDate(bookingStart, now, line) {
  if (bookingStart < now) {
    const productTitle = line.merchandise?.product?.title || "商品";
    return {
      localizedMessage: `「${productTitle}」の予約日時が過去の日付です。有効な日時を選択してください。`,
      target: "cart"
    };
  }
  return null;
}

/**
 * バリデーション: 最小予約リードタイム
 * 予約は現在時刻から1時間以上先である必要がある
 * 
 * @param {Date} bookingStart - 予約開始日時
 * @param {Date} now - 現在時刻
 * @param {Object} line - カートライン
 * @returns {Object|null} エラーオブジェクトまたはnull
 */
function validateMinLeadTime(bookingStart, now, line) {
  const minLeadTimeMs = 60 * 60 * 1000; // 1時間
  const minBookingTime = new Date(now.getTime() + minLeadTimeMs);
  
  if (bookingStart < minBookingTime) {
    const productTitle = line.merchandise?.product?.title || "商品";
    return {
      localizedMessage: `「${productTitle}」の予約は、現在時刻から1時間以上先の時間を選択してください。`,
      target: "cart"
    };
  }
  return null;
}

/**
 * バリデーション: 最大予約期間
 * 予約は90日以内である必要がある
 * 
 * @param {Date} bookingStart - 予約開始日時
 * @param {Date} now - 現在時刻
 * @param {Object} line - カートライン
 * @returns {Object|null} エラーオブジェクトまたはnull
 */
function validateMaxAdvanceBooking(bookingStart, now, line) {
  const maxAdvanceDays = 90;
  const maxAdvanceMs = maxAdvanceDays * 24 * 60 * 60 * 1000;
  const maxBookingTime = new Date(now.getTime() + maxAdvanceMs);
  
  if (bookingStart > maxBookingTime) {
    const productTitle = line.merchandise?.product?.title || "商品";
    return {
      localizedMessage: `「${productTitle}」の予約は${maxAdvanceDays}日以内の日時を選択してください。`,
      target: "cart"
    };
  }
  return null;
}

/**
 * 将来の拡張用: ダブルブッキング検証
 * 
 * 注意: Shopify Functionsからは外部APIを直接呼び出せないため、
 * この検証は以下の方法で実装する必要があります：
 * 
 * 1. Metaobjects/Metafieldsに予約済み枠を保存し、GraphQLで取得
 * 2. カート属性に検証結果フラグを事前にセット
 * 3. Checkout UI Extensionと組み合わせて検証
 * 
 * @param {string} resourceId - リソースID
 * @param {Date} bookingStart - 予約開始日時
 * @param {Date} bookingEnd - 予約終了日時
 * @returns {Object|null} エラーオブジェクトまたはnull
 */
function validateNoDoubleBooking(resourceId, bookingStart, bookingEnd) {
  // TODO: Metafieldsから予約済み枠を取得して検証
  // 現在はプレースホルダー
  return null;
}


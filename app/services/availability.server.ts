/**
 * 空き枠計算エンジン (Availability Engine)
 *
 * SPEC.md の「3.1 Availability Engine」に基づく実装
 *
 * 重要な仕様:
 * 1. Filter by Location: locationIdでScheduleをフィルタ
 * 2. Shift Priority: specificDate（特別シフト）を優先、なければdayOfWeek
 * 3. Buffer Handling:
 *    - BlockStart = Booking.startAt - Buffer
 *    - BlockEnd = Booking.endAt + Buffer
 * 4. 全ての時刻はUTCで処理し、表示層でタイムゾーン変換
 */

import db from "../db.server";
import type { BookingStatus } from "@prisma/client";
import { checkQuota } from "./quota.server";

// === Types ===

/**
 * 予約可能なスロット
 */
export interface AvailableSlot {
  /** スロット開始時刻 (UTC) */
  startTime: Date;
  /** スロット終了時刻 (UTC) */
  endTime: Date;
  /** 表示用の開始時刻文字列 (HH:mm) */
  startTimeDisplay: string;
  /** 表示用の終了時刻文字列 (HH:mm) */
  endTimeDisplay: string;
}

/**
 * 空き枠取得のパラメータ
 */
export interface GetAvailableSlotsParams {
  /** ショップID（クォータチェック用） */
  shopId?: string;
  /** ロケーションID */
  locationId: string;
  /** リソースID */
  resourceId: string;
  /** 対象日付 (YYYY-MM-DD形式またはDateオブジェクト) */
  date: string | Date;
  /** サービスの所要時間（分） */
  durationMinutes: number;
  /** バッファ時間（分）- 前後の準備時間 */
  bufferMinutes?: number;
  /** スロット間隔（分）- デフォルト30分 */
  slotInterval?: number;
  /** タイムゾーン - デフォルト Asia/Tokyo */
  timezone?: string;
  /** クォータチェックをスキップするか */
  skipQuotaCheck?: boolean;
}

/**
 * 空き枠取得の結果
 */
export interface GetAvailableSlotsResult {
  /** 成功フラグ */
  success: boolean;
  /** 予約可能なスロット一覧 */
  slots: AvailableSlot[];
  /** エラーメッセージ（エラー時のみ） */
  error?: string;
  /** クォータ制限に達しているか */
  quotaLimitReached?: boolean;
  /** デバッグ情報 */
  debug?: {
    scheduleFound: boolean;
    workingHours: { start: string; end: string } | null;
    existingBookingsCount: number;
    blockedRanges: Array<{ start: Date; end: Date }>;
  };
}

/**
 * 時間範囲を表す型
 */
interface TimeRange {
  start: Date;
  end: Date;
}

// === Helper Functions ===

/**
 * 時刻文字列 (HH:mm) を分単位に変換
 */
function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * 分単位を時刻文字列 (HH:mm) に変換
 */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Date オブジェクトを YYYY-MM-DD 形式に変換（タイムゾーン考慮）
 */
function dateToYYYYMMDD(date: Date, timezone: string): string {
  return date.toLocaleDateString("sv-SE", { timeZone: timezone });
}

/**
 * Date オブジェクトを HH:mm 形式に変換（タイムゾーン考慮）
 */
function dateToHHMM(date: Date, timezone: string): string {
  return date.toLocaleTimeString("sv-SE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 日付文字列と時刻文字列からUTC Dateを生成
 * @param dateStr YYYY-MM-DD形式
 * @param timeStr HH:mm形式
 * @param timezone タイムゾーン
 */
function createDateTimeInTimezone(
  dateStr: string,
  timeStr: string,
  timezone: string
): Date {
  // ISO形式の文字列を作成し、タイムゾーンを指定してパース
  const dateTimeStr = `${dateStr}T${timeStr}:00`;

  // タイムゾーンオフセットを計算
  const localDate = new Date(dateTimeStr);
  const utcDate = new Date(
    localDate.toLocaleString("en-US", { timeZone: "UTC" })
  );
  const tzDate = new Date(
    localDate.toLocaleString("en-US", { timeZone: timezone })
  );
  const offset = utcDate.getTime() - tzDate.getTime();

  return new Date(localDate.getTime() + offset);
}

/**
 * 2つの時間範囲が重複しているかチェック
 */
function rangesOverlap(range1: TimeRange, range2: TimeRange): boolean {
  return range1.start < range2.end && range1.end > range2.start;
}

/**
 * 指定日の曜日を取得（タイムゾーン考慮）
 * 0=日, 1=月, 2=火, ... 6=土
 */
function getDayOfWeek(date: Date, timezone: string): number {
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return dayMap[dateStr] ?? 0;
}

// === Main Function ===

/**
 * 空き枠を計算する
 *
 * @param params 空き枠取得パラメータ
 * @returns 予約可能なスロット一覧
 *
 * @example
 * ```ts
 * const result = await getAvailableSlots({
 *   locationId: "loc-123",
 *   resourceId: "res-456",
 *   date: "2025-01-15",
 *   durationMinutes: 60,
 *   bufferMinutes: 10,
 * });
 *
 * if (result.success) {
 *   console.log(result.slots);
 *   // [{ startTime: Date, endTime: Date, startTimeDisplay: "09:00", endTimeDisplay: "10:00" }, ...]
 * }
 * ```
 */
export async function getAvailableSlots(
  params: GetAvailableSlotsParams
): Promise<GetAvailableSlotsResult> {
  const {
    shopId,
    locationId,
    resourceId,
    skipQuotaCheck = false,
    date,
    durationMinutes,
    bufferMinutes = 0,
    slotInterval = 30,
    timezone = "Asia/Tokyo",
  } = params;

  try {
    // 1. 入力値のバリデーション
    if (!locationId || !resourceId || !date || durationMinutes <= 0) {
      return {
        success: false,
        slots: [],
        error: "必須パラメータが不足しています",
      };
    }

    // 1.5. クォータチェック（使用制限の確認）
    if (shopId && !skipQuotaCheck) {
      const quotaCheck = await checkQuota(shopId);
      if (!quotaCheck.allowed) {
        return {
          success: false,
          slots: [],
          error: quotaCheck.error,
          quotaLimitReached: true,
        };
      }
    }

    // 日付をDate型に正規化
    const targetDate = typeof date === "string" ? new Date(date) : date;
    const targetDateStr = dateToYYYYMMDD(targetDate, timezone);
    const targetDayOfWeek = getDayOfWeek(targetDate, timezone);

    // 2. スケジュールを取得（specificDate優先）
    // Step 2a: specificDateで検索
    let schedule = await db.schedule.findFirst({
      where: {
        resourceId,
        locationId,
        specificDate: new Date(targetDateStr),
        isAvailable: true,
      },
    });

    // Step 2b: specificDateがなければdayOfWeekで検索
    if (!schedule) {
      schedule = await db.schedule.findFirst({
        where: {
          resourceId,
          locationId,
          dayOfWeek: targetDayOfWeek,
          specificDate: null,
          isAvailable: true,
        },
      });
    }

    // スケジュールが見つからない場合（休業日）
    if (!schedule) {
      return {
        success: true,
        slots: [],
        debug: {
          scheduleFound: false,
          workingHours: null,
          existingBookingsCount: 0,
          blockedRanges: [],
        },
      };
    }

    // 3. 営業時間の設定
    const workStartMinutes = timeStringToMinutes(schedule.startTime);
    const workEndMinutes = timeStringToMinutes(schedule.endTime);

    // 営業時間をUTC Dateに変換
    const dayStartUTC = createDateTimeInTimezone(
      targetDateStr,
      schedule.startTime,
      timezone
    );
    const dayEndUTC = createDateTimeInTimezone(
      targetDateStr,
      schedule.endTime,
      timezone
    );

    // 4. 既存の予約を取得（対象日のPENDING_PAYMENTとCONFIRMED）
    // 対象日の開始と終了を取得
    const dayBoundaryStart = createDateTimeInTimezone(
      targetDateStr,
      "00:00",
      timezone
    );
    const dayBoundaryEnd = createDateTimeInTimezone(
      targetDateStr,
      "23:59",
      timezone
    );

    const existingBookings = await db.booking.findMany({
      where: {
        resourceId,
        locationId,
        status: {
          in: ["PENDING_PAYMENT", "CONFIRMED"] as BookingStatus[],
        },
        // 対象日に重なる予約を取得
        OR: [
          {
            // 予約が対象日内に開始
            startAt: {
              gte: dayBoundaryStart,
              lt: dayBoundaryEnd,
            },
          },
          {
            // 予約が対象日内に終了
            endAt: {
              gt: dayBoundaryStart,
              lte: dayBoundaryEnd,
            },
          },
          {
            // 予約が対象日を跨ぐ
            AND: [
              { startAt: { lt: dayBoundaryStart } },
              { endAt: { gt: dayBoundaryEnd } },
            ],
          },
        ],
      },
      include: {
        service: {
          select: {
            bufferTimeMin: true,
          },
        },
      },
      orderBy: { startAt: "asc" },
    });

    // 5. ブロック範囲を計算（予約時間 + バッファ）
    const blockedRanges: TimeRange[] = existingBookings.map((booking) => {
      // 予約に紐づくサービスのバッファ時間を取得
      const bookingBuffer = booking.service?.bufferTimeMin ?? 0;

      return {
        // BlockStart = Booking.startAt - Buffer
        start: new Date(booking.startAt.getTime() - bookingBuffer * 60 * 1000),
        // BlockEnd = Booking.endAt + Buffer
        end: new Date(booking.endAt.getTime() + bookingBuffer * 60 * 1000),
      };
    });

    // 6. 空きスロットを生成
    const slots: AvailableSlot[] = [];
    const totalDurationMinutes = durationMinutes + bufferMinutes;

    // 営業開始から終了まで、slotInterval刻みでスロットを生成
    for (
      let slotStartMinutes = workStartMinutes;
      slotStartMinutes + totalDurationMinutes <= workEndMinutes;
      slotStartMinutes += slotInterval
    ) {
      // スロットの開始・終了時刻を計算
      const slotStartTime = createDateTimeInTimezone(
        targetDateStr,
        minutesToTimeString(slotStartMinutes),
        timezone
      );

      // サービス終了時刻（バッファ前）
      const slotEndTime = new Date(
        slotStartTime.getTime() + durationMinutes * 60 * 1000
      );

      // バッファを含めた実際のブロック範囲
      const slotBlockRange: TimeRange = {
        start: slotStartTime,
        // 新しい予約のブロック終了 = サービス終了 + バッファ
        end: new Date(slotEndTime.getTime() + bufferMinutes * 60 * 1000),
      };

      // 7. 既存予約との重複チェック
      const isBlocked = blockedRanges.some((blocked) =>
        rangesOverlap(slotBlockRange, blocked)
      );

      if (!isBlocked) {
        slots.push({
          startTime: slotStartTime,
          endTime: slotEndTime,
          startTimeDisplay: minutesToTimeString(slotStartMinutes),
          endTimeDisplay: minutesToTimeString(slotStartMinutes + durationMinutes),
        });
      }
    }

    return {
      success: true,
      slots,
      debug: {
        scheduleFound: true,
        workingHours: {
          start: schedule.startTime,
          end: schedule.endTime,
        },
        existingBookingsCount: existingBookings.length,
        blockedRanges,
      },
    };
  } catch (error) {
    console.error("[Availability] Error calculating slots:", error);
    return {
      success: false,
      slots: [],
      error: "空き枠の計算中にエラーが発生しました",
    };
  }
}

// === Additional Utility Functions ===

/**
 * 複数リソースの空き枠を一括取得
 *
 * @param params 基本パラメータ（resourceIdを除く）
 * @param resourceIds リソースIDの配列
 * @returns リソースIDをキーとした空き枠マップ
 */
export async function getAvailableSlotsForMultipleResources(
  params: Omit<GetAvailableSlotsParams, "resourceId">,
  resourceIds: string[]
): Promise<Map<string, GetAvailableSlotsResult>> {
  const results = new Map<string, GetAvailableSlotsResult>();

  // 並列で取得
  const promises = resourceIds.map(async (resourceId) => {
    const result = await getAvailableSlots({ ...params, resourceId });
    return { resourceId, result };
  });

  const settledResults = await Promise.all(promises);

  for (const { resourceId, result } of settledResults) {
    results.set(resourceId, result);
  }

  return results;
}

/**
 * 日付範囲の空き枠を取得（週間ビュー用）
 *
 * @param params 基本パラメータ
 * @param startDate 開始日
 * @param days 日数
 * @returns 日付をキーとした空き枠マップ
 */
export async function getAvailableSlotsForDateRange(
  params: Omit<GetAvailableSlotsParams, "date">,
  startDate: Date,
  days: number
): Promise<Map<string, GetAvailableSlotsResult>> {
  const results = new Map<string, GetAvailableSlotsResult>();
  const timezone = params.timezone || "Asia/Tokyo";

  // 各日付の空き枠を並列取得
  const promises = Array.from({ length: days }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = dateToYYYYMMDD(date, timezone);

    return getAvailableSlots({ ...params, date }).then((result) => ({
      dateStr,
      result,
    }));
  });

  const settledResults = await Promise.all(promises);

  for (const { dateStr, result } of settledResults) {
    results.set(dateStr, result);
  }

  return results;
}

/**
 * 特定のスロットが予約可能かチェック
 *
 * @param params スロット検証パラメータ
 * @returns 予約可能かどうか
 */
export async function isSlotAvailable(params: {
  locationId: string;
  resourceId: string;
  startTime: Date;
  durationMinutes: number;
  bufferMinutes?: number;
  timezone?: string;
}): Promise<{ available: boolean; reason?: string }> {
  const {
    locationId,
    resourceId,
    startTime,
    durationMinutes,
    bufferMinutes = 0,
    timezone = "Asia/Tokyo",
  } = params;

  try {
    // 1. スケジュールの確認
    const dateStr = dateToYYYYMMDD(startTime, timezone);
    const dayOfWeek = getDayOfWeek(startTime, timezone);
    const timeStr = dateToHHMM(startTime, timezone);

    // specificDate優先でスケジュールを取得
    let schedule = await db.schedule.findFirst({
      where: {
        resourceId,
        locationId,
        specificDate: new Date(dateStr),
        isAvailable: true,
      },
    });

    if (!schedule) {
      schedule = await db.schedule.findFirst({
        where: {
          resourceId,
          locationId,
          dayOfWeek,
          specificDate: null,
          isAvailable: true,
        },
      });
    }

    if (!schedule) {
      return { available: false, reason: "この日は営業していません" };
    }

    // 2. 営業時間内かチェック
    const slotStartMinutes = timeStringToMinutes(timeStr);
    const slotEndMinutes = slotStartMinutes + durationMinutes;
    const workStartMinutes = timeStringToMinutes(schedule.startTime);
    const workEndMinutes = timeStringToMinutes(schedule.endTime);

    if (slotStartMinutes < workStartMinutes) {
      return { available: false, reason: "営業開始前の時間です" };
    }

    if (slotEndMinutes > workEndMinutes) {
      return { available: false, reason: "営業終了後にかかる時間です" };
    }

    // 3. 既存予約との重複チェック
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const blockStart = startTime;
    const blockEnd = new Date(endTime.getTime() + bufferMinutes * 60 * 1000);

    const conflictingBooking = await db.booking.findFirst({
      where: {
        resourceId,
        locationId,
        status: {
          in: ["PENDING_PAYMENT", "CONFIRMED"] as BookingStatus[],
        },
        // 重複チェック
        OR: [
          {
            AND: [
              { startAt: { lt: blockEnd } },
              { endAt: { gt: blockStart } },
            ],
          },
        ],
      },
      include: {
        service: {
          select: {
            bufferTimeMin: true,
          },
        },
      },
    });

    if (conflictingBooking) {
      // 既存予約のバッファを考慮した再チェック
      const existingBuffer = conflictingBooking.service?.bufferTimeMin ?? 0;
      const existingBlockStart = new Date(
        conflictingBooking.startAt.getTime() - existingBuffer * 60 * 1000
      );
      const existingBlockEnd = new Date(
        conflictingBooking.endAt.getTime() + existingBuffer * 60 * 1000
      );

      if (blockStart < existingBlockEnd && blockEnd > existingBlockStart) {
        return { available: false, reason: "この時間帯は既に予約が入っています" };
      }
    }

    return { available: true };
  } catch (error) {
    console.error("[Availability] Error checking slot:", error);
    return { available: false, reason: "確認中にエラーが発生しました" };
  }
}


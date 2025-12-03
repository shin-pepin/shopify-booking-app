import { useState, useEffect, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import type { ResourceType } from "@prisma/client";

// === Types ===
interface LocationData {
  id: string;
  name: string;
}

interface ScheduleData {
  id: string;
  locationId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  specificDate: string | null;
}

interface ResourceData {
  id: string;
  name: string;
  type: ResourceType;
  metadata: Record<string, unknown> | null;
  schedules: ScheduleData[];
}

interface LoaderData {
  resource: ResourceData;
  locations: LocationData[];
}

// 曜日の定義
const DAYS_OF_WEEK = [
  { value: 0, label: "日曜日", short: "日" },
  { value: 1, label: "月曜日", short: "月" },
  { value: 2, label: "火曜日", short: "火" },
  { value: 3, label: "水曜日", short: "水" },
  { value: 4, label: "木曜日", short: "木" },
  { value: 5, label: "金曜日", short: "金" },
  { value: 6, label: "土曜日", short: "土" },
];

// 時間オプションの生成（30分刻み）
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2)
    .toString()
    .padStart(2, "0");
  const minutes = i % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

// === Loader: リソース詳細とスケジュールを取得 ===
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const resourceId = params.id;

  if (!resourceId) {
    throw redirect("/app/resources");
  }

  const [resource, locations] = await Promise.all([
    db.resource.findUnique({
      where: { id: resourceId, shopId: shop },
      select: {
        id: true,
        name: true,
        type: true,
        metadata: true,
        schedules: {
          select: {
            id: true,
            locationId: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            isAvailable: true,
            specificDate: true,
          },
          orderBy: [{ locationId: "asc" }, { dayOfWeek: "asc" }],
        },
      },
    }),
    db.location.findMany({
      where: { shopId: shop, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  if (!resource) {
    throw redirect("/app/resources");
  }

  return {
    resource: {
      ...resource,
      metadata: resource.metadata as Record<string, unknown> | null,
      schedules: resource.schedules.map((s) => ({
        ...s,
        specificDate: s.specificDate?.toISOString() || null,
      })),
    },
    locations,
  };
};

// === Action: リソース更新とスケジュール管理 ===
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const resourceId = params.id;

  if (!resourceId) {
    return { success: false, error: "リソースIDが必要です" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
      case "updateResource": {
        const name = formData.get("name") as string;

        if (!name) {
          return { success: false, error: "名前は必須です" };
        }

        await db.resource.update({
          where: { id: resourceId, shopId: shop },
          data: { name },
        });

        return { success: true, action: "updated" };
      }

      case "saveSchedule": {
        const locationId = formData.get("locationId") as string;
        const schedulesJson = formData.get("schedules") as string;

        if (!locationId || !schedulesJson) {
          return { success: false, error: "パラメータが不足しています" };
        }

        const schedules = JSON.parse(schedulesJson) as Array<{
          dayOfWeek: number;
          startTime: string;
          endTime: string;
          isAvailable: boolean;
        }>;

        // 既存のスケジュールを削除して新規作成
        await db.schedule.deleteMany({
          where: {
            resourceId,
            locationId,
            specificDate: null, // 通常のスケジュールのみ
          },
        });

        // 新しいスケジュールを作成
        const newSchedules = schedules
          .filter((s) => s.isAvailable)
          .map((s) => ({
            resourceId,
            locationId,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            isAvailable: true,
          }));

        if (newSchedules.length > 0) {
          await db.schedule.createMany({
            data: newSchedules,
          });
        }

        return { success: true, action: "scheduleSaved" };
      }

      case "addSchedule": {
        const locationId = formData.get("locationId") as string;
        const dayOfWeek = parseInt(formData.get("dayOfWeek") as string, 10);
        const startTime = formData.get("startTime") as string;
        const endTime = formData.get("endTime") as string;

        if (!locationId || isNaN(dayOfWeek) || !startTime || !endTime) {
          return { success: false, error: "パラメータが不足しています" };
        }

        await db.schedule.create({
          data: {
            resourceId,
            locationId,
            dayOfWeek,
            startTime,
            endTime,
            isAvailable: true,
          },
        });

        return { success: true, action: "scheduleAdded" };
      }

      case "deleteSchedule": {
        const scheduleId = formData.get("scheduleId") as string;

        if (!scheduleId) {
          return { success: false, error: "スケジュールIDが必要です" };
        }

        await db.schedule.delete({
          where: { id: scheduleId },
        });

        return { success: true, action: "scheduleDeleted" };
      }

      default:
        return { success: false, error: "不明な操作です" };
    }
  } catch (error) {
    console.error("[Resource Detail] Action error:", error);
    return { success: false, error: "操作に失敗しました" };
  }
};

// === Component ===
export default function ResourceDetailPage() {
  const { resource, locations } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{
    success: boolean;
    action?: string;
    error?: string;
  }>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [resourceName, setResourceName] = useState(resource.name);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    locations[0]?.id || ""
  );
  const [editingSchedules, setEditingSchedules] = useState<
    Map<
      number,
      { startTime: string; endTime: string; isAvailable: boolean }
    >
  >(new Map());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "18:00",
  });

  const isLoading = fetcher.state !== "idle";

  // 選択中のロケーションのスケジュールを取得
  const currentSchedules = resource.schedules.filter(
    (s) => s.locationId === selectedLocationId && !s.specificDate
  );

  // 初期化: 編集用スケジュールマップを作成
  useEffect(() => {
    const scheduleMap = new Map<
      number,
      { startTime: string; endTime: string; isAvailable: boolean }
    >();

    // 全曜日を初期化（デフォルトは休み）
    DAYS_OF_WEEK.forEach((day) => {
      scheduleMap.set(day.value, {
        startTime: "09:00",
        endTime: "18:00",
        isAvailable: false,
      });
    });

    // 既存のスケジュールで上書き
    currentSchedules.forEach((s) => {
      scheduleMap.set(s.dayOfWeek, {
        startTime: s.startTime,
        endTime: s.endTime,
        isAvailable: s.isAvailable,
      });
    });

    setEditingSchedules(scheduleMap);
  }, [selectedLocationId, resource.schedules]);

  useEffect(() => {
    if (fetcher.data?.success) {
      switch (fetcher.data.action) {
        case "updated":
          shopify.toast.show("リソース情報を更新しました");
          break;
        case "scheduleSaved":
          shopify.toast.show("スケジュールを保存しました");
          break;
        case "scheduleAdded":
          shopify.toast.show("スケジュールを追加しました");
          setShowAddModal(false);
          break;
        case "scheduleDeleted":
          shopify.toast.show("スケジュールを削除しました");
          break;
      }
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const handleUpdateResource = () => {
    const formData = new FormData();
    formData.append("intent", "updateResource");
    formData.append("name", resourceName);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSaveSchedule = () => {
    const schedules = Array.from(editingSchedules.entries()).map(
      ([dayOfWeek, schedule]) => ({
        dayOfWeek,
        ...schedule,
      })
    );

    const formData = new FormData();
    formData.append("intent", "saveSchedule");
    formData.append("locationId", selectedLocationId);
    formData.append("schedules", JSON.stringify(schedules));
    fetcher.submit(formData, { method: "POST" });
  };

  const updateSchedule = (
    dayOfWeek: number,
    field: "startTime" | "endTime" | "isAvailable",
    value: string | boolean
  ) => {
    setEditingSchedules((prev) => {
      const newMap = new Map(prev);
      const current = newMap.get(dayOfWeek) || {
        startTime: "09:00",
        endTime: "18:00",
        isAvailable: false,
      };
      newMap.set(dayOfWeek, { ...current, [field]: value });
      return newMap;
    });
  };

  const getTypeLabel = (type: ResourceType) => {
    switch (type) {
      case "STAFF":
        return "スタッフ";
      case "ROOM":
        return "部屋";
      case "EQUIPMENT":
        return "機材";
      default:
        return type;
    }
  };

  return (
    <s-page
      heading={resource.name}
      backAction={{ url: "/app/resources" }}
    >
      <s-button
        slot="primary-action"
        onClick={handleSaveSchedule}
        {...(isLoading ? { loading: true } : {})}
      >
        スケジュール保存
      </s-button>

      {/* 基本情報セクション */}
      <s-section heading="基本情報">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text>タイプ:</s-text>
            <s-badge>{getTypeLabel(resource.type)}</s-badge>
          </s-stack>

          <s-text-field
            label="リソース名"
            value={resourceName}
            onChange={(e: CustomEvent) => setResourceName(e.detail as string)}
          />

          <s-button
            variant="secondary"
            onClick={handleUpdateResource}
            {...(isLoading ? { loading: true } : {})}
          >
            基本情報を更新
          </s-button>
        </s-stack>
      </s-section>

      {/* スケジュール設定セクション */}
      <s-section heading="シフト設定">
        {locations.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-text tone="caution">
              ⚠️ ロケーションが未登録です。
              <s-link href="/app">ホーム</s-link>からロケーションを同期してください。
            </s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {/* ロケーション選択 */}
            <s-select
              label="ロケーション（店舗）を選択"
              value={selectedLocationId}
              onChange={(e: CustomEvent) =>
                setSelectedLocationId(e.detail as string)
              }
              options={locations.map((loc) => ({
                label: loc.name,
                value: loc.id,
              }))}
            />

            <s-paragraph>
              <s-text tone="subdued">
                曜日ごとに営業時間を設定します。チェックを外すと休業日になります。
              </s-text>
            </s-paragraph>

            {/* 曜日ごとのスケジュール */}
            <s-stack direction="block" gap="tight">
              {DAYS_OF_WEEK.map((day) => {
                const schedule = editingSchedules.get(day.value) || {
                  startTime: "09:00",
                  endTime: "18:00",
                  isAvailable: false,
                };

                return (
                  <s-box
                    key={day.value}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background={schedule.isAvailable ? "subdued" : "subdued"}
                    style={{
                      opacity: schedule.isAvailable ? 1 : 0.6,
                    }}
                  >
                    <s-stack direction="inline" gap="base" wrap={false}>
                      <s-checkbox
                        checked={schedule.isAvailable}
                        onChange={(e: CustomEvent) =>
                          updateSchedule(
                            day.value,
                            "isAvailable",
                            e.detail as boolean
                          )
                        }
                      >
                        <s-text
                          fontWeight={schedule.isAvailable ? "bold" : "regular"}
                          style={{ minWidth: "60px" }}
                        >
                          {day.label}
                        </s-text>
                      </s-checkbox>

                      {schedule.isAvailable && (
                        <s-stack direction="inline" gap="tight">
                          <s-select
                            label=""
                            value={schedule.startTime}
                            onChange={(e: CustomEvent) =>
                              updateSchedule(
                                day.value,
                                "startTime",
                                e.detail as string
                              )
                            }
                            options={TIME_OPTIONS.map((t) => ({
                              label: t,
                              value: t,
                            }))}
                          />
                          <s-text>〜</s-text>
                          <s-select
                            label=""
                            value={schedule.endTime}
                            onChange={(e: CustomEvent) =>
                              updateSchedule(
                                day.value,
                                "endTime",
                                e.detail as string
                              )
                            }
                            options={TIME_OPTIONS.map((t) => ({
                              label: t,
                              value: t,
                            }))}
                          />
                        </s-stack>
                      )}

                      {!schedule.isAvailable && (
                        <s-text tone="subdued">休業日</s-text>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: ヘルプ */}
      <s-section slot="aside" heading="シフト設定のヒント">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text tone="subdued">
              スタッフは複数の店舗で働くことができます。
              ロケーションを切り替えて、各店舗でのシフトを設定してください。
            </s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text tone="subdued">
              例: 月・水は渋谷店、火・木は原宿店で勤務
            </s-text>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="現在のスケジュール">
        <s-stack direction="block" gap="tight">
          {currentSchedules.length === 0 ? (
            <s-text tone="subdued">スケジュール未設定</s-text>
          ) : (
            currentSchedules.map((s) => (
              <s-text key={s.id}>
                {DAYS_OF_WEEK.find((d) => d.value === s.dayOfWeek)?.short}:{" "}
                {s.startTime}-{s.endTime}
              </s-text>
            ))
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};


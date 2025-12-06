import { useState, useEffect } from "react";
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
  const hours = Math.floor(i / 2).toString().padStart(2, "0");
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

        await db.schedule.deleteMany({
          where: {
            resourceId,
            locationId,
            specificDate: null,
          },
        });

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
    Map<number, { startTime: string; endTime: string; isAvailable: boolean }>
  >(new Map());

  const isLoading = fetcher.state !== "idle";

  const currentSchedules = resource.schedules.filter(
    (s) => s.locationId === selectedLocationId && !s.specificDate
  );

  useEffect(() => {
    const scheduleMap = new Map<
      number,
      { startTime: string; endTime: string; isAvailable: boolean }
    >();

    DAYS_OF_WEEK.forEach((day) => {
      scheduleMap.set(day.value, {
        startTime: "09:00",
        endTime: "18:00",
        isAvailable: false,
      });
    });

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
          shopify.toast.show("名前を変更しました！");
          break;
        case "scheduleSaved":
          shopify.toast.show("シフトを保存しました！");
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

  const getTypeIcon = (type: ResourceType) => {
    switch (type) {
      case "STAFF":
        return "👤";
      case "ROOM":
        return "🚪";
      case "EQUIPMENT":
        return "🔧";
      default:
        return "📦";
    }
  };

  return (
    <s-page heading={`${getTypeIcon(resource.type)} ${resource.name}`}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSaveSchedule}
        {...(isLoading ? { loading: true } : {})}
      >
        シフトを保存
      </s-button>

      {/* 基本情報セクション */}
      <s-section heading="📝 基本情報">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text>種類:</s-text>
            <s-badge>{getTypeLabel(resource.type)}</s-badge>
          </s-stack>

          <s-text-field
            label="名前を変更"
            value={resourceName}
            onChange={(e: CustomEvent) => setResourceName(e.detail as string)}
          />

          <s-button
            variant="secondary"
            onClick={handleUpdateResource}
            {...(isLoading ? { loading: true } : {})}
          >
            名前を更新
          </s-button>
        </s-stack>
      </s-section>

      {/* シフト設定セクション */}
      <s-section heading="📅 シフト設定">
        {locations.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text>⚠️ 店舗情報がまだ読み込まれていません。</s-text>
              <s-text>
                <s-link href="/app">ホーム</s-link>から店舗情報を読み込んでください。
              </s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-select
              label="どの店舗のシフトを設定しますか？"
              value={selectedLocationId}
              onChange={(e: CustomEvent) => setSelectedLocationId(e.detail as string)}
              options={locations.map((loc) => ({
                label: `📍 ${loc.name}`,
                value: loc.id,
              }))}
            />

            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-text>
                  <strong>💡 使い方:</strong> チェックを入れた曜日が出勤日になります。
                  チェックを外すと休みの日になります。
                </s-text>
              </s-stack>
            </s-box>

            <s-stack direction="block" gap="base">
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
                    background="subdued"
                  >
                    <s-stack direction="inline" gap="base">
                      <s-checkbox
                        checked={schedule.isAvailable}
                        onChange={(e: CustomEvent) =>
                          updateSchedule(day.value, "isAvailable", e.detail as boolean)
                        }
                      >
                        <s-text>
                          {schedule.isAvailable ? <strong>{day.label}</strong> : day.label}
                        </s-text>
                      </s-checkbox>

                      {schedule.isAvailable && (
                        <s-stack direction="inline" gap="base">
                          <s-select
                            label=""
                            value={schedule.startTime}
                            onChange={(e: CustomEvent) =>
                              updateSchedule(day.value, "startTime", e.detail as string)
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
                              updateSchedule(day.value, "endTime", e.detail as string)
                            }
                            options={TIME_OPTIONS.map((t) => ({
                              label: t,
                              value: t,
                            }))}
                          />
                        </s-stack>
                      )}

                      {!schedule.isAvailable && <s-badge>休み</s-badge>}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>

            <s-button variant="primary" onClick={handleSaveSchedule} {...(isLoading ? { loading: true } : {})}>
              シフトを保存
            </s-button>
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: ヘルプ */}
      <s-section slot="aside" heading="💡 シフト設定のコツ">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>
              スタッフは複数の店舗で働くことができます。
              上の「店舗を選ぶ」を切り替えて、各店舗でのシフトを設定してください。
            </s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>
              <strong>例:</strong>
              <br />
              ・月・水・金は本店
              <br />
              ・火・木は支店
            </s-text>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="📋 現在のシフト">
        <s-stack direction="block" gap="base">
          {currentSchedules.length === 0 ? (
            <s-text>まだシフトが設定されていません</s-text>
          ) : (
            currentSchedules.map((s) => (
              <s-text key={s.id}>
                {DAYS_OF_WEEK.find((d) => d.value === s.dayOfWeek)?.short}:{" "}
                {s.startTime} 〜 {s.endTime}
              </s-text>
            ))
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside">
        <s-button variant="tertiary" onClick={() => navigate("/app/resources")}>
          ← 一覧に戻る
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

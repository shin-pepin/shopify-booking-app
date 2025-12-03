import { useState, useEffect, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import type { ResourceType } from "@prisma/client";

// === Types ===
interface LocationData {
  id: string;
  name: string;
  isActive: boolean;
}

interface ResourceData {
  id: string;
  name: string;
  type: ResourceType;
  createdAt: string;
  _count: {
    schedules: number;
    bookings: number;
  };
}

interface LoaderData {
  resources: ResourceData[];
  locations: LocationData[];
}

// === Loader: リソース一覧とロケーション一覧を取得 ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [resources, locations] = await Promise.all([
    db.resource.findMany({
      where: { shopId: shop },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        createdAt: true,
        _count: {
          select: {
            schedules: true,
            bookings: true,
          },
        },
      },
    }),
    db.location.findMany({
      where: { shopId: shop, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    }),
  ]);

  return {
    resources: resources.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    locations,
  };
};

// === Action: リソースのCRUD操作 ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
      case "create": {
        const name = formData.get("name") as string;
        const type = formData.get("type") as ResourceType;
        const locationIds = formData.getAll("locationIds") as string[];

        if (!name || !type) {
          return { success: false, error: "名前とタイプは必須です" };
        }

        // リソースを作成
        const resource = await db.resource.create({
          data: {
            shopId: shop,
            name,
            type,
          },
        });

        // 選択されたロケーションにデフォルトスケジュールを作成
        if (locationIds.length > 0) {
          const defaultSchedules = locationIds.flatMap((locationId) =>
            // 月〜金のデフォルトスケジュール
            [1, 2, 3, 4, 5].map((dayOfWeek) => ({
              resourceId: resource.id,
              locationId,
              dayOfWeek,
              startTime: "09:00",
              endTime: "18:00",
              isAvailable: true,
            }))
          );

          await db.schedule.createMany({
            data: defaultSchedules,
          });
        }

        return { success: true, action: "created", resourceId: resource.id };
      }

      case "delete": {
        const resourceId = formData.get("resourceId") as string;

        if (!resourceId) {
          return { success: false, error: "リソースIDが必要です" };
        }

        // リソースを削除（関連するスケジュールも自動削除）
        await db.resource.delete({
          where: { id: resourceId },
        });

        return { success: true, action: "deleted" };
      }

      default:
        return { success: false, error: "不明な操作です" };
    }
  } catch (error) {
    console.error("[Resources] Action error:", error);
    return { success: false, error: "操作に失敗しました" };
  }
};

// === Component ===
export default function ResourcesPage() {
  const { resources, locations } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{
    success: boolean;
    action?: string;
    error?: string;
    resourceId?: string;
  }>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceType, setNewResourceType] = useState<ResourceType>("STAFF");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.action === "created") {
        shopify.toast.show("リソースを作成しました");
        setShowCreateModal(false);
        resetForm();
        // 新しく作成したリソースの詳細ページに遷移
        if (fetcher.data.resourceId) {
          navigate(`/app/resources/${fetcher.data.resourceId}`);
        }
      } else if (fetcher.data.action === "deleted") {
        shopify.toast.show("リソースを削除しました");
        setDeleteTarget(null);
      }
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, navigate]);

  useEffect(() => {
    setIsAnimating(true);
  }, []);

  const resetForm = () => {
    setNewResourceName("");
    setNewResourceType("STAFF");
    setSelectedLocationIds([]);
  };

  const handleCreate = () => {
    if (!newResourceName.trim()) {
      shopify.toast.show("名前を入力してください");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "create");
    formData.append("name", newResourceName.trim());
    formData.append("type", newResourceType);
    selectedLocationIds.forEach((id) => formData.append("locationIds", id));

    fetcher.submit(formData, { method: "POST" });
  };

  const handleDelete = (resourceId: string) => {
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("resourceId", resourceId);
    fetcher.submit(formData, { method: "POST" });
  };

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds((prev) =>
      prev.includes(locationId)
        ? prev.filter((id) => id !== locationId)
        : [...prev, locationId]
    );
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

  const getTypeBadgeTone = (type: ResourceType) => {
    switch (type) {
      case "STAFF":
        return "info";
      case "ROOM":
        return "success";
      case "EQUIPMENT":
        return "attention";
      default:
        return "default";
    }
  };

  return (
    <s-page heading="リソース管理">
      <s-button slot="primary-action" onClick={() => setShowCreateModal(true)}>
        新規作成
      </s-button>

      {/* メインセクション: リソース一覧 */}
      <s-section heading="登録済みリソース">
        <s-paragraph>
          スタッフや部屋などの予約リソースを管理します。
          各リソースをクリックしてシフトを設定できます。
        </s-paragraph>

        {resources.length === 0 ? (
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>リソースが登録されていません</s-heading>
              <s-paragraph>
                「新規作成」ボタンからスタッフや部屋を登録してください。
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {resources.map((resource, index) => (
              <s-box
                key={resource.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
                style={{
                  opacity: isAnimating ? 1 : 0,
                  transform: isAnimating ? "translateY(0)" : "translateY(10px)",
                  transition: `opacity 0.3s ease ${index * 0.05}s, transform 0.3s ease ${index * 0.05}s`,
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/app/resources/${resource.id}`)}
              >
                <s-stack direction="inline" gap="base" wrap={false}>
                  <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-stack direction="inline" gap="tight">
                      <s-heading>{resource.name}</s-heading>
                      <s-badge tone={getTypeBadgeTone(resource.type)}>
                        {getTypeLabel(resource.type)}
                      </s-badge>
                    </s-stack>
                    <s-text tone="subdued">
                      スケジュール: {resource._count.schedules}件 / 予約:{" "}
                      {resource._count.bookings}件
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-button
                      variant="tertiary"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        navigate(`/app/resources/${resource.id}`);
                      }}
                    >
                      編集
                    </s-button>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setDeleteTarget(resource.id);
                      }}
                    >
                      削除
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: 統計情報 */}
      <s-section slot="aside" heading="統計">
        <s-stack direction="block" gap="tight">
          <s-stack direction="inline" gap="base">
            <s-text>総リソース数:</s-text>
            <s-text fontWeight="bold">{resources.length}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>スタッフ:</s-text>
            <s-text fontWeight="bold">
              {resources.filter((r) => r.type === "STAFF").length}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>部屋:</s-text>
            <s-text fontWeight="bold">
              {resources.filter((r) => r.type === "ROOM").length}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>機材:</s-text>
            <s-text fontWeight="bold">
              {resources.filter((r) => r.type === "EQUIPMENT").length}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="ロケーション">
        {locations.length === 0 ? (
          <s-paragraph>
            <s-text tone="subdued">
              ロケーションが未登録です。
              <s-link href="/app">ホーム</s-link>から同期してください。
            </s-text>
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="tight">
            {locations.map((loc) => (
              <s-text key={loc.id}>{loc.name}</s-text>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* 新規作成モーダル */}
      {showCreateModal && (
        <s-modal
          heading="新規リソース作成"
          open={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            resetForm();
          }}
        >
          <s-stack direction="block" gap="base">
            <s-text-field
              label="リソース名"
              value={newResourceName}
              onChange={(e: CustomEvent) =>
                setNewResourceName(e.detail as string)
              }
              placeholder="例: 佐藤太郎、会議室A"
            />

            <s-choice-list
              title="リソースタイプ"
              name="resourceType"
              choices={[
                { label: "スタッフ（美容師、セラピストなど）", value: "STAFF" },
                { label: "部屋（会議室、施術室など）", value: "ROOM" },
                { label: "機材（プロジェクター、カメラなど）", value: "EQUIPMENT" },
              ]}
              selected={[newResourceType]}
              onChange={(e: CustomEvent) => {
                const selected = e.detail as string[];
                if (selected.length > 0) {
                  setNewResourceType(selected[0] as ResourceType);
                }
              }}
            />

            {locations.length > 0 && (
              <s-choice-list
                title="所属ロケーション（複数選択可）"
                name="locations"
                allowMultiple
                choices={locations.map((loc) => ({
                  label: loc.name,
                  value: loc.id,
                }))}
                selected={selectedLocationIds}
                onChange={(e: CustomEvent) => {
                  setSelectedLocationIds(e.detail as string[]);
                }}
              />
            )}

            {locations.length === 0 && (
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-text tone="caution">
                  ⚠️
                  ロケーションが未登録のため、スケジュールを設定できません。
                  先にホーム画面からロケーションを同期してください。
                </s-text>
              </s-box>
            )}
          </s-stack>

          <s-stack slot="footer" direction="inline" gap="base">
            <s-button
              variant="tertiary"
              onClick={() => {
                setShowCreateModal(false);
                resetForm();
              }}
            >
              キャンセル
            </s-button>
            <s-button
              variant="primary"
              onClick={handleCreate}
              {...(isLoading ? { loading: true } : {})}
            >
              作成
            </s-button>
          </s-stack>
        </s-modal>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <s-modal
          heading="リソースの削除"
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
        >
          <s-paragraph>
            このリソースを削除しますか？
            関連するスケジュールも全て削除されます。この操作は取り消せません。
          </s-paragraph>

          <s-stack slot="footer" direction="inline" gap="base">
            <s-button variant="tertiary" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </s-button>
            <s-button
              variant="primary"
              tone="critical"
              onClick={() => handleDelete(deleteTarget)}
              {...(isLoading ? { loading: true } : {})}
            >
              削除
            </s-button>
          </s-stack>
        </s-modal>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};


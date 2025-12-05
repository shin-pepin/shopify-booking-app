import { useState, useEffect, useRef } from "react";
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

        const resource = await db.resource.create({
          data: {
            shopId: shop,
            name,
            type,
          },
        });

        if (locationIds.length > 0) {
          const defaultSchedules = locationIds.flatMap((locationId) =>
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
  
  const createModalRef = useRef<HTMLDialogElement>(null);
  const deleteModalRef = useRef<HTMLDialogElement>(null);

  const isLoading = fetcher.state !== "idle";

  // モーダルの開閉を制御
  useEffect(() => {
    if (showCreateModal) {
      createModalRef.current?.showModal();
    } else {
      createModalRef.current?.close();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (deleteTarget) {
      deleteModalRef.current?.showModal();
    } else {
      deleteModalRef.current?.close();
    }
  }, [deleteTarget]);

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.action === "created") {
        shopify.toast.show("リソースを作成しました");
        setShowCreateModal(false);
        resetForm();
        // 作成後は同じページに留まり、リストが自動更新される
      } else if (fetcher.data.action === "deleted") {
        shopify.toast.show("リソースを削除しました");
        setDeleteTarget(null);
      }
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

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

  const getTypeBadgeTone = (type: ResourceType): "info" | "success" | "warning" => {
    switch (type) {
      case "STAFF":
        return "info";
      case "ROOM":
        return "success";
      case "EQUIPMENT":
        return "warning";
      default:
        return "info";
    }
  };

  return (
    <s-page heading="リソース管理">
      <s-section>
        <s-stack direction="inline" gap="base" align="center">
          <s-heading>リソース管理</s-heading>
          <button
            type="button"
            onClick={() => {
              console.log("新規作成ボタンがクリックされました");
              setShowCreateModal(true);
            }}
            style={{
              backgroundColor: "#008060",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            新規作成
          </button>
        </s-stack>
      </s-section>

      {/* メインセクション: リソース一覧 */}
      <s-section heading="登録済みリソース">
        <s-paragraph>
          スタッフや部屋などの予約リソースを管理します。
          各リソースをクリックしてシフトを設定できます。
        </s-paragraph>

        {resources.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>リソースが登録されていません</s-heading>
              <s-paragraph>「新規作成」ボタンからスタッフや部屋を登録してください。</s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {resources.map((resource) => (
              <s-box
                key={resource.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{resource.name}</s-heading>
                      <s-badge tone={getTypeBadgeTone(resource.type)}>
                        {getTypeLabel(resource.type)}
                      </s-badge>
                    </s-stack>
                    <s-text>
                      スケジュール: {resource._count.schedules}件 / 予約: {resource._count.bookings}件
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="base">
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
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text>総リソース数:</s-text>
            <s-text><strong>{resources.length}</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>スタッフ:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "STAFF").length}</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>部屋:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "ROOM").length}</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>機材:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "EQUIPMENT").length}</strong></s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="ロケーション">
        {locations.length === 0 ? (
          <s-paragraph>
            <s-text>
              ロケーションが未登録です。
              <s-link href="/app">ホーム</s-link>から同期してください。
            </s-text>
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {locations.map((loc) => (
              <s-text key={loc.id}>{loc.name}</s-text>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* 新規作成モーダル */}
      <dialog
        ref={createModalRef}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        style={{
          border: "none",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "500px",
          width: "90%",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", fontSize: "18px" }}>新規リソース作成</h2>
        
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "500" }}>
            リソース名
          </label>
          <input
            type="text"
            value={newResourceName}
            onChange={(e) => setNewResourceName(e.target.value)}
            placeholder="例: 佐藤太郎、会議室A"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #ccc",
              borderRadius: "6px",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>
            リソースタイプ
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              { label: "スタッフ（美容師、セラピストなど）", value: "STAFF" },
              { label: "部屋（会議室、施術室など）", value: "ROOM" },
              { label: "機材（プロジェクター、カメラなど）", value: "EQUIPMENT" },
            ].map((option) => (
              <label key={option.value} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="resourceType"
                  value={option.value}
                  checked={newResourceType === option.value}
                  onChange={(e) => setNewResourceType(e.target.value as ResourceType)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        {locations.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>
              所属ロケーション（複数選択可）
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {locations.map((loc) => (
                <label key={loc.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    value={loc.id}
                    checked={selectedLocationIds.includes(loc.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedLocationIds([...selectedLocationIds, loc.id]);
                      } else {
                        setSelectedLocationIds(selectedLocationIds.filter((id) => id !== loc.id));
                      }
                    }}
                  />
                  {loc.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {locations.length === 0 && (
          <div style={{ padding: "12px", backgroundColor: "#FEF3C7", borderRadius: "6px", marginBottom: "16px" }}>
            ⚠️ ロケーションが未登録のため、スケジュールを設定できません。先にホーム画面からロケーションを同期してください。
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px" }}>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(false);
              resetForm();
            }}
            style={{
              padding: "8px 16px",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isLoading}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "#008060",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "作成中..." : "作成"}
          </button>
        </div>
      </dialog>

      {/* 削除確認モーダル */}
      <dialog
        ref={deleteModalRef}
        onClose={() => setDeleteTarget(null)}
        style={{
          border: "none",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "400px",
          width: "90%",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", fontSize: "18px" }}>リソースの削除</h2>
        <p style={{ margin: "0 0 24px 0", color: "#666" }}>
          このリソースを削除しますか？
          関連するスケジュールも全て削除されます。この操作は取り消せません。
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            style={{
              padding: "8px 16px",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => deleteTarget && handleDelete(deleteTarget)}
            disabled={isLoading}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "#dc2626",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "削除中..." : "削除"}
          </button>
        </div>
      </dialog>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

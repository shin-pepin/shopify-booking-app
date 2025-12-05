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
        shopify.toast.show("登録しました！");
        setShowCreateModal(false);
        resetForm();
        // 作成後は同じページに留まり、リストが自動更新される
      } else if (fetcher.data.action === "deleted") {
        shopify.toast.show("削除しました");
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
    <s-page heading="スタッフ・部屋の管理">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-heading>予約を受ける人・場所</s-heading>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            style={{
              backgroundColor: "#008060",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            ＋ 新しく追加
          </button>
        </s-stack>
      </s-section>

      {/* メインセクション: リソース一覧 */}
      <s-section heading="📋 登録済みの一覧">
        <s-paragraph>
          予約を受け付けるスタッフや部屋を登録してください。
          <br />
          名前をクリックすると、出勤日や営業時間を設定できます。
        </s-paragraph>

        {resources.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>まだ誰も登録されていません</s-heading>
              <s-paragraph>
                「＋ 新しく追加」ボタンから、予約を受け付けたいスタッフや部屋を登録しましょう！
              </s-paragraph>
              <s-paragraph>
                <s-text>
                  💡 ヒント: 美容師さん一人ひとりの名前や、部屋Aなどの名前で登録してください。
                </s-text>
              </s-paragraph>
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
                      <s-heading>{getTypeIcon(resource.type)} {resource.name}</s-heading>
                      <s-badge tone={getTypeBadgeTone(resource.type)}>
                        {getTypeLabel(resource.type)}
                      </s-badge>
                    </s-stack>
                    <s-text>
                      📅 シフト: {resource._count.schedules > 0 ? `${resource._count.schedules}件設定済み` : "未設定"} 
                      　|　 
                      📊 予約実績: {resource._count.bookings}件
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="primary"
                      onClick={() => {
                        navigate(`/app/resources/${resource.id}`);
                      }}
                    >
                      シフトを設定
                    </s-button>
                    <s-button
                      variant="tertiary"
                      onClick={() => {
                        setDeleteTarget(resource.id);
                      }}
                    >
                      🗑️
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー: 統計情報 */}
      <s-section slot="aside" heading="📊 登録数の内訳">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text>合計:</s-text>
            <s-text><strong>{resources.length}件</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>👤 スタッフ:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "STAFF").length}人</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>🚪 部屋:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "ROOM").length}室</strong></s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text>🔧 機材:</s-text>
            <s-text><strong>{resources.filter((r) => r.type === "EQUIPMENT").length}台</strong></s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="🏪 店舗">
        {locations.length === 0 ? (
          <s-paragraph>
            <s-text>
              店舗情報がまだ読み込まれていません。
              <br />
              <s-link href="/app">ホーム</s-link>から読み込んでください。
            </s-text>
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {locations.map((loc) => (
              <s-text key={loc.id}>📍 {loc.name}</s-text>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="💡 ヒント">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-text>
            シフト設定では、曜日ごとの出勤時間を登録できます。
            休みの日はチェックを外してください。
          </s-text>
        </s-box>
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
          borderRadius: "16px",
          padding: "28px",
          maxWidth: "480px",
          width: "90%",
          boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        }}
      >
        <h2 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: "600" }}>✨ 新しく追加する</h2>
        <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: "14px" }}>
          予約を受け付けるスタッフや部屋を登録します
        </p>
        
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "14px" }}>
            名前 <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input
            type="text"
            value={newResourceName}
            onChange={(e) => setNewResourceName(e.target.value)}
            placeholder="例: 田中さん、部屋A"
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              fontSize: "15px",
              boxSizing: "border-box",
              transition: "border-color 0.2s",
            }}
          />
          <p style={{ margin: "6px 0 0 0", color: "#888", fontSize: "13px" }}>
            お客様に表示される名前です
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "10px", fontWeight: "600", fontSize: "14px" }}>
            種類を選んでください <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { label: "👤 スタッフ", desc: "美容師さん、セラピストさんなど", value: "STAFF" },
              { label: "🚪 部屋・席", desc: "カット台、個室、ベッドなど", value: "ROOM" },
              { label: "🔧 機材", desc: "特殊機器、レンタル品など", value: "EQUIPMENT" },
            ].map((option) => (
              <label 
                key={option.value} 
                style={{ 
                  display: "flex", 
                  alignItems: "flex-start", 
                  gap: "10px", 
                  cursor: "pointer",
                  padding: "12px",
                  borderRadius: "8px",
                  border: newResourceType === option.value ? "2px solid #008060" : "1px solid #ddd",
                  backgroundColor: newResourceType === option.value ? "#f0fdf4" : "white",
                }}
              >
                <input
                  type="radio"
                  name="resourceType"
                  value={option.value}
                  checked={newResourceType === option.value}
                  onChange={(e) => setNewResourceType(e.target.value as ResourceType)}
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <div style={{ fontWeight: "500" }}>{option.label}</div>
                  <div style={{ fontSize: "13px", color: "#666" }}>{option.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {locations.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "10px", fontWeight: "600", fontSize: "14px" }}>
              どの店舗で働きますか？
            </label>
            <p style={{ margin: "0 0 10px 0", color: "#666", fontSize: "13px" }}>
              選んだ店舗に、月〜金の初期シフトが自動で設定されます
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {locations.map((loc) => (
                <label key={loc.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
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
                  📍 {loc.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {locations.length === 0 && (
          <div style={{ padding: "14px", backgroundColor: "#FEF3C7", borderRadius: "8px", marginBottom: "20px" }}>
            <p style={{ margin: 0, fontSize: "14px" }}>
              ⚠️ 店舗情報がまだ読み込まれていません。
              <br />
              先にホーム画面から店舗情報を読み込んでください。
            </p>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "28px", paddingTop: "20px", borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(false);
              resetForm();
            }}
            style={{
              padding: "10px 20px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              backgroundColor: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isLoading}
            style={{
              padding: "10px 24px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: "#008060",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            {isLoading ? "登録中..." : "✓ 登録する"}
          </button>
        </div>
      </dialog>

      {/* 削除確認モーダル */}
      <dialog
        ref={deleteModalRef}
        onClose={() => setDeleteTarget(null)}
        style={{
          border: "none",
          borderRadius: "16px",
          padding: "28px",
          maxWidth: "400px",
          width: "90%",
          boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", fontSize: "20px", fontWeight: "600" }}>🗑️ 削除の確認</h2>
        <p style={{ margin: "0 0 8px 0", color: "#333", fontSize: "15px" }}>
          本当に削除しますか？
        </p>
        <p style={{ margin: "0 0 24px 0", color: "#666", fontSize: "14px" }}>
          ※ 設定済みのシフトも一緒に削除されます。
          <br />
          　 この操作は元に戻せません。
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            style={{
              padding: "10px 20px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              backgroundColor: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => deleteTarget && handleDelete(deleteTarget)}
            disabled={isLoading}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: "#dc2626",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            {isLoading ? "削除中..." : "削除する"}
          </button>
        </div>
      </dialog>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

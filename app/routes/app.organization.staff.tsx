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
  isMaxPlan,
  getShopOrganization,
  getOrganizationStaff,
  inviteStaffMember,
  updateStaffMember,
  removeStaffMember,
  parseAllowedShopIds,
  serializeAllowedShopIds,
} from "../services/organization.server";
import type { StaffRole } from "@prisma/client";

// === Types ===
interface StaffData {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
  allowedShopIds: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  invitedAt: string;
  acceptedAt: string | null;
}

interface ShopData {
  id: string;
  name: string | null;
}

interface LoaderData {
  shop: string;
  canUse: boolean;
  organizationId: string | null;
  organizationName: string | null;
  staff: StaffData[];
  shops: ShopData[];
}

// === Loader ===
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // プランチェック
  const canUse = await isMaxPlan(shop);

  if (!canUse) {
    return {
      shop,
      canUse: false,
      organizationId: null,
      organizationName: null,
      staff: [],
      shops: [],
    };
  }

  // 組織情報を取得
  const organization = await getShopOrganization(shop);

  if (!organization) {
    return {
      shop,
      canUse: true,
      organizationId: null,
      organizationName: null,
      staff: [],
      shops: [],
    };
  }

  // スタッフ一覧を取得
  const staffMembers = await getOrganizationStaff(organization.id);

  return {
    shop,
    canUse: true,
    organizationId: organization.id,
    organizationName: organization.name,
    staff: staffMembers.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      allowedShopIds: parseAllowedShopIds(s.allowedShopIds),
      isActive: s.isActive,
      lastLoginAt: s.lastLoginAt?.toISOString() || null,
      invitedAt: s.invitedAt.toISOString(),
      acceptedAt: s.acceptedAt?.toISOString() || null,
    })),
    shops: organization.shops,
  };
};

// === Action ===
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // プランチェック
  if (!(await isMaxPlan(shop))) {
    return { success: false, error: "Maxプランで利用可能です" };
  }

  const organization = await getShopOrganization(shop);
  if (!organization) {
    return { success: false, error: "組織が見つかりません" };
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "invite") {
    const email = formData.get("email") as string;
    const name = formData.get("name") as string;
    const role = formData.get("role") as StaffRole;
    const allowedShopIds = formData.get("allowedShopIds") as string;

    if (!email || !role) {
      return { success: false, error: "メールアドレスと役割は必須です" };
    }

    try {
      await inviteStaffMember({
        organizationId: organization.id,
        email,
        name: name || undefined,
        role,
        allowedShopIds: allowedShopIds ? allowedShopIds.split(",") : [],
      });

      return { success: true, message: "スタッフを招待しました" };
    } catch (error: any) {
      return { success: false, error: error.message || "招待に失敗しました" };
    }
  }

  if (action === "update") {
    const staffId = formData.get("staffId") as string;
    const name = formData.get("name") as string;
    const role = formData.get("role") as StaffRole;
    const allowedShopIds = formData.get("allowedShopIds") as string;
    const isActive = formData.get("isActive") === "true";

    if (!staffId) {
      return { success: false, error: "スタッフIDが必要です" };
    }

    try {
      await updateStaffMember(staffId, {
        name: name || undefined,
        role,
        allowedShopIds: allowedShopIds ? allowedShopIds.split(",") : [],
        isActive,
      });

      return { success: true, message: "スタッフ情報を更新しました" };
    } catch (error) {
      return { success: false, error: "更新に失敗しました" };
    }
  }

  if (action === "remove") {
    const staffId = formData.get("staffId") as string;

    if (!staffId) {
      return { success: false, error: "スタッフIDが必要です" };
    }

    try {
      await removeStaffMember(staffId);
      return { success: true, message: "スタッフを削除しました" };
    } catch (error) {
      return { success: false, error: "削除に失敗しました" };
    }
  }

  return { success: false, error: "不明なアクションです" };
};

// === Component ===
export default function OrganizationStaffPage() {
  const { canUse, organizationId, organizationName, staff, shops } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ success: boolean; message?: string; error?: string }>();
  const shopify = useAppBridge();

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffData | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    role: "STAFF" as StaffRole,
    allowedShopIds: [] as string[],
  });

  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
      setShowInviteForm(false);
      setEditingStaff(null);
      setInviteForm({
        email: "",
        name: "",
        role: "STAFF",
        allowedShopIds: [],
      });
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleInvite = () => {
    fetcher.submit(
      {
        action: "invite",
        email: inviteForm.email,
        name: inviteForm.name,
        role: inviteForm.role,
        allowedShopIds: inviteForm.allowedShopIds.join(","),
      },
      { method: "POST" }
    );
  };

  const handleUpdate = () => {
    if (!editingStaff) return;

    fetcher.submit(
      {
        action: "update",
        staffId: editingStaff.id,
        name: editingStaff.name || "",
        role: editingStaff.role,
        allowedShopIds: editingStaff.allowedShopIds.join(","),
        isActive: String(editingStaff.isActive),
      },
      { method: "POST" }
    );
  };

  const handleRemove = (staffId: string) => {
    if (!confirm("このスタッフを削除しますか？")) return;

    fetcher.submit(
      { action: "remove", staffId },
      { method: "POST" }
    );
  };

  const getRoleBadge = (role: StaffRole) => {
    switch (role) {
      case "OWNER":
        return <s-badge tone="attention">オーナー</s-badge>;
      case "MANAGER":
        return <s-badge tone="success">マネージャー</s-badge>;
      case "STAFF":
        return <s-badge tone="info">スタッフ</s-badge>;
      case "VIEWER":
        return <s-badge>閲覧者</s-badge>;
      default:
        return <s-badge>{role}</s-badge>;
    }
  };

  const getRoleLabel = (role: StaffRole) => {
    switch (role) {
      case "OWNER":
        return "オーナー（全権限）";
      case "MANAGER":
        return "マネージャー（店舗管理）";
      case "STAFF":
        return "スタッフ（予約管理）";
      case "VIEWER":
        return "閲覧者（閲覧のみ）";
      default:
        return role;
    }
  };

  // Maxプラン以外または組織未作成
  if (!canUse || !organizationId) {
    return (
      <s-page
        heading="スタッフ管理"
        backAction={{
          url: "/app/organization",
          accessibilityLabel: "組織管理に戻る",
        }}
      >
        <s-section>
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>
                {!canUse
                  ? "Maxプラン専用機能"
                  : "組織を作成してください"}
              </s-heading>
              <s-paragraph>
                {!canUse
                  ? "スタッフ管理機能はMaxプランで利用可能です。"
                  : "先に組織を作成してからスタッフを招待できます。"}
              </s-paragraph>
              <s-button
                variant="primary"
                url={canUse ? "/app/organization" : "/app/billing"}
              >
                {canUse ? "組織を作成" : "プランをアップグレード"}
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page
      heading="スタッフ管理"
      backAction={{
        url: "/app/organization",
        accessibilityLabel: "組織管理に戻る",
      }}
    >
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => setShowInviteForm(true)}
      >
        スタッフを招待
      </s-button>

      {/* 招待フォーム */}
      {showInviteForm && (
        <s-section heading="スタッフを招待">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-text-field
                label="メールアドレス"
                type="email"
                value={inviteForm.email}
                onChange={(e: any) =>
                  setInviteForm({ ...inviteForm, email: e.target.value })
                }
                placeholder="staff@example.com"
              />
              <s-text-field
                label="名前（任意）"
                value={inviteForm.name}
                onChange={(e: any) =>
                  setInviteForm({ ...inviteForm, name: e.target.value })
                }
                placeholder="山田 花子"
              />
              <s-select
                label="役割"
                value={inviteForm.role}
                onChange={(e: any) =>
                  setInviteForm({ ...inviteForm, role: e.target.value })
                }
              >
                <option value="MANAGER">マネージャー（店舗管理）</option>
                <option value="STAFF">スタッフ（予約管理）</option>
                <option value="VIEWER">閲覧者（閲覧のみ）</option>
              </s-select>

              {inviteForm.role !== "OWNER" && (
                <s-stack direction="block" gap="tight">
                  <s-text fontWeight="bold">アクセス可能な店舗</s-text>
                  {shops.map((shop) => (
                    <s-checkbox
                      key={shop.id}
                      checked={inviteForm.allowedShopIds.includes(shop.id)}
                      onChange={(e: any) => {
                        const checked = e.target.checked;
                        setInviteForm({
                          ...inviteForm,
                          allowedShopIds: checked
                            ? [...inviteForm.allowedShopIds, shop.id]
                            : inviteForm.allowedShopIds.filter(
                                (id) => id !== shop.id
                              ),
                        });
                      }}
                    >
                      {shop.name || shop.id}
                    </s-checkbox>
                  ))}
                </s-stack>
              )}

              <s-stack direction="inline" gap="tight">
                <s-button
                  variant="primary"
                  onClick={handleInvite}
                  {...(isSubmitting ? { loading: true, disabled: true } : {})}
                >
                  招待を送信
                </s-button>
                <s-button
                  variant="plain"
                  onClick={() => setShowInviteForm(false)}
                >
                  キャンセル
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* 編集フォーム */}
      {editingStaff && (
        <s-section heading="スタッフを編集">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-text tone="subdued">{editingStaff.email}</s-text>
              <s-text-field
                label="名前"
                value={editingStaff.name || ""}
                onChange={(e: any) =>
                  setEditingStaff({ ...editingStaff, name: e.target.value })
                }
              />
              {editingStaff.role !== "OWNER" && (
                <>
                  <s-select
                    label="役割"
                    value={editingStaff.role}
                    onChange={(e: any) =>
                      setEditingStaff({ ...editingStaff, role: e.target.value })
                    }
                  >
                    <option value="MANAGER">マネージャー</option>
                    <option value="STAFF">スタッフ</option>
                    <option value="VIEWER">閲覧者</option>
                  </s-select>

                  <s-stack direction="block" gap="tight">
                    <s-text fontWeight="bold">アクセス可能な店舗</s-text>
                    {shops.map((shop) => (
                      <s-checkbox
                        key={shop.id}
                        checked={editingStaff.allowedShopIds.includes(shop.id)}
                        onChange={(e: any) => {
                          const checked = e.target.checked;
                          setEditingStaff({
                            ...editingStaff,
                            allowedShopIds: checked
                              ? [...editingStaff.allowedShopIds, shop.id]
                              : editingStaff.allowedShopIds.filter(
                                  (id) => id !== shop.id
                                ),
                          });
                        }}
                      >
                        {shop.name || shop.id}
                      </s-checkbox>
                    ))}
                  </s-stack>

                  <s-checkbox
                    checked={editingStaff.isActive}
                    onChange={(e: any) =>
                      setEditingStaff({
                        ...editingStaff,
                        isActive: e.target.checked,
                      })
                    }
                  >
                    アクティブ
                  </s-checkbox>
                </>
              )}

              <s-stack direction="inline" gap="tight">
                <s-button
                  variant="primary"
                  onClick={handleUpdate}
                  {...(isSubmitting ? { loading: true, disabled: true } : {})}
                >
                  更新
                </s-button>
                <s-button
                  variant="plain"
                  onClick={() => setEditingStaff(null)}
                >
                  キャンセル
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* スタッフ一覧 */}
      <s-section heading={`スタッフ一覧（${staff.length}名）`}>
        {staff.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-text tone="subdued">スタッフがいません</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {staff.map((member) => (
              <s-box
                key={member.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base" wrap={false}>
                  <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-stack direction="inline" gap="tight">
                      <s-heading>{member.name || member.email}</s-heading>
                      {getRoleBadge(member.role)}
                      {!member.isActive && (
                        <s-badge tone="critical">無効</s-badge>
                      )}
                      {!member.acceptedAt && (
                        <s-badge tone="warning">招待中</s-badge>
                      )}
                    </s-stack>
                    <s-text tone="subdued">{member.email}</s-text>
                    {member.role !== "OWNER" && member.allowedShopIds.length > 0 && (
                      <s-text tone="subdued">
                        アクセス: {member.allowedShopIds.map((id) => 
                          shops.find((s) => s.id === id)?.name || id
                        ).join(", ")}
                      </s-text>
                    )}
                  </s-stack>
                  <s-stack direction="inline" gap="tight">
                    <s-button
                      variant="plain"
                      onClick={() => setEditingStaff(member)}
                    >
                      編集
                    </s-button>
                    {member.role !== "OWNER" && (
                      <s-button
                        variant="plain"
                        tone="critical"
                        onClick={() => handleRemove(member.id)}
                      >
                        削除
                      </s-button>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* サイドバー */}
      <s-section slot="aside" heading="役割の説明">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">オーナー</s-text>
            <s-text tone="subdued">全店舗へのアクセス権、スタッフ管理、組織設定の変更が可能</s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">マネージャー</s-text>
            <s-text tone="subdued">指定された店舗の管理（予約・リソース・設定）が可能</s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">スタッフ</s-text>
            <s-text tone="subdued">指定された店舗の予約管理のみ可能</s-text>
          </s-stack>
          <s-stack direction="block" gap="tight">
            <s-text fontWeight="bold">閲覧者</s-text>
            <s-text tone="subdued">指定された店舗のデータを閲覧のみ可能</s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}


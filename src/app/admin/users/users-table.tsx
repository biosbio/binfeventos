"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type AdminUserRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  platformRole: "USER" | "PLATFORM_ADMIN";
  createdAt: string;
  memberships: { organization: string; role: string }[];
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(new Date(value));
}

export default function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();

  async function updateUser(payload: { userId: string; fullName?: string; phone?: string | null; status?: AdminUserRow["status"] }) {
    setError("");
    setSuccess("");
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.message ?? "Não foi possível atualizar o utilizador.");
      return;
    }
    setEditingId(null);
    setSuccess("Dados do utilizador atualizados.");
    startTransition(() => router.refresh());
  }

  if (users.length === 0) {
    return <div className="empty-state">Não foram encontrados utilizadores com estes filtros.</div>;
  }

  return (
    <div className="admin-users-list">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {success ? <p className="form-success" role="status">{success}</p> : null}
      {users.map((user) => {
        const protectedAccount = user.platformRole === "PLATFORM_ADMIN";
        const editing = editingId === user.id;
        return (
          <article className="panel admin-user-card" key={user.id}>
            <div className="admin-user-main">
              <div>
                <strong>{user.fullName}</strong>
                <div className="form-help">{user.email}</div>
                <div className="form-help">{user.phone || "Sem telefone"} · Registado em {dateLabel(user.createdAt)}</div>
              </div>
              <div className="admin-user-badges">
                <span className={`status-pill status-${user.status.toLowerCase()}`}>{user.status}</span>
                {protectedAccount ? <span className="status-pill">Administrador da plataforma</span> : null}
              </div>
            </div>

            <div className="admin-user-memberships">
              <strong>Organizações</strong>
              {user.memberships.length
                ? user.memberships.map((membership, index) => (
                    <span key={`${user.id}-${index}`}>{membership.organization} · {membership.role}</span>
                  ))
                : <span>Sem organização associada</span>}
            </div>

            {editing ? (
              <form className="admin-user-edit" onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void updateUser({
                  userId: user.id,
                  fullName: String(form.get("fullName") ?? ""),
                  phone: String(form.get("phone") ?? "").trim() || null,
                });
              }}>
                <label className="form-field">
                  <span>Nome completo</span>
                  <input name="fullName" defaultValue={user.fullName} required minLength={3} maxLength={120} />
                </label>
                <label className="form-field">
                  <span>Telefone</span>
                  <input name="phone" defaultValue={user.phone ?? ""} maxLength={20} />
                </label>
                <div className="admin-user-actions">
                  <button className="button button-primary" type="submit" disabled={pending}>Guardar alterações</button>
                  <button className="button button-secondary" type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="admin-user-actions">
                <button className="button button-secondary" type="button" disabled={protectedAccount || pending} onClick={() => { setError(""); setSuccess(""); setEditingId(user.id); }}>Editar dados</button>
                <button
                  className={user.status === "ACTIVE" ? "button button-secondary" : "button button-primary"}
                  type="button"
                  disabled={protectedAccount || pending}
                  onClick={() => void updateUser({ userId: user.id, status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}
                >
                  {user.status === "ACTIVE" ? "Suspender conta" : "Reativar conta"}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

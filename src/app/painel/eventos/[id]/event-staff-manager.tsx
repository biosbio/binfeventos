"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StaffMember = {
  id: string;
  userId: string;
  role: "ORGANIZER" | "SELLER" | "GATE";
  invitedAt: Date;
  approvedAt: Date | null;
  invite: { createdByUserId: string } | null;
  user: { fullName: string; email: string; status: string };
};
type StaffInvite = {
  id: string;
  role: "ORGANIZER" | "SELLER" | "GATE";
  createdAt: Date;
  expiresAt: Date;
  url?: string;
};

const roleLabels = { ORGANIZER: "Co-organizador", SELLER: "Vendedor", GATE: "Portaria" };
const rolePluralLabels = { ORGANIZER: "Co-organizadores", SELLER: "Vendedores", GATE: "Portaria" };

export default function EventStaffManager({
  eventId,
  members,
  invites: initialInvites,
  primaryOrganizerId,
  protectedOrganizerId,
}: {
  eventId: string;
  members: StaffMember[];
  invites: StaffInvite[];
  primaryOrganizerId: string | null;
  protectedOrganizerId: string | null;
}) {
  const router = useRouter();
  const [role, setRole] = useState<"ORGANIZER" | "SELLER" | "GATE">("SELLER");
  const [invites, setInvites] = useState(initialInvites);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: object) {
    const response = await fetch(`/api/event-staff/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Não foi possível concluir a operação.");
    return data;
  }

  async function createInvite() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await post("invites/create", { eventId, role });
      const url = `${window.location.origin}/evento/convite/${data.invite.token}`;
      setInvites((current) => [
        { id: data.invite.id, role, createdAt: new Date(), expiresAt: new Date(data.invite.expiresAt), url },
        ...current,
      ]);
      setMessage(`Convite de ${roleLabels[role].toLowerCase()} criado. O acesso depende da sua aprovação.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copiado. Envie-o à pessoa que pretende convidar.");
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o link apresentado.");
    }
  }

  async function runMemberAction(
    action: "approve" | "reject" | "revoke",
    member: StaffMember,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post(`members/${action}`, { eventId, memberId: member.id });
      setMessage(action === "approve" ? "Acesso aprovado." : action === "reject" ? "Pedido rejeitado." : "Acesso removido.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post("invites/revoke", { inviteId });
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      setMessage("Convite revogado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível revogar o convite.");
    } finally {
      setBusy(false);
    }
  }

  const pending = members.filter((member) => !member.approvedAt);
  const approved = members.filter((member) => member.approvedAt);
  const date = (value: Date) => new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(value);
  const renderRoleMembers = (list: StaffMember[], memberRole: StaffMember["role"], isPending: boolean) => (
    <section className={`event-staff-role-column event-staff-role-${memberRole.toLowerCase()}`}>
      <div className="event-staff-role-heading">
        <h3>{rolePluralLabels[memberRole]}</h3>
        <span>{list.filter((member) => member.role === memberRole).length}</span>
      </div>
      {list.filter((member) => member.role === memberRole).length ? (
        <div className="event-staff-member-list">
          {list.filter((member) => member.role === memberRole).map((member) => (
            <article className="event-staff-member-card" key={member.id}>
              <div>
                <strong>{member.user.fullName}</strong>
                <p>{member.user.email}</p>
                {isPending ? <small>Pedido em {date(member.invitedAt)}</small> : null}
              </div>
              {isPending ? (
                <div className="event-staff-member-actions">
                  <button className="button button-primary" type="button" disabled={busy || member.user.status !== "ACTIVE" || member.userId === primaryOrganizerId} onClick={() => runMemberAction("approve", member)}>Aprovar</button>
                  <button className="button button-secondary" type="button" disabled={busy || member.userId === primaryOrganizerId || member.userId === protectedOrganizerId} onClick={() => runMemberAction("reject", member)}>Rejeitar</button>
                </div>
              ) : (
                <button className="button button-secondary" type="button" disabled={busy || member.userId === primaryOrganizerId || member.userId === protectedOrganizerId} onClick={() => runMemberAction("revoke", member)}>Remover acesso</button>
              )}
            </article>
          ))}
        </div>
      ) : <p className="event-staff-role-empty">Ainda sem pessoas nesta função.</p>}
    </section>
  );

  return (
    <section className="seller-list-section event-staff-manager">
      <div className="dashboard-list-heading">
        <div>
          <h2>Equipa deste evento</h2>
          <p>Os convites e acessos ficam limitados a este evento. Cada pedido precisa da sua aprovação.</p>
        </div>
      </div>
      <div className="panel seller-invite-panel event-staff-invite-panel">
        <div className="form-field">
          <label htmlFor="event-staff-role">Função do convite</label>
          <select
            id="event-staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value === "ORGANIZER" || event.target.value === "GATE" ? event.target.value : "SELLER")}
            disabled={busy}
          >
            <option value="ORGANIZER">Co-organizador — gerir o evento, vendas e portaria</option>
            <option value="SELLER">Vendedor — vendas presenciais</option>
            <option value="GATE">Portaria — validar entradas deste evento</option>
          </select>
          <small>{role === "ORGANIZER"
            ? "O co-organizador terá acesso completo a este evento após a sua aprovação. O organizador principal não pode ser removido."
            : role === "SELLER"
              ? "A pessoa poderá registar vendas presenciais após a sua aprovação. Para validar entradas, precisa de um convite separado de portaria."
              : "A pessoa poderá validar entradas apenas neste evento após a sua aprovação. Este convite não dá acesso à bilheteira."}</small>
        </div>
        <button className="button button-primary" type="button" disabled={busy} onClick={createInvite}>
          {busy ? "A processar…" : "Criar convite"}
        </button>
        {invites.length > 0 ? (
          <div className="seller-active-invites">
            <strong>Convites ativos</strong>
            {invites.map((invite) => (
              <div className="event-staff-invite-card" key={invite.id}>
                <div className="event-staff-invite-card-heading">
                  <strong>Link · {roleLabels[invite.role]}</strong>
                  <span>Expira em {date(invite.expiresAt)}</span>
                </div>
                {invite.url ? (
                  <div className="event-staff-invite-url">
                    <input aria-label={`Link de convite · ${roleLabels[invite.role]}`} readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} />
                  </div>
                ) : null}
                <div className="event-staff-invite-actions">
                  {invite.url ? (
                    <button className="button button-secondary" type="button" disabled={busy} onClick={() => copyInvite(invite.url!)}>Copiar link</button>
                  ) : null}
                  <button className="button button-secondary event-staff-revoke" type="button" disabled={busy} onClick={() => revokeInvite(invite.id)}>Revogar</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-success" role="status">{message}</p> : null}
      </div>

      <div className="dashboard-list-heading">
        <h2>Pedidos pendentes</h2>
        <span>{pending.length}</span>
      </div>
      <div className="panel event-staff-roster-box">
        {renderRoleMembers(pending, "ORGANIZER", true)}
        <div className="event-staff-staff-columns">
          {renderRoleMembers(pending, "SELLER", true)}
          {renderRoleMembers(pending, "GATE", true)}
        </div>
      </div>

      <div className="dashboard-list-heading">
        <h2>Equipa aprovada</h2>
        <span>{approved.length}</span>
      </div>
      <div className="panel event-staff-roster-box">
        {renderRoleMembers(approved, "ORGANIZER", false)}
        <div className="event-staff-staff-columns">
          {renderRoleMembers(approved, "SELLER", false)}
          {renderRoleMembers(approved, "GATE", false)}
        </div>
      </div>
    </section>
  );
}

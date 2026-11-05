"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StaffMember = {
  id: string;
  role: "SELLER" | "GATE";
  invitedAt: Date;
  approvedAt: Date | null;
  user: { fullName: string; email: string; status: string };
};
type StaffInvite = {
  id: string;
  role: "SELLER" | "GATE";
  createdAt: Date;
  expiresAt: Date;
};

const roleLabels = { SELLER: "Vendedor", GATE: "Portaria" };

export default function EventStaffManager({
  eventId,
  members,
  invites: initialInvites,
}: {
  eventId: string;
  members: StaffMember[];
  invites: StaffInvite[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<"SELLER" | "GATE">("SELLER");
  const [link, setLink] = useState<{ id: string; url: string; role: "SELLER" | "GATE" } | null>(null);
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
      setLink({
        id: data.invite.id,
        url: `${window.location.origin}/evento/convite/${data.invite.token}`,
        role,
      });
      setInvites((current) => [
        { id: data.invite.id, role, createdAt: new Date(), expiresAt: new Date(data.invite.expiresAt) },
        ...current,
      ]);
      setMessage(`Convite de ${roleLabels[role].toLowerCase()} criado. O acesso depende da sua aprovação.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
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
      if (link?.id === inviteId) setLink(null);
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

  return (
    <section className="seller-list-section">
      <div className="dashboard-list-heading">
        <div>
          <h2>Equipa deste evento</h2>
          <p>Os convites e acessos ficam limitados a este evento. Cada pedido precisa da sua aprovação.</p>
        </div>
      </div>
      <div className="panel seller-invite-panel">
        <div className="form-field">
          <label htmlFor="event-staff-role">Função do convite</label>
          <select
            id="event-staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value === "GATE" ? "GATE" : "SELLER")}
            disabled={busy}
          >
            <option value="SELLER">Vendedor — vendas presenciais</option>
            <option value="GATE">Portaria — validar bilhetes deste evento</option>
          </select>
        </div>
        <button className="button button-primary" type="button" disabled={busy} onClick={createInvite}>
          {busy ? "A processar…" : "Criar convite"}
        </button>
        {link ? (
          <div className="seller-invite-link">
            <label htmlFor="event-staff-invite-url">Link · {roleLabels[link.role]}</label>
            <input id="event-staff-invite-url" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
            <button className="button button-secondary" type="button" onClick={copyInvite}>Copiar link</button>
          </div>
        ) : null}
        {invites.length > 0 ? (
          <div className="seller-active-invites">
            <strong>Convites ativos</strong>
            {invites.map((invite) => (
              <div className="seller-active-invite-row" key={invite.id}>
                <span>{roleLabels[invite.role]} · expira em {date(invite.expiresAt)}</span>
                <button className="text-link" type="button" disabled={busy} onClick={() => revokeInvite(invite.id)}>Revogar</button>
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
      {pending.length ? (
        <div className="dashboard-event-list">
          {pending.map((member) => (
            <article className="panel seller-row" key={member.id}>
              <div>
                <strong>{member.user.fullName}</strong>
                <p>{member.user.email} · {roleLabels[member.role]}</p>
                <small>Pedido em {date(member.invitedAt)}</small>
              </div>
              <button className="button button-primary" type="button" disabled={busy || member.user.status !== "ACTIVE"} onClick={() => runMemberAction("approve", member)}>Aprovar</button>
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => runMemberAction("reject", member)}>Rejeitar</button>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">Ainda não há pedidos de acesso.</div>}

      <div className="dashboard-list-heading">
        <h2>Equipa aprovada</h2>
        <span>{approved.length}</span>
      </div>
      {approved.length ? (
        <div className="dashboard-event-list">
          {approved.map((member) => (
            <article className="panel seller-row" key={member.id}>
              <div>
                <strong>{member.user.fullName}</strong>
                <p>{member.user.email} · {roleLabels[member.role]}</p>
              </div>
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => runMemberAction("revoke", member)}>Remover acesso</button>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">Ainda não aprovou membros para este evento.</div>}
    </section>
  );
}

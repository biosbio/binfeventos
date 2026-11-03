"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Seller = {
  id: string;
  invitedAt: Date;
  acceptedAt: Date | null;
  user: { fullName: string; email: string; status: string };
};
type ActiveInvite = { id: string; createdAt: Date; expiresAt: Date };

export default function SellerManager({
  sellers,
  activeInvites: initialActiveInvites,
}: {
  sellers: Seller[];
  activeInvites: ActiveInvite[];
}) {
  const router = useRouter();
  const [invite, setInvite] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeInvites, setActiveInvites] = useState(initialActiveInvites);

  async function createInvite() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organizations/seller-invites/create", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível gerar o link.");
        return;
      }
      setInvite({
        id: data.invite.id,
        url: `${window.location.origin}/vendedor/convite/${data.invite.token}`,
      });
      setActiveInvites((current) => [
        { id: data.invite.id, createdAt: new Date(), expiresAt: new Date(data.invite.expiresAt) },
        ...current,
      ]);
      setMessage("Link criado. É válido por 30 dias e pode ser enviado a mais de uma pessoa.");
    } catch {
      setError("Erro de rede ao criar o link. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setMessage("Link copiado. Envie-o às pessoas que pretende convidar.");
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o link apresentado.");
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/organizations/seller-invites/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível revogar o link.");
        return;
      }
      setActiveInvites((current) => current.filter((item) => item.id !== inviteId));
      if (invite?.id === inviteId) setInvite(null);
      setMessage("Link revogado. Já não pode ser utilizado.");
    } catch {
      setError("Erro de rede ao revogar o link.");
    } finally {
      setBusy(false);
    }
  }

  async function approveSeller(memberId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organizations/seller-invites/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível autorizar este vendedor.");
        return;
      }
      setMessage("Vendedor autorizado. A pessoa deve entrar novamente para aceder à bilheteira.");
      router.refresh();
    } catch {
      setError("Erro de rede ao autorizar o vendedor.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSeller(memberId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organizations/seller-invites/revoke-seller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível remover este vendedor.");
        return;
      }
      setMessage("Acesso de vendedor removido.");
      router.refresh();
    } catch {
      setError("Erro de rede ao remover o vendedor.");
    } finally {
      setBusy(false);
    }
  }

  const pendingSellers = sellers.filter((seller) => !seller.acceptedAt);
  const approvedSellers = sellers.filter((seller) => seller.acceptedAt);

  return (
    <div className="seller-manager">
      <section className="panel seller-invite-panel">
        <div>
          <h2>Convidar vendedores</h2>
          <p>O link serve para pedir entrada na equipa, não dá acesso imediato à bilheteira. Aprove cada pedido aqui.</p>
        </div>
        <button className="button button-primary" type="button" disabled={busy} onClick={createInvite}>
          {busy ? "A processar…" : "Gerar link de convite"}
        </button>
        {invite ? (
          <div className="seller-invite-link">
            <label htmlFor="seller-invite-url">Link do convite</label>
            <input id="seller-invite-url" readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} />
            <div className="seller-invite-actions">
              <button className="button button-secondary" type="button" onClick={copyInvite}>Copiar link</button>
            </div>
          </div>
        ) : null}
        {activeInvites.length ? (
          <div className="seller-active-invites">
            <strong>Links ativos</strong>
            {activeInvites.map((activeInvite) => (
              <div className="seller-active-invite-row" key={activeInvite.id}>
                <span>Expira em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeZone: "UTC" }).format(activeInvite.expiresAt)}</span>
                <button className="text-link" type="button" disabled={busy} onClick={() => revokeInvite(activeInvite.id)}>Revogar</button>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-success" role="status">{message}</p> : null}
      </section>

      <section className="seller-list-section">
        <div className="dashboard-list-heading">
          <h2>Pedidos pendentes</h2>
          <span>{pendingSellers.length}</span>
        </div>
        {pendingSellers.length ? (
          <div className="dashboard-event-list">
            {pendingSellers.map((seller) => (
              <article className="panel seller-row" key={seller.id}>
                <div>
                  <strong>{seller.user.fullName}</strong>
                  <p>{seller.user.email}</p>
                  <small>Pedido em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(seller.invitedAt)}</small>
                </div>
                <button className="button button-primary" type="button" disabled={busy || seller.user.status !== "ACTIVE"} onClick={() => approveSeller(seller.id)}>
                  Autorizar vendedor
                </button>
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => revokeSeller(seller.id)}>
                  Rejeitar pedido
                </button>
              </article>
            ))}
          </div>
        ) : <div className="empty-state">Ainda não há pedidos de acesso.</div>}
      </section>

      <section className="seller-list-section">
        <div className="dashboard-list-heading">
          <h2>Vendedores autorizados</h2>
          <span>{approvedSellers.length}</span>
        </div>
        {approvedSellers.length ? (
          <div className="dashboard-event-list">
            {approvedSellers.map((seller) => (
              <article className="panel seller-row" key={seller.id}>
                <div>
                  <strong>{seller.user.fullName}</strong>
                  <p>{seller.user.email}</p>
                </div>
                <div className="seller-row-actions">
                  <span className="status-pill">Autorizado</span>
                  <button className="button button-secondary" type="button" disabled={busy} onClick={() => revokeSeller(seller.id)}>Remover acesso</button>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state">Ainda não autorizou vendedores.</div>}
      </section>
    </div>
  );
}

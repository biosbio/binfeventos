"use client";

import { useState } from "react";

export default function SellerInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestAccess() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/organizations/seller-invites/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível enviar o pedido.");
        return;
      }
      setMessage(data.status === "approved"
        ? "Já está autorizado como vendedor. Aceda à bilheteira pelo seu painel."
        : "Pedido enviado. Poderá vender bilhetes depois de o organizador aprovar o seu acesso.");
    } catch {
      setError("Erro de rede ao enviar o pedido. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seller-claim">
      <button className="button button-primary" type="button" disabled={busy} onClick={requestAccess}>
        {busy ? "A enviar pedido…" : "Pedir acesso como vendedor"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
    </div>
  );
}

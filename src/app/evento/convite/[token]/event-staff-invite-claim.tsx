"use client";

import { useState } from "react";

export default function EventStaffInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestAccess() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/event-staff/invites/claim", {
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
        ? "O seu acesso a este evento já está aprovado."
        : "Pedido enviado. Poderá exercer esta função neste evento depois da aprovação do organizador.");
    } catch {
      setError("Erro de rede ao enviar o pedido. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seller-claim">
      <button className="button button-primary" type="button" disabled={busy} onClick={requestAccess}>
        {busy ? "A enviar pedido…" : "Pedir acesso ao evento"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
    </div>
  );
}

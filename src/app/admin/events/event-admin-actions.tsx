"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EventAdminActions({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancelEvent() {
    if (!window.confirm("Cancelar este evento? Esta ação remove-o da venda pública e pode exigir reembolsos das vendas confirmadas.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "CANCELLED" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "Não foi possível cancelar o evento.");
        return;
      }
      router.push("/admin/events?estado=cancelled");
      router.refresh();
    } catch {
      setError("Erro de rede ao cancelar o evento. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="event-admin-actions">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Link className="button button-secondary" href={`/admin/events/${eventId}/encerrar`}>Encerrar</Link>
      <button className="button button-danger" type="button" disabled={busy} onClick={cancelEvent}>
        {busy ? "A cancelar…" : "Cancelar"}
      </button>
    </div>
  );
}

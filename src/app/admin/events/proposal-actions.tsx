"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProposalActions({
  eventId,
  canApprove,
}: {
  eventId: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(to: "PUBLISHED" | "CANCELLED") {
    if (to === "CANCELLED" && !window.confirm("Rejeitar esta proposta? O evento não será publicado.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível atualizar a proposta.");
        return;
      }
      router.refresh();
    } catch {
      setError("Erro de rede ao atualizar a proposta. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 18 }}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="button" disabled={busy || !canApprove} onClick={() => decide("PUBLISHED")}>
        {busy ? "A guardar…" : "Aprovar e publicar"}
      </button>
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => decide("CANCELLED")}>
        Rejeitar proposta
      </button>
    </div>
  );
}

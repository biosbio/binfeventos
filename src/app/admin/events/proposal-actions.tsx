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
  const [mode, setMode] = useState<"FIXED_PACKAGE" | "PERCENTAGE" | "TICKET_DISCOUNT">("PERCENTAGE");
  const [value, setValue] = useState("");

  async function decide(to: "PUBLISHED" | "CANCELLED") {
    if (to === "CANCELLED" && !window.confirm("Rejeitar esta proposta? O evento não será publicado.")) return;
    setBusy(true);
    setError("");
    try {
      const numericValue = Number(value);
      if (to === "PUBLISHED" && (!Number.isFinite(numericValue) || numericValue <= 0)) {
        setError("Indique um valor válido para o acordo comercial.");
        return;
      }
      const response = await fetch(`/api/events/${eventId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          ...(to === "PUBLISHED" && {
            agreement: {
              mode,
              value: mode === "PERCENTAGE" ? Math.round(numericValue * 100) : Math.round(numericValue * 100),
            },
          }),
        }),
      });
      const data = await response.json().catch(() => ({}));
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
    <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <fieldset className="payment-agreement-form">
        <legend>Forma de pagamento do organizador *</legend>
        <div className="payment-agreement-options">
          <label className={`payment-agreement-option ${mode === "FIXED_PACKAGE" ? "is-selected" : ""}`}><input type="radio" name={`agreement-${eventId}`} checked={mode === "FIXED_PACKAGE"} onChange={() => setMode("FIXED_PACKAGE")} /><span><strong>Pacote único</strong><small>Regista somente o valor acordado a pagar.</small></span></label>
          <label className={`payment-agreement-option ${mode === "PERCENTAGE" ? "is-selected" : ""}`}><input type="radio" name={`agreement-${eventId}`} checked={mode === "PERCENTAGE"} onChange={() => setMode("PERCENTAGE")} /><span><strong>Percentagem</strong><small>Calculada sobre as vendas do evento.</small></span></label>
          <label className={`payment-agreement-option ${mode === "TICKET_DISCOUNT" ? "is-selected" : ""}`}><input type="radio" name={`agreement-${eventId}`} checked={mode === "TICKET_DISCOUNT"} onChange={() => setMode("TICKET_DISCOUNT")} /><span><strong>Desconto por bilhete</strong><small>Valor abatido por cada bilhete vendido.</small></span></label>
        </div>
        <label className="payment-agreement-value">
          <span>{mode === "PERCENTAGE" ? "Percentagem acordada" : mode === "FIXED_PACKAGE" ? "Valor do pacote" : "Desconto por bilhete"}</span>
          <input type="number" min="0.01" max={mode === "PERCENTAGE" ? "100" : undefined} step="0.01" required value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} />
        </label>
        <span className="form-help">{mode === "PERCENTAGE" ? "A comissão é calculada sobre cada venda confirmada." : mode === "FIXED_PACKAGE" ? "O sistema apenas regista o valor acordado a pagar; não calcula nem desconta vendas." : "O valor é descontado por cada bilhete vendido."}</span>
      </fieldset>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button className="button button-primary" type="button" disabled={busy || !canApprove} onClick={() => decide("PUBLISHED")}>
          {busy ? "A guardar…" : "Aprovar e publicar"}
        </button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => decide("CANCELLED")}>
          Rejeitar proposta
        </button>
      </div>
    </div>
  );
}

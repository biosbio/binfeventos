"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "FIXED_PACKAGE" | "PERCENTAGE" | "TICKET_DISCOUNT";

export default function PaymentAgreementActions({
  eventId, initialMode, initialValue,
}: { eventId: string; initialMode: Mode; initialValue: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState(String(initialValue / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || (mode === "PERCENTAGE" && amount > 100)) {
      setError("Indique um valor válido.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/payment-agreement`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, value: Math.round(amount * 100) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.message ?? "Não foi possível atualizar o acordo."); return; }
      setOpen(false); router.refresh();
    } catch { setError("Erro de rede ao atualizar o acordo."); } finally { setBusy(false); }
  }

  if (!open) return <button className="button button-secondary" type="button" onClick={() => setOpen(true)}>Alterar acordo</button>;
  return <fieldset className="payment-agreement-form" style={{ marginTop: 12 }}>
    <legend>Alterar acordo comercial</legend>
    <div className="payment-agreement-options">
      <label className={`payment-agreement-option ${mode === "FIXED_PACKAGE" ? "is-selected" : ""}`}><input type="radio" checked={mode === "FIXED_PACKAGE"} onChange={() => setMode("FIXED_PACKAGE")} /><span><strong>Pacote único</strong><small>Somente registo do valor.</small></span></label>
      <label className={`payment-agreement-option ${mode === "PERCENTAGE" ? "is-selected" : ""}`}><input type="radio" checked={mode === "PERCENTAGE"} onChange={() => setMode("PERCENTAGE")} /><span><strong>Percentagem</strong><small>Sobre todas as vendas.</small></span></label>
      <label className={`payment-agreement-option ${mode === "TICKET_DISCOUNT" ? "is-selected" : ""}`}><input type="radio" checked={mode === "TICKET_DISCOUNT"} onChange={() => setMode("TICKET_DISCOUNT")} /><span><strong>Por bilhete</strong><small>Abatimento por unidade.</small></span></label>
    </div>
    <label className="payment-agreement-value"><span>{mode === "PERCENTAGE" ? "Percentagem" : "Valor"}</span><input type="number" min="0.01" max={mode === "PERCENTAGE" ? "100" : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} /></label>
    <span className="form-help">Ao escolher percentagem ou desconto por bilhete, o novo acordo recalcula todas as vendas já confirmadas e aplica-se às próximas.</span>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="button button-primary" type="button" disabled={busy} onClick={save}>{busy ? "A guardar…" : "Guardar acordo"}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div>
  </fieldset>;
}

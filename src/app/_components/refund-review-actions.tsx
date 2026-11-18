"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundReviewActions({ refundId, status, organizerAssumesRefund }: { refundId: string; status: string; organizerAssumesRefund?: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [executionOpen, setExecutionOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [method, setMethod] = useState("Transferência bancária");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));
  const [evidenceRef, setEvidenceRef] = useState("");

  async function post(path: string, body: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/finance/refunds/ticket-cancellation/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Não foi possível atualizar o pedido."); return false; }
      router.refresh(); return true;
    } catch { setError("Erro de rede. Tente novamente."); return false; }
    finally { setBusy(false); }
  }

  async function decide(stage: "seller-review" | "organizer-review" | "platform-review", decision: "APPROVE" | "REJECT") {
    if (notes.trim().length < 3) { setError("Indique uma nota para esta decisão."); return; }
    if (await post(stage, { refundId, decision, notes: notes.trim() })) setNotes("");
  }

  async function recordExecution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await post("execution", { refundId, recipient, method, paidAt: new Date(paidAt).toISOString(), evidenceRef: evidenceRef || undefined, evidenceNotes: notes });
    if (ok) setExecutionOpen(false);
  }

  async function confirmPlatform() {
    if (window.confirm("Confirma que verificou a prova do pagamento e que o reembolso foi efetivamente recebido pelo comprador?")) await post("platform-confirm", { refundId });
  }

  return <div className="refund-review-actions">
    {status === "SELLER_REVIEW" || status === "ORGANIZER_REVIEW" || status === "PLATFORM_REVIEW" ? <><label className="cashier-field"><span>Notas da análise</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} /></label><div className="cash-modal-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => decide(status === "SELLER_REVIEW" ? "seller-review" : status === "ORGANIZER_REVIEW" ? "organizer-review" : "platform-review", "REJECT")}>Rejeitar</button><button className="button button-primary" type="button" disabled={busy} onClick={() => decide(status === "SELLER_REVIEW" ? "seller-review" : status === "ORGANIZER_REVIEW" ? "organizer-review" : "platform-review", "APPROVE")}>{busy ? "A guardar…" : status === "ORGANIZER_REVIEW" ? "Aprovar e assumir reembolso" : status === "PLATFORM_REVIEW" ? organizerAssumesRefund === false ? "Autorizar por escalonamento" : "Autorizar reembolso" : "Aprovar análise"}</button></div></> : null}
    {status === "PROCESSING" ? <><p>O reembolso foi autorizado. Registe quem recebeu, o meio utilizado, a data e uma referência/comprovativo.</p><button className="button button-primary" type="button" onClick={() => setExecutionOpen(true)}>Registar reembolso efetuado</button></> : null}
    {status === "REFUND_AWAITING_PLATFORM_CONFIRMATION" ? <button className="button button-primary" type="button" disabled={busy} onClick={confirmPlatform}>{busy ? "A confirmar…" : "Confirmar reembolso recebido pelo comprador"}</button> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {executionOpen ? <div className="cash-modal-backdrop"><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="refund-execution-title"><span className="section-kicker">REGISTO DE REEMBOLSO</span><h2 id="refund-execution-title">Pagamento efetuado</h2><form className="cash-modal-form" onSubmit={recordExecution}><label className="cashier-field"><span>Quem recebeu</span><input value={recipient} onChange={(e) => setRecipient(e.target.value)} required maxLength={160} /></label><label className="cashier-field"><span>Como foi pago</span><input value={method} onChange={(e) => setMethod(e.target.value)} required maxLength={80} /></label><label className="cashier-field"><span>Quando foi pago</span><input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required /></label><label className="cashier-field"><span>Referência/comprovativo</span><input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} maxLength={300} /></label><label className="cashier-field"><span>Notas de auditoria</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} minLength={10} maxLength={1000} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="cash-modal-actions"><button className="button button-secondary" type="button" onClick={() => setExecutionOpen(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "A guardar…" : "Enviar à plataforma"}</button></div></form></section></div> : null}
  </div>;
}

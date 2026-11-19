"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TicketCancelAction({ ticketId, ticketNumber }: { ticketId: string; ticketNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/finance/refunds/ticket-cancellation/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId, password, reason }) });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Não foi possível solicitar o cancelamento."); return; }
      setOpen(false); setPassword(""); setReason(""); router.refresh();
    } catch { setError("Erro de rede ao solicitar o cancelamento."); }
    finally { setBusy(false); }
  }

  return <>
    <button className="button button-secondary" type="button" onClick={() => setOpen(true)}>Solicitar cancelamento</button>
    {open ? <div className="cash-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-cancel-title"><button className="cash-modal-close" type="button" aria-label="Fechar" disabled={busy} onClick={() => setOpen(false)}>×</button><span className="section-kicker">CANCELAMENTO DE BILHETE</span><h2 id="ticket-cancel-title">Bilhete {ticketNumber}</h2><p>Ao confirmar, o QR será invalidado imediatamente. O pedido passará por análise do vendedor, do organizador e da plataforma. Um pedido aprovado pelo organizador ainda precisa da validação final da plataforma para o reembolso ser concluído.</p><form className="cash-modal-form" onSubmit={submit}><label className="cashier-field"><span>Motivo do cancelamento</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} minLength={5} maxLength={500} required /></label><label className="cashier-field"><span>Confirme com a sua senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="cash-modal-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Voltar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "A enviar…" : "Confirmar e invalidar bilhete"}</button></div></form></section></div> : null}
  </>;
}

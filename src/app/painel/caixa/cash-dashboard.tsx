"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Deposit = { id: string; amountCents: number; outstandingCents: number; receivedCents: number; differenceNotes: string | null; status: string; createdAt: string; shiftId: string; event: string; station: string };
type Seller = { id: string; name: string; soldCents: number; tickets: number; ticketTypes: Record<string, number>; payments: Record<string, number>; pendingCents: number; receivedCents: number; deposits: Deposit[] };
type PendingGroup = { event: string; deposits: Deposit[]; dueCents: number; receivedCents: number };
const labels: Record<string, string> = { CASH: "Dinheiro", CARD: "Cartão", MOBILE_MONEY: "Dinheiro móvel", DIGITAL_WALLET: "Carteira digital", BANK_TRANSFER: "Transferência bancária" };

export default function CashDashboard({ currency, sellers }: { currency: string; sellers: Seller[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<{ seller: Seller; group: PendingGroup } | null>(null);
  const [receivedValue, setReceivedValue] = useState("");
  const [password, setPassword] = useState("");
  const [clearDifference, setClearDifference] = useState(false);
  const [differenceNotes, setDifferenceNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (n: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(n / 100);
  const total = (key: "soldCents" | "pendingCents" | "receivedCents") => sellers.reduce((n, s) => n + s[key], 0);
  const paymentTotals: Record<string, number> = {};
  sellers.forEach((s) => Object.entries(s.payments).forEach(([method, amount]) => { paymentTotals[method] = (paymentTotals[method] ?? 0) + amount; }));

  function pendingGroups(seller: Seller): PendingGroup[] {
    const grouped = new Map<string, Deposit[]>();
    seller.deposits.filter((d) => d.status !== "CONFIRMED" && (d.outstandingCents || d.amountCents) > 0).forEach((deposit) => {
      const list = grouped.get(deposit.event) ?? [];
      list.push(deposit);
      grouped.set(deposit.event, list);
    });
    return Array.from(grouped, ([event, deposits]) => ({
      event,
      deposits: deposits.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      dueCents: deposits.reduce((sum, d) => sum + (d.outstandingCents || d.amountCents), 0),
      receivedCents: deposits.reduce((sum, d) => sum + d.receivedCents, 0),
    }));
  }

  function openReceive(seller: Seller, group: PendingGroup) {
    setError(""); setPassword(""); setDifferenceNotes(""); setClearDifference(false);
    setReceivedValue((group.dueCents / 100).toFixed(2));
    setModal({ seller, group });
  }

  async function submitReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const receivedCents = Math.round(Number(receivedValue.replace(",", ".")) * 100);
    if (!Number.isFinite(receivedCents) || receivedCents < 0 || receivedCents > modal.group.dueCents) {
      setError("Indique um valor válido até ao total pendente do evento."); return;
    }
    const hasDifference = receivedCents < modal.group.dueCents;
    if (hasDifference && clearDifference && !differenceNotes.trim()) { setError("A justificativa da conversa pessoal com o vendedor é obrigatória para zerar a diferença."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/boxoffice/deposits/confirm-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depositIds: modal.group.deposits.map((d) => d.id), password, receivedCents, clearDifference: hasDifference && clearDifference,
          differenceNotes: hasDifference && clearDifference ? differenceNotes.trim() : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Não foi possível confirmar o recebimento."); return; }
      setModal(null); router.refresh();
    } catch { setError("Erro de rede ao confirmar o recebimento."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="dashboard-stats">
      <div className="panel"><div className="price-label">Bilhetes vendidos</div><div className="price">{sellers.reduce((n, s) => n + s.tickets, 0)}</div></div>
      <div className="panel"><div className="price-label">Total vendido</div><div className="price">{money(total("soldCents"))}</div></div>
      <div className="panel"><div className="price-label">Total a receber</div><div className="price">{money(total("pendingCents"))}</div></div>
      <div className="panel"><div className="price-label">Total recebido</div><div className="price">{money(total("receivedCents"))}</div></div>
    </div>
    <section className="cashier-card" style={{ marginTop: 20 }}><h2>Vendas por forma de pagamento</h2><div className="cash-deposit-totals">{Object.entries(paymentTotals).map(([method, amount]) => <div key={method}><span>{labels[method] ?? method}</span><strong>{money(amount)}</strong></div>)}</div></section>
    <div className="dashboard-list-heading"><h2>Vendedores</h2><span>{sellers.length} registo(s)</span></div>
    {error && !modal ? <p className="form-error" role="alert">{error}</p> : null}
    {sellers.length === 0 ? <div className="empty-state">Ainda não há vendas de bilheteira.</div> : <div className="dashboard-event-list">{sellers.map((seller) => <article className="panel" key={seller.id}>
      <button type="button" className="cash-seller-toggle" aria-expanded={expanded === seller.id} onClick={() => setExpanded(expanded === seller.id ? null : seller.id)}><strong>{seller.name}</strong><span>{seller.tickets} bilhetes · Vendido {money(seller.soldCents)} · A receber {money(seller.pendingCents)}</span></button>
      {expanded === seller.id ? <div className="cash-seller-report"><p><strong>Total vendido:</strong> {money(seller.soldCents)} · <strong>Total recebido:</strong> {money(seller.receivedCents)} · <strong>Total na caixa / a receber:</strong> {money(seller.pendingCents)}</p><p><strong>Bilhetes vendidos:</strong> {seller.tickets}</p><h3>Bilhetes por tipo</h3><ul>{Object.entries(seller.ticketTypes).map(([name, quantity]) => <li key={name}>{name}: {quantity}</li>)}</ul><h3>Por forma de pagamento</h3><ul>{Object.entries(seller.payments).map(([method, amount]) => <li key={method}>{labels[method] ?? method}: {money(amount)}</li>)}</ul><h3>Valores pendentes por evento</h3>{pendingGroups(seller).length === 0 ? <p>Sem valores pendentes.</p> : <ul className="cash-event-pending-list">{pendingGroups(seller).map((group) => <li key={group.event}><div><strong>{group.event}</strong><span>{group.deposits.length} fechamento(s) · {money(group.dueCents)} a receber{group.receivedCents ? ` · recebido anteriormente ${money(group.receivedCents)}` : ""}</span></div><button className="button button-primary" type="button" onClick={() => openReceive(seller, group)}>Confirmar recebimento</button></li>)}</ul>}</div> : null}
    </article>)}</div>}

    {modal ? <div className="cash-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="cash-modal-title"><button type="button" className="cash-modal-close" aria-label="Fechar" disabled={busy} onClick={() => setModal(null)}>×</button><span className="section-kicker">RECEBIMENTO DE CAIXA</span><h2 id="cash-modal-title">{modal.seller.name} · {modal.group.event}</h2><p>Há {money(modal.group.dueCents)} pendentes neste evento, distribuídos em {modal.group.deposits.length} fechamento(s). O total vendido permanecerá no relatório.</p><form className="cash-modal-form" onSubmit={submitReceipt}><label className="cashier-field"><span>Valor recebido ({currency})</span><input type="number" min="0" max={(modal.group.dueCents / 100).toFixed(2)} step="0.01" value={receivedValue} onChange={(e) => setReceivedValue(e.target.value)} required /></label><label className="cashier-field"><span>Senha do organizador</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><fieldset className="cash-modal-difference"><legend>Se o valor recebido for menor, como tratar a diferença?</legend><label><input type="radio" checked={!clearDifference} onChange={() => setClearDifference(false)} /> Manter como valor a receber</label><label><input type="radio" checked={clearDifference} onChange={() => setClearDifference(true)} /> Zerar após conversa pessoal com o vendedor</label>{clearDifference ? <label className="cashier-field"><span>Justificativa da conversa</span><textarea value={differenceNotes} onChange={(e) => setDifferenceNotes(e.target.value)} required rows={3} maxLength={500} /></label> : null}</fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="cash-modal-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "A confirmar…" : clearDifference ? "Confirmar e zerar" : "Confirmar recebimento"}</button></div></form></section></div> : null}
  </>;
}

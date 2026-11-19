"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Deposit = { id: string; amountCents: number; outstandingCents: number; receivedCents: number; createdAt: string; closedAt: string | null; sellerName: string; sellerId: string; stationName: string; stationLocation: string | null; eventName: string; eventId: string | null };
type Group = { sellerId: string; sellerName: string; eventId: string | null; eventName: string; deposits: Deposit[]; pendingCents: number; receivedCents: number };

export default function CashDepositManager({ currency, deposits, totalSalesCents }: { currency: string; deposits: Deposit[]; totalSalesCents: number }) {
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [receivedValue, setReceivedValue] = useState("");
  const [password, setPassword] = useState("");
  const [clearDifference, setClearDifference] = useState(false);
  const [differenceNotes, setDifferenceNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const money = (cents: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(cents / 100);
  const pendingCents = deposits.reduce((sum, d) => sum + d.outstandingCents, 0);
  const grouped = new Map<string, Group>();
  for (const deposit of deposits) {
    if (deposit.outstandingCents <= 0) continue;
    const key = `${deposit.sellerId}:${deposit.eventId ?? "org"}`;
    const current = grouped.get(key) ?? { sellerId: deposit.sellerId, sellerName: deposit.sellerName, eventId: deposit.eventId, eventName: deposit.eventName, deposits: [], pendingCents: 0, receivedCents: 0 };
    current.deposits.push(deposit);
    current.pendingCents += deposit.outstandingCents;
    current.receivedCents += deposit.receivedCents;
    grouped.set(key, current);
  }
  const groups = Array.from(grouped.values()).sort((a, b) => a.eventName.localeCompare(b.eventName) || a.sellerName.localeCompare(b.sellerName));

  function openModal(item: Group) {
    setGroup(item); setReceivedValue((item.pendingCents / 100).toFixed(2)); setPassword(""); setClearDifference(false); setDifferenceNotes(""); setError(""); setMessage("");
  }

  async function confirmReceived(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group) return;
    const cents = Math.round(Number(receivedValue.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > group.pendingCents) { setError("Indique um valor válido até ao total pendente."); return; }
    if (cents < group.pendingCents && clearDifference && !differenceNotes.trim()) { setError("A justificativa da conversa pessoal com o vendedor é obrigatória."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/boxoffice/deposits/confirm-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositIds: group.deposits.map((d) => d.id), password, receivedCents: cents, clearDifference: cents < group.pendingCents && clearDifference, differenceNotes: cents < group.pendingCents && clearDifference ? differenceNotes.trim() : undefined }) });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Não foi possível confirmar o recebimento."); return; }
      setMessage(`Recebimento de ${money(cents)} registado para ${group.eventName}. O total vendido permanece no histórico.`);
      setGroup(null); router.refresh();
    } catch { setError("Erro de rede ao confirmar o recebimento."); }
    finally { setBusy(false); }
  }

  return <>
    <section className="cashier-card cash-deposit-manager">
      <div className="cash-deposit-heading"><div><h2>Entregas de caixa</h2><p>Os valores do mesmo evento e vendedor são somados. Confirme quando receber o dinheiro.</p></div><div className="cash-deposit-totals"><div><span>Caixa por receber</span><strong>{money(pendingCents)}</strong></div><div><span>Total vendido</span><strong>{money(totalSalesCents)}</strong></div></div></div>
      {error && !group ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}
      {groups.length === 0 ? <p className="form-help">Não há entregas pendentes. O total vendido continua guardado no histórico.</p> : <ul className="cash-deposit-list">{groups.map((item) => <li key={`${item.sellerId}:${item.eventId ?? "org"}`}><div className="cash-deposit-info"><strong>{money(item.pendingCents)}</strong><span>{item.eventName}</span><small>Vendedor: {item.sellerName} · {item.deposits.length} fechamento(s){item.receivedCents ? ` · recebido anteriormente ${money(item.receivedCents)}` : ""}</small></div><button className="button button-primary" type="button" onClick={() => openModal(item)}>Confirmar recebimento</button></li>)}</ul>}
    </section>
    {group ? <div className="cash-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setGroup(null); }}><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="deposit-modal-title"><button type="button" className="cash-modal-close" aria-label="Fechar" disabled={busy} onClick={() => setGroup(null)}>×</button><span className="section-kicker">RECEBIMENTO DE CAIXA</span><h2 id="deposit-modal-title">{group.eventName} · {group.sellerName}</h2><p>{money(group.pendingCents)} pendentes em {group.deposits.length} fechamento(s). Total vendido: {money(totalSalesCents)}.</p><form className="cash-modal-form" onSubmit={confirmReceived}><label className="cashier-field"><span>Valor recebido ({currency})</span><input type="number" min="0" max={(group.pendingCents / 100).toFixed(2)} step="0.01" value={receivedValue} onChange={(e) => setReceivedValue(e.target.value)} required /></label><label className="cashier-field"><span>Senha do organizador</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><fieldset className="cash-modal-difference"><legend>Se houver diferença</legend><label><input type="radio" checked={!clearDifference} onChange={() => setClearDifference(false)} /> Manter como valor a receber</label><label><input type="radio" checked={clearDifference} onChange={() => setClearDifference(true)} /> Zerar após conversa pessoal com o vendedor</label>{clearDifference ? <label className="cashier-field"><span>Justificativa da conversa</span><textarea value={differenceNotes} onChange={(e) => setDifferenceNotes(e.target.value)} rows={3} maxLength={500} required /></label> : null}</fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="cash-modal-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setGroup(null)}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "A confirmar…" : clearDifference ? "Confirmar e zerar" : "Confirmar recebimento"}</button></div></form></section></div> : null}
  </>;
}

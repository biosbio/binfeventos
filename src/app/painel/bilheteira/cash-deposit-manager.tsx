"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Deposit = {
  id: string;
  amountCents: number;
  createdAt: string;
  closedAt: string | null;
  sellerName: string;
  stationName: string;
  stationLocation: string | null;
  eventName: string;
};

export default function CashDepositManager({
  currency,
  deposits,
  totalSalesCents,
}: {
  currency: string;
  deposits: Deposit[];
  totalSalesCents: number;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pendingCents = deposits.reduce((total, deposit) => total + deposit.amountCents, 0);
  const money = (amountCents: number) => new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency,
  }).format(amountCents / 100);

  async function confirmReceived(deposit: Deposit) {
    setBusyId(deposit.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/boxoffice/deposits/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositId: deposit.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível confirmar o recebimento.");
        return;
      }
      setMessage(`Recebimento de ${money(deposit.amountCents)} confirmado. O total vendido permanece no histórico.`);
      router.refresh();
    } catch {
      setError("Erro de rede ao confirmar o recebimento.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="cashier-card cash-deposit-manager">
      <div className="cash-deposit-heading">
        <div>
          <h2>Entregas de caixa</h2>
          <p>Confirme cada entrega quando o vendedor entregar o dinheiro à organização.</p>
        </div>
        <div className="cash-deposit-totals">
          <div><span>Caixa por receber</span><strong>{money(pendingCents)}</strong></div>
          <div><span>Total vendido</span><strong>{money(totalSalesCents)}</strong></div>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
      {deposits.length === 0 ? (
        <p className="form-help">Não há entregas pendentes. O total vendido continua guardado no histórico.</p>
      ) : (
        <ul className="cash-deposit-list">
          {deposits.map((deposit) => (
            <li key={deposit.id}>
              <div className="cash-deposit-info">
                <strong>{money(deposit.amountCents)}</strong>
                <span>{deposit.eventName} · {deposit.stationName}{deposit.stationLocation ? ` — ${deposit.stationLocation}` : ""}</span>
                <small>Vendedor: {deposit.sellerName} · Fechado em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(deposit.closedAt ?? deposit.createdAt))}</small>
              </div>
              <button className="button button-primary" type="button" disabled={busyId !== ""} onClick={() => confirmReceived(deposit)}>
                {busyId === deposit.id ? "A confirmar…" : "Confirmar recebido"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

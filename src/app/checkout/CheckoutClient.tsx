"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteHeader, SiteFooter } from "../_components/site-shell";

// ============================================================
// Checkout — cliente mínimo (SEC):
// 1. O utilizador escolhe quantidade; o servidor valida lote,
//    disponibilidade e limite por comprador.
// 2. Resumo financeiro vem SEMPRE do servidor (nunca calculado
//    aqui); o browser apenas mostra o que recebeu.
// 3. Titulares obrigatórios (comprador ≠ titular).
// 4. Idempotência: checkoutIdempotencyKey guardada apenas em
//    memória do componente (não localStorage).
// ============================================================

interface AvailabilityItem {
  ticketTypeId: string;
  batchId: string;
  name: string;
  category: string;
  unitPriceCents: number;
  currency: string;
  requiresIdentity: boolean;
  onSale: boolean;
  available: number;
}

interface Attendee {
  fullName: string;
}

export default function CheckoutClient() {
  const search = useSearchParams();
  const sessionId = search.get("sessionId");
  const eventId = search.get("eventId");

  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buyers, setBuyers] = useState<Attendee[]>([{ fullName: "" }]);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [hold, setHold] = useState<{ holdId: string; expiresAt: string } | null>(null);
  const [summary, setSummary] = useState<{
    totalCents: number; subtotalCents: number; serviceFeeCents: number; currency: string;
  } | null>(null);
  const [order, setOrder] = useState<{ orderId: string; orderNumber: string } | null>(null);
  const [paymentRedirect, setPaymentRedirect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetch("/api/marketplace/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => r.json())
      .then((d) => setItems((d.items ?? []).filter((i: AvailabilityItem) => i.onSale && i.available > 0)))
      .catch(() => setError("Não foi possível carregar a disponibilidade."));
  }, [sessionId]);

  // Titulares acompanham a quantidade escolhida
  useEffect(() => {
    setBuyers(Array.from({ length: quantity }, (_, i) => buyers[i] ?? { fullName: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity, selected]);

  async function reserve() {
    if (!selected) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/marketplace/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          ticketTypeId: selected.ticketTypeId,
          batchId: selected.batchId,
          quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Reserva recusada pelo servidor.");
        return;
      }
      setHold({ holdId: data.holdId, expiresAt: data.expiresAt });
    } finally {
      setLoading(false);
    }
  }

  async function placeOrder() {
    if (!hold || !selected) return;
    if (buyers.some((b) => b.fullName.trim().length < 3) || !buyerName.trim() || !buyerEmail.trim()) {
      setError("Preencha o nome do comprador e de todos os titulares.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/marketplace/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdId: hold.holdId,
          checkoutIdempotencyKey: crypto.randomUUID(),
          buyerName,
          buyerEmail,
          attendees: buyers.map((b) => ({
            ticketTypeId: selected.ticketTypeId,
            fullName: b.fullName.trim(),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Não foi possível criar a encomenda.");
        return;
      }
      setSummary({
        totalCents: data.order.totalCents,
        subtotalCents: data.order.subtotalCents,
        serviceFeeCents: data.order.serviceFeeCents,
        currency: data.order.currency,
      });
      setOrder({ orderId: data.order.orderId, orderNumber: data.order.orderNumber });
    } finally {
      setLoading(false);
    }
  }

  async function startPayment() {
    if (!order) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          providerCode: "multicaixa",
          method: "MOBILE_MONEY",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Pagamento recusado pelo servidor.");
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setPaymentRedirect(null);
      setError("Pagamento iniciado. Aguarde a confirmação por email/notificação.");
    } finally {
      setLoading(false);
    }
  }

  if (!sessionId || !eventId) {
    return (
      <>
        <SiteHeader />
        <main className="container" style={{ padding: "60px 0" }}>
          <div className="empty-state">Sessão inválida. Volte ao evento e tente novamente.</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "45px 0 70px", maxWidth: 560 }}>
        <span className="section-kicker">CHECKOUT SEGURO</span>
        <h1 style={{ margin: "9px 0 22px", fontSize: "clamp(30px,4vw,42px)", letterSpacing: "-.05em" }}>
          Finalizar compra
        </h1>

        {error ? <div className="form-error" role="alert">{error}</div> : null}

        {/* Passo 1: escolher bilhete e quantidade */}
        {!hold && !order ? (
          <div className="panel">
            <h2>1 · Escolha os bilhetes</h2>
            {items.length === 0 ? (
              <p className="form-help">Sem bilhetes disponíveis para esta sessão.</p>
            ) : (
              items.map((i) => (
                <label key={i.batchId} className="ticket-row" style={{ cursor: "pointer" }}>
                  <div>
                    <input
                      type="radio"
                      name="ticket"
                      checked={selected?.batchId === i.batchId}
                      onChange={() => setSelected(i)}
                    />{" "}
                    <strong>{i.name}</strong>
                    <small>
                      {i.available} disponíveis · {i.requiresIdentity ? "identificação obrigatória" : "sem identificação"}
                    </small>
                  </div>
                  <strong>
                    {(i.unitPriceCents / 100).toLocaleString("pt-PT", { style: "currency", currency: i.currency })}
                  </strong>
                </label>
              ))
            )}

            {selected ? (
              <>
                <div className="form-field" style={{ marginTop: 16 }}>
                  <label htmlFor="qty">Quantidade</label>
                  <input
                    id="qty"
                    type="number"
                    min={1}
                    max={Math.min(selected.available, 20)}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(selected.available, Number(e.target.value) || 1)))}
                  />
                </div>
                <button className="button button-primary" style={{ width: "100%" }} onClick={reserve} disabled={loading}>
                  {loading ? "A reservar…" : "Reservar lugares"}
                </button>
                <p className="form-help" style={{ marginTop: 8 }}>
                  A reserva temporária dura 10 minutos e é controlada pelo servidor.
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Passo 2: comprador + titulares */}
        {hold && !order ? (
          <div className="panel">
            <h2>2 · Identificação</h2>
            <p className="form-help">
              Reserva ativa até {new Date(hold.expiresAt).toLocaleTimeString("pt-PT")}.
            </p>
            <div className="form-field">
              <label htmlFor="buyerName">Nome do comprador</label>
              <input id="buyerName" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="buyerEmail">Email do comprador</label>
              <input id="buyerEmail" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
            </div>
            {buyers.map((b, i) => (
              <div className="form-field" key={i}>
                <label htmlFor={`holder-${i}`}>Titular {i + 1}</label>
                <input
                  id={`holder-${i}`}
                  placeholder="Nome completo do titular do bilhete"
                  value={b.fullName}
                  onChange={(e) =>
                    setBuyers(buyers.map((x, j) => (j === i ? { fullName: e.target.value } : x)))
                  }
                />
              </div>
            ))}
            <button className="button button-primary" style={{ width: "100%" }} onClick={placeOrder} disabled={loading}>
              {loading ? "A criar encomenda…" : "Continuar para pagamento"}
            </button>
          </div>
        ) : null}

        {/* Passo 3: resumo do servidor + pagamento */}
        {order && summary ? (
          <div className="panel">
            <h2>3 · Pagamento</h2>
            <div className="ticket-row"><span>Subtotal</span><strong>{(summary.subtotalCents / 100).toLocaleString("pt-PT", { style: "currency", currency: summary.currency })}</strong></div>
            <div className="ticket-row"><span>Taxa de serviço</span><strong>{(summary.serviceFeeCents / 100).toLocaleString("pt-PT", { style: "currency", currency: summary.currency })}</strong></div>
            <div className="ticket-row"><span>Total</span><strong>{(summary.totalCents / 100).toLocaleString("pt-PT", { style: "currency", currency: summary.currency })}</strong></div>
            <p className="form-help" style={{ marginTop: 10 }}>
              Encomenda {order.orderNumber} — valores calculados e validados pelo
              servidor. Os bilhetes são emitidos apenas após confirmação do pagamento.
            </p>
            <button className="button button-lime" style={{ width: "100%" }} onClick={startPayment} disabled={loading}>
              {loading ? "A iniciar…" : "Pagar com Mobile Money"}
            </button>
          </div>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
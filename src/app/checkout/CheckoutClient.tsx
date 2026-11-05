"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  description: string | null;
  unitPriceCents: number;
  currency: string;
  requiresIdentity: boolean;
  onSale: boolean;
  available: number;
}

interface Attendee {
  fullName: string;
}

interface PaymentOption {
  providerCode: string;
  providerName: string;
  country: string;
  method: "CARD" | "MOBILE_MONEY" | "DIGITAL_WALLET" | "BANK_TRANSFER" | "CASH";
}

const PAYMENT_METHOD_LABELS: Record<PaymentOption["method"], string> = {
  CARD: "Cartão de crédito ou débito",
  MOBILE_MONEY: "Mobile Money",
  DIGITAL_WALLET: "Carteira digital",
  BANK_TRANSFER: "Transferência bancária",
  CASH: "Dinheiro",
};

function localSandboxUrl(value: string): string {
  try {
    const target = new URL(value, window.location.origin);
    if (
      target.pathname.startsWith("/checkout/sandbox-authorization") &&
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(target.hostname)
    ) {
      target.protocol = window.location.protocol;
      target.host = window.location.host;
    }
    return target.toString();
  } catch {
    return value;
  }
}

export default function CheckoutClient() {
  const search = useSearchParams();
  const sessionId = search.get("sessionId");
  const eventId = search.get("eventId");

  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState("");
  const [paymentOptionsLoading, setPaymentOptionsLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [buyers, setBuyers] = useState<Attendee[]>([{ fullName: "" }]);
  const [hold, setHold] = useState<{ holdId: string; expiresAt: string } | null>(null);
  const [summary, setSummary] = useState<{
    totalCents: number; currency: string;
  } | null>(null);
  const [order, setOrder] = useState<{ orderId: string; orderNumber: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedCurrency = selected?.currency;

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

  useEffect(() => {
    let cancelled = false;
    setPaymentOptions([]);
    setSelectedPaymentOption("");
    if (!selectedCurrency) return;

    setPaymentOptionsLoading(true);
    fetch(`/api/payments/options?currency=${encodeURIComponent(selectedCurrency)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message ?? "Não foi possível carregar os meios de pagamento.");
        }
        return data as { options: PaymentOption[] };
      })
      .then(({ options }) => {
        if (cancelled) return;
        setPaymentOptions(options);
        const firstOption = options[0];
        if (firstOption) {
          setSelectedPaymentOption(`${firstOption.providerCode}:${firstOption.method}`);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar os meios de pagamento.");
      })
      .finally(() => {
        if (!cancelled) setPaymentOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCurrency]);

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
    if (buyers.some((b) => b.fullName.trim().length < 3)) {
      setError("Preencha o nome de todos os titulares.");
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
        currency: data.order.currency,
      });
      setOrder({ orderId: data.order.orderId, orderNumber: data.order.orderNumber });
    } finally {
      setLoading(false);
    }
  }

  async function startPayment() {
    if (!order) return;
    const option = paymentOptions.find(
      (candidate) => `${candidate.providerCode}:${candidate.method}` === selectedPaymentOption,
    );
    if (!option) {
      setError("Selecione um meio de pagamento disponível.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          providerCode: option.providerCode,
          method: option.method,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Pagamento recusado pelo servidor.");
        return;
      }
      if (data.redirectUrl) {
        window.location.href = localSandboxUrl(data.redirectUrl);
        return;
      }
      setError("Pagamento iniciado. Aguarde a confirmação por email/notificação.");
    } finally {
      setLoading(false);
    }
  }

  if (!sessionId || !eventId) {
    return (
      <>
        <main className="container checkout-page">
          <div className="empty-state">Sessão inválida. Volte ao evento e tente novamente.</div>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="container checkout-page">
        <span className="section-kicker">CHECKOUT SEGURO</span>
        <h1 style={{ margin: "9px 0 22px", fontSize: "clamp(30px,4vw,42px)", letterSpacing: "-.05em" }}>
          Finalizar compra
        </h1>

        {error ? <div className="form-error" role="alert">{error}</div> : null}

        {/* Passo 1: escolher bilhete e quantidade */}
        {!hold && !order ? (
          <div className="panel checkout-panel">
            <h2>1 · Escolha os bilhetes</h2>
            {items.length === 0 ? (
              <p className="form-help">Sem bilhetes disponíveis para esta sessão.</p>
            ) : (
              items.map((i) => (
                <label key={i.batchId} className="checkout-choice checkout-ticket-option">
                  <span className="checkout-choice-main">
                    <input
                      type="radio"
                      name="ticket"
                      checked={selected?.batchId === i.batchId}
                      onChange={() => setSelected(i)}
                    />{" "}
                    <span className="checkout-choice-copy">
                      <strong>{i.name}</strong>
                      {i.description ? <small>{i.description}</small> : null}
                      <small>{i.available} disponíveis · {i.requiresIdentity ? "identificação obrigatória" : "sem identificação"}</small>
                    </span>
                  </span>
                  <strong className="checkout-option-price">
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
                <button className="button button-primary" style={{ width: "100%" }} onClick={reserve} disabled={loading || paymentOptionsLoading || paymentOptions.length === 0}>
                  {loading ? "A reservar…" : "Reservar lugares"}
                </button>
                {paymentOptionsLoading ? (
                  <p className="form-help">A verificar meios de pagamento disponíveis…</p>
                ) : paymentOptions.length === 0 ? (
                  <p className="form-help" role="status">
                    Ainda não há meios de pagamento configurados para esta moeda. Tente novamente mais tarde.
                  </p>
                ) : null}
                <p className="form-help" style={{ marginTop: 8 }}>
                  A reserva temporária dura 10 minutos e é controlada pelo servidor.
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Passo 2: comprador + titulares */}
        {hold && !order ? (
          <div className="panel checkout-panel">
            <h2>2 · Identificação</h2>
            <p className="form-help">
              Reserva ativa até {new Date(hold.expiresAt).toLocaleTimeString("pt-PT")}. Os dados do comprador
              serão usados a partir da sua conta.
            </p>
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
          <div className="panel checkout-panel">
            <h2>3 · Pagamento</h2>
            <div className="ticket-row"><span>Total</span><strong>{(summary.totalCents / 100).toLocaleString("pt-PT", { style: "currency", currency: summary.currency })}</strong></div>
            <fieldset className="checkout-payment-options">
              <legend>Meio de pagamento</legend>
              {paymentOptions.map((option) => {
                const optionKey = `${option.providerCode}:${option.method}`;
                return (
                  <label key={optionKey} className="checkout-choice checkout-method-option">
                    <span className="checkout-choice-main">
                      <input
                        type="radio"
                        name="payment-option"
                        value={optionKey}
                        checked={selectedPaymentOption === optionKey}
                        onChange={() => setSelectedPaymentOption(optionKey)}
                      />{" "}
                      <span className="checkout-choice-copy">
                        <strong>{PAYMENT_METHOD_LABELS[option.method]}</strong>
                        <small>{option.providerName} · {option.country}</small>
                      </span>
                    </span>
                  </label>
                );
              })}
              {paymentOptionsLoading ? <p className="form-help">A carregar meios de pagamento…</p> : null}
              {!paymentOptionsLoading && paymentOptions.length === 0 ? (
                <p className="form-help" role="status">Não há meios de pagamento disponíveis para esta moeda.</p>
              ) : null}
            </fieldset>
            <p className="checkout-payment-note">
              Encomenda {order.orderNumber}. O total corresponde ao preço definido
              para os bilhetes, sem taxa de serviço para o comprador. Os bilhetes
              são emitidos apenas após confirmação do pagamento.
            </p>
            <button className="button button-lime" style={{ width: "100%" }} onClick={startPayment} disabled={loading || paymentOptionsLoading || paymentOptions.length === 0}>
              {loading ? "A iniciar…" : "Continuar para pagamento"}
            </button>
          </div>
        ) : null}
      </main>
    </>
  );
}

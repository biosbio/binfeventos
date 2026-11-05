"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Station = { code: string; name: string; eventIds?: string[] };
type Shift = { id: string; eventId: string | null; station: Station } | null;
type Ticket = {
  ticketTypeId: string;
  batchId: string;
  name: string;
  batchName: string;
  currency: string;
  unitPriceCents: number;
  available: number;
};
type Session = { id: string; eventId: string; name: string; startsAt: string; tickets: Ticket[] };
type Attendee = { fullName: string; documentType: string; documentNumber: string };
type PaymentOption = {
  providerCode: string;
  providerName: string;
  method: "CARD" | "MOBILE_MONEY" | "DIGITAL_WALLET" | "BANK_TRANSFER" | "CASH";
};

const PAYMENT_LABELS: Record<PaymentOption["method"], string> = {
  CARD: "Cartão",
  MOBILE_MONEY: "Dinheiro móvel",
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

export default function CashierClient({
  currency,
  paymentOptions,
  stations,
  activeShift,
  sessions,
  eventStaffOnly,
}: {
  currency: string;
  paymentOptions: PaymentOption[];
  stations: Station[];
  activeShift: Shift;
  sessions: Session[];
  eventStaffOnly: boolean;
}) {
  const router = useRouter();
  const selectableSessions = eventStaffOnly
    ? sessions.filter((item) => stations.some((station) => station.eventIds?.includes(item.eventId)))
    : sessions;
  const initialEventId = activeShift?.eventId ?? selectableSessions[0]?.eventId ?? sessions[0]?.eventId ?? "";
  const [eventId, setEventId] = useState(initialEventId);
  const initialStation = activeShift?.station.code ?? stations.find((station) =>
    !eventStaffOnly || station.eventIds?.includes(initialEventId),
  )?.code ?? "";
  const [stationCode, setStationCode] = useState(initialStation);
  const [openingFloat, setOpeningFloat] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [differenceNotes, setDifferenceNotes] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [paymentOptionKey, setPaymentOptionKey] = useState(
    `${paymentOptions[0]?.providerCode ?? "cash"}:${paymentOptions[0]?.method ?? "CASH"}`,
  );
  const [attendees, setAttendees] = useState<Attendee[]>([
    { fullName: "", documentType: "PASSAPORTE", documentNumber: "" },
  ]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const availableStations = eventStaffOnly
    ? stations.filter((station) => station.eventIds?.includes(eventId))
    : stations;
  const availableSessions = activeShift?.eventId
    ? sessions.filter((item) => item.eventId === activeShift.eventId)
    : sessions;
  const session = availableSessions.find((item) => item.id === sessionId);
  const tickets = session?.tickets ?? [];
  const ticket = tickets.find((item) => `${item.ticketTypeId}:${item.batchId}` === ticketKey);
  const amount = ticket ? ticket.unitPriceCents * quantity : 0;
  const paymentOption = paymentOptions.find(
    (option) => `${option.providerCode}:${option.method}` === paymentOptionKey,
  ) ?? paymentOptions[0];

  function chooseSession(nextSessionId: string) {
    setSessionId(nextSessionId);
    setTicketKey("");
    setQuantity(1);
    setAttendees([{ fullName: "", documentType: "PASSAPORTE", documentNumber: "" }]);
  }

  function chooseTicket(nextTicketKey: string) {
    setTicketKey(nextTicketKey);
    setQuantity(1);
    setAttendees([{ fullName: "", documentType: "PASSAPORTE", documentNumber: "" }]);
  }

  function changeQuantity(nextQuantity: number) {
    setQuantity(nextQuantity);
    setAttendees((current) =>
      Array.from({ length: nextQuantity }, (_, index) =>
        current[index] ?? { fullName: "", documentType: "PASSAPORTE", documentNumber: "" },
      ),
    );
  }

  async function openShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/boxoffice/shifts/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationCode,
          eventId: eventStaffOnly ? eventId : undefined,
          openingFloatCents: Math.round(Number(openingFloat) * 100),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível abrir o turno.");
        return;
      }
      router.refresh();
    } catch {
      setError("Erro de rede ao abrir o turno.");
    } finally {
      setBusy(false);
    }
  }

  async function sellForCash(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeShift || !session || !ticket) return;
    if (
      attendees.length !== quantity ||
      attendees.some((attendee) =>
        attendee.fullName.trim().length < 3 ||
        attendee.documentType.trim().length < 2 ||
        attendee.documentNumber.trim().length < 4,
      )
    ) {
      setError("Preencha os dados de identificação de todos os titulares.");
      return;
    }

    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const holdResponse = await fetch("/api/marketplace/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          ticketTypeId: ticket.ticketTypeId,
          batchId: ticket.batchId,
          quantity,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const holdData = await holdResponse.json();
      if (!holdResponse.ok) {
        setError(holdData.message ?? "Não foi possível reservar o inventário.");
        return;
      }

      const response = await fetch("/api/boxoffice/sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationCode: activeShift.station.code,
          holdId: holdData.holdId,
          providerCode: paymentOption?.providerCode,
          method: paymentOption?.method ?? "CASH",
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          attendees: attendees.map((attendee) => ({
            ticketTypeId: ticket.ticketTypeId,
            fullName: attendee.fullName.trim(),
            documentType: attendee.documentType.trim(),
            documentNumber: attendee.documentNumber.trim(),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível finalizar a venda em dinheiro.");
        return;
      }

      if (paymentOption?.method !== "CASH") {
        if (data.order.payment?.redirectUrl) {
          window.location.assign(localSandboxUrl(data.order.payment.redirectUrl));
        } else {
          router.push(`/checkout/return?order=${encodeURIComponent(data.order.orderId)}`);
        }
        return;
      }
      setSuccess(`Venda concluída. Encomenda ${data.order.orderNumber}; bilhete(s) emitido(s).`);
      setBuyerName("");
      setBuyerEmail("");
      setAttendees([{ fullName: "", documentType: "PASSAPORTE", documentNumber: "" }]);
      setQuantity(1);
      router.refresh();
    } catch {
      setError("Erro de rede ao finalizar a venda. Verifique a encomenda antes de repetir.");
    } finally {
      setBusy(false);
    }
  }

  async function closeShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeShift) return;
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const response = await fetch("/api/boxoffice/shifts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId: activeShift.id,
          countedCents: Math.round(Number(countedCash) * 100),
          differenceNotes: differenceNotes.trim() || "Sem diferenças identificadas.",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível fechar o turno.");
        return;
      }
      setSuccess("Turno fechado e caixa registado.");
      router.refresh();
    } catch {
      setError("Erro de rede ao fechar o turno.");
    } finally {
      setBusy(false);
    }
  }

  if (!activeShift) {
    return (
      <section className="cashier-card">
        <h2>Abrir turno de caixa</h2>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {availableStations.length === 0 ? (
          <p className="form-help">
            Não há postos de bilheteira ativos associados ao local deste evento. Peça ao organizador
            para configurar um posto antes de iniciar vendas.
          </p>
        ) : (
          <form onSubmit={openShift}>
            {eventStaffOnly ? (
              <label className="cashier-field">
                <span>Evento</span>
                <select
                  value={eventId}
                  onChange={(event) => {
                    const nextEventId = event.target.value;
                    setEventId(nextEventId);
                    setStationCode(stations.find((station) => station.eventIds?.includes(nextEventId))?.code ?? "");
                  }}
                  required
                >
                  {Array.from(new Map(selectableSessions.map((item) => [item.eventId, item.name])).entries()).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="cashier-field">
              <span>Posto de venda</span>
              <select value={stationCode} onChange={(event) => setStationCode(event.target.value)} required>
                {availableStations.map((station) => (
                  <option key={station.code} value={station.code}>{station.name}</option>
                ))}
              </select>
            </label>
            <label className="cashier-field">
              <span>Fundo inicial ({currency})</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingFloat}
                onChange={(event) => setOpeningFloat(event.target.value)}
                required
              />
            </label>
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "A abrir…" : "Abrir turno"}
            </button>
          </form>
        )}
      </section>
    );
  }

  return (
    <div className="cashier-layout">
      <section className="cashier-card">
        <div className="cashier-open-shift">
          <span className="cashier-status-dot" />
          <div><strong>Turno aberto</strong><small>{activeShift.station.name}</small></div>
          <span className="cashier-cash-badge">Caixa presencial</span>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {success ? <p className="form-success" role="status">{success}</p> : null}
        {availableSessions.length === 0 ? (
          <p className="form-help">Não há bilhetes disponíveis para venda presencial neste momento.</p>
        ) : (
          <form className="cashier-form" onSubmit={sellForCash}>
            <h2>Registar venda</h2>
            <label className="cashier-field">
              <span>Meio de pagamento</span>
              <select
                value={paymentOptionKey}
                onChange={(event) => setPaymentOptionKey(event.target.value)}
                required
              >
                {paymentOptions.map((option) => (
                  <option key={`${option.providerCode}:${option.method}`} value={`${option.providerCode}:${option.method}`}>
                    {PAYMENT_LABELS[option.method]} · {option.providerName}
                  </option>
                ))}
              </select>
            </label>
            <label className="cashier-field">
              <span>Evento e sessão</span>
              <select value={sessionId} onChange={(event) => chooseSession(event.target.value)} required>
                <option value="">Selecione o evento</option>
                {availableSessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(item.startsAt))}
                  </option>
                ))}
              </select>
            </label>
            <label className="cashier-field">
              <span>Tipo de bilhete</span>
              <select value={ticketKey} onChange={(event) => chooseTicket(event.target.value)} required disabled={!session}>
                <option value="">Selecione o bilhete</option>
                {tickets.map((item) => (
                  <option key={`${item.ticketTypeId}:${item.batchId}`} value={`${item.ticketTypeId}:${item.batchId}`}>
                    {item.name} — {item.batchName} · {item.available} disponível(is)
                  </option>
                ))}
              </select>
            </label>
            {ticket ? (
              <label className="cashier-field">
                <span>Quantidade (máximo {ticket.available})</span>
                <input
                  type="number"
                  min="1"
                  max={Math.min(ticket.available, 20)}
                  value={quantity}
                  onChange={(event) =>
                    changeQuantity(Math.max(1, Math.min(ticket.available, Number(event.target.value) || 1)))
                  }
                  required
                />
              </label>
            ) : null}

            <h3>Dados do comprador</h3>
            <label className="cashier-field">
              <span>Nome completo</span>
              <input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} minLength={3} required />
            </label>
            <label className="cashier-field">
              <span>Email</span>
              <input type="email" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} required />
            </label>

            {ticket ? (
              <>
                <h3>Titulares dos bilhetes</h3>
                {attendees.map((attendee, index) => (
                  <fieldset className="cashier-attendee" key={index}>
                    <legend>Titular {index + 1}</legend>
                    <label className="cashier-field">
                      <span>Nome completo</span>
                      <input
                        value={attendee.fullName}
                        onChange={(event) => setAttendees((current) =>
                          current.map((item, itemIndex) => itemIndex === index
                            ? { ...item, fullName: event.target.value }
                            : item),
                        )}
                        minLength={3}
                        required
                      />
                    </label>
                    <div className="cashier-document-row">
                      <label className="cashier-field">
                        <span>Tipo de documento</span>
                        <input
                          value={attendee.documentType}
                          onChange={(event) => setAttendees((current) =>
                            current.map((item, itemIndex) => itemIndex === index
                              ? { ...item, documentType: event.target.value }
                              : item),
                          )}
                          minLength={2}
                          required
                        />
                      </label>
                      <label className="cashier-field">
                        <span>Número do documento</span>
                        <input
                          value={attendee.documentNumber}
                          onChange={(event) => setAttendees((current) =>
                            current.map((item, itemIndex) => itemIndex === index
                              ? { ...item, documentNumber: event.target.value }
                              : item),
                          )}
                          minLength={4}
                          required
                        />
                      </label>
                    </div>
                  </fieldset>
                ))}
              </>
            ) : null}

            {ticket ? (
              <div className="cashier-total">
                <span>Total recebido em dinheiro</span>
                <strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: ticket.currency }).format(amount / 100)}</strong>
              </div>
            ) : null}
            <button className="button button-primary cashier-submit" type="submit" disabled={busy || !ticket}>
              {busy ? "A finalizar venda…" : "Receber dinheiro e emitir bilhete(s)"}
            </button>
          </form>
        )}
        <form className="cashier-form" onSubmit={closeShift}>
          <h2>Fechar turno</h2>
          <label className="cashier-field">
            <span>Dinheiro contado ({currency})</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
              required
            />
          </label>
          <label className="cashier-field">
            <span>Notas sobre diferenças</span>
            <input value={differenceNotes} onChange={(event) => setDifferenceNotes(event.target.value)} />
          </label>
          <button className="button button-secondary" type="submit" disabled={busy}>
            {busy ? "A fechar…" : "Fechar turno"}
          </button>
        </form>
      </section>
      <aside className="cashier-help">
        <span className="cashier-cash-icon" aria-hidden="true">$</span>
        <h2>Pagamento em dinheiro</h2>
        <p>Receba o valor do comprador antes de finalizar. A confirmação da venda atualiza o caixa e emite os bilhetes.</p>
        <small>O comprador online não verá dinheiro como opção de pagamento.</small>
      </aside>
    </div>
  );
}

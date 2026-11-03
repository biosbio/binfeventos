"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Station = { code: string; name: string };
type Shift = { id: string; station: Station } | null;
type Ticket = {
  ticketTypeId: string;
  batchId: string;
  name: string;
  batchName: string;
  currency: string;
  unitPriceCents: number;
  available: number;
};
type Session = { id: string; name: string; startsAt: string; tickets: Ticket[] };
type Attendee = { fullName: string; documentType: string; documentNumber: string };

export default function CashierClient({
  currency,
  stations,
  activeShift,
  sessions,
}: {
  currency: string;
  stations: Station[];
  activeShift: Shift;
  sessions: Session[];
}) {
  const router = useRouter();
  const [stationCode, setStationCode] = useState(activeShift?.station.code ?? stations[0]?.code ?? "");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [sessionId, setSessionId] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([
    { fullName: "", documentType: "PASSAPORTE", documentNumber: "" },
  ]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const session = sessions.find((item) => item.id === sessionId);
  const tickets = session?.tickets ?? [];
  const ticket = tickets.find((item) => `${item.ticketTypeId}:${item.batchId}` === ticketKey);
  const amount = ticket ? ticket.unitPriceCents * quantity : 0;

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

  if (!activeShift) {
    return (
      <section className="cashier-card">
        <h2>Abrir turno de caixa</h2>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {stations.length === 0 ? (
          <p className="form-help">
            Não há postos de bilheteira ativos nesta organização. Peça ao administrador
            para configurar um posto antes de iniciar vendas.
          </p>
        ) : (
          <form onSubmit={openShift}>
            <label className="cashier-field">
              <span>Posto de venda</span>
              <select value={stationCode} onChange={(event) => setStationCode(event.target.value)} required>
                {stations.map((station) => (
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
          <span className="cashier-cash-badge">Pagamento em dinheiro</span>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {success ? <p className="form-success" role="status">{success}</p> : null}
        {sessions.length === 0 ? (
          <p className="form-help">Não há bilhetes disponíveis para venda presencial neste momento.</p>
        ) : (
          <form className="cashier-form" onSubmit={sellForCash}>
            <h2>Registar venda</h2>
            <label className="cashier-field">
              <span>Evento e sessão</span>
              <select value={sessionId} onChange={(event) => chooseSession(event.target.value)} required>
                <option value="">Selecione o evento</option>
                {sessions.map((item) => (
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

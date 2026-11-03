"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Session = { id: string; startsAt: Date; endsAt: Date };
type Batch = {
  id: string;
  quantity: number;
  status: string;
  inventory: { sessionId: string; totalQuantity: number; soldQuantity: number; reservedQuantity: number }[];
};
type TicketType = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  basePriceCents: number;
  currency: string;
  requiresIdentity: boolean;
  status: string;
  batches: Batch[];
};

const CATEGORY_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  VIP: "VIP",
  PREMIUM: "Premium",
  STUDENT: "Estudante",
  CHILD: "Criança",
  FREE: "Gratuito",
  INVITE: "Convite",
  SPECIAL_ACCESS: "Acesso especial",
};

export default function TicketInventoryManager({
  eventId,
  sessions,
  ticketTypes,
  currency,
}: {
  eventId: string;
  sessions: Session[];
  ticketTypes: TicketType[];
  currency: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("NORMAL");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState("0");
  const [requiresIdentity, setRequiresIdentity] = useState(true);
  const [typeError, setTypeError] = useState("");
  const [typeSuccess, setTypeSuccess] = useState("");
  const [typeBusy, setTypeBusy] = useState(false);
  const [salesError, setSalesError] = useState("");
  const [salesSuccess, setSalesSuccess] = useState("");
  const [closingBatchId, setClosingBatchId] = useState<string | null>(null);
  const [savingQuantityId, setSavingQuantityId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [maxPerBuyer, setMaxPerBuyer] = useState("10");

  useEffect(() => {
    if (sessions.length === 0) {
      setSalesError("Adicione primeiro a data do evento para criar bilhetes.");
    } else if (sessions.length > 1) {
      setSalesError("Atualize a duração do evento no formulário acima antes de configurar os bilhetes.");
    } else {
      setSalesError("");
    }
  }, [sessions.length]);

  async function createTicketType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTypeBusy(true);
    setTypeError("");
    setTypeSuccess("");
    try {
      const response = await fetch("/api/catalog/ticket-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          name,
          category,
          description: description || undefined,
          basePriceCents: Math.round(Number(basePrice) * 100),
          requiresIdentity,
          quantity: Number(quantity),
          maxPerBuyer: Number(maxPerBuyer),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setTypeError(data.message ?? "Não foi possível publicar o tipo de bilhete.");
        return;
      }
      setName("");
      setDescription("");
      setBasePrice("0");
      setQuantity("100");
      setMaxPerBuyer("10");
      setTypeSuccess("Bilhete publicado. A venda inicia automaticamente quando o evento for publicado.");
      router.refresh();
    } catch {
      setTypeError("Erro de rede ao publicar o tipo de bilhete.");
    } finally {
      setTypeBusy(false);
    }
  }

  async function finishSales(ticketTypeId: string) {
    setClosingBatchId(ticketTypeId);
    setSalesError("");
    setSalesSuccess("");
    try {
      const activeBatches = ticketTypes
        .find((ticketType) => ticketType.id === ticketTypeId)
        ?.batches.filter((batch) => batch.status !== "CLOSED") ?? [];
      for (const batch of activeBatches) {
        const response = await fetch("/api/catalog/batches/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: batch.id, to: "CLOSED" }),
        });
        const data = await response.json();
        if (!response.ok) {
          setSalesError(data.message ?? "Não foi possível terminar as vendas deste bilhete.");
          router.refresh();
          return;
        }
      }
      setSalesSuccess("Vendas deste tipo de bilhete terminadas.");
      router.refresh();
    } catch {
      setSalesError("Erro de rede ao terminar as vendas.");
    } finally {
      setClosingBatchId(null);
    }
  }

  async function saveQuantity(
    ticketTypeId: string,
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setSavingQuantityId(ticketTypeId);
    setSalesError("");
    setSalesSuccess("");
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/catalog/ticket-types/quantity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketTypeId,
          quantity: Number(formData.get("quantity")),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSalesError(data.message ?? "Não foi possível guardar a quantidade.");
        return;
      }
      setSalesSuccess("Quantidade guardada. Pode alterá-la novamente a qualquer momento.");
      router.refresh();
    } catch {
      setSalesError("Erro de rede ao guardar a quantidade.");
    } finally {
      setSavingQuantityId(null);
    }
  }

  return (
    <section className="panel" style={{ display: "grid", gap: 20 }}>
      <div>
        <h2>Tipos de bilhete</h2>
        <p className="form-help">
          Crie tipos com nomes e condições próprias — por exemplo entrada geral,
          bilhete gratuito, VIP, mesa, combo ou criança. O comprador verá
          essas informações antes de reservar. A venda começa automaticamente
          quando o evento for publicado e pode ser terminada aqui.
          Moeda da organização: {currency}.
        </p>
      </div>

      {salesError ? <p className="form-error" role="alert">{salesError}</p> : null}
      {salesSuccess ? <p className="form-success" role="status">{salesSuccess}</p> : null}

      {ticketTypes.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          {ticketTypes.map((ticketType) => (
            <article key={ticketType.id} className="ticket-row" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{ticketType.name}</strong>
                  <div className="form-help">
                    {CATEGORY_LABELS[ticketType.category] ?? ticketType.category}
                    {" · "}
                    {new Intl.NumberFormat("pt-PT", {
                      style: "currency",
                      currency: ticketType.currency,
                    }).format(ticketType.basePriceCents / 100)}
                    {" · "}
                    {ticketType.requiresIdentity ? "Identificação obrigatória" : "Sem identificação obrigatória"}
                  </div>
                  {ticketType.description ? <p>{ticketType.description}</p> : null}
                </div>
                <span className="status-pill">{ticketType.status === "ACTIVE" ? "Ativo" : ticketType.status}</span>
              </div>
              {ticketType.batches.length ? (
                <ul style={{ marginBottom: 0 }}>
                  {ticketType.batches.map((batch) => {
                    const inventory = batch.inventory.reduce(
                      (total, item) => total + item.totalQuantity - item.soldQuantity - item.reservedQuantity,
                      0,
                    );
                    return (
                      <li key={batch.id} className="form-help">
                        {inventory} disponível(is) · {batch.status === "CLOSED" ? "Vendas terminadas" : "À venda"}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="form-help">Defina a quantidade para iniciar as vendas deste tipo.</p>
              )}
              {ticketType.batches.length <= 1 ? (
                <form
                  className="form-field"
                  style={{ marginTop: 12 }}
                  onSubmit={(event) => saveQuantity(ticketType.id, event)}
                >
                  <label htmlFor={`ticket-quantity-${ticketType.id}`}>Quantidade disponível por data</label>
                  <input
                    id={`ticket-quantity-${ticketType.id}`}
                    name="quantity"
                    type="number"
                    min="1"
                    max="1000000"
                    required
                    defaultValue={ticketType.batches[0]?.quantity ?? ""}
                  />
                  <button
                    className="button button-secondary"
                    type="submit"
                    disabled={savingQuantityId === ticketType.id}
                  >
                    {savingQuantityId === ticketType.id
                      ? "A guardar…"
                      : ticketType.batches.length
                        ? "Guardar quantidade"
                        : "Definir quantidade e iniciar vendas"}
                  </button>
                </form>
              ) : (
                <p className="form-help">
                  Este tipo tem vários lotes. Altere a quantidade de cada lote pela gestão de inventário.
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">Ainda não há tipos de bilhete configurados.</div>
      )}

      <form className="panel" style={{ display: "grid", gap: 14 }} onSubmit={createTicketType}>
        <h3>Criar tipo de bilhete</h3>
        {typeError ? <p className="form-error" role="alert">{typeError}</p> : null}
        {typeSuccess ? <p className="form-success" role="status">{typeSuccess}</p> : null}
        <div className="form-field">
          <label htmlFor="ticket-name">Nome que o comprador verá *</label>
          <input id="ticket-name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Entrada geral, Mesa VIP para 6, Combo adulto + criança" />
        </div>
        <div className="form-field">
          <label htmlFor="ticket-category">Categoria</label>
          <select id="ticket-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="ticket-description">Descrição e condições</label>
          <textarea id="ticket-description" rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explique o que está incluído, quantidade de pessoas, faixa etária ou condições de acesso." />
        </div>
        <div className="form-field">
          <label htmlFor="ticket-price">Preço por bilhete ({currency})</label>
          <input id="ticket-price" type="number" min="0" step="0.01" required value={basePrice} onChange={(event) => setBasePrice(event.target.value)} />
          <span className="form-help">Use 0 para bilhetes gratuitos.</span>
        </div>
        <div className="form-field">
          <label htmlFor="ticket-quantity">Quantidade disponível *</label>
          <input id="ticket-quantity" type="number" required min="1" max="1000000" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="ticket-max-per-buyer">Limite por comprador *</label>
          <input id="ticket-max-per-buyer" type="number" required min="1" max="1000000" value={maxPerBuyer} onChange={(event) => setMaxPerBuyer(event.target.value)} />
        </div>
        <label>
          <input type="checkbox" checked={requiresIdentity} onChange={(event) => setRequiresIdentity(event.target.checked)} />
          {" "}Pedir identificação do titular
        </label>
        <button className="button button-secondary" type="submit" disabled={typeBusy || sessions.length !== 1}>
          {typeBusy ? "A publicar…" : "Publicar bilhete e iniciar venda"}
        </button>
      </form>

      {ticketTypes.map((ticketType) => {
        const hasOpenSales = ticketType.batches.some((batch) => batch.status !== "CLOSED");
        return hasOpenSales ? (
          <button
            key={`finish-${ticketType.id}`}
            className="button button-secondary"
            type="button"
            disabled={closingBatchId === ticketType.id}
            onClick={() => finishSales(ticketType.id)}
          >
            {closingBatchId === ticketType.id ? "A terminar…" : `Terminar vendas: ${ticketType.name}`}
          </button>
        ) : null;
      })}
    </section>
  );
}

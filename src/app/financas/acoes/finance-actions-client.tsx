"use client";

import { useState } from "react";

// ============================================================
// Ações financeiras (FINANCE_MANAGER) — cliente mínimo.
// O servidor valida permissões e dupla aprovação; aqui apenas
// recolhemos o período e mostramos o resultado. Valores nunca
// são calculados no browser.
// ============================================================

export default function FinanceActionsPage() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [periodStart, setPeriodStart] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(today.toISOString().slice(0, 10));
  const [settlementId, setSettlementId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function call(path: string, body: unknown, okMsg: string) {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string; settlement?: { id: string } };
      if (!res.ok) {
        setError(data.message ?? "Ação recusada pelo servidor.");
        return null;
      }
      setMessage(okMsg);
      return data;
    } catch {
      setError("Erro de rede. Tente novamente.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function prepare() {
    const data = await call(
      "/api/finance/settlements/prepare",
      { periodStart, periodEnd },
      "Liquidação preparada. Aguarda dupla aprovação."
    );
    if (data?.settlement?.id) setSettlementId(data.settlement.id);
  }

  async function approve(decision: "APPROVE" | "REJECT") {
    if (!settlementId) {
      setError("Indique o ID da liquidação (ou prepare uma primeiro).");
      return;
    }
    await call(
      "/api/finance/settlements/decide",
      { settlementId, decision },
      decision === "APPROVE" ? "Liquidação aprovada (dupla aprovação registada)." : "Liquidação rejeitada."
    );
  }

  async function markPaid() {
    if (!settlementId) {
      setError("Indique o ID da liquidação.");
      return;
    }
    await call(
      "/api/finance/settlements/paid",
      { settlementId },
      "Liquidação marcada como paga."
    );
  }

  return (
    <>
      <main className="container" style={{ padding: "45px 0 70px", maxWidth: 560 }}>
        <span className="section-kicker">AÇÕES FINANCEIRAS</span>
        <h1 style={{ margin: "9px 0 22px", fontSize: "clamp(30px,4vw,42px)", letterSpacing: "-.05em" }}>
          Liquidações
        </h1>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {message ? <div className="form-success" role="status">{message}</div> : null}

        <div className="panel">
          <h2>Preparar liquidação do período</h2>
          <div className="form-field">
            <label htmlFor="start">Início do período</label>
            <input id="start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="end">Fim do período</label>
            <input id="end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <button className="button button-primary" style={{ width: "100%" }} onClick={prepare} disabled={loading}>
            {loading ? "A calcular no servidor…" : "Preparar liquidação"}
          </button>
          <p className="form-help" style={{ marginTop: 8 }}>
            Bruto, comissão, taxas, reembolsos e reservas são agregados pelo
            servidor a partir da base de dados.
          </p>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h2>Decidir liquidação</h2>
          <div className="form-field">
            <label htmlFor="settlementId">ID da liquidação</label>
            <input
              id="settlementId"
              value={settlementId}
              onChange={(e) => setSettlementId(e.target.value)}
              placeholder="Cole o ID devolvido na preparação"
            />
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <button className="button button-primary" onClick={() => approve("APPROVE")} disabled={loading}>
              Aprovar (dupla aprovação)
            </button>
            <button className="button button-secondary" onClick={() => approve("REJECT")} disabled={loading}>
              Rejeitar
            </button>
            <button className="button button-lime" onClick={markPaid} disabled={loading}>
              Marcar como paga
            </button>
          </div>
          <p className="form-help" style={{ marginTop: 10 }}>
            Quem prepara não pode aprovar — o servidor recusa (dupla aprovação).
          </p>
        </div>
      </main>
    </>
  );
}

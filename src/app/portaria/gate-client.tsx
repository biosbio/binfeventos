"use client";

import { useState } from "react";
import Link from "next/link";

// ============================================================
// Portaria — leitor de QR (com validador autenticado com
// access:validate). O token lido vai SEMPRE ao servidor; nada
// é decidido offline (SEC-18). Sem câmara no MVP: colar/ler
// o token apresentado no bilhete impresso ou ecrã.
// ============================================================

interface ValidationResult {
  allowed: boolean;
  reason?: string;
  action?: string;
  holder?: string;
  ticketNumber?: string;
}

const REASONS: Record<string, string> = {
  INVALID_QR: "QR inválido, expirado ou revogado",
  ALREADY_USED: "Bilhete já utilizado",
  WRONG_SESSION: "Bilhete de outra sessão",
  TICKET_CANCELLED: "Bilhete cancelado",
  TICKET_REVOKED: "Bilhete revogado",
  IDENTITY_MISMATCH: "Identidade não conferida",
  NOT_EVENT_DAY: "Fora do horário de abertura",
  GATE_CLOSED: "Porta encerrada",
};

export default function GatePage() {
  const [gateCode, setGateCode] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [identityVerified, setIdentityVerified] = useState(true);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function validate(e: React.FormEvent) {
    e.preventDefault();
    if (!gateCode || !qrToken) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/access/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateCode, qrToken, identityVerified }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Validação recusada.");
        return;
      }
      setResult(data);
      if (data.allowed) setQrToken("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ padding: "45px 0 70px", maxWidth: 520 }}>
        <span className="section-kicker">PORTARIA</span>
        <h1 style={{ margin: "9px 0 22px", fontSize: "clamp(30px,4vw,42px)", letterSpacing: "-.05em" }}>
          Controlo de acesso
        </h1>

        <p className="section-copy" style={{ maxWidth: "none" }}>
          Validação 100% online: cada QR é conferido no servidor, com registo
          de entrada, saída e recusa. <Link className="text-link" href="/login">Entrar</Link> com
          conta de validador.
        </p>

        {error ? <div className="form-error" role="alert" style={{ marginTop: 18 }}>{error}</div> : null}

        {result ? (
          <div
            className={result.allowed ? "form-success" : "form-error"}
            role="status"
            style={{ marginTop: 18, fontSize: 14 }}
          >
            {result.allowed
              ? `✓ ${result.action === "EXIT_RECORDED" ? "Saída registada" : "Entrada autorizada"} — ${result.holder ?? ""} ${result.ticketNumber ? `(${result.ticketNumber})` : ""}`
              : `✗ RECUSADO — ${REASONS[result.reason ?? ""] ?? result.reason}`}
          </div>
        ) : null}

        <form onSubmit={validate} className="panel" style={{ marginTop: 20 }}>
          <div className="form-field">
            <label htmlFor="gate">Código da porta</label>
            <input
              id="gate"
              placeholder="Ex: PORTA-A"
              value={gateCode}
              onChange={(e) => setGateCode(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="qr">QR / token apresentado</label>
            <textarea
              id="qr"
              rows={3}
              placeholder="Leia ou cole o token do bilhete"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={identityVerified}
                onChange={(e) => setIdentityVerified(e.target.checked)}
              />
              Identidade do titular conferida
            </label>
          </div>
          <button className="button button-primary" style={{ width: "100%" }} type="submit" disabled={loading}>
            {loading ? "A validar no servidor…" : "Validar"}
          </button>
        </form>
    </main>
  );
}
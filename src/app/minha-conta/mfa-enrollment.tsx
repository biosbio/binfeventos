"use client";

import { useState } from "react";
import Link from "next/link";

export default function MfaEnrollment({ initiallyEnabled, adminAccessPending = false }: { initiallyEnabled: boolean; adminAccessPending?: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [adminReady, setAdminReady] = useState(adminAccessPending && !initiallyEnabled);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function begin() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/users/mfa/setup", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error("A API de MFA devolveu uma resposta inválida. Reinicie o servidor e tente novamente.");
      if (!response.ok) throw new Error(data.message ?? "Não foi possível iniciar a configuração MFA.");
      setSecret(data.secret);
      setNotice("Adicione este segredo na sua aplicação autenticadora e confirme com o código de 6 dígitos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar configuração MFA.");
    } finally { setBusy(false); }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/users/mfa/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ totpCode: code }),
      });
      const data = await response.json().catch(() => null);
      if (!data) throw new Error("A API de MFA devolveu uma resposta inválida. Reinicie o servidor e tente novamente.");
      if (!response.ok) throw new Error(data.message ?? "Código MFA inválido.");
      setEnabled(true); setSecret(""); setCode(""); setAdminReady(false);
      setNotice(adminReady ? "MFA ativado. O seu acesso de administrador está pronto." : "MFA ativado com sucesso.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao confirmar o código MFA.");
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{ marginTop: 24, padding: 20 }}>
    <h2 style={{ margin: 0 }}>Segurança da conta</h2>
    <p className="form-help" style={{ marginTop: 8 }}>
      {enabled ? "Autenticação MFA ativa." : adminReady ? "Um administrador designou esta conta. Configure o MFA para ativar o acesso à administração central." : "Ative MFA antes de receber acesso à administração central."}
    </p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="form-success" role="status">{notice}</p> : null}
    {enabled && !adminReady && adminAccessPending ? <Link className="button button-primary" href="/admin">Abrir administração</Link> : null}
    {!enabled && !secret ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void begin()}>{busy ? "A iniciar…" : "Configurar MFA"}</button> : null}
    {!enabled && secret ? <form className="admin-user-edit" onSubmit={confirm}>
      <label className="form-field"><span>Segredo para inserir manualmente na aplicação autenticadora</span><input readOnly value={secret} onFocus={(event) => event.currentTarget.select()} /></label>
      <label className="form-field"><span>Código de confirmação</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "A confirmar…" : "Ativar MFA"}</button>
    </form> : null}
  </section>;
}

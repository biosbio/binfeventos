"use client";

import { useState } from "react";
import Link from "next/link";

export default function PanelAuthForm({ isAdmin }: { isAdmin: boolean }) {
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requestCode() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/users/panel-auth-start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível enviar o código.");
      setSent(true); setNotice("Código enviado. Verifique a sua caixa de entrada ou mensagens SMS.");
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao enviar código."); }
    finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = isAdmin ? { password, totpCode } : { code };
      const response = await fetch("/api/users/panel-auth-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível validar.");
      window.location.href = isAdmin ? "/admin" : "/painel";
    } catch (e) { setError(e instanceof Error ? e.message : "Erro de validação."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <span className="brand"><span className="brand-mark">B</span> BINF EVENTOS</span>
        <h1>{isAdmin ? "Confirmar acesso administrativo" : "Validar acesso do organizador"}</h1>
        <p>{isAdmin
          ? "Por segurança, confirme novamente a sua password e o código da aplicação autenticadora."
          : "Para abrir o painel, confirme a sua identidade através de um código de 6 dígitos enviado por email ou SMS."}</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {notice ? <div className="form-help" role="status">{notice}</div> : null}
        {isAdmin ? (
          <form onSubmit={verify}>
            <div className="form-field"><label htmlFor="panel-password">Password</label><input id="panel-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <div className="form-field"><label htmlFor="panel-totp">Código MFA (TOTP)</label><input id="panel-totp" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0,6))} /></div>
            <button className="button button-primary" disabled={busy}>{busy ? "A validar…" : "Confirmar e abrir administração"}</button>
          </form>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="panel-channel">Receber código por</label>
              <select id="panel-channel" value={channel} onChange={e => { setChannel(e.target.value as "EMAIL" | "SMS"); setSent(false); }}>
                <option value="EMAIL">Email</option><option value="SMS">SMS</option>
              </select>
            </div>
            <button type="button" className="button button-secondary" onClick={requestCode} disabled={busy}>{busy ? "A enviar…" : sent ? "Reenviar código" : "Enviar código"}</button>
            {sent ? <form onSubmit={verify}>
              <div className="form-field"><label htmlFor="panel-code">Código de 6 dígitos</label><input id="panel-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0,6))} /></div>
              <button className="button button-primary" disabled={busy || code.length !== 6}>{busy ? "A validar…" : "Validar e abrir painel"}</button>
            </form> : null}
          </>
        )}
        <p className="auth-switch"><Link href="/">Voltar à área pública</Link></p>
      </section>
    </main>
  );
}

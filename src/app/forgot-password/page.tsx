"use client";

import Link from "next/link";
import { useState } from "react";

type Method = "EMAIL" | "SMS" | "TOTP";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<Method>("EMAIL");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requestCode() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (method === "TOTP") {
        setReady(true);
        setNotice("Introduza o código atual da aplicação autenticadora do administrador.");
        return;
      }
      const response = await fetch("/api/users/password-recovery-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, channel: method }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível solicitar a recuperação.");
      setReady(true);
      setNotice(data.message ?? "Se a conta for elegível, receberá um código.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao solicitar recuperação.");
    } finally { setBusy(false); }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/users/password-recovery-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          newPassword,
          ...(method === "TOTP" ? { totpCode: code } : { code }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível atualizar a password.");
      setCompleted(true);
      setNotice("Password atualizada. Todas as sessões anteriores foram terminadas.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao confirmar recuperação.");
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <section className="auth-card">
        <span className="brand"><span className="brand-mark">B</span> BINF EVENTOS</span>
        <h1>Recuperar password</h1>
        <p>Confirme a sua identidade usando um contacto já associado à conta ou a aplicação autenticadora do administrador.</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {notice ? <div className="form-success" role="status">{notice}</div> : null}
        {completed ? (
          <Link className="button button-primary" href="/login">Voltar ao login</Link>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="recovery-email">Email cadastrado</label>
              <input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setReady(false); }} />
            </div>
            <div className="form-field">
              <label htmlFor="recovery-method">Método de confirmação</label>
              <select id="recovery-method" value={method} onChange={e => { setMethod(e.target.value as Method); setReady(false); setCode(""); setNotice(""); }}>
                <option value="EMAIL">Email cadastrado (organizador ou utilizador)</option>
                <option value="SMS">Telemóvel cadastrado (utilizador comum)</option>
                <option value="TOTP">Aplicação autenticadora (administrador)</option>
              </select>
            </div>
            {!ready ? (
              <button className="button button-primary" type="button" disabled={busy || !email} onClick={requestCode}>{busy ? "A processar…" : method === "TOTP" ? "Continuar com MFA" : "Enviar código"}</button>
            ) : (
              <form onSubmit={confirm}>
                <div className="form-field">
                  <label htmlFor="recovery-code">{method === "TOTP" ? "Código MFA (6 dígitos)" : "Código recebido (6 dígitos)"}</label>
                  <input id="recovery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
                <div className="form-field">
                  <label htmlFor="new-password">Nova password</label>
                  <input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  <span className="form-help">Mínimo de 12 caracteres, com maiúscula, minúscula e número.</span>
                </div>
                <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "A atualizar…" : "Confirmar e alterar password"}</button>
              </form>
            )}
          </>
        )}
        <p className="auth-switch"><Link href="/login">Voltar ao login</Link></p>
      </section>
    </div>
  );
}

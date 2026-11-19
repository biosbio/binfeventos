"use client";

import Link from "next/link";
import BrandLogo from "../_components/brand-logo";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [methods, setMethods] = useState<string[] | null>(null);
  const [requireTotp, setRequireTotp] = useState(false);
  const [code, setCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function findMethods() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/users/password-recovery-options", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível continuar.");
      setMethods(data.methods as string[]);
      setRequireTotp(Boolean(data.requireTotp));
      setReady(false); setCode(""); setTotpCode("");
      if (data.requireTotp) setNotice("Esta conta recupera o acesso apenas com a aplicação autenticadora.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar métodos de recuperação.");
    } finally { setBusy(false); }
  }

  async function requestCode() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (requireTotp) {
        setReady(true);
        setNotice("Introduza o código atual da aplicação autenticadora do administrador.");
        return;
      }
      const response = await fetch("/api/users/password-recovery-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
          ...(requireTotp ? { totpCode } : { code }),
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
        <span className="brand"><BrandLogo /></span>
        <h1>Recuperar password</h1>
        <p>Utilizadores e organizadores recebem um código por email. Administradores confirmam com a aplicação autenticadora.</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {notice ? <div className="form-success" role="status">{notice}</div> : null}
        {completed ? (
          <Link className="button button-primary" href="/login">Voltar ao login</Link>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="recovery-email">Email cadastrado</label>
              <input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setMethods(null); setRequireTotp(false); setReady(false); }} />
            </div>
            {!methods ? (
              <button className="button button-primary" type="button" disabled={busy || !email} onClick={findMethods}>{busy ? "A verificar…" : "Continuar"}</button>
            ) : (
              <>
                {!ready ? (
                  <button className="button button-primary" type="button" disabled={busy} onClick={requestCode}>{busy ? "A processar…" : requireTotp ? "Continuar com MFA" : "Enviar código por email"}</button>
                ) : <form onSubmit={confirm}>
                {requireTotp ? <div className="form-field">
                  <label htmlFor="recovery-totp">Código MFA da aplicação autenticadora</label>
                  <input id="recovery-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div> : <div className="form-field">
                  <label htmlFor="recovery-code">Código enviado por email</label>
                  <input id="recovery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>}
                <div className="form-field">
                  <label htmlFor="new-password">Nova password</label>
                  <input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                  <span className="form-help">{requireTotp ? "Administrador: mínimo de 9 caracteres, com maiúscula, minúscula, número e símbolo." : "Mínimo de 12 caracteres, com maiúscula, minúscula e número."}</span>
                </div>
                <button className="button button-primary" type="submit" disabled={busy || (requireTotp ? totpCode.length !== 6 : code.length !== 6)}>{busy ? "A atualizar…" : "Confirmar e alterar password"}</button>
                </form>}
              </>
            )}
          </>
        )}
        <p className="auth-switch"><Link href="/login">Voltar ao login</Link></p>
      </section>
    </div>
  );
}

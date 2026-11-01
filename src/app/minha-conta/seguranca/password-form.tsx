"use client";

import { useState } from "react";
import Link from "next/link";

export default function ChangePasswordForm({ isAdmin }: { isAdmin: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("A confirmação da nova password não coincide.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/users/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, ...(isAdmin ? { totpCode } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível alterar a password.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alterar a password.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="panel">
        <p className="form-success">Password alterada. Por segurança, todas as sessões foram terminadas.</p>
        <Link className="button button-primary" href="/login">Entrar novamente</Link>
      </div>
    );
  }

  return (
    <form className="panel account-password-form" onSubmit={submit}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-field">
        <label htmlFor="current-password">Password atual</label>
        <input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="new-password">Nova password</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        <span className="form-help">Mínimo de 12 caracteres, com maiúscula, minúscula e número.</span>
      </div>
      <div className="form-field">
        <label htmlFor="confirm-password">Confirmar nova password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
      </div>
      {isAdmin ? (
        <div className="form-field">
          <label htmlFor="admin-totp">Código MFA da aplicação autenticadora</label>
          <input id="admin-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>
      ) : null}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "A atualizar…" : "Alterar password"}</button>
    </form>
  );
}

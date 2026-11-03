"use client";

import { useState } from "react";
import Link from "next/link";
import BrandLogo from "../_components/brand-logo";

export default function PanelAuthForm({ isAdmin, nextPath }: { isAdmin: boolean; nextPath: string }) {
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const payload = isAdmin ? { password, totpCode } : { password };
      const response = await fetch("/api/users/panel-auth-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Não foi possível validar.");
      window.location.href = nextPath;
    } catch (e) { setError(e instanceof Error ? e.message : "Erro de validação."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <span className="brand"><BrandLogo /></span>
        <h1>{isAdmin ? "Confirmar acesso administrativo" : "Validar acesso do organizador"}</h1>
        <p>{isAdmin
          ? "Por segurança, confirme novamente a sua password e o código da aplicação autenticadora."
          : "Confirme a sua password para abrir o painel e gerir os eventos da sua organização."}</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <form onSubmit={verify}>
          <div className="form-field"><label htmlFor="panel-password">Password</label><input id="panel-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          {isAdmin ? (
            <>
            <div className="form-field"><label htmlFor="panel-totp">Código MFA (TOTP)</label><input id="panel-totp" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0,6))} /></div>
            </>
          ) : null}
          <button className="button button-primary" disabled={busy}>{busy ? "A validar…" : isAdmin ? "Confirmar e abrir administração" : "Confirmar e abrir painel"}</button>
        </form>
        <p className="auth-switch"><Link href="/">Voltar à área pública</Link></p>
      </section>
    </main>
  );
}

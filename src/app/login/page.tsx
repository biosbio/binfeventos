"use client";

import { useState } from "react";
import Link from "next/link";

// ============================================================
// Login — cliente mínimo: envia apenas email/password (+TOTP).
// A password NÃO é persistida no browser (sem localStorage).
// O backend responde com cookie HttpOnly de sessão.
// ============================================================

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }),
      });
      const data = (await res.json()) as { code?: string; message?: string };
      if (!res.ok) {
        if (data.message?.includes("MFA")) setNeedsMfa(true);
        setError(data.message ?? "Não foi possível entrar.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <span className="brand" aria-hidden="true">
          <span className="brand-mark">B</span> BINF EVENTOS
        </span>
        <h1>Bem-vindo de volta</h1>
        <p>Entre para comprar bilhetes, gerir os seus lugares e acompanhar os seus eventos.</p>

        {error ? <div className="form-error" role="alert">{error}</div> : null}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="form-help">
              Nunca guardamos a sua password no navegador — a sessão vive num
              cookie HttpOnly protegido.
            </span>
          </div>

          {needsMfa ? (
            <div className="form-field">
              <label htmlFor="totp">Código MFA (6 dígitos)</label>
              <input
                id="totp"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          ) : null}

          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? "A entrar…" : "Entrar"}
          </button>
        </form>

        <p className="auth-switch">
          Ainda não tem conta? <Link href="/register">Criar conta grátis</Link>
        </p>
      </div>
    </div>
  );
}
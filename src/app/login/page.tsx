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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // FormData lê os valores reais dos controlos, incluindo autofill
    // do navegador que pode não disparar onChange no React.
    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get("email") ?? "").trim();
    const submittedPassword = String(formData.get("password") ?? "");
    const submittedTotp = String(formData.get("totpCode") ?? "").replace(/\D/g, "");

    try {
      const res = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: submittedEmail,
          password: submittedPassword,
          ...(submittedTotp ? { totpCode: submittedTotp } : {}),
        }),
      });
      const data = (await res.json()) as { code?: string; message?: string };
      if (!res.ok) {
        if (data.code === "MFA_REQUIRED" || data.message?.includes("MFA")) {
          setNeedsMfa(true);
        }
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
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
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
            <p className="form-help"><Link href="/forgot-password">Esqueceu-se da password?</Link></p>
          </div>

          {needsMfa ? (
            <div className="form-field">
              <label htmlFor="totp">Código MFA (6 dígitos)</label>
              <input
                id="totp"
                name="totpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\\d{6}"
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

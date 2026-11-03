"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandLogo from "../_components/brand-logo";

// ============================================================
// Registo — cliente mínimo. A validação forte (password 12+,
// maiúscula, minúscula, número) é SEMPRE no servidor (SEC-09);
// o aviso aqui é apenas de conveniência.
// ============================================================

export default function RegisterForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, phone, password }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Não foi possível criar a conta.");
        return;
      }
      router.push(`/register/confirmation?next=${encodeURIComponent(nextPath)}`);
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
          <BrandLogo />
        </span>
        <h1>Criar conta</h1>
        <p>Compre bilhetes, guarde os seus lugares e receba os bilhetes digitais no seu email.</p>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="fullName">Nome completo</label>
            <input
              id="fullName"
              required
              minLength={3}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="phone">Telemóvel</label>
            <input
              id="phone"
              type="tel"
              required
              minLength={7}
              maxLength={16}
              pattern="[+][1-9][0-9]{7,14}"
              autoComplete="tel"
              placeholder="+2459XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <span className="form-help">Obrigatório para recuperação da conta por SMS.</span>
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="form-help">
              Pelo menos 12 caracteres, com uma maiúscula, uma minúscula e um
              número. A verificação final é feita no servidor.
            </span>
          </div>

          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? "A criar conta…" : "Criar conta"}
          </button>
        </form>

        <p className="auth-switch">
          Já tem conta? <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>Entrar</Link>
        </p>
      </div>
    </div>
  );
}
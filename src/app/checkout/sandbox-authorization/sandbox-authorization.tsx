"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SandboxAuthorization({ providerRef }: { providerRef: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function authorize() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/payments/sandbox/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerRef }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível simular o pagamento.");
        return;
      }
      router.push(`/checkout/return?order=${encodeURIComponent(data.orderId)}`);
    } catch {
      setError("Erro de rede ao simular o pagamento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel checkout-panel">
      <span className="section-kicker">AMBIENTE DE DESENVOLVIMENTO</span>
      <h2>Simular pagamento</h2>
      <p className="form-help">Esta simulação confirma o pagamento de teste e não movimenta dinheiro real.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="button" disabled={busy} onClick={authorize}>
        {busy ? "A confirmar…" : "Confirmar pagamento de teste"}
      </button>
    </div>
  );
}

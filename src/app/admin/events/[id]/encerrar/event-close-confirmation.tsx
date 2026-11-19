"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EventCloseConfirmation({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "COMPLETED", totpCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível encerrar o evento.");
        return;
      }
      router.push("/admin/events?estado=completed");
      router.refresh();
    } catch {
      setError("Erro de rede ao encerrar o evento. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel admin-user-edit" onSubmit={submit}>
      <label className="form-field" htmlFor="event-close-mfa">
        <span>Código MFA do administrador que está a encerrar o evento</span>
        <input
          id="event-close-mfa"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button className="button button-primary" type="submit" disabled={busy || totpCode.length !== 6}>
          {busy ? "A encerrar…" : "Confirmar encerramento"}
        </button>
      </div>
    </form>
  );
}

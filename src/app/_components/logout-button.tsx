"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/users/logout", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível terminar a sessão.");
      window.location.href = "/";
    } catch (error) {
      setBusy(false);
      window.alert(error instanceof Error ? error.message : "Erro ao terminar a sessão.");
    }
  }

  return (
    <button className="button logout-button" type="button" onClick={logout} disabled={busy}>
      {busy ? "A sair…" : "Sair"}
    </button>
  );
}

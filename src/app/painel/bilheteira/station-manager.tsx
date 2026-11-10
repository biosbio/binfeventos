"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EventOption = { id: string; name: string; sessions: { id: string; venueId: string | null; venue: { name: string; city: string | null } | null }[] };
type Station = { code: string; name: string; location: string | null; status: string; venueId: string | null; venue: { name: string } | null };

export default function StationManager({
  events,
  initialStations,
}: {
  events: EventOption[];
  initialStations: Station[];
}) {
  const router = useRouter();
  const selectableEvents = events.filter((event) => event.sessions.some((session) => session.venueId));
  const [name, setName] = useState("");
  const [eventId, setEventId] = useState(selectableEvents[0]?.id ?? "");
  const [venueId, setVenueId] = useState(selectableEvents[0]?.sessions.find((session) => session.venueId)?.venueId ?? "");
  const [location, setLocation] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function saveStation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(editingCode
        ? `/api/boxoffice/stations/${encodeURIComponent(editingCode)}`
        : "/api/boxoffice/stations", {
        method: editingCode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location, eventId, venueId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível criar o posto.");
        return;
      }
      setName("");
      setLocation("");
      setEditingCode(null);
      setMessage(editingCode ? "Posto atualizado." : "Posto criado.");
      router.refresh();
    } catch {
      setError("Erro de rede ao criar o posto.");
    } finally {
      setBusy(false);
    }
  }

  function editStation(station: Station) {
    const matchingEvent = selectableEvents.find((item) => item.sessions.some((session) => session.venueId === station.venueId));
    if (!matchingEvent) {
      setError("Este local já não está associado a uma sessão. Remova o posto e crie outro no local correto.");
      return;
    }
    setError("");
    setMessage("");
    setEditingCode(station.code);
    setName(station.name);
    setLocation(station.location ?? "");
    setEventId(matchingEvent.id);
    setVenueId(station.venueId ?? "");
  }

  function cancelEdit() {
    setEditingCode(null);
    setName("");
    setLocation("");
    setError("");
    setMessage("");
  }

  async function removeStation(station: Station) {
    if (!window.confirm(`Remover o posto “${station.name}”?`)) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/boxoffice/stations/${encodeURIComponent(station.code)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível remover o posto.");
        return;
      }
      if (editingCode === station.code) cancelEdit();
      setMessage("Posto removido.");
      router.refresh();
    } catch {
      setError("Erro de rede ao remover o posto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cashier-layout">
      <section className="cashier-card">
        <h2>{editingCode ? "Editar posto" : "Criar posto"}</h2>
        {selectableEvents.length === 0 ? (
          <p className="form-help">Defina primeiro o local numa sessão do evento. Depois, crie aqui um posto para esse evento e local.</p>
        ) : (
          <form className="cashier-form" onSubmit={saveStation}>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {message ? <p className="form-success" role="status">{message}</p> : null}
            <label className="cashier-field">
              <span>Nome do posto</span>
              <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} placeholder="Ex.: Bilheteira principal" required />
            </label>
            <label className="cashier-field">
              <span>Evento</span>
              <select value={eventId} onChange={(inputEvent) => {
                const nextEventId = inputEvent.target.value;
                setEventId(nextEventId);
                const linkedVenueId = selectableEvents.find((item) => item.id === nextEventId)?.sessions.find((session) => session.venueId)?.venueId;
                setVenueId(linkedVenueId ?? "");
              }} required>
                {selectableEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
              </select>
            </label>
            <label className="cashier-field">
              <span>Local do posto</span>
              <input value={location} onChange={(inputEvent) => setLocation(inputEvent.target.value)} minLength={2} maxLength={120} placeholder="Ex.: Entrada principal, portão norte" required />
            </label>
            <div className="cashier-station-form-actions">
              <button className="button button-primary" type="submit" disabled={busy}>{busy ? "A guardar…" : editingCode ? "Guardar alterações" : "Criar posto"}</button>
              {editingCode ? <button className="button button-secondary" type="button" disabled={busy} onClick={cancelEdit}>Cancelar</button> : null}
            </div>
          </form>
        )}
      </section>
      <section className="cashier-card">
        <h2>Postos configurados</h2>
        {initialStations.length === 0 ? <p className="form-help">Ainda não há postos de bilheteira.</p> : (
          <ul className="cashier-station-list">
            {initialStations.map((station) => (
              <li key={station.code}>
                <div className="cashier-station-details"><strong>{station.name}</strong><small>{station.location || "Local não indicado"}</small></div>
                <div className="cashier-station-actions">
                  <button className="cashier-icon-button" type="button" title={`Editar ${station.name}`} aria-label={`Editar ${station.name}`} disabled={busy} onClick={() => editStation(station)}>✎</button>
                  <button className="cashier-icon-button cashier-icon-button-danger" type="button" title={`Remover ${station.name}`} aria-label={`Remover ${station.name}`} disabled={busy} onClick={() => removeStation(station)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

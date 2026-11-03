"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function makeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nextCalendarDate(value: string): string | undefined {
  if (!value) return undefined;
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

type CountryOption = { code: string; name: string };

export default function PlatformEventForm({ countryOptions, currency }: { countryOptions: CountryOption[]; currency: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [eventDuration, setEventDuration] = useState<"one-day" | "multiple-days">("one-day");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueCountry, setVenueCountry] = useState("AO");
  const [normalTicketPrice, setNormalTicketPrice] = useState("");
  const [normalTicketQuantity, setNormalTicketQuantity] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let coverImageUrl: string | undefined;
      if (coverFile) {
        const upload = new FormData();
        upload.set("file", coverFile);
        const uploadResponse = await fetch("/api/events/upload-cover", { method: "POST", body: upload });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          setError(uploadData.message ?? "Não foi possível carregar a imagem.");
          return;
        }
        coverImageUrl = uploadData.url;
      }

      const response = await fetch("/api/events/platform-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
          category,
          normalTicket: {
            basePriceCents: Math.round(Number(normalTicketPrice) * 100),
            quantity: Number(normalTicketQuantity),
          },
          coverImageUrl,
          venue: {
            name: venueName,
            address: venueAddress || undefined,
            city: venueCity,
            country: venueCountry,
          },
          startsAt: new Date(`${startsAt}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${eventDuration === "one-day" ? startsAt : endsAt}T23:59:59.999Z`).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível criar o evento.");
        return;
      }
      router.push("/admin/events");
      router.refresh();
    } catch {
      setError("Erro de rede ao criar o evento. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 760 }}>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <form className="event-create-form" onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="platform-event-name">Nome do evento *</label>
          <input id="platform-event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(makeSlug(e.target.value));
          }} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-slug">Endereço web (opcional)</label>
          <input id="platform-event-slug" minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => {
            setSlugEdited(true);
            setSlug(makeSlug(e.target.value));
          }} />
          <span className="form-help">Se ficar vazio, será gerado a partir do nome.</span>
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-category">Categoria</label>
          <select id="platform-event-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="CONCERT">Concerto</option>
            <option value="CONFERENCE">Conferência</option>
            <option value="SPORT">Desporto</option>
            <option value="THEATER">Teatro</option>
            <option value="FESTIVAL">Festival</option>
            <option value="WORKSHOP">Workshop</option>
            <option value="OTHER">Outro</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-description">Descrição</label>
          <textarea id="platform-event-description" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-cover">Imagem de capa (JPEG, PNG ou WebP, até 5 MB)</label>
          <input id="platform-event-cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
        </div>
        <fieldset className="form-field">
          <legend>Duração do evento *</legend>
          <label>
            <input type="radio" name="platform-event-duration" checked={eventDuration === "one-day"} onChange={() => setEventDuration("one-day")} />
            {" "}Um dia
          </label>
          <label>
            <input type="radio" name="platform-event-duration" checked={eventDuration === "multiple-days"} onChange={() => setEventDuration("multiple-days")} />
            {" "}Vários dias
          </label>
          <label htmlFor="platform-event-start">{eventDuration === "one-day" ? "Data do evento *" : "Data de início *"}</label>
          <input id="platform-event-start" type="date" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          {eventDuration === "multiple-days" ? (
            <>
              <label htmlFor="platform-event-end">Data de fim *</label>
              <input id="platform-event-end" type="date" required min={nextCalendarDate(startsAt)} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </>
          ) : null}
        </fieldset>
        <h2>Local do evento</h2>
        <div className="form-field">
          <label htmlFor="platform-venue-name">Nome do local *</label>
          <input id="platform-venue-name" required minLength={2} maxLength={150} value={venueName} onChange={(event) => setVenueName(event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-venue-address">Endereço</label>
          <input id="platform-venue-address" maxLength={300} value={venueAddress} onChange={(event) => setVenueAddress(event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-venue-city">Cidade *</label>
          <input id="platform-venue-city" required minLength={2} maxLength={100} value={venueCity} onChange={(event) => setVenueCity(event.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-venue-country">País *</label>
          <select id="platform-venue-country" required value={venueCountry} onChange={(event) => setVenueCountry(event.target.value)}>
            {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
          </select>
        </div>
        <h2>Bilhete normal</h2>
        <p className="form-help">O bilhete normal será criado junto com o evento. Moeda da organização central: {currency}.</p>
        <div className="event-create-ticket-grid">
          <div className="form-field">
            <label htmlFor="platform-ticket-price">Preço do bilhete ({currency}) *</label>
            <input id="platform-ticket-price" type="number" required min="0" max="1000000" step="0.01" value={normalTicketPrice} onChange={(event) => setNormalTicketPrice(event.target.value)} />
            <span className="form-help">Use 0 para entrada gratuita.</span>
          </div>
          <div className="form-field">
            <label htmlFor="platform-ticket-quantity">Quantidade disponível *</label>
            <input id="platform-ticket-quantity" type="number" required min="1" max="1000000" step="1" value={normalTicketQuantity} onChange={(event) => setNormalTicketQuantity(event.target.value)} />
          </div>
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "A criar evento…" : "Criar rascunho"}
        </button>
      </form>
    </section>
  );
}

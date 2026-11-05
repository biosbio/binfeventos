"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandLogo from "../../../_components/brand-logo";

function makeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nextCalendarDate(value: string): string | undefined {
  if (!value) return undefined;
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

type Option = { code: string; name: string };

export default function NewEventForm({
  needsOrganization,
  initialCountry,
  initialCurrency,
  countryOptions,
  currencyOptions,
}: {
  needsOrganization: boolean;
  initialCountry: string;
  initialCurrency: string;
  countryOptions: Option[];
  currencyOptions: Option[];
}) {
  const router = useRouter();
  const [organizationReady, setOrganizationReady] = useState(!needsOrganization);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [organizationSlugEdited, setOrganizationSlugEdited] = useState(false);
  const [organizationCountry, setOrganizationCountry] = useState(initialCountry);
  const [organizationCurrency, setOrganizationCurrency] = useState(initialCurrency);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [additionalOrganizerLimit, setAdditionalOrganizerLimit] = useState("1");
  const [eventDuration, setEventDuration] = useState<"one-day" | "multiple-days">("one-day");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueCountry, setVenueCountry] = useState(initialCountry);
  const [normalTicketPrice, setNormalTicketPrice] = useState("");
  const [normalTicketQuantity, setNormalTicketQuantity] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!organizationReady) {
        const organizationResponse = await fetch("/api/organizations/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: organizationName,
            slug: organizationSlug,
            country: organizationCountry,
            currency: organizationCurrency,
            password,
          }),
        });
        const organizationData = await organizationResponse.json();
        if (!organizationResponse.ok) {
          setError(organizationData.message ?? "Não foi possível iniciar o perfil de organização.");
          return;
        }
        setOrganizationReady(true);
      }

      let uploadedCoverUrl: string | undefined;
      if (coverFile) {
        const upload = new FormData();
        upload.set("file", coverFile);
        const uploadResponse = await fetch("/api/events/upload-cover", { method: "POST", body: upload });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          setError(uploadData.message ?? "Não foi possível carregar a imagem.");
          return;
        }
        uploadedCoverUrl = uploadData.url;
      }

      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
          category,
          additionalOrganizerLimit: Number(additionalOrganizerLimit),
          normalTicket: {
            basePriceCents: Math.round(Number(normalTicketPrice) * 100),
            quantity: Number(normalTicketQuantity),
          },
          coverImageUrl: uploadedCoverUrl,
          venue: {
            name: venueName,
            address: venueAddress || undefined,
            city: venueCity,
            country: venueCountry,
          },
          startsAt: new Date(`${eventStartDate}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${eventDuration === "one-day" ? eventStartDate : eventEndDate}T23:59:59.999Z`).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Não foi possível submeter o evento.");
        return;
      }
      router.push(`/painel/eventos/${data.event.id}`);
      router.refresh();
    } catch {
      setError("Erro de rede ao submeter o evento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="site-header event-create-header"><Link className="brand" href="/"><BrandLogo /></Link><Link className="button button-secondary" href="/painel">Voltar ao painel</Link></header>
      <main className="event-create-page">
        <div className="event-create-container">
          <Link className="event-back-link" href="/painel">← Voltar ao painel</Link>
          <div className="event-create-layout">
            <section className="event-create-intro">
              <span className="section-kicker">BINF EVENTOS · ORGANIZADORES</span>
              <h1>Vamos dar vida ao seu evento.</h1>
              <p>Apresente os dados principais. A equipa BINF EVENTOS irá analisar a proposta; o evento só ficará público depois de aprovado.</p>
              <div className="approval-note">
                <span className="approval-icon">✓</span>
                <div><strong>Publicação sujeita a aprovação</strong><p>A proposta fica privada enquanto estiver em análise. Só a equipa BINF EVENTOS pode aprovar a publicação.</p></div>
              </div>
              {!organizationReady ? (
                <p className="form-help">Como esta conta ainda não tem uma organização, primeiro vamos criar esse perfil. Confirme a sua password para ativar o acesso ao painel.</p>
              ) : null}
              <div className="event-create-steps">
                <div><span>01</span><p><strong>Submeta</strong><small>Indique as informações do evento.</small></p></div>
                <div><span>02</span><p><strong>Análise</strong><small>A equipa responsável verifica os dados.</small></p></div>
                <div><span>03</span><p><strong>Publicação</strong><small>Após aprovação, poderá avançar.</small></p></div>
              </div>
            </section>

            <section className="event-create-card">
              <div className="event-create-card-heading">
                <span>FORMULÁRIO DE SUBMISSÃO</span>
                <h2>Informações do evento</h2>
                <p>Os campos assinalados com * são obrigatórios.</p>
              </div>
              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <form onSubmit={handleSubmit} className="event-create-form">
                {!organizationReady ? (
                  <>
                    <div className="form-field">
                      <label htmlFor="organization-name">Nome da organização *</label>
                      <input id="organization-name" required minLength={3} maxLength={120} value={organizationName} onChange={(e) => {
                        setOrganizationName(e.target.value);
                        if (!organizationSlugEdited) setOrganizationSlug(makeSlug(e.target.value));
                      }} placeholder="Ex.: Associação Cultural de Bissau" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="organization-slug">Identificador da organização *</label>
                      <input id="organization-slug" required minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={organizationSlug} onChange={(e) => {
                        setOrganizationSlugEdited(true);
                        setOrganizationSlug(makeSlug(e.target.value));
                      }} placeholder="associacao-cultural-bissau" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="organization-country">País *</label>
                      <select id="organization-country" required value={organizationCountry} onChange={(e) => {
                        setOrganizationCountry(e.target.value);
                        setVenueCountry(e.target.value);
                      }}>
                        {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="organization-currency">Moeda *</label>
                      <select id="organization-currency" required value={organizationCurrency} onChange={(e) => setOrganizationCurrency(e.target.value)}>
                        {currencyOptions.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="organizer-password">Confirme a sua password *</label>
                      <input id="organizer-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                      <span className="form-help">Esta confirmação protege a criação do seu perfil de organização.</span>
                    </div>
                  </>
                ) : null}
                <div className="form-field">
                  <label htmlFor="event-name">Nome do evento *</label>
                  <input id="event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(makeSlug(e.target.value)); }} placeholder="Ex.: Festival de Música de Bissau" />
                </div>
                <div className="form-field">
                  <label htmlFor="event-slug">Endereço web (opcional)</label>
                  <input id="event-slug" minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => { setSlugEdited(true); setSlug(makeSlug(e.target.value)); }} placeholder="Gerado a partir do nome do evento" />
                  <span className="form-help">Se deixar vazio, será criado automaticamente a partir do nome do evento.</span>
                </div>
                <div className="form-field">
                  <label htmlFor="event-category">Categoria *</label>
                  <select id="event-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="CONCERT">Concerto</option><option value="CONFERENCE">Conferência</option><option value="SPORT">Desporto</option><option value="THEATER">Teatro</option><option value="FESTIVAL">Festival</option><option value="WORKSHOP">Workshop</option><option value="OTHER">Outro</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="event-additional-organizers">Organizadores adicionais *</label>
                  <select
                    id="event-additional-organizers"
                    value={additionalOrganizerLimit}
                    onChange={(event) => setAdditionalOrganizerLimit(event.target.value)}
                  >
                    <option value="1">1 organizador adicional</option>
                    <option value="2">2 organizadores adicionais</option>
                    <option value="3">3 organizadores adicionais</option>
                  </select>
                  <span className="form-help">Depois da criação, só você poderá aprovar os organizadores convidados. Vendedores e portaria não têm limite.</span>
                </div>
                <fieldset className="event-create-duration">
                  <legend>Duração do evento *</legend>
                  <div className="event-duration-options">
                  <label className={eventDuration === "one-day" ? "event-duration-option is-selected" : "event-duration-option"}>
                    <input
                      type="radio"
                      name="event-duration"
                      value="one-day"
                      checked={eventDuration === "one-day"}
                      onChange={() => setEventDuration("one-day")}
                    />
                    <span><strong>Um dia</strong><small>Escolher uma única data</small></span>
                  </label>
                  <label className={eventDuration === "multiple-days" ? "event-duration-option is-selected" : "event-duration-option"}>
                    <input
                      type="radio"
                      name="event-duration"
                      value="multiple-days"
                      checked={eventDuration === "multiple-days"}
                      onChange={() => setEventDuration("multiple-days")}
                    />
                    <span><strong>Vários dias</strong><small>Definir início e fim</small></span>
                  </label>
                  </div>
                </fieldset>
                <div className="form-field">
                  <label htmlFor="event-start-date">
                    {eventDuration === "one-day" ? "Data do evento *" : "Data de início *"}
                  </label>
                  <input
                    id="event-start-date"
                    type="date"
                    required
                    value={eventStartDate}
                    onChange={(event) => setEventStartDate(event.target.value)}
                  />
                </div>
                {eventDuration === "multiple-days" ? (
                  <div className="form-field">
                    <label htmlFor="event-end-date">Data de fim *</label>
                    <input
                      id="event-end-date"
                      type="date"
                      required
                      min={nextCalendarDate(eventStartDate)}
                      value={eventEndDate}
                      onChange={(event) => setEventEndDate(event.target.value)}
                    />
                  </div>
                ) : null}
                <h3>Local do evento</h3>
                <div className="form-field">
                  <label htmlFor="event-venue-name">Nome do local *</label>
                  <input id="event-venue-name" required minLength={2} maxLength={150} value={venueName} onChange={(event) => setVenueName(event.target.value)} placeholder="Ex.: Estádio Nacional" />
                </div>
                <div className="form-field">
                  <label htmlFor="event-venue-address">Endereço</label>
                  <input id="event-venue-address" maxLength={300} value={venueAddress} onChange={(event) => setVenueAddress(event.target.value)} placeholder="Rua, bairro ou referência" />
                </div>
                <div className="form-field">
                  <label htmlFor="event-venue-city">Cidade *</label>
                  <input id="event-venue-city" required minLength={2} maxLength={100} value={venueCity} onChange={(event) => setVenueCity(event.target.value)} />
                </div>
                <div className="form-field">
                  <label htmlFor="event-venue-country">País *</label>
                  <select id="event-venue-country" required value={venueCountry} onChange={(event) => setVenueCountry(event.target.value)}>
                    {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
                  </select>
                </div>
                <h3>Bilhete normal</h3>
                <p className="form-help">O bilhete normal será criado junto com o evento. O preço fica associado à moeda da organização.</p>
                <div className="event-create-ticket-grid">
                  <div className="form-field">
                    <label htmlFor="event-ticket-price">Preço do bilhete ({organizationCurrency}) *</label>
                    <input id="event-ticket-price" type="number" required min="0" max="1000000" step="0.01" value={normalTicketPrice} onChange={(event) => setNormalTicketPrice(event.target.value)} />
                    <span className="form-help">Use 0 para entrada gratuita.</span>
                  </div>
                  <div className="form-field">
                    <label htmlFor="event-ticket-quantity">Quantidade disponível *</label>
                    <input id="event-ticket-quantity" type="number" required min="1" max="1000000" step="1" value={normalTicketQuantity} onChange={(event) => setNormalTicketQuantity(event.target.value)} />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="event-description">Descrição do evento</label>
                  <textarea id="event-description" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explique o objetivo, o programa e o que os participantes podem esperar." />
                </div>
                <div className="form-field">
                  <label htmlFor="event-cover">Imagem de capa (JPEG, PNG ou WebP, até 5 MB)</label>
                  <input id="event-cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
                </div>
                <button className="button button-primary event-submit-button" type="submit" disabled={loading}>{loading ? "A submeter..." : "Submeter proposta para análise"}</button>
                <p className="event-privacy-note">Ao submeter, confirma que tem autorização para organizar este evento e fornecer estas informações.</p>
              </form>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

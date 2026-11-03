import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { getCountryOptions, getCurrencyOptions } from "@/shared/lib/locale-options";
import NewEventForm from "./form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel%2Feventos%2Fnovo");
  if (ctx.platformRole === "PLATFORM_ADMIN") redirect("/admin");
  if (ctx.organizationId && !ctx.permissions.has("event:create")) {
    redirect("/organizador");
  }
  const organization = ctx.organizationId
    ? await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
          select: { country: true, currency: true },
      })
    : null;

  return (
    <NewEventForm
      needsOrganization={!ctx.organizationId}
      initialCountry={organization?.country ?? "GW"}
      initialCurrency={organization?.currency ?? "XOF"}
      countryOptions={getCountryOptions()}
      currencyOptions={getCurrencyOptions()}
    />
  );
}

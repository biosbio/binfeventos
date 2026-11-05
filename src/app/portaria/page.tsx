import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import GateClient from "./gate-client";

export default async function GatePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login?next=%2Fportaria");
  if (!auth.permissions.has("access:validate")) {
    const eventGateMembership = auth.organizationId ? await prisma.eventStaffMembership.findFirst({
      where: {
        userId: auth.userId,
        role: { in: ["ORGANIZER", "GATE"] },
        approvedAt: { not: null },
        event: { organizationId: auth.organizationId, organization: { status: "ACTIVE" } },
      },
      select: { id: true },
    }) : null;
    if (!eventGateMembership) redirect("/painel");
  }
  if (!auth.panelVerifiedUntil || auth.panelVerifiedUntil.getTime() <= Date.now()) redirect("/acesso-painel?next=%2Fportaria");

  return (
    <>
      <SiteHeader />
      <GateClient />
      <SiteFooter />
    </>
  );
}

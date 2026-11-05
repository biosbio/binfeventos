import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import GateClient from "./gate-client";

export default async function GatePage() {
  const auth = await getAuthContext();
  if (
    auth?.organizationId &&
    !auth.permissions.has("access:validate") &&
    (!auth.panelVerifiedUntil || auth.panelVerifiedUntil.getTime() <= Date.now())
  ) {
    const eventGateMembership = await prisma.eventStaffMembership.findFirst({
      where: {
        userId: auth.userId,
        role: "GATE",
        approvedAt: { not: null },
        event: { organizationId: auth.organizationId, organization: { status: "ACTIVE" } },
      },
      select: { id: true },
    });
    if (eventGateMembership) redirect("/acesso-painel?next=%2Fportaria");
  }

  return (
    <>
      <SiteHeader />
      <GateClient />
      <SiteFooter />
    </>
  );
}

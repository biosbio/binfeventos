import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import PanelAuthForm from "./panel-auth-form";

export const dynamic = "force-dynamic";

export default async function PanelAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  const eventStaffRoles = ctx.organizationId
    ? await prisma.eventStaffMembership.findMany({
        where: {
          userId: ctx.userId,
          role: { in: ["SELLER", "GATE"] },
          approvedAt: { not: null },
          event: { organizationId: ctx.organizationId, organization: { status: "ACTIVE" } },
        },
        select: { role: true },
        distinct: ["role"],
      })
    : [];
  const isApprovedEventSeller = eventStaffRoles.some((membership) => membership.role === "SELLER");
  const isApprovedEventGate = eventStaffRoles.some((membership) => membership.role === "GATE");
  const isApprovedEventStaff = isApprovedEventSeller || isApprovedEventGate;
  if (
    ctx.platformRole !== "PLATFORM_ADMIN" &&
    (!ctx.organizationId || (ctx.permissions.size === 0 && !isApprovedEventStaff))
  ) {
    redirect("/organizador");
  }
  if (ctx.panelVerifiedUntil && ctx.panelVerifiedUntil.getTime() > Date.now()) {
    const destination = ctx.platformRole === "PLATFORM_ADMIN"
      ? next === "/admin/users" ? next : "/admin"
      : (isApprovedEventSeller && next === "/bilheteira") ||
          (isApprovedEventGate && next === "/portaria")
        ? next
        : "/painel";
    redirect(destination);
  }
  const isAdmin = ctx.platformRole === "PLATFORM_ADMIN";
  const nextPath = isAdmin && next === "/admin/users"
    ? next
    : isAdmin
      ? "/admin"
      : (isApprovedEventSeller && next === "/bilheteira") ||
          (isApprovedEventGate && next === "/portaria")
        ? next
        : "/painel";
  return <PanelAuthForm isAdmin={isAdmin} nextPath={nextPath} />;
}

import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
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
  if (ctx.platformRole !== "PLATFORM_ADMIN" && (!ctx.organizationId || ctx.permissions.size === 0)) {
    redirect("/organizador");
  }
  if (ctx.panelVerifiedUntil && ctx.panelVerifiedUntil.getTime() > Date.now()) {
    const destination = ctx.platformRole === "PLATFORM_ADMIN"
      ? next === "/admin/users" ? next : "/admin"
      : "/painel";
    redirect(destination);
  }
  const isAdmin = ctx.platformRole === "PLATFORM_ADMIN";
  const nextPath = isAdmin && next === "/admin/users" ? next : isAdmin ? "/admin" : "/painel";
  return <PanelAuthForm isAdmin={isAdmin} nextPath={nextPath} />;
}

import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import PanelAuthForm from "./panel-auth-form";

export const dynamic = "force-dynamic";

export default async function PanelAuthPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  if (ctx.panelVerifiedUntil && ctx.panelVerifiedUntil.getTime() > Date.now()) {
    redirect(ctx.platformRole === "PLATFORM_ADMIN" ? "/admin" : "/painel");
  }
  return <PanelAuthForm isAdmin={ctx.platformRole === "PLATFORM_ADMIN"} />;
}

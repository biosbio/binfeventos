import { redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login?next=%2Fpainel");
  if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) {
    redirect("/acesso-painel");
  }
  return children;
}

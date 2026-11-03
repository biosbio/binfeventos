import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import CheckoutClient from "./CheckoutClient";
import { getAuthContext } from "@/shared/auth";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; sessionId?: string }>;
}) {
  const [{ eventId, sessionId }, auth] = await Promise.all([
    searchParams,
    getAuthContext(),
  ]);
  if (!auth) {
    const query = new URLSearchParams();
    if (eventId) query.set("eventId", eventId);
    if (sessionId) query.set("sessionId", sessionId);
    const checkoutPath = query.size ? `/checkout?${query.toString()}` : "/checkout";
    redirect(`/login?next=${encodeURIComponent(checkoutPath)}`);
  }

  return (
    <>
      <SiteHeader />
      <Suspense fallback={<div className="empty-state" style={{ margin: "60px auto", maxWidth: 400 }}>A carregar checkout…</div>}>
        <CheckoutClient />
      </Suspense>
      <SiteFooter />
    </>
  );
}

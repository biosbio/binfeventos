import { Suspense } from "react";
import { SiteHeader, SiteFooter } from "../_components/site-shell";
import CheckoutClient from "./CheckoutClient";

export default function CheckoutPage() {
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

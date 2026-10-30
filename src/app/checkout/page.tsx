import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="empty-state" style={{ margin: "60px auto", maxWidth: 400 }}>A carregar checkout…</div>}>
      <CheckoutClient />
    </Suspense>
  );
}

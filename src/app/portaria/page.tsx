import { SiteHeader, SiteFooter } from "../_components/site-shell";
import GateClient from "./gate-client";

export default function GatePage() {
  return (
    <>
      <SiteHeader />
      <GateClient />
      <SiteFooter />
    </>
  );
}

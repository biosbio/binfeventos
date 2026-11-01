import { SiteHeader, SiteFooter } from "../../_components/site-shell";
import FinanceActionsClient from "./finance-actions-client";

export default function FinanceActionsPage() {
  return (
    <>
      <SiteHeader />
      <FinanceActionsClient />
      <SiteFooter />
    </>
  );
}

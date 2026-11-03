import { safeNextPath } from "@/app/_lib/safe-next-path";
import RegisterForm from "./register-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <RegisterForm nextPath={safeNextPath(next)} />;
}

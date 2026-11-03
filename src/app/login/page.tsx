import { safeNextPath } from "@/app/_lib/safe-next-path";
import LoginForm from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm nextPath={safeNextPath(next)} />;
}

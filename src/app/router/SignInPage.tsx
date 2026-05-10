import { Navigate } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppShell } from "@/app/layout/AppShell";
import { SignInCard } from "@/features/usr/components/SignInCard";

export function SignInPage() {
  return (
    <AppShell>
      <Authenticated>
        <Navigate to="/" replace />
      </Authenticated>
      <Unauthenticated>
        <SignInCard />
      </Unauthenticated>
    </AppShell>
  );
}

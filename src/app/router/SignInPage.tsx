import { Navigate } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInCard } from "@/features/usr/components/SignInCard";

export function SignInPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-st-bg px-4 py-12">
      {/* Nebula glow layers */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 60% 50% at 15% 25%, rgba(34,211,238,0.07) 0%, transparent 70%)",
            "radial-gradient(ellipse 55% 45% at 85% 75%, rgba(124,58,237,0.08) 0%, transparent 70%)",
            "radial-gradient(ellipse 40% 60% at 50% 50%, rgba(30,58,138,0.12) 0%, transparent 70%)",
          ].join(", "),
        }}
      />
      <Authenticated>
        <Navigate to="/lobby" replace />
      </Authenticated>
      <Unauthenticated>
        <div className="relative z-10 w-full max-w-md">
          <SignInCard />
        </div>
      </Unauthenticated>
    </div>
  );
}

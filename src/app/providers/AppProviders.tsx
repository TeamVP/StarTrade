import { type ReactNode } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { AnalyticsProvider } from "@/app/providers/AnalyticsProvider";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={convex}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </ConvexAuthProvider>
  );
}

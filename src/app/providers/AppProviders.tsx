import { type ReactNode } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { AnalyticsProvider } from "@/app/providers/AnalyticsProvider";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

function MissingConvexUrlNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-white">Missing Convex URL</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          This deployment is missing the client Convex Cloud URL. Set
          <span className="font-mono text-slate-100"> VITE_CONVEX_URL </span>
          in Vercel to the
          <span className="font-mono text-slate-100"> https://&lt;deployment&gt;.convex.cloud </span>
          URL, or provide
          <span className="font-mono text-slate-100"> CONVEX_URL </span>
          with that same Cloud URL and rebuild so Vite can inject it. The
          <span className="font-mono text-slate-100"> https://&lt;deployment&gt;.convex.site </span>
          URL is for auth/site configuration instead.
        </p>
      </div>
    </div>
  );
}

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function AppProviders({ children }: { children: ReactNode }) {
  if (!convex) {
    return <MissingConvexUrlNotice />;
  }

  return (
    <ConvexAuthProvider client={convex}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </ConvexAuthProvider>
  );
}

import { useEffect, type ReactNode } from "react";
import posthog from "posthog-js";
import * as Sentry from "@sentry/react";

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;
const sentryDsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN as string | undefined;

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        tracesSampleRate: 0.2,
      });
    }

    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://app.posthog.com",
        capture_pageview: true,
      });
    }
  }, []);

  return <>{children}</>;
}

import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { AppShell } from "@/app/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const CHUNK_ERROR_MESSAGES = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
] as const;

function getErrorDetails(error: unknown) {
  if (isRouteErrorResponse(error)) {
    const data =
      typeof error.data === "string"
        ? error.data
        : error.data
          ? JSON.stringify(error.data, null, 2)
          : null;

    return {
      title: `${error.status} ${error.statusText}`.trim(),
      message: data ?? "The requested route could not be completed.",
      isChunkError: false,
    };
  }

  if (error instanceof Error) {
    const isChunkError = CHUNK_ERROR_MESSAGES.some((message) => error.message.includes(message));
    return {
      title: isChunkError ? "Page update required" : "Unexpected application error",
      message: error.message,
      isChunkError,
    };
  }

  if (typeof error === "string") {
    const isChunkError = CHUNK_ERROR_MESSAGES.some((message) => error.includes(message));
    return {
      title: isChunkError ? "Page update required" : "Unexpected application error",
      message: error,
      isChunkError,
    };
  }

  return {
    title: "Unexpected application error",
    message: "Something went wrong while loading this page.",
    isChunkError: false,
  };
}

export function AppRouteErrorPage() {
  const routeError = useRouteError();
  const { title, message, isChunkError } = getErrorDetails(routeError);
  const description = isChunkError
    ? "A fresh deploy replaced part of the app while this tab was still open. Reload to pick up the new version."
    : "The app hit an error while rendering this route. You can reload the page or head back to safety.";

  return (
    <AppShell
      mainClassName="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-3xl items-center px-4 py-10"
      headerTrailing={
        <Button asChild variant="ghost">
          <Link to="/">Home</Link>
        </Button>
      }
    >
      <Card className="w-full space-y-6 p-6 sm:p-8">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-accent">Route error</p>
          <h1 className="text-3xl font-semibold text-st-fg">{title}</h1>
          <p className="text-sm leading-6 text-st-muted">{description}</p>
        </div>

        <div className="rounded-lg border border-st-border bg-st-bg/60 px-4 py-3 text-sm text-st-fg">
          {message}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button className="sm:min-w-40" onClick={() => window.location.reload()}>
            Reload page
          </Button>
          <Button asChild variant="secondary" className="sm:min-w-40">
            <Link to="/">Return home</Link>
          </Button>
        </div>

        {routeError instanceof Error && routeError.stack ? (
          <details className="text-xs text-st-muted">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-st-border bg-st-bg/60 p-3 text-[11px] leading-5 text-st-muted">
              {routeError.stack}
            </pre>
          </details>
        ) : null}
      </Card>
    </AppShell>
  );
}
import { useQuery } from "convex/react";
import { Link, Outlet } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";

/**
 * Renders the nested admin routes only for users whose `users.admin` flag is
 * true.  All other authenticated users see a clear "no access" message with
 * links back to the lobby and profile pages.
 *
 * Must be placed inside an `<Authenticated>` boundary so the query can run.
 */
export function AdminGuard() {
  const account = useQuery(api.usr.queries.getMyAccount, {});

  // While the query is loading, show nothing (the parent Suspense/Authenticated
  // boundary already handles the unauthenticated case).
  if (account === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-st-muted">
        Loading…
      </div>
    );
  }

  if (!account?.user.admin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold text-st-fg">Access Restricted</h1>
          <p className="max-w-sm text-sm text-st-muted">
            You don't have permission to view this page. Admin access is required.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="primary">
            <Link to="/lobby">Go to Lobby</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/profile">Go to Profile</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

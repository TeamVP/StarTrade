import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function mutationErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function stringFromFormData(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function AdminUsersPage() {
  const { activeGame, games, setSelectedGameId } = useActiveGame();
  const userResult = useQuery(api.admin.queries.listUsers, {
    gameId: activeGame?._id ?? null,
    limit: 100,
  });
  const createUser = useMutation(api.admin.mutations.createUser);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeGame === null) {
      setError("Select an active game first.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = stringFromFormData(formData, "email");
    const password = stringFromFormData(formData, "password");
    const name = stringFromFormData(formData, "name").trim();
    const displayName = stringFromFormData(formData, "displayName").trim();

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await createUser({
        gameId: activeGame._id,
        email,
        password,
        name: name.length > 0 ? name : null,
        displayName: displayName.length > 0 ? displayName : null,
      });
      form.reset();
      setSuccess(`Created user ${email.trim().toLowerCase()}.`);
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-st-fg">Users</h1>
        <p className="text-sm text-st-muted">
          View the Convex auth users table and create sign-in ready password accounts.
        </p>
      </div>

      {games.length > 1 ? (
        <Card className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Game Context</h2>
            <p className="mt-1 text-sm text-st-muted">
              User management is available when you are an admin in the selected game.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {games.map((game) => {
              const isActive = activeGame?._id === game._id;
              return (
                <button
                  key={game._id}
                  type="button"
                  onClick={() => setSelectedGameId(game._id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "border-st-accent bg-st-accent/10 text-st-fg ring-1 ring-st-accent/30"
                      : "border-st-border text-st-muted hover:bg-st-panel hover:text-st-fg"
                  }`}
                >
                  {game.name}
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create User</h2>
          <p className="mt-1 text-sm text-st-muted">
            Creates a password-based auth account. The user can sign in immediately with email and password.
          </p>
        </div>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void onSubmit(event)}>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Password</span>
            <input
              type="password"
              name="password"
              minLength={8}
              required
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Name</span>
            <input
              type="text"
              name="name"
              placeholder="Optional auth profile name"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Display name</span>
            <input
              type="text"
              name="displayName"
              placeholder="Optional in-game profile name"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <div className="md:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={submitting || activeGame === null}>
              {submitting ? "Creating..." : "Create user"}
            </Button>
            {activeGame !== null ? (
              <span className="text-sm text-st-muted">Admin check runs against {activeGame.name}.</span>
            ) : (
              <span className="text-sm text-st-muted">No active game selected.</span>
            )}
          </div>
        </form>
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
        {success !== null ? <p className="text-sm text-emerald-300">{success}</p> : null}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Users Table</h2>
            <p className="mt-1 text-sm text-st-muted">Showing the latest 100 user rows.</p>
          </div>
          {activeGame !== null ? (
            <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
              Context: {activeGame.name}
            </div>
          ) : null}
        </div>

        {userResult === undefined ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            Loading users...
          </p>
        ) : !userResult.authorized ? (
          <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-4 text-sm text-amber-200">
            Select a game where your account has an active admin role to view and manage users.
          </p>
        ) : userResult.users.length === 0 ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            No users found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-st-muted">
                  <th className="border-b border-st-border px-3 py-2 font-medium">Email</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Name</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Display</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Verified</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Created</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">User ID</th>
                </tr>
              </thead>
              <tbody>
                {userResult.users.map((user) => (
                  <tr key={user._id} className="align-top">
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      <div>{user.email ?? "-"}</div>
                      {user.isAnonymous ? (
                        <div className="mt-1 text-xs text-st-muted">Anonymous</div>
                      ) : null}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.name ?? "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <div className="text-st-fg">{user.displayName ?? "-"}</div>
                      {user.timezone ? (
                        <div className="mt-1 text-xs text-st-muted">{user.timezone}</div>
                      ) : null}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.emailVerified ? "Yes" : "No"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-muted">
                      {formatTimestamp(user.createdAt)}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <code className="break-all rounded bg-st-bg px-1.5 py-0.5 text-xs text-st-fg">
                        {user._id}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
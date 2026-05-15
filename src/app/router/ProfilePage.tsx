import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { SignOutButton } from "@/features/usr/components/SignOutButton";

function initialsFromName(name: string | null | undefined, email: string | null | undefined): string {
  const source = name ?? email ?? "?";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "?";
  const second = parts.length > 1 ? parts[1][0] : parts[0][1] ?? "";
  return `${first}${second}`.toUpperCase();
}

export function ProfilePage() {
  const account = useQuery(api.usr.queries.getMyAccount, {});

  const displayName = account?.profile?.displayName ?? account?.user.name ?? "Gamer profile";
  const email = account?.user.email ?? "No email on file";
  const avatarUrl = account?.profile?.avatarUrl ?? account?.user.image ?? null;
  const initials = initialsFromName(
    account?.profile?.displayName ?? account?.user.name,
    account?.user.email,
  );

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {avatarUrl !== null ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-20 w-20 rounded-full border border-st-border object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-st-border bg-st-panel text-xl font-semibold text-st-fg">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold text-st-fg">{displayName}</h1>
              <p className="mt-1 text-sm text-st-muted">{email}</p>
              <p className="mt-2 text-sm text-st-muted">
                Manage your gamer profile, account details, and session state from one place.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SignOutButton />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Account</h2>
          <dl className="mt-4 grid gap-4 text-sm text-st-muted sm:grid-cols-2">
            <div className="rounded border border-st-border bg-st-bg p-3">
              <dt className="text-xs uppercase tracking-wide">Display name</dt>
              <dd className="mt-1 font-medium text-st-fg">{displayName}</dd>
            </div>
            <div className="rounded border border-st-border bg-st-bg p-3">
              <dt className="text-xs uppercase tracking-wide">Email</dt>
              <dd className="mt-1 font-medium text-st-fg">{email}</dd>
            </div>
            <div className="rounded border border-st-border bg-st-bg p-3">
              <dt className="text-xs uppercase tracking-wide">Avatar</dt>
              <dd className="mt-1 font-medium text-st-fg">
                {avatarUrl !== null ? "Custom avatar set" : "Using initials"}
              </dd>
            </div>
            <div className="rounded border border-st-border bg-st-bg p-3">
              <dt className="text-xs uppercase tracking-wide">Logout</dt>
              <dd className="mt-1 font-medium text-st-fg">End the current session</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
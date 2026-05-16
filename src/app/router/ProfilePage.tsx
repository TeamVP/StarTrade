import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  const upsertMyProfile = useMutation(api.usr.mutations.upsertMyProfile);
  const setMyPassword = useMutation(api.usr.mutations.setMyPassword);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [timezoneInput, setTimezoneInput] = useState("");
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordConfirmInput, setPasswordConfirmInput] = useState("");
  const [passwordState, setPasswordState] = useState<"idle" | "saving" | "saved">("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (account === undefined || account === null) {
      return;
    }
    setDisplayNameInput(account.profile?.displayName ?? account.user.name ?? "");
    setAvatarUrlInput(account.profile?.avatarUrl ?? account.user.image ?? "");
    setTimezoneInput(account.profile?.timezone ?? "");
    setAnalyticsConsent(account.profile?.analyticsConsent ?? false);
  }, [account]);

  const displayName = account?.profile?.displayName ?? account?.user.name ?? "Gamer profile";
  const email = account?.user.email ?? "No email on file";
  const avatarUrl = account?.profile?.avatarUrl ?? account?.user.image ?? null;
  const initials = initialsFromName(
    account?.profile?.displayName ?? account?.user.name,
    account?.user.email,
  );
  const hasPasswordAccount = account?.hasPasswordAccount ?? false;

  useEffect(() => {
    setPasswordInput("");
    setPasswordConfirmInput("");
    setPasswordState("idle");
    setPasswordError(null);
  }, [account?.user._id]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaveState("saving");
    try {
      await upsertMyProfile({
        displayName: displayNameInput,
        avatarUrl: avatarUrlInput.trim().length > 0 ? avatarUrlInput.trim() : null,
        timezone: timezoneInput.trim().length > 0 ? timezoneInput.trim() : null,
        analyticsConsent,
      });
      setSaveState("saved");
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
      setSaveState("idle");
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordInput !== passwordConfirmInput) {
      setPasswordError("Passwords do not match.");
      setPasswordState("idle");
      return;
    }

    setPasswordError(null);
    setPasswordState("saving");
    try {
      await setMyPassword({
        password: passwordInput,
      });
      setPasswordInput("");
      setPasswordConfirmInput("");
      setPasswordState("saved");
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setPasswordError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
      setPasswordState("idle");
    }
  }

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Account</h2>
              <p className="mt-2 text-sm text-st-muted">
                Update the profile details shown across lobbies, scoreboards, and player seats.
              </p>
            </div>
            {saveState === "saved" ? (
              <span className="rounded border border-emerald-500/40 bg-emerald-950/30 px-2 py-1 text-xs font-medium text-emerald-200">
                Saved
              </span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm text-st-muted">
              <span className="text-xs uppercase tracking-wide">Display name</span>
              <input
                value={displayNameInput}
                onChange={(event) => {
                  setDisplayNameInput(event.target.value);
                  setSaveState("idle");
                }}
                className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none transition-colors focus:border-st-accent"
                placeholder="Enter your display name"
              />
            </label>
            <label className="grid gap-2 text-sm text-st-muted">
              <span className="text-xs uppercase tracking-wide">Avatar URL</span>
              <input
                value={avatarUrlInput}
                onChange={(event) => {
                  setAvatarUrlInput(event.target.value);
                  setSaveState("idle");
                }}
                className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none transition-colors focus:border-st-accent"
                placeholder="https://example.com/avatar.png"
              />
            </label>
            <label className="grid gap-2 text-sm text-st-muted">
              <span className="text-xs uppercase tracking-wide">Timezone</span>
              <input
                value={timezoneInput}
                onChange={(event) => {
                  setTimezoneInput(event.target.value);
                  setSaveState("idle");
                }}
                className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none transition-colors focus:border-st-accent"
                placeholder="America/New_York"
              />
            </label>
            <label className="flex items-center gap-3 rounded border border-st-border bg-st-bg px-3 py-3 text-sm text-st-muted">
              <input
                type="checkbox"
                checked={analyticsConsent}
                onChange={(event) => {
                  setAnalyticsConsent(event.target.checked);
                  setSaveState("idle");
                }}
                className="accent-cyan-400"
              />
              Allow analytics for improving the game experience.
            </label>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-st-muted">Email is managed by your sign-in provider.</p>
              <Button type="submit" disabled={saveState === "saving" || account === undefined || account === null}>
                {saveState === "saving" ? "Saving..." : "Save profile"}
              </Button>
            </div>
          </form>
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

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Password</h2>
              <p className="mt-2 text-sm text-st-muted">
                {hasPasswordAccount
                  ? "Change the password used for email sign-in on this account."
                  : "Create a password so this account can also sign in with email and password."}
              </p>
            </div>
            {passwordState === "saved" ? (
              <span className="rounded border border-emerald-500/40 bg-emerald-950/30 px-2 py-1 text-xs font-medium text-emerald-200">
                Saved
              </span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4" onSubmit={handlePasswordSubmit}>
            <label className="grid gap-2 text-sm text-st-muted">
              <span className="text-xs uppercase tracking-wide">New password</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setPasswordState("idle");
                  setPasswordError(null);
                }}
                minLength={8}
                autoComplete="new-password"
                className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none transition-colors focus:border-st-accent"
                placeholder="Enter a new password"
              />
            </label>
            <label className="grid gap-2 text-sm text-st-muted">
              <span className="text-xs uppercase tracking-wide">Confirm password</span>
              <input
                type="password"
                value={passwordConfirmInput}
                onChange={(event) => {
                  setPasswordConfirmInput(event.target.value);
                  setPasswordState("idle");
                  setPasswordError(null);
                }}
                minLength={8}
                autoComplete="new-password"
                className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none transition-colors focus:border-st-accent"
                placeholder="Re-enter the new password"
              />
            </label>
            {passwordError ? <p className="text-sm text-red-300">{passwordError}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-st-muted">
                {account?.user.email !== null
                  ? "This updates the password tied to your current email address."
                  : "Password sign-in requires an email address on the account."}
              </p>
              <Button
                type="submit"
                disabled={
                  passwordState === "saving" ||
                  account === undefined ||
                  account === null ||
                  account.user.email === null ||
                  passwordInput.length < 8 ||
                  passwordInput !== passwordConfirmInput
                }
              >
                {passwordState === "saving"
                  ? "Saving..."
                  : hasPasswordAccount
                    ? "Reset password"
                    : "Set password"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
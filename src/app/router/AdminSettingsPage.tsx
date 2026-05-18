import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";

export function AdminSettingsPage() {
  const authSettings = useQuery(api.siteSettings.getAuthSettings);
  const updateAuthSettings = useMutation(api.siteSettings.updateAuthSettings);
  const [googleOauthEnabled, setGoogleOauthEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authSettings !== undefined) {
      setGoogleOauthEnabled(authSettings.googleOauthEnabled);
    }
  }, [authSettings?.googleOauthEnabled, authSettings]);

  async function handleToggleGoogleOauth() {
    const previous = googleOauthEnabled;
    const next = !previous;
    setGoogleOauthEnabled(next);
    setSaving(true);
    setError(null);

    try {
      await updateAuthSettings({ googleOauthEnabled: next });
    } catch (updateError) {
      setGoogleOauthEnabled(previous);
      setError(updateError instanceof Error ? updateError.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
        <h1 className="text-2xl font-semibold text-st-fg">Settings</h1>
        <p className="text-sm text-st-muted">Global site controls that affect the player experience.</p>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-st-fg">Authentication</h2>
          <p className="text-sm text-st-muted">
            Control which sign-in options appear on the public login screen.
          </p>
        </div>

        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-st-fg">Google Oauth</h3>
              <p className="mt-1 text-sm text-st-muted">
                When disabled, the Google sign-in button and divider are hidden on /sign-in.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={googleOauthEnabled}
              aria-label="Toggle Google Oauth"
              disabled={saving || authSettings === undefined}
              onClick={() => void handleToggleGoogleOauth()}
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors ${
                googleOauthEnabled
                  ? "border-st-accent bg-st-accent"
                  : "border-st-border bg-st-bg"
              } ${saving || authSettings === undefined ? "opacity-60" : ""}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  googleOauthEnabled ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-st-border bg-st-bg/60 px-3 py-2 text-sm text-st-muted">
            <span>Current status</span>
            <span className="font-medium text-st-fg">
              {authSettings === undefined
                ? "Loading..."
                : googleOauthEnabled
                  ? "Google Oauth enabled"
                  : "Google Oauth disabled"}
            </span>
          </div>

          {error !== null ? (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          ) : null}
        </Card>
      </section>
    </div>
  );
}

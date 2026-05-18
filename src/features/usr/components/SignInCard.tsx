import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function readableAuthError(message: string, flow: "signIn" | "signUp") {
  if (message.includes("InvalidAccountId")) {
    return flow === "signIn"
      ? "No account found for that email. Try creating an account instead."
      : "This email address cannot be used to create an account. Contact an admin.";
  }
  if (message.includes("InvalidSecret")) {
    return "Incorrect password. Please try again.";
  }
  if (message.includes("AccountAlreadyExists")) {
    return "An account with this email already exists. Sign in instead.";
  }
  return message;
}

const inputClass =
  "w-full rounded-lg border border-st-border bg-st-bg px-3 py-2.5 text-sm text-st-fg placeholder:text-st-muted/50 transition-colors focus:border-st-accent focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-st-muted";

export function SignInCard() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");

  const switchFlow = (next: "signIn" | "signUp") => {
    setFlow(next);
    setError(null);
    setConfirmPassword("");
  };

  const handleGoogleSignIn = () => {
    setError(null);
    setPending(true);
    void signIn("google").catch((e: Error) => {
      setError(readableAuthError(e.message, flow));
      setPending(false);
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    if (flow === "signUp") {
      const password = formData.get("password") as string;
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
    }

    formData.set("flow", flow);
    setError(null);
    setPending(true);
    void signIn("password", formData).catch((e: Error) => {
      setError(readableAuthError(e.message, flow));
      setPending(false);
    });
  };

  return (
    <div className="w-full rounded-2xl border border-st-border bg-st-panel/90 p-8 shadow-2xl backdrop-blur-sm">
      {/* Branding */}
      <div className="mb-7 text-center">
        <div className="mb-2 flex items-center justify-center gap-3">
          <img src="/starstrat1.svg" alt="" className="h-10 w-10" />
          <span className="text-3xl font-bold tracking-wide text-white">StarStrat</span>
        </div>
        <p className="text-sm text-st-muted">Galactic conquest awaits</p>
      </div>

      {/* Tab switcher */}
      <div className="mb-6 flex rounded-lg border border-st-border bg-st-bg p-1">
        <button
          type="button"
          onClick={() => switchFlow("signIn")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            flow === "signIn"
              ? "bg-st-accent text-st-bg"
              : "text-st-muted hover:text-st-fg"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => switchFlow("signUp")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            flow === "signUp"
              ? "bg-st-accent text-st-bg"
              : "text-st-muted hover:text-st-fg"
          }`}
        >
          Create Account
        </button>
      </div>

      {/* Google OAuth */}
      <button
        type="button"
        disabled={pending}
        onClick={handleGoogleSignIn}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-st-border bg-white/5 px-4 py-2.5 text-sm font-medium text-st-fg transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-st-muted">
        <div className="h-px flex-1 bg-st-border" />
        <span>or use email</span>
        <div className="h-px flex-1 bg-st-border" />
      </div>

      {/* Form */}
      <form className="space-y-3" onSubmit={handleSubmit}>
        {flow === "signUp" && (
          <div>
            <label className={labelClass}>Display Name</label>
            <input
              type="text"
              name="name"
              required
              placeholder="Commander Zara"
              autoComplete="name"
              className={inputClass}
            />
          </div>
        )}

        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Password</label>
          <input
            type="password"
            name="password"
            required
            placeholder={flow === "signUp" ? "Min. 8 characters" : "Your password"}
            autoComplete={flow === "signIn" ? "current-password" : "new-password"}
            className={inputClass}
          />
        </div>

        {flow === "signUp" && (
          <div>
            <label className={labelClass}>Confirm Password</label>
            <input
              type="password"
              placeholder="Re-enter your password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-lg bg-st-accent py-2.5 text-sm font-semibold text-st-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? flow === "signIn"
              ? "Signing in…"
              : "Creating account…"
            : flow === "signIn"
              ? "Sign In"
              : "Create Account"}
        </button>
      </form>
    </div>
  );
}

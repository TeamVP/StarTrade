import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function readableAuthError(message: string, flow: "signIn" | "signUp") {
  if (message.includes("InvalidAccountId")) {
    return flow === "signIn"
      ? "No password sign-in account exists for that email yet. If an admin created the user record, they need to provision a password first."
      : "This email does not have a password sign-in account yet. Ask an admin to provision one first."
  }
  return message;
}

export function SignInCard() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="mx-auto mt-16 w-full max-w-md p-6">
      <h2 className="text-lg font-semibold">Sign in to StarStrat</h2>
      <Button
        type="button"
        variant="secondary"
        className="mt-4 w-full"
        onClick={() => {
          setError(null);
          void signIn("google").catch((signInError: Error) => {
            setError(readableAuthError(signInError.message, flow));
          });
        }}
      >
        Continue with Google
      </Button>
      <div className="my-4 flex items-center gap-3 text-xs text-st-muted">
        <div className="h-px flex-1 bg-st-border" />
        <span>or use email</span>
        <div className="h-px flex-1 bg-st-border" />
      </div>
      <form
        className="mt-4 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          formData.set("flow", flow);
          setError(null);
          void signIn("password", formData).catch((signInError: Error) => {
            setError(readableAuthError(signInError.message, flow));
          });
        }}
      >
        <input
          type="email"
          name="email"
          placeholder="Email"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <Button type="submit" className="w-full">
          {flow === "signIn" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      <Button
        variant="ghost"
        type="button"
        className="mt-3 text-xs text-st-muted underline"
        onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
      >
        {flow === "signIn" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </Button>
      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
    </Card>
  );
}

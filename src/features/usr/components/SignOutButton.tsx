import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  if (!isAuthenticated) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      className="px-3 py-1 text-xs"
      onClick={() => void signOut()}
    >
      Sign out
    </Button>
  );
}

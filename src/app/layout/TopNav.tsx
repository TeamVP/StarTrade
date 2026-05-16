import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function TopNav() {
  const { pathname } = useLocation();
  const isAdminHome = pathname === "/admin";

  if (isAdminHome) {
    return <h1 className="px-3 py-px text-base font-semibold tracking-wide text-st-fg">Admin</h1>;
  }

  return (
    <div className="flex items-center">
      <Button variant="secondary" className="px-3 py-px text-xs" asChild>
        <Link to="/admin">Back to Admin</Link>
      </Button>
    </div>
  );
}

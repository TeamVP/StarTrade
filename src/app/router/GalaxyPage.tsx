import { GalaxyViewport } from "@/features/galaxy/components/GalaxyViewport";
import { EmpirePanel } from "@/features/empire/components/EmpirePanel";
import { AdminPanel } from "@/features/admin/components/AdminPanel";
import { ReplayPanel } from "@/features/replay/components/ReplayPanel";
import { TurnPanel } from "@/features/sim/components/TurnPanel";

export function GalaxyPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="space-y-4">
        <GalaxyViewport />
      </section>
      <aside className="space-y-4">
        <TurnPanel />
        <EmpirePanel />
        <ReplayPanel />
        <AdminPanel />
      </aside>
    </div>
  );
}

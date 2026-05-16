import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";

type AdminCatalogPlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  capabilities: string[];
  relatedLinks: Array<{ to: string; label: string; description: string }>;
};

export function AdminCatalogPlaceholderPage(props: AdminCatalogPlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-[76.8rem] space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">
          {props.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold text-st-fg">{props.title}</h1>
        <p className="text-sm text-st-muted">{props.description}</p>
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Planned capabilities
          </h2>
          <p className="mt-1 text-sm text-st-muted">
            This admin surface is now linked from the control center and reserved for the following tooling.
          </p>
        </div>
        <ul className="space-y-2 text-sm text-st-fg">
          {props.capabilities.map((capability) => (
            <li key={capability} className="rounded-lg border border-st-border bg-st-bg/60 px-3 py-2">
              {capability}
            </li>
          ))}
        </ul>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Nearby surfaces
          </h2>
          <p className="mt-1 text-sm text-st-muted">
            Existing pages that already expose adjacent simulation or configuration data.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {props.relatedLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-xl border border-st-border bg-st-panel px-4 py-4 transition-colors hover:border-st-accent hover:bg-st-bg"
            >
              <div className="text-sm font-semibold text-st-fg">{link.label}</div>
              <p className="mt-1 text-sm text-st-muted">{link.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
import { AdminCatalogPlaceholderPage } from "./AdminCatalogPlaceholderPage";

export function AdminTraderNpcsPage() {
  return (
    <AdminCatalogPlaceholderPage
      eyebrow="Admin"
      title="Trader NPCs"
      description="Manage the NPC trader roster used by the background trader system."
      capabilities={[
        "List trader NPC catalog entries with display names, affiliations, and ordering.",
        "Edit trader NPC metadata and enable or disable entries in the catalog.",
        "Select each trader NPC's strategy from the shared strategy library when trader strategy support lands.",
        "Add new trader NPC players to the roster used by trader identity seeding.",
      ]}
      relatedLinks={[
        {
          to: "/admin/traders",
          label: "Traders",
          description: "Live trader identity activity and background logistics diagnostics.",
        },
        {
          to: "/admin/balance",
          label: "Balance",
          description: "Existing NPC trader runtime parameters and spawning controls.",
        },
      ]}
    />
  );
}
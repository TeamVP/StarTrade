import { AdminCatalogPlaceholderPage } from "./AdminCatalogPlaceholderPage";

export function AdminStrategiesPage() {
  return (
    <AdminCatalogPlaceholderPage
      eyebrow="Admin"
      title="Strategies"
      description="Manage the automation strategy library used by NPC empires and human automation helpers."
      capabilities={[
        "List strategies in the library with preview metadata and raw strategy JSON.",
        "Edit existing strategies and add new strategies to the catalog.",
        "Toggle whether each strategy is available to NPC players.",
        "Toggle whether each strategy is available to human users.",
      ]}
      relatedLinks={[
        {
          to: "/admin/empires",
          label: "Empires",
          description: "Current empire strategy editing and application surface.",
        },
        {
          to: "/admin/results",
          label: "Results",
          description: "Historical outcome data that can inform strategy library curation.",
        },
      ]}
    />
  );
}
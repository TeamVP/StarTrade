import { AdminCatalogPlaceholderPage } from "./AdminCatalogPlaceholderPage";

export function AdminEmpireNpcsPage() {
  return (
    <AdminCatalogPlaceholderPage
      eyebrow="Admin"
      title="Empire NPCs"
      description="Manage the NPC empire player roster used during game creation and seeding."
      capabilities={[
        "List empire NPC players with their empire identity, labels, and current defaults.",
        "Edit NPC player metadata and availability in the admin catalog.",
        "Select each NPC empire player's strategy from the shared strategy library.",
        "Add new NPC empire players to the roster used by the game seeder.",
      ]}
      relatedLinks={[
        {
          to: "/admin/games",
          label: "Games",
          description: "Current game creation flow where optional NPC empires are selected.",
        },
        {
          to: "/admin/empires",
          label: "Empires",
          description: "Live empire state and strategy editing for seeded empire actors.",
        },
      ]}
    />
  );
}
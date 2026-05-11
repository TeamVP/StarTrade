import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveGame } from "./useActiveGame";

export function useGalaxyData() {
  const { activeGame } = useActiveGame();
  const systemsQuery = useQuery(
    api.gal.queries.listSystems,
    activeGame ? { gameId: activeGame._id, limit: 200 } : "skip",
  );
  const linksQuery = useQuery(
    api.gal.queries.listLinks,
    activeGame ? { gameId: activeGame._id, limit: 400 } : "skip",
  );
  const empiresQuery = useQuery(
    api.emp.queries.listEmpires,
    activeGame ? { gameId: activeGame._id, limit: 50 } : "skip",
  );

  const systems = useMemo(() => systemsQuery ?? [], [systemsQuery]);
  const links = useMemo(() => linksQuery ?? [], [linksQuery]);
  const empires = useMemo(() => empiresQuery ?? [], [empiresQuery]);

  const empireColors = useMemo(
    () => Object.fromEntries(empires.map((e) => [e._id, e.colorHex])),
    [empires],
  );

  return {
    activeGame,
    systems,
    links,
    empires,
    empireColors,
  };
}

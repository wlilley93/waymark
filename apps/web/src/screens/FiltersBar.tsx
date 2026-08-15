import { Button, Input, Select, Textarea } from "../ui/controls.js";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

export function FiltersBar() {
  const current = useStore((s) => s.current);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  if (!current) return null;

  const toggleTerm = (id: string) =>
    setFilters({
      termIds: filters.termIds.includes(id) ? filters.termIds.filter((t) => t !== id) : [...filters.termIds, id],
    });

  return (
    <div className="filters">
      {current.facets.map((f) => (
        <div key={f.id} className="filter-group">
          <span className="filter-name">{f.name}</span>
          {current.terms
            .filter((t) => t.facetId === f.id)
            .map((t) => (
              <Button
                key={t.id}
                className={`chip ${filters.termIds.includes(t.id) ? "on" : ""}`}
                style={filters.termIds.includes(t.id) ? { background: t.color, borderColor: t.color } : {}}
                onClick={() => toggleTerm(t.id)}
              >
                {t.name}
              </Button>
            ))}
        </div>
      ))}
      <div className="filter-group">
        <span className="filter-name">Rating</span>
        {[3, 4].map((n) => (
          <Button
            key={n}
            className={`chip ${filters.minRating === n ? "on" : ""}`}
            onClick={() => setFilters({ minRating: filters.minRating === n ? undefined : n })}
          >
            ★{n}+
          </Button>
        ))}
      </div>
      <div className="filter-group">
        <Button className={`chip ${filters.mine ? "on" : ""}`} onClick={() => setFilters({ mine: !filters.mine })}>
          Only mine
        </Button>
      </div>
    </div>
  );
}

export function refreshViewport(): Promise<void> {
  // exposed for MapScreen to call after filter changes
  return Promise.resolve();
}

export async function loadViewport(mapId: string, bbox: [number, number, number, number]) {
  const { setPlaces } = useStore.getState();
  const { filters } = useStore.getState();
  const list = await api.viewport(mapId, bbox.join(","), {
    termIds: filters.termIds.length ? filters.termIds : undefined,
    minRating: filters.minRating,
    mine: filters.mine,
  });
  setPlaces(list);
}

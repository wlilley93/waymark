import { useState } from "react";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

interface Props {
  picked: { lng: number; lat: number } | null;
  onClose: () => void;
}

export function AddPlaceSheet({ picked, onClose }: Props) {
  const current = useStore((s) => s.current)!;
  const mergePlaces = useStore((s) => s.mergePlaces);
  const select = useStore((s) => s.select);
  const [mode, setMode] = useState<"pin" | "search">("pin");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ name: string; lat: number; lng: number; address?: string; website?: string; osm?: { type: string; id: number } }[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [primaryTermId, setPrimaryTermId] = useState<string>("");
  const [termIds, setTermIds] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [personalNote, setPersonalNote] = useState("");
  const [sharedNote, setSharedNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const categoryFacet = current.facets.find((f) => f.key === "category");
  const otherFacets = current.facets.filter((f) => f.key !== "category");
  const categoryTerms = current.terms.filter((t) => t.facetId === categoryFacet?.id);

  const doSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const r = await api.geocode(query.trim());
      setResults(r.results);
    } catch {
      setError("search failed — try again or drop a pin");
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    setError(null);
    try {
      const body: Record<string, unknown> = {
        termIds,
        primaryTermId: primaryTermId || null,
        rating,
        personalNote: personalNote || undefined,
        sharedNote: sharedNote || undefined,
      };
      if (placeId) {
        body.placeId = placeId;
      } else {
        if (!name.trim()) throw new Error("name required");
        if (!picked) throw new Error("pick a location on the map first");
        body.newPlace = {
          name: name.trim(),
          location: { lat: picked.lat, lng: picked.lng },
          provider: "manual",
          address: address || undefined,
          website: website || undefined,
        };
      }
      const created = await api.createMapPlace(current.map.id, body);
      mergePlaces([created]);
      select(created.id);
      onClose();
    } catch (e) {
      const err = e as Error & { body?: { error?: string } };
      setError(err.body?.error ?? err.message);
    }
  };

  return (
    <div className="panel add-sheet">
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <h2>Add a place</h2>

      <div className="tabs">
        <button className={mode === "pin" ? "on" : ""} onClick={() => setMode("pin")}>
          Drop pin
        </button>
        <button className={mode === "search" ? "on" : ""} onClick={() => setMode("search")}>
          Search
        </button>
      </div>

      {mode === "pin" ? (
        <p className="hint">
          {placeId
            ? `Using selected place${name ? `: ${name}` : ""}`
            : picked
              ? `Pin at ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)} — or click the map to move it`
              : "Click the map to place the pin"}
          {placeId && (
            <button className="link" onClick={() => { setPlaceId(null); setName(""); }}>clear</button>
          )}
        </p>
      ) : (
        <div>
          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doSearch()}
              placeholder="Search a place name (submitted search, not autocomplete)"
            />
            <button onClick={() => void doSearch()} disabled={searching}>
              {searching ? "…" : "Search"}
            </button>
          </div>
          {results.length > 0 && (
            <ul className="results">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setResults([]);
                      setSearching(true);
                      // create the canonical place immediately — the server
                      // dedupes by (provider, external_id) so repeat picks reuse it
                      api
                        .createPlace({
                          name: r.name,
                          location: { lat: r.lat, lng: r.lng },
                          provider: "nominatim",
                          address: r.address,
                          website: r.website,
                          osm: r.osm as { type: "node" | "way" | "relation"; id: number } | undefined,
                        })
                        .then((p) => {
                          setPlaceId(p.id);
                          setName(r.name);
                          setSearching(false);
                        })
                        .catch(() => setSearching(false));
                    }}
                  >
                    {r.name}
                    <span className="addr">{r.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!placeId && (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" />
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (optional)" />
        </>
      )}

      <label>
        Category
        <select value={primaryTermId} onChange={(e) => setPrimaryTermId(e.target.value)}>
          <option value="">—</option>
          {categoryTerms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {otherFacets.map((f) => (
        <fieldset key={f.id}>
          <legend>{f.name}</legend>
          <div className="chips">
            {current.terms
              .filter((t) => t.facetId === f.id)
              .map((t) => (
                <button
                  key={t.id}
                  className={`chip ${termIds.includes(t.id) ? "on" : ""}`}
                  style={termIds.includes(t.id) ? { background: t.color, borderColor: t.color } : {}}
                  onClick={() =>
                    setTermIds((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))
                  }
                >
                  {t.name}
                </button>
              ))}
          </div>
        </fieldset>
      ))}

      <div className="row">
        <label>
          Rating
          <select value={rating ?? ""} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea value={sharedNote} onChange={(e) => setSharedNote(e.target.value)} placeholder="Shared note for the group (optional)" rows={2} />
      <textarea value={personalNote} onChange={(e) => setPersonalNote(e.target.value)} placeholder="Private note (only you)" rows={2} />

      {error && <p className="error">{error}</p>}
      <button className="primary" onClick={() => void submit()}>
        Save place
      </button>
    </div>
  );
}

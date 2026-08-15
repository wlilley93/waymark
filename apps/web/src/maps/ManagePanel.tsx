import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";
import { FIELD_TYPES } from "@waymark/shared";

// Taxonomy + typed field management (REQUIREMENTS FR-4, D2/D3): facets,
// terms and field definitions are data, edited in-app — never code.
export function ManagePanel({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const current = useStore((s) => s.current);
  const refreshTaxonomy = useStore((s) => s.refreshTaxonomy);
  const fieldDefs = (useStore.getState() as { fieldDefs?: import("@waymark/shared").FieldDefinitionRecord[] }).fieldDefs ?? [];
  const [facetRows, setFacetRows] = useState<import("@waymark/shared").FieldDefinitionRecord[]>(fieldDefs);
  const [newTermFacet, setNewTermFacet] = useState("");
  const [newTermName, setNewTermName] = useState("");
  const [newFacetKey, setNewFacetKey] = useState("");
  const [newFacetName, setNewFacetName] = useState("");
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fType, setFType] = useState<"text" | "number" | "boolean" | "date" | "url" | "select">("text");
  const [fOptions, setFOptions] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fields(mapId).then(setFacetRows).catch(() => {});
  }, [mapId]);

  if (!current) return null;
  const facets = current.facets;
  const terms = current.terms;
  const canWrite = current.map.yourRole === "owner" || current.map.yourRole === "editor";

  const addTerm = async () => {
    setError(null);
    if (!newTermFacet || !newTermName.trim()) return setError("pick a facet and name the term");
    try {
      await api.addTerm(mapId, { facetId: newTermFacet, name: newTermName.trim() });
      setNewTermName("");
      await refreshTaxonomy();
    } catch (e) {
      setError((e as Error & { body?: { error?: string } }).body?.error ?? (e as Error).message);
    }
  };

  const addFacet = async () => {
    setError(null);
    if (!newFacetKey.trim() || !newFacetName.trim()) return setError("facet needs a key and a name");
    try {
      await api.addFacet(mapId, { key: newFacetKey.trim(), name: newFacetName.trim() });
      setNewFacetKey("");
      setNewFacetName("");
      await refreshTaxonomy();
    } catch (e) {
      setError((e as Error & { body?: { error?: string } }).body?.error ?? (e as Error).message);
    }
  };

  const addField = async () => {
    setError(null);
    if (!fKey.trim() || !fLabel.trim()) return setError("field needs a key and a label");
    if (fType === "select" && !fOptions.trim()) return setError("select fields need options (comma-separated)");
    try {
      await api.addField(mapId, {
        key: fKey.trim(),
        label: fLabel.trim(),
        dataType: fType,
        ...(fType === "select" ? { options: fOptions.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
      });
      setFKey("");
      setFLabel("");
      setFOptions("");
      api.fields(mapId).then(setFacetRows).catch(() => {});
    } catch (e) {
      setError((e as Error & { body?: { error?: string } }).body?.error ?? (e as Error).message);
    }
  };

  return (
    <div className="panel manage">
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <h2>Manage map</h2>
      {!canWrite && <p className="hint">viewers can browse only — ask an editor to change the taxonomy</p>}

      <h3>Facets &amp; terms</h3>
      {facets.map((f) => (
        <div key={f.id} className="facet-row">
          <span className="filter-name">{f.name}</span>
          <span className="chips">
            {terms
              .filter((t) => t.facetId === f.id)
              .map((t) => (
                <span key={t.id} className="chip on" style={{ background: t.color, borderColor: t.color }}>
                  {t.name}
                </span>
              ))}
          </span>
        </div>
      ))}
      {canWrite && (
        <>
          <div className="row">
            <select value={newTermFacet} onChange={(e) => setNewTermFacet(e.target.value)} aria-label="Facet for new term">
              <option value="">facet…</option>
              {facets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <input value={newTermName} onChange={(e) => setNewTermName(e.target.value)} placeholder="New term (e.g. Cosy)" />
            <button onClick={() => void addTerm()}>Add term</button>
          </div>
          <div className="row">
            <input value={newFacetKey} onChange={(e) => setNewFacetKey(e.target.value)} placeholder="key (e.g. season)" />
            <input value={newFacetName} onChange={(e) => setNewFacetName(e.target.value)} placeholder="Name (e.g. Season)" />
            <button onClick={() => void addFacet()}>Add facet</button>
          </div>
        </>
      )}

      <h3>Custom fields</h3>
      {facetRows.length === 0 && <p className="hint">none yet — fields apply to every place on this map</p>}
      {facetRows.map((d) => (
        <p key={d.id} className="field-row">
          <strong>{d.label}</strong> <span className="who">{d.key} · {d.dataType}{d.filterable ? " · filterable" : ""}</span>
        </p>
      ))}
      {canWrite && (
        <>
          <div className="row">
            <input value={fKey} onChange={(e) => setFKey(e.target.value)} placeholder="key (e.g. wheelchair)" />
            <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Label (e.g. Step-free access)" />
          </div>
          <div className="row">
            <select value={fType} onChange={(e) => setFType(e.target.value as typeof fType)} aria-label="Field type">
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {fType === "select" && (
              <input value={fOptions} onChange={(e) => setFOptions(e.target.value)} placeholder="options, comma-separated" />
            )}
            <button onClick={() => void addField()}>Add field</button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

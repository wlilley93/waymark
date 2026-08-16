import { Button, Input, Select, Option, Textarea } from "../ui/controls.js";
import { useEffect, useState } from "react";
import type { MapPlaceDetail, FieldDefinitionRecord, TermRecord } from "@waymark/shared";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

// The edit flow ([2026] VJS-CC-WAYMARK 1 D4): PATCH carries If-Match; a 409
// surfaces the conflict with the current record rather than silently
// overwriting anything — last-write-wins is forbidden on map_places.

export function EditPlaceBox({
  mapId,
  mp,
  detail,
  terms,
  categoryFacetId,
  fieldDefs,
  onClose,
}: {
  mapId: string;
  mp: NonNullable<ReturnType<typeof useStore.getState>["places"]>["byId"][string];
  detail: MapPlaceDetail;
  terms: TermRecord[];
  categoryFacetId: string | undefined;
  fieldDefs: FieldDefinitionRecord[];
  onClose: () => void;
}) {
  const refreshSelected = useStore((s) => s.refreshSelected);
  const [sharedNote, setSharedNote] = useState(mp.sharedNote ?? "");
  const [primaryTermId, setPrimaryTermId] = useState(mp.primaryTermId ?? "");
  const [termIds, setTermIds] = useState<string[]>(mp.termIds);
  const [fields, setFields] = useState<Record<string, string | boolean>>(
    Object.fromEntries(Object.entries(detail.fieldValues).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v)])),
  );
  const [conflict, setConflict] = useState<{ currentVersion: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSharedNote(mp.sharedNote ?? "");
    setPrimaryTermId(mp.primaryTermId ?? "");
    setTermIds(mp.termIds);
    setConflict(null);
    setError(null);
  }, [mp.id, mp.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const otherTerms = terms.filter((t) => t.id !== primaryTermId);
  const editableFieldDefs = fieldDefs.filter((d) => d.dataType !== "select" || (d.options ?? []).length > 0);

  const save = async () => {
    setError(null);
    setConflict(null);
    const fieldPayload: Record<string, unknown> = {};
    for (const d of fieldDefs) {
      const raw = fields[d.key];
      if (raw === undefined || raw === "" ) continue;
      fieldPayload[d.key] = d.dataType === "boolean" ? Boolean(raw) : d.dataType === "number" ? Number(raw) : raw;
    }
    try {
      await api.patchMapPlace(mapId, mp.id, mp.version, {
        sharedNote: sharedNote.trim() || null,
        primaryTermId: primaryTermId || null,
        termIds: termIds,
        fields: fieldPayload,
      });
      onClose();
      refreshSelected();
    } catch (e) {
      const err = e as Error & { status?: number; body?: { error?: string; currentVersion?: number; details?: string[] } };
      if (err.status === 409) {
        setConflict({ currentVersion: err.body?.currentVersion ?? detail.version });
      } else if (err.status === 400 && err.body?.details) {
        setError(err.body.details.join("; "));
      } else {
        setError(err.body?.error ?? err.message);
      }
    }
  };

  return (
    <div className="edit-box">
      <h3>Edit bookmark</h3>
      <Textarea value={sharedNote} onChange={(e) => setSharedNote(e.target.value)} placeholder="Shared note for the group" rows={2} />

      <label>
        Primary category
        <Select value={primaryTermId} onChange={(e) => setPrimaryTermId(e.target.value)}>
          <Option value="">—</Option>
          {terms
            .filter((t) => t.facetId === categoryFacetId)
            .map((t) => (
              <Option key={t.id} value={t.id}>
                {t.name}
              </Option>
            ))}
        </Select>
      </label>

      <div className="chips">
        {otherTerms.map((t) => (
          <Button
            key={t.id}
            className={`chip ${termIds.includes(t.id) ? "on" : ""}`}
            style={termIds.includes(t.id) ? { background: t.color, borderColor: t.color } : {}}
            onClick={() => setTermIds((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {editableFieldDefs.length > 0 && (
        <>
          <h3>Fields</h3>
          {editableFieldDefs.map((d) =>
            d.dataType === "boolean" ? (
              <label key={d.id} className="checkbox">
                <Input
                  type="checkbox"
                  checked={fields[d.key] === true || fields[d.key] === "true"}
                  onChange={(e) => setFields((f) => ({ ...f, [d.key]: e.target.checked }))}
                />{" "}
                {d.label}
              </label>
            ) : d.dataType === "select" ? (
              <label key={d.id}>
                {d.label}
                <Select value={String(fields[d.key] ?? "")} onChange={(e) => setFields((f) => ({ ...f, [d.key]: e.target.value }))}>
                  <Option value="">—</Option>
                  {(d.options ?? []).map((o) => (
                    <Option key={o} value={o}>
                      {o}
                    </Option>
                  ))}
                </Select>
              </label>
            ) : (
              <label key={d.id}>
                {d.label}
                <Input
                  type={d.dataType === "number" ? "number" : d.dataType === "date" ? "date" : d.dataType === "url" ? "url" : "text"}
                  value={String(fields[d.key] ?? "")}
                  onChange={(e) => setFields((f) => ({ ...f, [d.key]: e.target.value }))}
                />
              </label>
            ),
          )}
        </>
      )}

      {conflict && (
        <p className="conflict">
          Someone edited this place while you were typing (they are on v{conflict.currentVersion}; you edited v{mp.version}).
          Your changes were NOT saved. Reload their version and re-apply what still matters.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="row">
        <Button className="primary" onClick={() => void save()}>
          Save (v{mp.version})
        </Button>
        <Button onClick={() => void refreshSelected()}>Reload</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client.ts";

interface TableInfo {
  table_name: string;
  row_estimate: number;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface PreviewResponse {
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

interface SnapshotKeyRow {
  meeting_date: string;
  venue_code: string;
  race_no: number;
  n: number;
}

const PAGE_SIZE = 50;

function snapshotKeyId(k: SnapshotKeyRow): string {
  return `${k.meeting_date}|${k.venue_code}|${k.race_no}`;
}

function confirmToken(k: SnapshotKeyRow): string {
  return `${k.venue_code}-${k.race_no}`;
}

function formatSnapshotKeyLabel(k: SnapshotKeyRow): string {
  return `${k.meeting_date} · ${k.venue_code} · Race ${k.race_no} (${k.n.toLocaleString()} rows)`;
}

export default function Database() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [page, setPage] = useState(0);

  const [snapshotKeys, setSnapshotKeys] = useState<SnapshotKeyRow[]>([]);
  const [snapshotKeysErr, setSnapshotKeysErr] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState("");
  const [backupBeforePurge, setBackupBeforePurge] = useState(true);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [purgeErr, setPurgeErr] = useState<string | null>(null);

  const loadSnapshotKeys = useCallback(() => {
    setSnapshotKeysErr(null);
    return apiFetch<{ keys: SnapshotKeyRow[] }>("/api/realtime/snapshot-keys")
      .then((r) => {
        const keys = r.keys ?? [];
        setSnapshotKeys(keys);
        setSelectedSnapshotId((prev) => {
          if (prev && keys.some((k) => snapshotKeyId(k) === prev)) return prev;
          return keys[0] ? snapshotKeyId(keys[0]) : "";
        });
      })
      .catch((e: Error) => {
        setSnapshotKeysErr(e.message);
        setSnapshotKeys([]);
      });
  }, []);

  useEffect(() => {
    apiFetch<TableInfo[]>("/api/db/tables").then(setTables).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected !== "hkjc_odds_snapshots") {
      setPurgeModalOpen(false);
      setSnapshotKeys([]);
      setSnapshotKeysErr(null);
      setSelectedSnapshotId("");
      return;
    }
    loadSnapshotKeys();
  }, [selected, loadSnapshotKeys]);

  useEffect(() => {
    if (!selected) return;
    setPage(0);
    apiFetch<ColumnInfo[]>(`/api/db/tables/${selected}/columns`).then(setColumns).catch(() => {});
    apiFetch<PreviewResponse>(`/api/db/tables/${selected}/preview?limit=${PAGE_SIZE}&offset=0`).then(setPreview).catch(() => {});
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    apiFetch<PreviewResponse>(`/api/db/tables/${selected}/preview?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      .then(setPreview)
      .catch(() => {});
  }, [page, selected]);

  const selectedSnapshot = useMemo(
    () => snapshotKeys.find((k) => snapshotKeyId(k) === selectedSnapshotId) ?? null,
    [snapshotKeys, selectedSnapshotId]
  );

  const openPurgeModal = () => {
    setPurgeErr(null);
    setPurgeMsg(null);
    setPurgeConfirm("");
    setPurgeModalOpen(true);
  };

  const closePurgeModal = () => {
    if (purgeLoading) return;
    setPurgeModalOpen(false);
    setPurgeConfirm("");
  };

  const runExportDownload = async (k: SnapshotKeyRow) => {
    const qs = new URLSearchParams({
      meeting_date: k.meeting_date,
      venue_code: k.venue_code,
      race_no: String(k.race_no),
    });
    const data = await apiFetch<{ snapshots: unknown[]; truncated?: boolean; limit?: number }>(
      `/api/realtime/snapshots/export?${qs}`
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hkjc_odds_snapshots_${k.meeting_date}_${k.venue_code}_r${k.race_no}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return data;
  };

  const runPurge = async () => {
    if (!selectedSnapshot) return;
    const token = confirmToken(selectedSnapshot);
    if (purgeConfirm.trim() !== token) {
      setPurgeErr(`Type exactly "${token}" to confirm.`);
      return;
    }
    setPurgeLoading(true);
    setPurgeErr(null);
    setPurgeMsg(null);
    try {
      let exportNote = "";
      if (backupBeforePurge) {
        const data = await runExportDownload(selectedSnapshot);
        if (data.truncated) {
          exportNote = `Export capped at ${data.limit ?? "?"} rows (truncated). Purge removed all rows for this race in the database.`;
        }
      }
      const r = await apiFetch<{ deleted: number }>("/api/realtime/snapshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_date: selectedSnapshot.meeting_date,
          venue_code: selectedSnapshot.venue_code,
          race_no: selectedSnapshot.race_no,
        }),
      });
      const parts = [
        exportNote,
        `Removed ${r.deleted.toLocaleString()} snapshot row(s).`,
      ].filter(Boolean);
      setPurgeMsg(parts.join(" "));
      await loadSnapshotKeys();
      setPurgeModalOpen(false);
      setPurgeConfirm("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPurgeErr(msg);
    } finally {
      setPurgeLoading(false);
    }
  };

  const columnNames = preview?.rows?.length ? Object.keys(preview.rows[0]) : [];
  const totalPages = preview ? Math.ceil(preview.total / PAGE_SIZE) : 0;

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700 }}>Database Tables</h2>
      <p className="muted" style={{ margin: "0 0 16px", fontSize: 13, maxWidth: "72ch" }}>
        Select <code>hkjc_odds_snapshots</code> below to manage stored odds rows (race list, purge, JSON backup). The race
        picker loads only for that table.
      </p>

      {purgeModalOpen && selectedSnapshot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePurgeModal();
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: "100%", margin: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="purge-modal-title" className="card-title" style={{ marginTop: 0 }}>
              Purge snapshots for this race?
            </h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {formatSnapshotKeyLabel(selectedSnapshot)}. This cannot be undone unless you kept a backup.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={backupBeforePurge}
                onChange={(e) => setBackupBeforePurge(e.target.checked)}
                disabled={purgeLoading}
              />
              <span>Download JSON backup first</span>
            </label>
            <label className="field-label">Type {confirmToken(selectedSnapshot)} to confirm</label>
            <input
              type="text"
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              autoComplete="off"
              disabled={purgeLoading}
              placeholder={confirmToken(selectedSnapshot)}
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0",
              }}
            />
            {purgeErr && <p className="error-text" style={{ marginBottom: 8 }}>{purgeErr}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost" onClick={closePurgeModal} disabled={purgeLoading}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ borderColor: "rgba(248, 113, 113, 0.5)", color: "#fecaca" }}
                onClick={() => void runPurge()}
                disabled={purgeLoading}
              >
                {purgeLoading ? "Working…" : "Confirm purge"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-list">
        {tables.map((t) => (
          <div
            key={t.table_name}
            className={`table-list-item${selected === t.table_name ? " selected" : ""}`}
            onClick={() => setSelected(t.table_name)}
          >
            <div className="tname">{t.table_name}</div>
            <div className="tcount">~{t.row_estimate.toLocaleString()} rows</div>
          </div>
        ))}
      </div>

      {selected === "hkjc_odds_snapshots" && (
        <div className="card" style={{ marginBottom: 20, borderColor: "rgba(248, 113, 113, 0.35)" }}>
          <h3 className="card-title" style={{ marginTop: 0 }}>
            HKJC odds snapshots
          </h3>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Remove all stored odds rows for one race to shrink <code>hkjc_odds_snapshots</code>. Purge and JSON export
            require <code>ODDS_SNAPSHOT_PURGE_ENABLED=true</code> on the server. Optional backup downloads up to 50k rows
            per race; if you hit the cap, run export again after purging in chunks or raise the server limit.
          </p>
          {snapshotKeysErr && <p className="error-text">{snapshotKeysErr}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ minWidth: 280, flex: "1 1 280px" }}>
              <label className="field-label">Race (with data)</label>
              <select
                value={selectedSnapshotId}
                onChange={(e) => setSelectedSnapshotId(e.target.value)}
                disabled={!snapshotKeys.length}
                style={{ width: "100%", maxWidth: 480 }}
              >
                {!snapshotKeys.length ? (
                  <option value="">No snapshot rows in database</option>
                ) : (
                  snapshotKeys.map((k) => (
                    <option key={snapshotKeyId(k)} value={snapshotKeyId(k)}>
                      {formatSnapshotKeyLabel(k)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button type="button" className="btn-secondary" onClick={() => loadSnapshotKeys()}>
              Refresh list
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ borderColor: "rgba(248, 113, 113, 0.5)", color: "#fecaca" }}
              onClick={openPurgeModal}
              disabled={!selectedSnapshot}
            >
              Purge selected race…
            </button>
          </div>
          {purgeMsg && !purgeModalOpen && (
            <p style={{ marginTop: 12, fontSize: 13, color: "#86efac" }}>{purgeMsg}</p>
          )}
        </div>
      )}

      {selected && columns.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Schema: {selected}</h3>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.column_name}>
                    <td style={{ fontWeight: 600 }}>{c.column_name}</td>
                    <td>{c.data_type}</td>
                    <td>{c.is_nullable}</td>
                    <td style={{ color: "#64748b", fontSize: 12 }}>{c.column_default ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && preview && (
        <div className="card">
          <h3 className="card-title">
            Data: {selected}
            <span style={{ fontWeight: 400, fontSize: 13, color: "#94a3b8", marginLeft: 12 }}>
              {preview.total.toLocaleString()} rows total
            </span>
          </h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {columnNames.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {columnNames.map((col) => (
                      <td key={col}>{formatCell(row[col])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span>Page {page + 1} / {totalPages}</span>
              <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {!selected && (
        <p style={{ color: "#64748b" }}>
          Select a table above to browse its schema and data. For odds snapshot purge and export, select{" "}
          <code>hkjc_odds_snapshots</code>.
        </p>
      )}
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

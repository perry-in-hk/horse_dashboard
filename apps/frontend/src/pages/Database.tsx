import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client.ts";
import PageHeader from "../components/PageHeader.tsx";

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
  return `${k.meeting_date} · ${k.venue_code} · 第 ${k.race_no} 場（${k.n.toLocaleString()} 筆）`;
}

export default function Database() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesErr, setTablesErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsErr, setColumnsErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [schemaOpen, setSchemaOpen] = useState(false);

  const [snapshotKeys, setSnapshotKeys] = useState<SnapshotKeyRow[]>([]);
  const [snapshotKeysLoading, setSnapshotKeysLoading] = useState(false);
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
    setSnapshotKeysLoading(true);
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
      })
      .finally(() => setSnapshotKeysLoading(false));
  }, []);

  useEffect(() => {
    setTablesLoading(true);
    setTablesErr(null);
    apiFetch<TableInfo[]>("/api/db/tables")
      .then(setTables)
      .catch((e: Error) => {
        setTablesErr(e.message);
        setTables([]);
      })
      .finally(() => setTablesLoading(false));
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
    setSchemaOpen(false);
    setColumnsLoading(true);
    setColumnsErr(null);
    setPreviewLoading(true);
    setPreviewErr(null);
    apiFetch<ColumnInfo[]>(`/api/db/tables/${selected}/columns`)
      .then(setColumns)
      .catch((e: Error) => {
        setColumnsErr(e.message);
        setColumns([]);
      })
      .finally(() => setColumnsLoading(false));
    apiFetch<PreviewResponse>(`/api/db/tables/${selected}/preview?limit=${PAGE_SIZE}&offset=0`)
      .then(setPreview)
      .catch((e: Error) => {
        setPreviewErr(e.message);
        setPreview(null);
      })
      .finally(() => setPreviewLoading(false));
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    setPreviewLoading(true);
    setPreviewErr(null);
    apiFetch<PreviewResponse>(`/api/db/tables/${selected}/preview?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      .then(setPreview)
      .catch((e: Error) => {
        setPreviewErr(e.message);
        setPreview(null);
      })
      .finally(() => setPreviewLoading(false));
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
      setPurgeErr(`請完整輸入 "${token}" 以確認。`);
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
          exportNote = `備份匯出上限為 ${data.limit ?? "?"} 筆（已截斷）。`;
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
        `已清除 ${r.deleted.toLocaleString()} 筆快照資料。`,
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
    <div className="db-page">
      <PageHeader title="Database Tables" subtitle="瀏覽資料表內容與維護快照資料。" />
      <p className="muted page-intro">
        先選擇資料表查看預覽與欄位；若需清理特定賽事快照，請切換至 <code>hkjc_odds_snapshots</code> 並使用下方維護區。
      </p>

      {purgeModalOpen && selectedSnapshot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-modal-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePurgeModal();
          }}
        >
          <div
            className="card modal-card db-purge-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="purge-modal-title" className="card-title">
              確認清除該場快照？
            </h3>
            <p className="muted db-purge-note">
              {formatSnapshotKeyLabel(selectedSnapshot)}。此操作不可復原，建議先匯出備份。
            </p>
            <label className="db-purge-check">
              <input
                type="checkbox"
                checked={backupBeforePurge}
                onChange={(e) => setBackupBeforePurge(e.target.checked)}
                disabled={purgeLoading}
              />
              <span>先下載 JSON 備份</span>
            </label>
            <label className="field-label">輸入 {confirmToken(selectedSnapshot)} 以確認</label>
            <input
              type="text"
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              autoComplete="off"
              disabled={purgeLoading}
              placeholder={confirmToken(selectedSnapshot)}
              className="scraper-input db-purge-input"
            />
            {purgeErr && <p className="error-text db-purge-err">{purgeErr}</p>}
            <div className="action-row db-purge-actions">
              <button type="button" className="btn btn-ghost" onClick={closePurgeModal} disabled={purgeLoading}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-danger-outline"
                onClick={() => void runPurge()}
                disabled={purgeLoading}
              >
                {purgeLoading ? "處理中…" : "確認清除"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card db-table-card">
        <h3 className="card-title">資料表選擇</h3>
        {tablesErr && <p className="error-text">{tablesErr}</p>}
        {tablesLoading ? <p className="muted status-line">載入資料表中…</p> : null}
        <div className="table-list">
          {tables.map((t) => (
            <button
              type="button"
            key={t.table_name}
            className={`table-list-item${selected === t.table_name ? " selected" : ""}`}
            onClick={() => setSelected(t.table_name)}
          >
            <div className="tname">{t.table_name}</div>
            <div className="tcount">約 {t.row_estimate.toLocaleString()} 筆</div>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="card db-preview-card">
          <h3 className="card-title">
            資料預覽：{selected}
            {preview ? <span className="muted db-total">共 {preview.total.toLocaleString()} 筆</span> : null}
          </h3>
          {previewLoading && <p className="muted status-line">載入資料中…</p>}
          {previewErr && <p className="error-text">{previewErr}</p>}
          {preview && (
            <>
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
                  <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    上一頁
                  </button>
                  <span>
                    第 {page + 1} / {totalPages} 頁
                  </span>
                  <button
                    className="btn btn-ghost"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一頁
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {selected === "hkjc_odds_snapshots" && (
        <section className="card db-snapshot-card">
          <h3 className="card-title">快照維護</h3>
          <p className="muted db-snapshot-intro">
            以賽事為單位清理快照資料，可先匯出備份再執行刪除。
          </p>
          {snapshotKeysLoading ? <p className="muted status-line">載入快照賽事清單中…</p> : null}
          {snapshotKeysErr && <p className="error-text">{snapshotKeysErr}</p>}
          <div className="action-row db-snapshot-actions">
            <div className="db-snapshot-race-select">
              <label className="field-label">有資料的賽事</label>
              <select
                value={selectedSnapshotId}
                onChange={(e) => setSelectedSnapshotId(e.target.value)}
                disabled={!snapshotKeys.length}
              >
                {!snapshotKeys.length ? (
                  <option value="">目前無可清理快照資料</option>
                ) : (
                  snapshotKeys.map((k) => (
                    <option key={snapshotKeyId(k)} value={snapshotKeyId(k)}>
                      {formatSnapshotKeyLabel(k)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => loadSnapshotKeys()}>
              更新清單
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-danger-outline"
              onClick={openPurgeModal}
              disabled={!selectedSnapshot}
            >
              清除所選賽事…
            </button>
          </div>
          {purgeMsg && !purgeModalOpen && (
            <p className="text-success-soft db-purge-msg">{purgeMsg}</p>
          )}
        </section>
      )}

      {selected && (
        <section className="card db-schema-card">
          <button type="button" className="db-schema-toggle" onClick={() => setSchemaOpen((v) => !v)}>
            <span>{schemaOpen ? "收合欄位結構" : "展開欄位結構"}</span>
            <span className="db-schema-toggle-icon">{schemaOpen ? "▲" : "▼"}</span>
          </button>
          {columnsLoading && <p className="muted status-line">載入欄位結構中…</p>}
          {columnsErr && <p className="error-text">{columnsErr}</p>}
          {schemaOpen && columns.length > 0 && (
            <div className="table-scroll db-schema-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>欄位</th>
                    <th>型別</th>
                    <th>可為空</th>
                    <th>預設值</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.column_name}>
                      <td className="db-col-name">{c.column_name}</td>
                      <td>{c.data_type}</td>
                      <td>{c.is_nullable}</td>
                      <td className="text-faint-inline db-col-default">
                        {c.column_default ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!selected && (
        <p className="muted">
          請先選擇資料表以查看資料預覽與欄位結構。
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

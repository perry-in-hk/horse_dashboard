import { useEffect, useState } from "react";
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

const PAGE_SIZE = 50;

export default function Database() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    apiFetch<TableInfo[]>("/api/db/tables").then(setTables).catch(() => {});
  }, []);

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

  const columnNames = preview?.rows?.length ? Object.keys(preview.rows[0]) : [];
  const totalPages = preview ? Math.ceil(preview.total / PAGE_SIZE) : 0;

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700 }}>Database Tables</h2>

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

      {!selected && <p style={{ color: "#64748b" }}>Select a table above to browse its schema and data.</p>}
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

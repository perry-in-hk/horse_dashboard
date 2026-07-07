import SystemWorkflowDiagrams from "../components/SystemWorkflowDiagrams.tsx";
import PageHeader from "../components/PageHeader.tsx";

export default function Settings() {
  return (
    <div className="settings-page">
      <PageHeader title="Settings" subtitle="查看系統流程與維運資訊。" />

      <section className="card settings-intro">
        <h2 className="card-title">操作導覽</h2>
        <p className="muted">
          日常維運建議先在 <strong>Realtime</strong> 監看同步，再以 <strong>Scraper</strong> 進行資料補齊。本頁提供系統流程與維運指引。
        </p>
      </section>

      <section className="card settings-intro">
        <h2 className="card-title">帳號管理</h2>
        <p className="muted">
          帳號、密碼與角色由身分管理平台集中維護。若需新增或調整權限，請聯絡系統管理員於 Keycloak 後台處理。
        </p>
      </section>

      <section className="card settings-infra">
        <h2 className="card-title">系統流程總覽</h2>
        <p className="settings-infra-lead">
          下方流程圖會依主題色自動調整，分別展示設定來源、資料流、智能分析與部署啟動順序。
        </p>
        <p className="settings-infra-lead settings-infra-note">
          這些圖用於日常溝通與維運判讀；若需要實作細節，請參考專案文件。
        </p>

        <div className="settings-legend card">
          <h3 className="settings-legend-title">圖形說明</h3>
          <ul className="settings-legend-list">
            <li>
              <strong>圓角形</strong>：使用者或流程起點 / 終點。
            </li>
            <li>
              <strong>矩形</strong>：系統步驟或服務節點。
            </li>
            <li>
              <strong>圓柱</strong>：資料儲存層（例如資料庫）。
            </li>
            <li>
              <strong>六角形</strong>：外部系統來源。
            </li>
          </ul>
        </div>

        <SystemWorkflowDiagrams />
      </section>
    </div>
  );
}

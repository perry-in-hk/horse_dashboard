import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import AppLogo from "../components/AppLogo.tsx";

export default function Login() {
  const { user, loading, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const callbackError = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("error");
  }, []);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">載入中…</p>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/analysis" replace />;
  }

  async function onLoginClick() {
    setError(null);
    setSubmitting(true);
    try {
      await login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗");
      setSubmitting(false);
      return;
    } finally {
      setTimeout(() => setSubmitting(false), 1200);
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <div className="login-brand-row">
          <AppLogo size={36} showWordmark />
        </div>
        <h1 className="card-title">使用 Keycloak 登入</h1>
        <p className="muted login-lead">請透過身分管理平台登入後繼續使用儀表板。</p>
        {callbackError ? <p className="login-error">登入失敗：{callbackError}</p> : null}
        {error ? <p className="login-error">{error}</p> : null}
        <button type="button" className="btn btn-primary login-submit" disabled={submitting} onClick={onLoginClick}>
          {submitting ? "前往登入中…" : "前往 Keycloak"}
        </button>
      </div>
    </div>
  );
}

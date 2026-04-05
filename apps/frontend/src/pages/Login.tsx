import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";

export default function Login() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/analysis" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <h1 className="card-title">Sign in</h1>
        <p className="muted login-lead">HKJC Dashboard</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-label">
            Username
            <input
              className="login-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="login-label">
            Password
            <input
              className="login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" className="btn-primary login-submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

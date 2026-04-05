import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { apiFetch } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";

type UserRow = {
  id: number;
  username: string;
  role: string;
  created_at: string;
};

export default function UserAdminSection() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role !== "admin") return;
    apiFetch<{ users: UserRow[] }>("/api/users")
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, [user?.role]);

  if (user?.role !== "admin") return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, role }),
      });
      setUsername("");
      setPassword("");
      setRole("user");
      const r = await apiFetch<{ users: UserRow[] }>("/api/users");
      setUsers(r.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-intro">
      <h2 className="card-title">Users (admin)</h2>
      <p className="muted">
        Create additional accounts. The first administrator is provisioned during initial deployment when no users exist yet.
      </p>

      <form className="user-admin-form" onSubmit={onSubmit}>
        <div className="user-admin-row">
          <label className="user-admin-label">
            Username
            <input
              className="user-admin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label className="user-admin-label">
            Password (min 8)
            <input
              className="user-admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="user-admin-label">
            Role
            <select className="user-admin-input" value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        {error ? <p className="login-error">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create user"}
        </button>
      </form>

      <div className="user-admin-table-wrap">
        <table className="user-admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{new Date(u.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

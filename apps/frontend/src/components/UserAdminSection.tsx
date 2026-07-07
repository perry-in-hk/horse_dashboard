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
      setError(err instanceof Error ? err.message : "建立帳號失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-intro">
      <h2 className="card-title">帳號與權限（管理員）</h2>
      <p className="muted">
        建立團隊帳號並指定角色。首次管理員帳號可由伺服器的 <code>AUTH_INITIAL_USERNAME</code> /{" "}
        <code>AUTH_INITIAL_PASSWORD</code> 於空資料庫時初始化。
      </p>

      <form className="login-form" onSubmit={onSubmit}>
        <label className="login-label">
          帳號
          <input
            className="login-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="login-label">
          密碼（至少 8 字元）
          <input
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        <label className="login-label">
          角色
          <select className="login-input" value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="btn-primary login-submit" type="submit" disabled={busy}>
          {busy ? "建立中…" : "建立帳號"}
        </button>
      </form>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>帳號</th>
              <th>角色</th>
              <th>建立時間</th>
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
            {!users.length ? (
              <tr>
                <td colSpan={4} className="muted">
                  目前沒有可顯示的使用者資料。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

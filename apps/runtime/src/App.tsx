import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { SchemaRenderer } from "@lcdp/renderer";
import type { AppInfo, Snapshot, UserInfo } from "./api.js";
import { api, getStoredUser, makeAdapter, storeSession } from "./api.js";

/**
 * 运行态应用壳（M1）：登录 -> 应用列表 -> 进入应用后按快照的 PageSchema 渲染。
 * 路由用 hash（Pages 静态托管免改写规则）：#/app/<appId><页面路由>?id=<记录id>
 */

interface Route {
  path: string;
  params: Record<string, string>;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { path: path || "/", params };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

interface Toast {
  message: string;
  kind: "ok" | "error";
}

const shell = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#111827",
} as const;

export default function App() {
  const route = useHashRoute();
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = (message: string, kind: "ok" | "error" = "ok") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  };

  const logout = () => {
    storeSession(null, null);
    setUser(null);
    window.location.hash = "#/";
  };

  const match = route.path.match(/^\/app\/([^/]+)(\/.*)?$/);
  const appId = match ? decodeURIComponent(match[1]!) : null;
  const inPath = match?.[2] ?? "/";

  return (
    <div style={shell}>
      {!user ? (
        <LoginView
          onLoggedIn={(u) => {
            setUser(u);
            window.location.hash = "#/";
          }}
        />
      ) : !appId ? (
        <AppsView user={user} onLogout={logout} notify={notify} />
      ) : (
        <AppView
          appId={appId}
          inPath={inPath}
          params={route.params}
          user={user}
          onLogout={logout}
          notify={notify}
        />
      )}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 28,
            transform: "translateX(-50%)",
            background: toast.kind === "error" ? "#991b1b" : "#065f46",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 14,
            boxShadow: "0 6px 24px rgba(0,0,0,.25)",
            zIndex: 50,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function LoginView({ onLoggedIn }: { onLoggedIn: (user: UserInfo) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username.trim(), password);
      onLoggedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9fafb",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 340,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 28,
          boxShadow: "0 8px 30px rgba(0,0,0,.06)",
        }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>LCDP Runtime · 运行态</h1>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 20px" }}>
          登录后进入已发布应用（管理员账号在初始化向导中设置）
        </p>
        <label style={{ display: "block", fontSize: 14, marginBottom: 12 }}>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={loginInput}
            autoComplete="username"
          />
        </label>
        <label style={{ display: "block", fontSize: 14, marginBottom: 16 }}>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={loginInput}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "9px 0",
            borderRadius: 8,
            border: "1px solid #2563eb",
            background: "#2563eb",
            color: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </main>
  );
}

const loginInput = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
} as const;

function AppsView({
  user,
  onLogout,
  notify,
}: {
  user: UserInfo;
  onLogout: () => void;
  notify: (message: string, kind?: "ok" | "error") => void;
}) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .apps()
      .then(setApps)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        notify(msg, "error");
      });
  }, [notify]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>我的应用</h1>
          <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>
            {user.username}（{user.role}）· 选择一个应用进入运行态
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onLogout} style={ghostBtn}>
          退出登录
        </button>
      </header>
      {error && <div style={errorBox}>{error}</div>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => {
              window.location.hash = `#/app/${encodeURIComponent(app.id)}`;
            }}
            style={{
              textAlign: "left",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 20,
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(0,0,0,.04)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600 }}>{app.name}</div>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 6 }}>
              场景：{app.scenario ?? "—"}
            </div>
          </button>
        ))}
        {apps.length === 0 && !error && (
          <p style={{ color: "#9ca3af" }}>暂无应用（先完成平台初始化）</p>
        )}
      </div>
    </main>
  );
}

const ghostBtn = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
} as const;

const errorBox = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 14,
  marginBottom: 12,
} as const;

function AppView({
  appId,
  inPath,
  params,
  user,
  onLogout,
  notify,
}: {
  appId: string;
  inPath: string;
  params: Record<string, string>;
  user: UserInfo;
  onLogout: () => void;
  notify: (message: string, kind?: "ok" | "error") => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    api
      .snapshot(appId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [appId]);

  const adapter = useMemo(
    () =>
      makeAdapter(
        appId,
        (to) => {
          window.location.hash = `#/app/${encodeURIComponent(appId)}${to}`;
        },
        notify,
      ),
    [appId, notify],
  );

  if (error) {
    return (
      <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <div style={errorBox}>{error}</div>
        <button
          style={ghostBtn}
          onClick={() => {
            window.location.hash = "#/";
          }}
        >
          返回应用列表
        </button>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main style={{ padding: 40, color: "#6b7280" }}>正在加载应用…</main>
    );
  }

  const listPages = snapshot.pages.filter((p) =>
    p.root.children?.some((ch) => ch.type === "DataTable"),
  );
  const current =
    snapshot.pages.find((p) => p.route === inPath) ??
    (inPath === "/" ? listPages[0] : undefined);

  const navLabel = (page: Snapshot["pages"][number]): string => {
    const ref = page.dataSources[0]?.ref;
    const entity = snapshot.data.entities.find((e) => e.key === ref);
    return entity?.label ?? page.name;
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 208,
          flexShrink: 0,
          borderRight: "1px solid #e5e7eb",
          background: "#f9fafb",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>
          {snapshot.app.name}
        </div>
        <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 14 }}>
          LCDP Runtime
        </div>
        {listPages.map((page) => (
          <button
            key={page.id}
            onClick={() => {
              window.location.hash = `#/app/${encodeURIComponent(appId)}${page.route}`;
            }}
            style={{
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 7,
              border: "1px solid transparent",
              background:
                current?.route === page.route ? "#e0e7ff" : "transparent",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {navLabel(page)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          style={{ ...ghostBtn, textAlign: "left" }}
          onClick={() => {
            window.location.hash = "#/";
          }}
        >
          ← 应用列表
        </button>
        <button
          style={{ ...ghostBtn, textAlign: "left", marginTop: 6 }}
          onClick={onLogout}
        >
          退出（{user.username}）
        </button>
      </aside>
      <main style={{ flex: 1, padding: "24px 28px", minWidth: 0 }}>
        {current ? (
          <SchemaRenderer
            page={current}
            dataSchema={snapshot.data}
            adapter={adapter}
            params={params}
          />
        ) : (
          <div style={{ color: "#9ca3af" }}>页面不存在：{inPath}</div>
        )}
      </main>
    </div>
  );
}

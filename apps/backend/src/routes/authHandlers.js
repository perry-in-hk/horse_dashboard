import { pool } from "../db.js";
import {
  buildLoginRedirect,
  buildLogoutRedirect,
  exchangeAuthorizationCode,
  getPostLogoutUri,
} from "../keycloak.js";

export async function login(req, res) {
  try {
    const loginUrl = await buildLoginRedirect(req);
    res.redirect(loginUrl.href);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to start Keycloak login" });
  }
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function deriveRole(idTokenClaims, accessTokenClaims, clientId) {
  const realmRoles = [
    ...(Array.isArray(idTokenClaims?.realm_access?.roles) ? idTokenClaims.realm_access.roles : []),
    ...(Array.isArray(accessTokenClaims?.realm_access?.roles) ? accessTokenClaims.realm_access.roles : []),
  ];
  const clientRoles = [
    ...(Array.isArray(idTokenClaims?.resource_access?.[clientId]?.roles)
      ? idTokenClaims.resource_access[clientId].roles
      : []),
    ...(Array.isArray(accessTokenClaims?.resource_access?.[clientId]?.roles)
      ? accessTokenClaims.resource_access[clientId].roles
      : []),
  ];
  const merged = [...realmRoles, ...clientRoles];

  if (merged.includes("admin")) return "admin";
  if (merged.includes("user")) return "user";
  return null;
}

async function upsertUserFromKeycloakClaims(idTokenClaims, accessTokenClaims) {
  const sub = typeof idTokenClaims?.sub === "string" ? idTokenClaims.sub : "";
  if (!sub) {
    throw new Error("Missing subject claim");
  }

  const preferredUsernameRaw =
    typeof idTokenClaims?.preferred_username === "string"
      ? idTokenClaims.preferred_username
      : typeof idTokenClaims?.email === "string"
        ? idTokenClaims.email
        : "";
  const preferredUsername = preferredUsernameRaw.trim().slice(0, 128);
  if (!preferredUsername) {
    throw new Error("Missing preferred_username/email claim");
  }

  const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim() || "hkjc-dashboard";
  const role = deriveRole(idTokenClaims, accessTokenClaims, clientId);
  if (!role) {
    const err = new Error("Missing dashboard role");
    err.statusCode = 403;
    throw err;
  }

  const { rows } = await pool.query(
    `
      INSERT INTO dashboard_users (username, password_hash, role, keycloak_sub)
      VALUES ($1, NULL, $2, $3)
      ON CONFLICT (keycloak_sub) WHERE keycloak_sub IS NOT NULL
      DO UPDATE SET
        username = EXCLUDED.username,
        role = EXCLUDED.role
      RETURNING id, username, role
    `,
    [preferredUsername, role, sub]
  );

  return rows[0];
}

export async function callback(req, res) {
  try {
    const tokens = await exchangeAuthorizationCode(req);
    const idTokenClaims = tokens.claims();
    const accessTokenClaims = decodeJwtPayload(tokens.access_token);
    const user = await upsertUserFromKeycloakClaims(idTokenClaims, accessTokenClaims);
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.redirect("/login?error=Session%20regenerate%20failed");
      }
      req.session.oidc = null;
      req.session.userId = user.id;
      req.session.keycloakIdToken = tokens.id_token ?? null;
      res.redirect("/analysis");
    });
  } catch (e) {
    const cause = e?.cause;
    const detail =
      typeof cause?.error_description === "string"
        ? cause.error_description
        : typeof cause?.error === "string"
          ? cause.error
          : e?.message || "Keycloak login failed";
    console.error("OIDC callback failed:", detail, cause ?? e);
    req.session.oidc = null;
    const message = encodeURIComponent(detail);
    res.redirect(`/login?error=${message}`);
  }
}

export async function logout(req, res) {
  const idTokenHint = req.session?.keycloakIdToken ?? undefined;
  const fallbackRedirect = getPostLogoutUri(req);

  req.session.destroy(async (err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }

    let redirectUrl = fallbackRedirect;
    try {
      const endSessionUrl = await buildLogoutRedirect(req, idTokenHint);
      redirectUrl = endSessionUrl.href;
    } catch (e) {
      console.error(e);
    }

    res.json({ ok: true, redirectUrl });
  });
}

export function me(req, res) {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    },
  });
}

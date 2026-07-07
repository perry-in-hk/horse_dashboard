import * as oidc from "openid-client";

const realm = process.env.KEYCLOAK_REALM?.trim() || "hkjc";
const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim() || "hkjc-dashboard";
const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET?.trim();
const publicBaseUrl = process.env.KEYCLOAK_PUBLIC_BASE_URL?.trim();
const internalBaseUrl = process.env.KEYCLOAK_INTERNAL_BASE_URL?.trim();

if (!clientSecret) {
  throw new Error("Missing KEYCLOAK_CLIENT_SECRET");
}
if (!publicBaseUrl) {
  throw new Error("Missing KEYCLOAK_PUBLIC_BASE_URL");
}
if (!internalBaseUrl) {
  throw new Error("Missing KEYCLOAK_INTERNAL_BASE_URL");
}

const publicIssuerUrl = new URL(`${publicBaseUrl.replace(/\/+$/, "")}/realms/${realm}`);
const internalIssuerUrl = new URL(`${internalBaseUrl.replace(/\/+$/, "")}/realms/${realm}`);
const useInsecureDiscovery = publicIssuerUrl.protocol === "http:";

function mapToInternalUrl(input) {
  const url = new URL(input.toString());
  if (url.origin !== publicIssuerUrl.origin) {
    return url;
  }
  url.protocol = internalIssuerUrl.protocol;
  url.host = internalIssuerUrl.host;
  return url;
}

async function keycloakFetch(input, init) {
  return fetch(mapToInternalUrl(input), init);
}

function getBrowserOrigin(req) {
  const explicitBrowserOrigin = process.env.AUTH_BROWSER_ORIGIN?.trim();
  if (explicitBrowserOrigin) {
    try {
      return new URL(explicitBrowserOrigin).origin;
    } catch {
      // ignore malformed env and continue detection
    }
  }

  const originHeader = req.get("origin");
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      // ignore malformed origin and fallback below
    }
  }

  const forwardedProto = req.get("x-forwarded-proto");
  const forwardedHost = req.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get("host") || "";
  if (host === "localhost:4000" || host === "127.0.0.1:4000") {
    return "http://localhost:5173";
  }

  return `${req.protocol}://${req.get("host")}`;
}

function mapToBrowserUrl(req, url) {
  const publicBase = new URL(publicBaseUrl.replace(/\/+$/, ""));
  const mapped = new URL(url.toString());
  mapped.protocol = publicBase.protocol;
  mapped.host = publicBase.host;
  return mapped;
}

let configPromise;

async function getConfig() {
  if (!configPromise) {
    configPromise = oidc.discovery(
      publicIssuerUrl,
      clientId,
      undefined,
      oidc.ClientSecretBasic(clientSecret),
      {
        ...(useInsecureDiscovery ? { execute: [oidc.allowInsecureRequests] } : {}),
        [oidc.customFetch]: keycloakFetch,
      }
    );
  }
  return configPromise;
}

export function getCallbackUrl(req) {
  return `${getBrowserOrigin(req)}${req.originalUrl}`;
}

export function getRedirectUri(req) {
  return `${getBrowserOrigin(req)}/api/auth/callback`;
}

export function getPostLogoutUri(req) {
  return `${getBrowserOrigin(req)}/login`;
}

export async function buildLoginRedirect(req) {
  const config = await getConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  req.session.oidc = {
    codeVerifier,
    state,
    nonce,
  };

  const loginUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: getRedirectUri(req),
    scope: "openid profile email roles",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return mapToBrowserUrl(req, loginUrl);
}

export async function exchangeAuthorizationCode(req) {
  const config = await getConfig();
  const checks = req.session.oidc;
  if (!checks?.codeVerifier || !checks?.state || !checks?.nonce) {
    throw new Error("Missing OIDC session checks");
  }

  // Must match redirect_uri from buildLoginRedirect (see panva/openid-client#782).
  const currentUrl = new URL(getCallbackUrl(req));
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
  });

  return tokens;
}

export async function buildLogoutRedirect(req, idTokenHint) {
  const config = await getConfig();
  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    post_logout_redirect_uri: getPostLogoutUri(req),
    client_id: clientId,
    id_token_hint: idTokenHint,
  });
  return mapToBrowserUrl(req, endSessionUrl);
}

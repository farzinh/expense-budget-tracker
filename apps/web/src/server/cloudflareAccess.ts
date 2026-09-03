/**
 * Cloudflare Access JWT verification for the web app.
 *
 * Used when AUTH_MODE=cloudflare_access, the self-hosted counterpart to the
 * Cognito path. Cloudflare Access authenticates the user at the edge and
 * forwards a signed assertion; this module verifies it and nothing else.
 * There is no login, refresh, or logout here — Access owns the whole session
 * lifecycle and re-issues the assertion on every request it proxies.
 *
 * Verified against the team's public keys:
 *   issuer   https://<team>.cloudflareaccess.com
 *   jwks     https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
 *   audience the Application Audience (AUD) tag of the Access application
 *
 * The audience check is what binds an assertion to *this* application. Without
 * it any token issued to any application in the same Cloudflare team would be
 * accepted, so CF_ACCESS_AUD is required rather than optional.
 */
import { JwtRsaVerifier } from "aws-jwt-verify";

export const CF_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
export const CF_ACCESS_COOKIE = "CF_Authorization";

export type CloudflareAccessIdentity = Readonly<{
  userId: string;
  email: string;
}>;

/**
 * Accepts either a bare team name ("acme") or a full domain
 * ("acme.cloudflareaccess.com", with or without scheme), because the
 * Cloudflare dashboard shows it in more than one form.
 */
const normalizeTeamDomain = (raw: string): string => {
  const withoutScheme = raw.trim().replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  if (withoutScheme === "") {
    throw new Error("CF_ACCESS_TEAM_DOMAIN is not configured");
  }
  return withoutScheme.includes(".")
    ? withoutScheme
    : `${withoutScheme}.cloudflareaccess.com`;
};

const getTeamDomain = (): string =>
  normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN ?? "");

const getAudience = (): string => {
  const audience = process.env.CF_ACCESS_AUD ?? "";
  if (audience === "") throw new Error("CF_ACCESS_AUD is not configured");
  return audience;
};

let verifier: ReturnType<typeof JwtRsaVerifier.create> | undefined;

export const getAccessJwtVerifier = (): ReturnType<typeof JwtRsaVerifier.create> => {
  if (verifier !== undefined) return verifier;
  const teamDomain = getTeamDomain();
  verifier = JwtRsaVerifier.create({
    issuer: `https://${teamDomain}`,
    audience: getAudience(),
    jwksUri: `https://${teamDomain}/cdn-cgi/access/certs`,
  });
  return verifier;
};

/** Reset the memoized verifier. Tests only. */
export const resetAccessJwtVerifier = (): void => {
  verifier = undefined;
};

/**
 * Verify an Access assertion and extract the app's identity contract.
 *
 * `email_verified` is not part of the Access token: Cloudflare only mints an
 * assertion after the configured identity provider has authenticated the user,
 * so a verified email is implied by the token existing at all.
 */
export const verifyAccessAssertion = async (assertion: string): Promise<CloudflareAccessIdentity> => {
  const payload = await getAccessJwtVerifier().verify(assertion);

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Cloudflare Access token missing sub claim");
  }

  const email = "email" in payload ? payload.email : undefined;
  if (typeof email !== "string" || email.length === 0) {
    throw new Error("Cloudflare Access token missing email claim");
  }

  return { userId: sub, email };
};

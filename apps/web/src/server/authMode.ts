export type AuthMode = "none" | "cognito" | "cloudflare_access";

type AuthModeEnv = Readonly<{
  AUTH_MODE?: string;
  NODE_ENV?: string;
  HOST?: string;
  CORS_ORIGIN?: string;
  ALLOW_INSECURE_NO_AUTH?: string;
}>;

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
]);

const AUTH_MODES: ReadonlySet<string> = new Set<AuthMode>([
  "none",
  "cognito",
  "cloudflare_access",
]);

const normalizeHost = (value: string): string =>
  value.replace(/^\[(.*)\]$/u, "$1").trim().toLowerCase();

const isLocalHost = (value: string): boolean =>
  LOCAL_HOSTS.has(normalizeHost(value));

const isLocalHttpOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLocalHost(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Opt-in that lets AUTH_MODE=none run inside a container for local testing.
 *
 * The production image sets NODE_ENV=production and binds 0.0.0.0, so the
 * NODE_ENV and HOST checks below reject it by default. Neither check can
 * observe whether the container's port is actually published, so this flag
 * exists to make "I know this is unauthenticated" explicit and greppable.
 *
 * It deliberately does NOT waive the CORS_ORIGIN check: that requirement is
 * what keeps the escape hatch local-only, since a browser has to reach the app
 * at the configured origin for CSRF validation to pass.
 */
const isInsecureNoAuthOptIn = (env: AuthModeEnv): boolean =>
  env.ALLOW_INSECURE_NO_AUTH === "true";

export const getAuthModeValidationErrors = (env: AuthModeEnv): ReadonlyArray<string> => {
  const rawAuthMode = env.AUTH_MODE;
  if (rawAuthMode === undefined || rawAuthMode.trim() === "") {
    return ['AUTH_MODE must be set explicitly to "none", "cognito", or "cloudflare_access"'];
  }

  if (!AUTH_MODES.has(rawAuthMode)) {
    return [`Invalid AUTH_MODE="${rawAuthMode}". Expected "none", "cognito", or "cloudflare_access"`];
  }

  if (rawAuthMode === "cognito" || rawAuthMode === "cloudflare_access") {
    return [];
  }

  const errors: Array<string> = [];
  const insecureOptIn = isInsecureNoAuthOptIn(env);

  if (env.NODE_ENV === "production" && !insecureOptIn) {
    errors.push(
      "AUTH_MODE=none is not allowed when NODE_ENV=production"
      + " (set ALLOW_INSECURE_NO_AUTH=true to run the container locally without auth)",
    );
  }

  const host = env.HOST ?? "127.0.0.1";
  if (!isLocalHost(host) && !insecureOptIn) {
    errors.push(
      `AUTH_MODE=none requires HOST to be localhost, 127.0.0.1, or ::1. Received "${host}"`
      + " (set ALLOW_INSECURE_NO_AUTH=true to run the container locally without auth)",
    );
  }

  // Never waived by ALLOW_INSECURE_NO_AUTH: this is the check that confines the
  // opt-in to a local origin.
  const corsOrigin = env.CORS_ORIGIN;
  if (corsOrigin === undefined || corsOrigin.trim() === "") {
    errors.push("AUTH_MODE=none requires CORS_ORIGIN to be set to a local http origin");
  } else if (!isLocalHttpOrigin(corsOrigin)) {
    errors.push(
      `AUTH_MODE=none requires CORS_ORIGIN to be a local http origin (localhost, 127.0.0.1, or ::1). Received "${corsOrigin}"`,
    );
  }

  return errors;
};

export const getConfiguredAuthMode = (env: AuthModeEnv): AuthMode => {
  const errors = getAuthModeValidationErrors(env);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const authMode = env.AUTH_MODE;
  if (authMode === "none" || authMode === "cognito" || authMode === "cloudflare_access") {
    return authMode;
  }

  throw new Error('AUTH_MODE must be set explicitly to "none", "cognito", or "cloudflare_access"');
};

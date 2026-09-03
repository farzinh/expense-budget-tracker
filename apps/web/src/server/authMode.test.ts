import assert from "node:assert/strict";
import test from "node:test";

import { getAuthModeValidationErrors, getConfiguredAuthMode } from "@/server/authMode";

const LOCAL_NONE_ENV = {
  AUTH_MODE: "none",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  CORS_ORIGIN: "http://localhost:3000",
};

const CONTAINER_ENV = {
  AUTH_MODE: "none",
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  CORS_ORIGIN: "http://localhost:3000",
};

test("AUTH_MODE must be set explicitly", (): void => {
  assert.deepEqual(getAuthModeValidationErrors({}), [
    'AUTH_MODE must be set explicitly to "none", "cognito", or "cloudflare_access"',
  ]);
});

test("AUTH_MODE rejects an unknown mode", (): void => {
  assert.deepEqual(getAuthModeValidationErrors({ AUTH_MODE: "oidc" }), [
    'Invalid AUTH_MODE="oidc". Expected "none", "cognito", or "cloudflare_access"',
  ]);
});

test("cognito and cloudflare_access need no local-host constraints", (): void => {
  assert.deepEqual(getAuthModeValidationErrors({ AUTH_MODE: "cognito" }), []);
  assert.deepEqual(getAuthModeValidationErrors({ AUTH_MODE: "cloudflare_access" }), []);
  assert.equal(getConfiguredAuthMode({ AUTH_MODE: "cloudflare_access" }), "cloudflare_access");
});

test("AUTH_MODE=none is accepted for local development", (): void => {
  assert.deepEqual(getAuthModeValidationErrors(LOCAL_NONE_ENV), []);
  assert.equal(getConfiguredAuthMode(LOCAL_NONE_ENV), "none");
});

test("AUTH_MODE=none in a container is rejected without the opt-in", (): void => {
  const errors = getAuthModeValidationErrors(CONTAINER_ENV);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /not allowed when NODE_ENV=production/u);
  assert.match(errors[1], /requires HOST to be localhost/u);
});

test("ALLOW_INSECURE_NO_AUTH permits AUTH_MODE=none in a container", (): void => {
  assert.deepEqual(
    getAuthModeValidationErrors({ ...CONTAINER_ENV, ALLOW_INSECURE_NO_AUTH: "true" }),
    [],
  );
});

test("ALLOW_INSECURE_NO_AUTH only counts when exactly \"true\"", (): void => {
  for (const value of ["1", "yes", "TRUE", ""]) {
    const errors = getAuthModeValidationErrors({ ...CONTAINER_ENV, ALLOW_INSECURE_NO_AUTH: value });
    assert.notDeepEqual(errors, [], `ALLOW_INSECURE_NO_AUTH=${value} must not enable the opt-in`);
  }
});

/**
 * The security property that keeps the escape hatch local-only: the opt-in
 * waives the NODE_ENV and HOST checks but never the origin check, so it cannot
 * be used to serve an unauthenticated app on a public domain.
 */
test("ALLOW_INSECURE_NO_AUTH never waives the local-origin requirement", (): void => {
  const errors = getAuthModeValidationErrors({
    ...CONTAINER_ENV,
    CORS_ORIGIN: "https://money.example.com",
    ALLOW_INSECURE_NO_AUTH: "true",
  });
  assert.deepEqual(errors, [
    'AUTH_MODE=none requires CORS_ORIGIN to be a local http origin (localhost, 127.0.0.1, or ::1). Received "https://money.example.com"',
  ]);
  assert.throws(
    () => getConfiguredAuthMode({
      ...CONTAINER_ENV,
      CORS_ORIGIN: "https://money.example.com",
      ALLOW_INSECURE_NO_AUTH: "true",
    }),
    /local http origin/u,
  );
});

test("ALLOW_INSECURE_NO_AUTH still requires CORS_ORIGIN to be present", (): void => {
  assert.deepEqual(
    getAuthModeValidationErrors({
      AUTH_MODE: "none",
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      ALLOW_INSECURE_NO_AUTH: "true",
    }),
    ["AUTH_MODE=none requires CORS_ORIGIN to be set to a local http origin"],
  );
});

# Built from the repository root, not from apps/worker.
#
# This is an npm workspace: the lockfile and every workspace manifest live
# above apps/worker, so a build context scoped to this directory cannot see
# package-lock.json. `compose.yml` sets `context: ../..` to match.

FROM node:24.20.0-alpine AS npm
RUN npm install --global npm@12.0.2

# --- Stage 1: Install dependencies ---
# Only the manifests are copied first, so the install layer is reused whenever
# source changes but dependencies do not. npm ci needs every workspace manifest
# present to validate them against the root lockfile.
FROM npm AS deps
WORKDIR /workspace
COPY .npmrc package.json package-lock.json ./
COPY apps/auth/package.json apps/auth/package.json
COPY apps/sql-api/package.json apps/sql-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agent-shared/package.json packages/agent-shared/package.json
COPY infra/aws/package.json infra/aws/package.json
RUN npm ci --workspace expense-budget-tracker-worker --include-workspace-root

# --- Stage 2: Build ---
FROM deps AS builder
WORKDIR /workspace
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src/ apps/worker/src/
RUN cd apps/worker && ../../node_modules/.bin/tsc

# --- Stage 3: Production runner ---
FROM npm AS runner
WORKDIR /workspace
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

COPY .npmrc package.json package-lock.json ./
COPY apps/auth/package.json apps/auth/package.json
COPY apps/sql-api/package.json apps/sql-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agent-shared/package.json packages/agent-shared/package.json
COPY infra/aws/package.json infra/aws/package.json
RUN npm ci --omit=dev --workspace expense-budget-tracker-worker --include-workspace-root

COPY --from=builder /workspace/apps/worker/dist/ apps/worker/dist/

USER worker
CMD ["node", "apps/worker/dist/scheduler.js"]

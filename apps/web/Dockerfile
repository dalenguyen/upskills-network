# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY libs/gcloud/package.json ./libs/gcloud/
RUN pnpm install --frozen-lockfile

COPY . .

# The Firebase web config is baked into the client bundle at build time: Vite
# substitutes `import.meta.env.VITE_…` textually during the build, so a value
# supplied only to the running container arrives far too late. Without these the
# bundle ships `apiKey: undefined`, `readFirebaseWebConfig()` returns null, and
# every sign-in fails with "Sign-in is unavailable right now."
#
# They are public values, not secrets — see `app/auth/firebase-config.ts`. They
# are still per-environment, which is why they arrive as build args from the
# deploy target rather than being hardcoded here.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

# Increase memory limit for Node.js during build
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN pnpm nx build web --configuration=production

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist/apps/web ./

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "analog/server/index.mjs"]

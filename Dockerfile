# facilitatorx402 — Production Dockerfile
# PostgreSQL is the only supported database.
# Build: docker build -t facilitatorx402 .

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build
RUN npx prisma generate

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# DB startup check — verifies PostgreSQL URL before migrating
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

# 1. Verify PostgreSQL URL
# 2. Run migrations (PostgreSQL only)
# 3. Start app
CMD ["sh", "-c", "node scripts/db-check.js && npx prisma migrate deploy && node dist/index.js"]

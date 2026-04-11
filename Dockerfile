# ─── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Utilisateur non-root
RUN addgroup -S translog && adduser -S translog -G translog

# Copie uniquement ce qui est nécessaire
COPY --from=builder --chown=translog:translog /app/dist ./dist
COPY --from=builder --chown=translog:translog /app/node_modules ./node_modules
COPY --from=builder --chown=translog:translog /app/prisma ./prisma
COPY --from=builder --chown=translog:translog /app/package.json ./package.json

USER translog

# SEULE variable d'environnement autorisée en production
ENV NODE_ENV=production

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["node", "dist/main.js"]

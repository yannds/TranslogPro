# ─── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Prisma 5.x needs OpenSSL 3.x. node:20-alpine n'a PAS d'openssl pré-installé →
# Prisma retombe sur "openssl-1.1.x" et crash. Install explicit + binaryTargets
# dans schema.prisma (linux-musl-openssl-3.0.x).
RUN apk add --no-cache openssl libstdc++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# dumb-init — init PID 1 qui forward les signaux SIGTERM/SIGINT au process node.
# Sans, `docker stop` ne propage pas le signal, graceful shutdown ne se déclenche
# pas, le container est tué à 10s SIGKILL (fin des transactions en cours, etc.).
# openssl + libstdc++ — runtime requirements pour Prisma query engine sur Alpine.
RUN apk add --no-cache dumb-init openssl libstdc++

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

ENTRYPOINT ["dumb-init", "--"]
# Le build NestJS produit dist/src/main.js (pas dist/main.js) car tsconfig.build
# n'exclut pas scripts/ et prisma/ — TypeScript calcule rootDir au plus haut commun
# et préserve la structure src/ dans dist/. Cohérent, on pointe direct sur src/main.js.
CMD ["node", "dist/src/main.js"]

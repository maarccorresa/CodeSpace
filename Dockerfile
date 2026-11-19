# syntax=docker/dockerfile:1

# ── Compilación ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# bcrypt es nativo: herramientas por si no hay binario precompilado
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Ejecución ────────────────────────────────────────────────
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public

# Datos persistentes (montados como volumen)
RUN mkdir -p workspaces-data tickets-data && chown node:node workspaces-data tickets-data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]

FROM node:22-bookworm-slim

# Herramientas de compilación por si better-sqlite3 no encuentra un binario
# precompilado para la arquitectura del servidor (arm64, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server/index.js"]

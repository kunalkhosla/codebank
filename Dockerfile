# CodeBank — Node 20. better-sqlite3 ships prebuilt binaries, but we include
# build tools so `npm ci` works even when a prebuilt isn't available.
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]

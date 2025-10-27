FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/worker-node/package.json apps/worker-node/package-lock.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY apps/worker-node ./
CMD ["node", "--import", "./otel.mjs", "src/index.js"]

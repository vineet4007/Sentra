FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/gateway-node/package.json apps/gateway-node/package-lock.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY apps/gateway-node ./
EXPOSE 8080 50051
CMD ["node", "--import", "./otel.mjs", "src/index.js"]

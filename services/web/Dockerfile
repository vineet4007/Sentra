FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "const net = require('net'); const port = Number(process.env.PORT || 3000); const socket = net.createConnection({ host: '127.0.0.1', port }, () => { socket.end(); process.exit(0); }); socket.setTimeout(2000, () => { socket.destroy(); process.exit(1); }); socket.on('error', () => process.exit(1));"
CMD ["node", "server.js"]

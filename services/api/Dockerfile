FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN       if [ -f package-lock.json ]; then npm ci;       elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile;       elif [ -f yarn.lock ]; then yarn install --frozen-lockfile;       else npm i; fi

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY package.json ./package.json
RUN npm i --omit=dev
RUN chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "const port = process.env.API_PORT || 8080; fetch('http://127.0.0.1:' + port + '/health').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"
CMD ["node", "dist/index.js"]

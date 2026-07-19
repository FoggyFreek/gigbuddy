# Standalone image for the link-page app (API + built SPA in one process).
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
# Drop root: the runtime only needs to read the app and listen on a port.
USER node
EXPOSE 3010
# Migrations run as a separate one-shot step (see docker-compose.yml); this is
# the long-running API + SPA server.
CMD ["node", "server/index.js"]

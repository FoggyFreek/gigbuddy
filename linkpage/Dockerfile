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
EXPOSE 3010
# Run `node server/migrate.js` once per deploy before starting.
CMD ["node", "server/index.js"]

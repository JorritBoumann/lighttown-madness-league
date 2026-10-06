# The game server, and the game, for any host that runs a container.
#
# Built in one stage and run from another: the build needs Vite and the
# development packages, and what comes out of it is the server as one
# self-contained file (see `ssr` in vite.config.ts) and the game as static
# files, so the image that runs is Node, that file and the site.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist-server/main.js ./main.js
COPY --from=build /app/dist ./site
ENV NODE_ENV=production PORT=8080 SITE_DIR=/app/site
EXPOSE 8080
USER node
# The same check a host would make: the server answers plain HTTP on /health.
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "main.js"]

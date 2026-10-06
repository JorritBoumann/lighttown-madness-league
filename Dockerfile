# The game server, for any host that runs a container.
#
# Built in one stage and run from another: the build needs Vite and the
# development packages, and what comes out of it is one self-contained file
# (see `ssr` in vite.config.ts), so the image that runs is Node and that file
# and nothing else.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist-server/main.js ./main.js
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
# The same check a host would make: the server answers plain HTTP on /health.
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "main.js"]

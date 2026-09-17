FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS frontend
COPY public ./public
COPY src ./src
COPY tools ./tools
COPY index.html SOURCE.md ./
ARG ONLINE_SERVER_URL=http://127.0.0.1:8080
ARG SUPABASE_URL=
ARG SUPABASE_PUBLISHABLE_KEY=
RUN ONLINE_SERVER_URL="$ONLINE_SERVER_URL" SUPABASE_URL="$SUPABASE_URL" SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" node tools/build.mjs
ENV HOST=0.0.0.0 ROCKET_ARENA_DIST=1 PORT=4173 ROCKET_ARENA_LIVE_RELOAD=0
USER node
EXPOSE 4173
CMD ["node", "tools/serve.mjs"]

FROM node:22-bookworm-slim AS server
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/physics ./src/physics
COPY src/core/class-fields.js ./src/core/class-fields.js
COPY src/match/session.js ./src/match/session.js
COPY src/online/protocol.js src/online/timing.js ./src/online/
COPY public/physics ./public/physics
COPY public/assets/arena/collision ./public/assets/arena/collision
COPY tools/db-migrate.mjs ./tools/db-migrate.mjs
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]

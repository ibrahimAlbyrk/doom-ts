# DOOM-TS multiplayer — single-process prod image (client + Colyseus on one port).
# Build context is the REPO ROOT:  docker build -f deploy/Dockerfile -t doom-ts .
#
# Prereq: extract the game assets into public/assets BEFORE building, so `npm run build` can
# bundle them into dist/  (assets are gitignored — see DEPLOY.md):
#     npm run extract-assets        # needs the Freedoom WADs (tools/extract-wad/README.md)
#
# The server runs via tsx (matching `npm run server`), so devDependencies stay installed.
FROM node:22-slim

WORKDIR /opt/doom

# Install deps first (layer cache) — copy manifests, then the rest.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the static client into dist/ (requires public/assets to be present in the context).
RUN npm run build

ENV NODE_ENV=production
ENV PORT=2567
ENV HOST=0.0.0.0
EXPOSE 2567

# Serves dist/ + Colyseus ws + /matchmake on $PORT.
CMD ["npm", "run", "start:prod"]

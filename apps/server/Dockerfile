# The API server, and the migrate and seed steps, which are the same image with a different
# entry point.
#
# There is no build step. `npm start` already runs the TypeScript through tsx, so compiling
# to a dist/ here would add an artefact to keep in step with the source for no gain — the
# server is started, not published.

# No --platform=$BUILDPLATFORM on this stage, unlike the web image. tsx pulls in esbuild,
# which ships a compiled binary per architecture, so `npm ci` has to run as the target and
# fetch @esbuild/linux-arm64 rather than the x64 build. Under emulation that is slow; it is
# also the only way the install is correct.
FROM node:24-alpine AS deps
WORKDIR /app

# Manifests before sources: this layer is reused until a dependency actually changes, so an
# ordinary code change redeploys without a reinstall. Every workspace's package.json has to
# be here or `npm ci` refuses the lockfile.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci --omit=dev


FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The install exactly as npm left it, nested directories and all. The symlinks under
# node_modules/@georgian point into packages/, which the next line fills in.
COPY --from=deps /app/ ./
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

# Only the seed reads these. It runs from this image, so they come along.
COPY data/ data/

# The speech cache's mount point, made here and owned by the user that runs the process.
#
# Docker only copies ownership into a named volume when it *creates* one, and it takes it from
# the image's own directory at that path. With no such directory the mount point is made
# root-owned and 0755, and the first thing this server tries to write into it fails with
# EACCES: permission denied, mkdir '/cache/tts/31'. Nothing in that error says the problem is a
# volume rather than the code, which is what makes it worth a line here.
#
# An existing volume keeps the ownership it was created with, so this only fixes deployments
# made from here on. One that is already root-owned has to be corrected once on the host:
#
#   docker run --rm -v lemmata_tts-cache:/cache/tts node:24-alpine chown -R node:node /cache/tts
#
# This is the only volume the server writes to. Uploaded quiz clips and lesson pictures used to
# want a second one, and do not any more: they are `bytea` columns now, so they travel in a
# dump. MEDIA_DIR survives only as the path `legacyPathFor` unlinks from, best effort.
RUN mkdir -p /cache/tts && chown -R node:node /cache/tts

USER node
EXPOSE 4000

# Not `npm start`. Run through node directly and the app is PID 1's own process, so the
# SIGTERM Docker sends on `stop` reaches the handler in index.ts and the connection pool
# closes properly, instead of npm swallowing it and the container being killed ten seconds
# later. `--import tsx` registers the loader in this process rather than spawning a child.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]

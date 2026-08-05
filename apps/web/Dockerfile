# The built web app, inside nginx, which is the front door of the stack: it serves these
# files and forwards /rpc and /api to the server. It does not do TLS — the proxy already on
# the host does that, and gets a single upstream and no path rules as a result.
#
# One origin either way, which is what auth.ts needs to keep the session cookie first-party.

# --platform=$BUILDPLATFORM pins this stage to the machine doing the building, never the
# machine being built for. What comes out is index.html and a few hashed .js and .css files,
# which are the same bytes whatever the CPU — so running vite under arm64 emulation to
# produce them would cost minutes and change nothing. Only the nginx stage below is
# architecture-specific, and that stage does nothing but copy.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# The full install, dev dependencies included: vite and tsc are the build.
RUN npm ci

COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Empty is the answer for the single-origin deployment: client.ts falls back to the origin
# the page was served from. Only set this for the split-origin setup, and read the note in
# docker-compose.prod.yml about what else has to change with it.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

# Typechecks first — `build` in apps/web/package.json runs tsc before vite — so a type error
# fails the image rather than shipping.
RUN npm run build -w @georgian/web


FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx-upstream.conf /etc/nginx/snippets/upstream.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

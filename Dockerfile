# syntax=docker/dockerfile:1.7
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /opt/minemate
COPY . ./
RUN --mount=type=cache,target=/tmp/minemate-npm-cache --mount=type=secret,id=proxyca --mount=type=secret,id=proxyenv \
    if [ -f /run/secrets/proxyenv ]; then . /run/secrets/proxyenv; fi; \
    if [ -f /run/secrets/proxyca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxyca; fi; \
    npm ci --fetch-timeout=30000 --fetch-retries=1 --loglevel=warn && \
    npm run typecheck && npm run build && npm prune --omit=dev && \
    mkdir -p /runtime/apps/web && \
    mv node_modules dist /runtime/ && \
    mv apps/web/dist /runtime/apps/web/ && \
    cp package.json /runtime/

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /opt/minemate
ENV NODE_ENV=production MINEMATE_DATA_PATH=/data MINEMATE_PORT=8080
COPY --from=build --chown=node:node /runtime/ ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","--use-env-proxy","dist/api/main.js"]

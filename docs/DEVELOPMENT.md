# Development

The workspace uses strict TypeScript, React 19, Vite 8, TanStack Query/Router,
Fastify 5 and Node 24's SQLite. Dependency versions and lockfile are committed
project inputs; npm's cache is at `/tmp/minemate-npm-cache` in this cloud workspace.

```sh
npm ci
npm run check
npm run test:docker
npm run test:e2e
npm run format
```

Start `npm run dev` and `npm run dev:web` in separate terminals. The Vite dev
server proxies `/api` and WebSockets to the backend. Build with `npm run build`
and use `npm start` for the combined production service. A graphical empty-state
works without Docker; server creation requires a proven shared Docker host path.

Domain packages:

- shared: contracts, schemas, edition capabilities and permissions;
- database: migration, transactions and persistent repositories;
- docker: Engine protocol and ownership checks;
- minecraft: edition-specific runtime and command adapters;
- mod-platforms: official API adapters and dependency/download rules;
- settings-schema: version/edition settings and protected fields;
- backup: anchored paths, safe ZIPs, atomic swaps and retention;
- gateway-protocol: Java and Bedrock framing/readiness;
- ui: tokens, assets, landscape, reusable controls and sound.

API service modules own jobs, authentication, host checks, servers, files,
content, backups, updates, monitoring and optional S3. Frontend management panels
are lazy loaded. Vendor groups split React, navigation, motion and validation;
no production chunk needs the former oversized monolithic bundle.

Unit/API tests use disposable directories. Browser tests use an explicitly named
controlled protocol fixture and injected Docker provider, not production example
data. `test:docker` creates one uniquely labeled, bounded, network-isolated
container and removes only that container. Live tests require explicit EULA
consent and run on separate disposable data roots.

In this cloud environment the Docker daemon sees a different `/workspace` from
the shell. Do not weaken the host-path proof. Real lifecycle validation runs
MineMate inside Docker with a daemon-side temporary data root. The fixture
`real-docker-driver.ts` injects only the cloud's proxy/CA into real Engine calls;
it is excluded from production builds. Certificates, cookies and live test
state must remain outside Git.

Official integration references inspected during implementation:

- [Docker Engine API v1.49](https://docs.docker.com/reference/api/engine/version/v1.49/)
- [itzg Java documentation](https://docker-minecraft-server.readthedocs.io/)
- [itzg Bedrock](https://github.com/itzg/docker-minecraft-bedrock-server)
- [Modrinth API](https://docs.modrinth.com/api/)
- [CurseForge API](https://docs.curseforge.com/)
- [Paper downloads API](https://docs.papermc.io/misc/downloads-api/)
- [Fabric meta API](https://meta.fabricmc.net/)

The cloud setup script performs dependency installation and production checks.
It does not launch daemons or accept a Minecraft EULA. Saved start instructions
explain how to start the application and the Docker namespace limitation.

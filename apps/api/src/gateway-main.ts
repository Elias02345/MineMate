import { readFile, writeFile, rename } from "node:fs/promises";
import net from "node:net";
import dgram from "node:dgram";
import path from "node:path";
import {
  handshake,
  packet,
  stringPacket,
  readVarint,
} from "../../../packages/gateway-protocol/src/index.ts";
interface Route {
  edition: "JAVA" | "BEDROCK";
  state: string;
  host: string;
  port: number;
  name: string;
  version: string;
  maxPlayers: number;
}
const directory = process.env.MINEMATE_ROUTE_PATH ?? "/route";
let route: Route = JSON.parse(
  await readFile(path.join(directory, "route.json"), "utf8"),
) as Route;
const refresh = setInterval(() => {
  void readFile(path.join(directory, "route.json"), "utf8")
    .then((data) => {
      route = JSON.parse(data) as Route;
    })
    .catch(() => {
      /* keep last valid route */
    });
}, 1000);
let lastWake = 0;
async function wake() {
  if (Date.now() - lastWake < 5000) return;
  lastWake = Date.now();
  const file = path.join(directory, "wake.tmp");
  await writeFile(file, String(Date.now()));
  await rename(file, path.join(directory, "wake.json"));
}
const servers: { close: () => unknown }[] = [];
if (route.edition === "JAVA") {
  const server = net.createServer((socket) => {
    socket.setTimeout(15000, () => socket.destroy());
    let data = Buffer.alloc(0),
      mode: "handshake" | "status" | "proxy" = "handshake",
      protocol = 0;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (mode === "proxy") return;
      data = Buffer.concat([data, chunk]);
      if (data.length > 65536) {
        socket.destroy();
        return;
      }
      try {
        if (mode === "handshake") {
          const h = handshake(data);
          if (!h) return;
          protocol = h.protocol;
          if (route.state === "RUNNING") {
            mode = "proxy";
            socket.pause();
            socket.setTimeout(0);
            const target = net.connect(route.port, route.host);
            target.on("error", () => socket.destroy());
            socket.on("close", () => target.destroy());
            target.once("connect", () => {
              target.write(data);
              socket.pipe(target);
              target.pipe(socket);
              socket.resume();
            });
            return;
          }
          if (h.intent !== 1) {
            void wake().catch(() => {});
            socket.end(
              stringPacket(
                0,
                JSON.stringify({
                  text: "Your world is waking up. Please reconnect in a moment.",
                  color: "green",
                }),
              ),
            );
            return;
          }
          mode = "status";
          data = data.subarray(h.length);
        }
        while (data.length) {
          const size = readVarint(data);
          if (!size || data.length < size.value + size.bytes) return;
          const body = data.subarray(size.bytes, size.bytes + size.value),
            id = readVarint(body);
          if (!id) {
            socket.destroy();
            return;
          }
          if (id.value === 0)
            socket.write(
              stringPacket(
                0,
                JSON.stringify({
                  version: { name: route.version, protocol },
                  players: { max: route.maxPlayers, online: 0 },
                  description: {
                    text: `${route.name} • ${route.state === "SLEEPING" ? "Sleeping — join to wake" : "Starting — reconnect soon"}`,
                    color: "green",
                  },
                }),
              ),
            );
          else if (id.value === 1)
            socket.end(packet(1, body.subarray(id.bytes)));
          else socket.destroy();
          data = data.subarray(size.value + size.bytes);
        }
      } catch {
        socket.destroy();
      }
    });
  });
  server.listen(25565, "0.0.0.0");
  servers.push(server);
} else {
  const server = dgram.createSocket("udp4"),
    clients = new Map<
      string,
      { socket: dgram.Socket; at: number; ready: boolean; pending: Buffer[] }
    >();
  server.on("error", (e) => {
    process.stderr.write(e.message + "\n");
  });
  server.on("message", (message, peer) => {
    if (route.state !== "RUNNING") {
      void wake().catch(() => {});
      return;
    }
    const key = peer.address + ":" + peer.port;
    let client = clients.get(key);
    if (!client) {
      if (clients.size >= 1024) return;
      const outgoing = dgram.createSocket("udp4");
      client = {
        socket: outgoing,
        at: Date.now(),
        ready: false,
        pending: [message],
      };
      clients.set(key, client);
      outgoing.on("error", () => {
        outgoing.close();
        clients.delete(key);
      });
      outgoing.on("message", (reply) =>
        server.send(reply, peer.port, peer.address),
      );
      const created = client;
      outgoing.connect(route.port, route.host, () => {
        created.ready = true;
        for (const packet of created.pending) outgoing.send(packet);
        created.pending = [];
      });
    } else if (client.ready) client.socket.send(message);
    else if (client.pending.length < 16) client.pending.push(message);
    client.at = Date.now();
  });
  const expiry = setInterval(() => {
    for (const [key, c] of clients)
      if (Date.now() - c.at > 60000) {
        c.socket.close();
        clients.delete(key);
      }
  }, 10000);
  server.bind(19132, "0.0.0.0");
  servers.push({
    close: () => {
      clearInterval(expiry);
      for (const c of clients.values()) c.socket.close();
      server.close();
    },
  });
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(refresh);
    for (const server of servers) server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  });

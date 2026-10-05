import net from "node:net";
import {
  handshake,
  readVarint,
  stringPacket,
  packet,
} from "../../packages/gateway-protocol/src/index.ts";
export async function fixtureProtocol(port = 25565) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0),
      greeted = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (!greeted) {
          const h = handshake(buffer);
          if (!h) return;
          buffer = buffer.subarray(h.length);
          greeted = true;
        }
        while (buffer.length) {
          const size = readVarint(buffer);
          if (!size || buffer.length < size.bytes + size.value) return;
          const body = buffer.subarray(size.bytes, size.bytes + size.value),
            id = readVarint(body);
          if (id?.value === 0)
            socket.write(
              stringPacket(
                0,
                JSON.stringify({
                  version: { name: "Controlled test runtime", protocol: 767 },
                  players: { online: 0, max: 20 },
                  description: { text: "Test fixture, not Minecraft" },
                }),
              ),
            );
          if (id?.value === 1) socket.end(packet(1, body.subarray(id.bytes)));
          buffer = buffer.subarray(size.bytes + size.value);
        }
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

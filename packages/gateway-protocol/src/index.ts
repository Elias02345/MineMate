import net from "node:net";
import dgram from "node:dgram";
export function varint(value: number): Buffer {
  const out: number[] = [];
  let n = value >>> 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
export function readVarint(
  data: Buffer,
  offset = 0,
): { value: number; bytes: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const b = data[offset + i];
    if (b === undefined) return null;
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { value, bytes: i + 1 };
  }
  throw new Error("Invalid VarInt");
}
export function packet(id: number, data: Buffer): Buffer {
  const body = Buffer.concat([varint(id), data]);
  return Buffer.concat([varint(body.length), body]);
}
export function stringPacket(id: number, text: string): Buffer {
  const value = Buffer.from(text);
  return packet(id, Buffer.concat([varint(value.length), value]));
}
export function handshake(
  data: Buffer,
): { intent: number; protocol: number; length: number } | null {
  const size = readVarint(data);
  if (!size) return null;
  if (size.value < 1 || size.value > 4096)
    throw new Error("Invalid handshake size");
  if (data.length < size.value + size.bytes) return null;
  let offset = size.bytes;
  const id = readVarint(data, offset);
  if (!id || id.value !== 0) throw new Error("Invalid handshake");
  offset += id.bytes;
  const version = readVarint(data, offset);
  if (!version) throw new Error("Invalid version");
  offset += version.bytes;
  const len = readVarint(data, offset);
  if (!len || len.value > 255) throw new Error("Invalid address");
  offset += len.bytes + len.value + 2;
  const intent = readVarint(data, offset);
  if (!intent || ![1, 2, 3].includes(intent.value))
    throw new Error("Invalid intent");
  return {
    intent: intent.value,
    protocol: version.value,
    length: size.value + size.bytes,
  };
}
export async function javaStatus(
  host: string,
  port = 25565,
): Promise<{ players: number; names: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    let data = Buffer.alloc(0),
      completed = false;
    socket.once("close", () => {
      if (!completed)
        reject(new Error("Minecraft closed the status connection"));
    });
    socket.setTimeout(3000, () => socket.destroy(new Error("Status timeout")));
    socket.on("error", reject);
    socket.once("connect", () => {
      const name = Buffer.from(host),
        portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      socket.write(
        packet(
          0,
          Buffer.concat([
            varint(-1),
            varint(name.length),
            name,
            portBytes,
            varint(1),
          ]),
        ),
      );
      socket.write(packet(0, Buffer.alloc(0)));
    });
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 1024 ** 2) {
        socket.destroy(new Error("Status too large"));
        return;
      }
      try {
        const size = readVarint(data);
        if (!size || data.length < size.value + size.bytes) return;
        const id = readVarint(data, size.bytes);
        if (!id || id.value !== 0) throw new Error("Invalid status");
        const length = readVarint(data, size.bytes + id.bytes);
        if (!length) throw new Error("Invalid JSON length");
        const payload = JSON.parse(
          data
            .subarray(
              size.bytes + id.bytes + length.bytes,
              size.bytes + size.value,
            )
            .toString(),
        ) as { players?: { online: number; sample?: { name: string }[] } };
        completed = true;
        socket.destroy();
        resolve({
          players: payload.players?.online ?? 0,
          names: payload.players?.sample?.map((p) => p.name) ?? [],
        });
      } catch (e) {
        socket.destroy();
        reject(e);
      }
    });
  });
}
const magic = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");
export async function bedrockStatus(
  host: string,
  port = 19132,
): Promise<{ players: number; names: string[]; version: string }> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Bedrock ping timed out"));
    }, 3000);
    socket.once("error", (e) => {
      clearTimeout(timer);
      socket.close();
      reject(e);
    });
    socket.once("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      if (msg[0] !== 0x1c || msg.length < 35) {
        reject(new Error("Invalid Bedrock response"));
        return;
      }
      const fields = msg.subarray(35).toString().split(";");
      resolve({
        players: Number(fields[4] ?? 0),
        names: [],
        version: fields[3] ?? "",
      });
    });
    const ping = Buffer.alloc(33);
    ping[0] = 1;
    ping.writeBigInt64BE(BigInt(Date.now()), 1);
    magic.copy(ping, 9);
    ping.writeBigInt64BE(1n, 25);
    socket.send(ping, port, host);
  });
}

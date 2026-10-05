import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, open } from "node:fs/promises";
import path from "node:path";
export class SecretStore {
  private constructor(private key: Buffer) {}
  static async open(root: string) {
    const filename = path.join(root, "app/secrets/master.key");
    let key: Buffer;
    try {
      key = await readFile(filename);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      key = randomBytes(32);
      try {
        const f = await open(filename, "wx", 0o600);
        try {
          await f.writeFile(key);
          await f.sync();
        } finally {
          await f.close();
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        key = await readFile(filename);
      }
    }
    if (key.length !== 32) throw new Error("Invalid encryption key");
    return new SecretStore(key);
  }
  seal(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  unseal(value: string) {
    const data = Buffer.from(value, "base64"),
      cipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  }
}

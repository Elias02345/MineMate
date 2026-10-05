import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { AppError } from "../../../packages/shared/src/index.ts";
import type { Servers } from "./servers.ts";
export const s3Schema = z.object({
  endpoint: z.url(),
  region: z.string().min(1).max(64),
  bucket: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9.-]+$/),
  accessKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(512),
  prefix: z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9/_-]*$/)
    .default("minemate"),
});
export class S3Backups {
  constructor(private servers: Servers) {
    servers.jobs.register("backup.remote", async (op, phase) => {
      phase("Uploading the verified recovery chest");
      return this.upload(op.serverId!, String(op.payload.backupId));
    });
  }
  private client() {
    const config = this.servers.store.setting<z.infer<typeof s3Schema> | null>(
        "s3Config",
        null,
      ),
      secret = this.servers.store.setting<string>("s3Secret", "");
    if (!config || !secret)
      throw new AppError(
        "S3_CONFIG",
        "Configure your remote recovery chest first.",
      );
    const credentials = JSON.parse(this.servers.secrets.unseal(secret)) as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    return {
      client: new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials,
      }),
      config,
    };
  }
  save(input: unknown) {
    const c = s3Schema.parse(input),
      u = new URL(c.endpoint);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hostname === "169.254.169.254"
    )
      throw new AppError(
        "S3_ENDPOINT",
        "Choose a trusted S3-compatible endpoint.",
      );
    const secret = this.servers.secrets.seal(
      JSON.stringify({
        accessKeyId: c.accessKey,
        secretAccessKey: c.secretKey,
      }),
    );
    this.servers.store.setSetting("s3Secret", secret);
    this.servers.store.setSetting("s3Config", {
      ...c,
      accessKey: "",
      secretKey: "",
    });
  }
  async test() {
    const { client, config } = this.client();
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { ok: true };
    } finally {
      client.destroy();
    }
  }
  async upload(serverId: string, backupId: string) {
    const b = this.servers.store
      .backups(serverId)
      .find((b) => b.id === backupId);
    if (!b) throw new AppError("NOT_FOUND", "Recovery chest not found.", 404);
    const { hashFile } =
      await import("../../../packages/backup/src/archive.ts");
    const filename =
      this.servers.paths.server(serverId, "backups") + "/" + b.filename;
    if ((await hashFile(filename)) !== b.hash)
      throw new AppError(
        "BACKUP_INTEGRITY",
        "This backup failed integrity verification.",
      );
    const { client, config } = this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: `${config.prefix}/${serverId}/${b.filename}`,
          Body: createReadStream(
            this.servers.paths.server(serverId, "backups") + "/" + b.filename,
          ),
          ContentLength: b.bytes,
          Metadata: { sha256: b.hash },
        }),
      );
      return { ok: true };
    } finally {
      client.destroy();
    }
  }
}

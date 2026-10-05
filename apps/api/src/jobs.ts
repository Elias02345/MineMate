import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/database/src/index.ts";
import {
  AppError,
  now,
  type Operation,
} from "../../../packages/shared/src/index.ts";
import type { Events } from "./events.ts";
export type JobHandler = (
  operation: Operation,
  phase: (text: string) => void,
) => Promise<Record<string, unknown> | void>;
export class Jobs {
  private handlers = new Map<string, JobHandler>();
  private active = new Map<string, Promise<void>>();
  private closed = false;
  constructor(
    private store: Store,
    private events: Events,
  ) {
    store.run(
      "UPDATE operations SET status='INTERRUPTED',phase='Interrupted by application restart; inspect recovery points before retrying',updated_at=? WHERE status='RUNNING'",
      now(),
    );
  }
  register(kind: string, handler: JobHandler) {
    this.handlers.set(kind, handler);
  }
  enqueue(
    serverId: string | null,
    actor: string,
    kind: string,
    payload: Record<string, unknown> = {},
  ): Operation {
    const id = randomUUID(),
      at = now();
    try {
      this.store.run(
        "INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id,
        serverId,
        actor,
        kind,
        "QUEUED",
        "Waiting",
        null,
        JSON.stringify(payload),
        null,
        at,
        at,
      );
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        throw new AppError(
          "BUSY",
          "Another operation is already changing this world.",
          409,
        );
      throw e;
    }
    const op = this.store.operation(
      this.store.get("SELECT * FROM operations WHERE id=?", id)!,
    );
    this.events.send(
      "server.operation.progress",
      op,
      serverId ?? undefined,
      id,
    );
    this.run(op);
    return op;
  }
  resume() {
    for (const row of this.store.all(
      "SELECT * FROM operations WHERE status='QUEUED'",
    ))
      this.run(this.store.operation(row));
  }
  private run(op: Operation) {
    if (this.closed) return;
    const promise = this.execute(op).finally(() => this.active.delete(op.id));
    this.active.set(op.id, promise);
  }
  private async execute(op: Operation) {
    const handler = this.handlers.get(op.kind);
    const phase = (text: string) => {
      this.store.run(
        "UPDATE operations SET phase=?,updated_at=? WHERE id=?",
        text,
        now(),
        op.id,
      );
      this.events.send(
        "server.operation.progress",
        { ...op, phase: text, status: "RUNNING" },
        op.serverId ?? undefined,
        op.id,
      );
    };
    this.store.run(
      "UPDATE operations SET status='RUNNING',updated_at=? WHERE id=?",
      now(),
      op.id,
    );
    try {
      if (!handler) throw new Error("Unknown operation");
      const result = await handler(op, phase);
      this.store.run(
        "UPDATE operations SET status='SUCCEEDED',phase='Complete',result=?,updated_at=? WHERE id=?",
        JSON.stringify(result ?? {}),
        now(),
        op.id,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Operation failed";
      this.store.run(
        "UPDATE operations SET status='FAILED',phase='Needs attention',error=?,updated_at=? WHERE id=?",
        message,
        now(),
        op.id,
      );
      this.store.notify(op.serverId, "error", message);
    }
    const result = this.store.operation(
      this.store.get("SELECT * FROM operations WHERE id=?", op.id)!,
    );
    this.events.send(
      "server.operation.progress",
      result,
      op.serverId ?? undefined,
      op.id,
    );
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.active.values()]);
  }
}

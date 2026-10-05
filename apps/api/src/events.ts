import { EventEmitter } from "node:events";
import { now, type Event } from "../../../packages/shared/src/index.ts";
export class Events extends EventEmitter {
  send(type: string, data: unknown, serverId?: string, operationId?: string) {
    const event: Event = { type, data, serverId, operationId, at: now() };
    this.emit("event", event);
    return event;
  }
}

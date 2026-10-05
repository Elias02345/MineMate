import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Server,
  ServerConfig,
  User,
  Operation,
  Backup,
  InstalledContent,
  Permission,
  Notification,
} from "../../shared/src/index.ts";
import { now } from "../../shared/src/index.ts";

type Row = Record<string, SQLInputValue>;
const migrations = [
  `
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE UNIQUE INDEX one_owner ON users(role) WHERE role='owner';
CREATE TABLE bootstrap(id INTEGER PRIMARY KEY CHECK(id=1),user_id TEXT NOT NULL REFERENCES users(id));
CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT NOT NULL,config TEXT NOT NULL,port INTEGER NOT NULL,protocol TEXT NOT NULL,state TEXT NOT NULL,desired TEXT NOT NULL,container_id TEXT,metrics TEXT,error TEXT,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(port,protocol));
CREATE TABLE server_permissions(server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,permission TEXT NOT NULL,PRIMARY KEY(server_id,user_id,permission));
CREATE TABLE server_configurations(server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,revision TEXT NOT NULL,properties TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE server_runtimes(server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,docker_state TEXT,minecraft_ready INTEGER NOT NULL DEFAULT 0,failures TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
CREATE TABLE eula_acceptances(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),accepted_at TEXT NOT NULL,url TEXT NOT NULL);
CREATE TABLE operations(id TEXT PRIMARY KEY,server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,actor TEXT REFERENCES users(id),kind TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,error TEXT,payload TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX one_active_operation ON operations(server_id) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE installed_content(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,source TEXT NOT NULL,project_id TEXT NOT NULL,version_id TEXT NOT NULL,filename TEXT NOT NULL,hash TEXT NOT NULL,game_version TEXT NOT NULL,loader TEXT NOT NULL,dependency INTEGER NOT NULL,managed INTEGER NOT NULL,installed_at TEXT NOT NULL,installed_by TEXT NOT NULL,UNIQUE(server_id,filename));
CREATE TABLE content_sources(id TEXT PRIMARY KEY,source TEXT NOT NULL,project_id TEXT NOT NULL,metadata TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE backups(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,filename TEXT NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL,config TEXT NOT NULL,creator TEXT NOT NULL,integrity TEXT NOT NULL);
CREATE TABLE backup_targets(id TEXT PRIMARY KEY,name TEXT NOT NULL,config TEXT NOT NULL,secret TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE notifications(id TEXT PRIMARY KEY,server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,level TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,actor TEXT,server_id TEXT,action TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE update_records(id TEXT PRIMARY KEY,server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,previous_config TEXT NOT NULL,target_config TEXT NOT NULL,backup_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL);
`,
];
export class Store {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    migrations.forEach((sql, i) => {
      if (!this.get("SELECT version FROM migrations WHERE version=?", i + 1))
        this.transaction(() => {
          this.db.exec(sql);
          this.run("INSERT INTO migrations VALUES(?,?)", i + 1, now());
        });
    });
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  user(row: Row): User {
    return {
      id: String(row.id),
      username: String(row.username),
      role: row.role as User["role"],
      enabled: !!row.enabled,
      createdAt: String(row.created_at),
    };
  }
  users() {
    return this.all("SELECT * FROM users ORDER BY created_at").map((r) =>
      this.user(r),
    );
  }
  grants(serverId: string, userId: string) {
    return this.all<{ permission: Permission }>(
      "SELECT permission FROM server_permissions WHERE server_id=? AND user_id=?",
      serverId,
      userId,
    ).map((r) => r.permission);
  }
  server(row: Row, host: string): Server {
    return {
      id: String(row.id),
      name: String(row.name),
      config: JSON.parse(String(row.config)) as ServerConfig,
      port: Number(row.port),
      state: row.state as Server["state"],
      desired: row.desired as Server["desired"],
      containerId: row.container_id ? String(row.container_id) : null,
      metrics: row.metrics
        ? (JSON.parse(String(row.metrics)) as Server["metrics"])
        : null,
      error: row.error ? String(row.error) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archived: !!row.archived,
      endpoint: {
        host,
        port: Number(row.port),
        protocol: row.protocol as "TCP" | "UDP",
      },
      permissions: [],
    };
  }
  servers(host: string) {
    return this.all("SELECT * FROM servers ORDER BY created_at").map((r) =>
      this.server(r, host),
    );
  }
  findServer(id: string, host: string) {
    const row = this.get("SELECT * FROM servers WHERE id=?", id);
    return row ? this.server(row, host) : undefined;
  }
  saveServer(s: Server) {
    this.run(
      "UPDATE servers SET name=?,config=?,state=?,desired=?,container_id=?,metrics=?,error=?,archived=?,updated_at=? WHERE id=?",
      s.name,
      JSON.stringify(s.config),
      s.state,
      s.desired,
      s.containerId,
      s.metrics ? JSON.stringify(s.metrics) : null,
      s.error,
      s.archived ? 1 : 0,
      now(),
      s.id,
    );
  }
  operation(r: Row): Operation {
    return {
      id: String(r.id),
      serverId: r.server_id ? String(r.server_id) : null,
      kind: String(r.kind),
      status: r.status as Operation["status"],
      phase: String(r.phase),
      error: r.error ? String(r.error) : null,
      payload: JSON.parse(String(r.payload)) as Operation["payload"],
      result: r.result
        ? (JSON.parse(String(r.result)) as Operation["result"])
        : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }
  operations(serverId?: string) {
    return this.all(
      serverId
        ? "SELECT * FROM operations WHERE server_id=? ORDER BY created_at DESC LIMIT 100"
        : "SELECT * FROM operations ORDER BY created_at DESC LIMIT 100",
      ...(serverId ? [serverId] : []),
    ).map((r) => this.operation(r));
  }
  backup(r: Row): Backup {
    return {
      id: String(r.id),
      serverId: String(r.server_id),
      filename: String(r.filename),
      hash: String(r.hash),
      bytes: Number(r.bytes),
      createdAt: String(r.created_at),
      reason: String(r.reason),
      config: JSON.parse(String(r.config)) as ServerConfig,
      creator: String(r.creator),
      integrity: r.integrity as Backup["integrity"],
    };
  }
  backups(id: string) {
    return this.all(
      "SELECT * FROM backups WHERE server_id=? ORDER BY created_at DESC",
      id,
    ).map((r) => this.backup(r));
  }
  content(id: string): InstalledContent[] {
    return this.all(
      "SELECT * FROM installed_content WHERE server_id=?",
      id,
    ).map((r) => ({
      id: String(r.id),
      serverId: String(r.server_id),
      source: r.source as InstalledContent["source"],
      projectId: String(r.project_id),
      versionId: String(r.version_id),
      filename: String(r.filename),
      hash: String(r.hash),
      gameVersion: String(r.game_version),
      loader: String(r.loader),
      dependency: !!r.dependency,
      managed: !!r.managed,
      installedAt: String(r.installed_at),
      installedBy: String(r.installed_by),
    }));
  }
  audit(
    actor: string | null,
    server: string | null,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    this.run(
      "INSERT INTO audit_events VALUES(?,?,?,?,?,?)",
      randomUUID(),
      actor,
      server,
      action,
      JSON.stringify(metadata),
      now(),
    );
  }
  notify(
    serverId: string | null,
    level: Notification["level"],
    message: string,
  ): Notification {
    const n: Notification = {
      id: randomUUID(),
      serverId,
      level,
      message,
      createdAt: now(),
      read: false,
    };
    this.run(
      "INSERT INTO notifications VALUES(?,?,?,?,?,0)",
      n.id,
      serverId,
      level,
      message,
      n.createdAt,
    );
    return n;
  }
  setting<T>(key: string, fallback: T): T {
    const row = this.get("SELECT value FROM settings WHERE key=?", key);
    return row ? (JSON.parse(String(row.value)) as T) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.run(
      "INSERT INTO settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      key,
      JSON.stringify(value),
      now(),
    );
  }
}

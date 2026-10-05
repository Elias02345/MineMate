# Recovery chests

MineMate stops Minecraft before archiving, avoiding mixed world save states.
A manual or scheduled backup restarts a previously running world and preserves
a sleeping world's desired state. Backup archives include all server data and
a content-inventory manifest. SHA-256 and size are recorded in SQLite.

Before settings, file, content, import, runtime or update mutations, MineMate
creates a recovery point. Managed content changes and updates start Minecraft
and verify its real protocol response. An unsuccessful content installation,
modpack import or update restores the previous data/runtime/inventory. An
operation failure remains visible after rollback; inspect the preserved startup
diagnosis to understand the incompatibility.

A restore requires the exact world name. It stops Minecraft, creates an emergency
backup, checks the selected SHA-256, validates/stages extraction and swaps the
server directory atomically. It restores the matching configuration and content
records before starting Minecraft. The newest previous directory is retained
as an additional snapshot.

Archive validation rejects absolute/traversal paths, Windows paths, duplicate
paths, symlinks, devices, encrypted entries, excessive compression ratios,
more than 100,000 entries, more than 20 GB expanded data, or a member exceeding
4 GB. Limits also apply while extracting. Upload requests are capped at 512 MB
per archive. These conservative limits may require splitting unusually large
worlds before import.

Retention combines the last N backups, daily and weekly points, and an optional
byte budget. At least the newest point is retained. An active restore target is
protected from emergency-backup retention. Scheduling is stored in the database
and managed by a central monitor; it does not spawn one timer per server.

Optional S3 storage uses encrypted credentials, a bucket connection test and
durable upload operations. The local hash is checked before uploading and sent
as object metadata. Local retention remains independent. Remote restore requires
downloading a recovery archive into a local import flow; the application does not
provide a remote object browser or automatic remote restore.

Full-installation recovery also requires `app/database` and `app/secrets`.
A per-world ZIP cannot recover installation accounts or integration keys. Keep
an external copy of the whole stopped data directory.

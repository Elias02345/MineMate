# Persistent data contract

All installation state belongs beneath the one data root, mounted as `/data` in
MineMate. Docker receives a separate, absolute host path to that same directory.
A sentinel read by an owned disposable container proves the paths correspond.

```text
data/
  app/database/minemate.sqlite       SQLite WAL database and migration records
  app/config/                       reserved application configuration area
  app/secrets/master.key            32-byte encryption key, mode 0600
  app/logs/                         reserved application log area
  servers/<uuid>/
    server/                         the sole directory mounted into Minecraft
    backups/<backup-uuid>.zip        verified complete server backups
    snapshots/<uuid>/               preceding directory during atomic restoration
    uploads/                        temporary, bounded uploads
    imports/                        validated archive staging
    metadata/rcon.secret            encrypted internal RCON credential
    metadata/failure.log            preserved failed startup diagnosis
  gateway/<uuid>/route.json          private persistent routing state
  gateway/<uuid>/wake.json           coalesced join wake request
  cache/{mods,plugins,modpacks,minecraft,downloads}/
  assets/
  tmp/
```

The database owns users, hashed sessions, permissions, settings, server identity,
configuration, desired state, runtime references, EULA acceptances, operations,
installed content, backup metadata, notifications, audit and update history.
Containers have stable UUID labels; names and ports are not identities.

Directories are created with mode 0700 and files normally with mode 0600, owned
by UID/GID 1000. The Compose prepare-data service adjusts only the data-root owner. It does not
recursively change existing worlds. A recovery copy must include the SQLite
WAL/SHM files and `master.key`; losing the key prevents credential decryption.

Server archives contain their server files plus a MineMate inventory manifest.
They do not contain the installation database, integration credentials or sibling
worlds. Restores verify the hash, stage extraction, swap directories, restore the
recorded runtime configuration and restore inventory metadata. The last previous
server directory is kept as a local snapshot; full backups have separate retention.

Unfinished operations become Interrupted after an application restart. Queued
operations resume after reconciliation. Inspect their recovery chests before
retrying a mutation. Unknown or ambiguously owned containers remain untouched.

To copy the whole installation consistently, stop all Minecraft worlds first,
then stop MineMate and copy the entire data directory. Stopping MineMate alone
does not stop independent Minecraft containers. This avoids copying live world
or SQLite writes. Restart Compose afterwards.

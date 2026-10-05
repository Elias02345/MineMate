# Security model

MineMate is a private homelab administrator, not a multi-tenant hosting boundary.
The installation owner and administrators can manage Docker-backed worlds and
upload executable Java code. Treat those accounts and trusted JARs accordingly.

The first owner is claimed transactionally even under racing registrations.
Passwords use Argon2id. Sessions store only hashed random tokens, expire and are
revoked on disable/password changes. Cookies are HttpOnly and SameSite=Strict;
Secure cookies are configurable for HTTPS. Mutations require a matching Origin
and CSRF token. Login/registration and API requests are rate limited; static
assets are exempt so an API limit cannot blank the interface.

Authorization is checked at every REST boundary and on each WebSocket event.
Members need explicit per-world permissions. Disabling a user revokes sessions.
Administrative account/permission/integration routes require an administrator.
Console log events require Console permission. Repair summaries are visible to
world viewers, while technical log output requires Console permission.

Each Docker mutation verifies managed, installation, world and kind labels.
MineMate refuses foreign containers. Minecraft has no Docker socket, host shell
or sibling-world/app-secret mount. The socket proxy has no published port.
Because creating containers remains a host-equivalent capability, isolating the
proxy is essential; an exposed proxy is not made safe merely by reducing routes.

Integration credentials use AES-256-GCM with a data-root master key and files
with restricted modes. The API returns configuration status rather than saved
keys. Internal RCON stays unexposed and redacted from properties, downloads and
console messages. Audit entries record actions and relevant identifiers, not
passwords, session tokens or full commands.

Paths reject traversal, absolute/drive paths, backslashes and symlinks. On Linux,
read/download operations anchor every component to a directory descriptor and
use O_NOFOLLOW, preventing a concurrently running mod from swapping a parent
symlink after validation. Mutations stop the owned runtime before touching files.
Archives are validated and extracted into isolated staging; downloads require
HTTPS on approved platform CDNs and a matching platform hash. Every redirect is
rechecked. Content manifests are rendered as React text; configuration highlighting
does not inject HTML.

Keep `online-mode=true` in real worlds. If you deliberately disable account
verification, restrict the world to trusted networks. MineMate never disables
TLS or content-hash verification to make a download succeed. Test proxy CAs are
explicitly trusted rather than bypassing validation.

Do not expose an unconfigured installation to untrusted clients: until the first
owner is created, the first visitor can claim it. Prefer a trusted LAN or protected
reverse proxy. Backups contain player/world/plugin data and may include secrets
written by third-party plugins; protect backup access and external storage.

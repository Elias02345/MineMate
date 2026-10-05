# Playing outside the LAN

MineMate runs independently on your LAN. In a world, open **Play together** to
copy its real LAN host, assigned port and protocol. The gateway owns that stable
port, so sleeping a Minecraft container does not change the public target.

To use CloudGate:

1. Create/select the server's host entry in CloudGate.
2. Paste the MineMate LAN address and port as its target.
3. Choose TCP for Java or UDP for Bedrock.
4. Connect CloudGate's Playit/tunnel provider and give friends its public address.

MineMate recommends CloudGate but does not create a CloudGate account or tunnel
on your behalf. Its integration is a target/clipboard hand-off; it has no hidden
dependency on an unavailable CloudGate API. TCP-only tunnels cannot carry
Bedrock's UDP gameplay.

## Sleep and wake

The Java gateway answers a normal multiplayer status request for a sleeping
world. A login attempt writes one coalesced wake request. The central monitor
starts the owned Minecraft container, and the player reconnects after startup.
A running world is proxied transparently; the gateway does not modify login
identity, encryption or compression. Initial TCP bytes are buffered until the
upstream connection is established.

Bedrock uses a bounded per-client UDP relay. Traffic to a sleeping world requests
wake; clients must retry after startup. MineMate does not claim a completed
Bedrock login, invent a RakNet session or report Java-style TCP availability for
Bedrock. Relay sessions expire after inactivity. An authenticated Bedrock game
still needs Microsoft's external account services.

Only Sleeping worlds wake from incoming traffic. A deliberately Stopped or
archived world stays stopped. Port collisions are checked against the database,
Docker's published listeners and local binds; Docker is the final authority when
its host namespace differs from MineMate's namespace.

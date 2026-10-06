# Console, players and sharing

Open a world from the dashboard. Its **Console**, **Players**, **Play together**
and **World permissions** tabs provide the following controls without enabling
advanced mode. Tabs and actions follow the logged-in member's permissions.

## Browser console

**Console** shows recent container logs and streams new lines while the page is
open. Search the output, pause/resume scrolling or clear the local view. Enter a
Minecraft command and press Send or Enter; a leading `/` is accepted. Arrow Up
and Down recall recent commands. Command responses appear in the console.

The **Common commands** section runs commands through the same authenticated
Minecraft-console endpoint:

- List players, set day/night, clear weather or start rain.
- Save the world immediately (Java only).
- Choose a difficulty and apply it.
- Send a message to all players.

Commands are disabled while the server is offline. Java uses RCON; Bedrock queues
commands through the runtime's console helper and reports their results in live
logs. The web browser does not receive a host shell or the RCON password.

## Whitelist and player actions

In **Players**, enter a Minecraft player name and select the desired action.
Java supports kick, operator/deoperator, whitelist add/remove and ban/unban.
Bedrock supports kick, operator/deoperator and allowlist add/remove, including
space-containing gamertags. Confirm the chosen action before execution.

The guest list is shown as named entries with removal buttons. Java also displays
operators and banned players with deoperator/unban controls. Lists refresh after
an action and periodically while the panel is open.

With Settings permission, switch **Only invited players may join** and click
**Save guest list setting**. This saves `white-list` for Java or `allow-list` for
Bedrock using the normal settings operation. A recovery point is created and an
online server restarts to apply it; a stopped server stays stopped. The switch
shows the actual persisted setting on subsequent visits. Player entries remain
in the server's own whitelist/allowlist files.

## Invite Minecraft players

**Play together** provides the Minecraft host/port, edition and version, plus a
ready-to-copy invitation. Copy works on ordinary HTTP LAN installations as well
as HTTPS; if the browser disallows copying, select the displayed text manually.
The address is the Docker host's configured LAN target. Outside the LAN, use the
existing CloudGate target instructions with your TCP (Java) or UDP (Bedrock)
tunnel and share that provider's reachable address. Copying a LAN address does
not automatically create an external tunnel.

Minecraft joining uses the game port and whitelist/allowlist. It does not require
a MineMate administration account.

## Share MineMate management

Click **Share management access** under Play together, or open **World
permissions** directly. Owners/admins can follow **Create or manage member
accounts**, create a member account and return to the world's permissions.

Select the member, choose a preset or individual permissions, then save:

- **View only**: see this world's overview and connection target.
- **Manage server and console**: view, start/stop/restart, console and players.
- **Remove access**: clear every permission on this world.

The management preset does not grant configuration, file, content, backup,
update or deletion access; those permissions can be selected separately. Enabling
an individual permission also selects View, so the member can find the world.
Changes are checked by the API and access revocation applies to subsequent
requests. Membership grants access only to the selected world, without changing
the member's application role.

## Web port

Production Compose publishes **18080** on the Docker host and forwards it to
**8080 inside the container**. Set `MINEMATE_PORT=18080` in `.env`, including on an
older installation whose `.env` still says 8080. Open `http://HOST-IP:18080`.
Minecraft ports are independent of the management UI port.

# Server, content and world uploads

## Install your server JAR

In the creation wizard, choose Java and your play style. On the version page,
select the actual server software (including Forge and NeoForge), Minecraft
version, and **Upload my own JAR** under Server installation. Software selection
is available without enabling advanced mode. The world page independently offers
new worlds or a saved-world import, so a server JAR and world upload can be used
together.

- Forge / NeoForge: select the matching loader and upload its official **installer**
  JAR. MineMate supplies it to the runtime's installer, then starts Minecraft.
  The installer profile's Minecraft version and loader must match the selection.
- Vanilla, Paper, Purpur, Fabric or Custom: upload a directly executable server
  JAR containing a Main-Class manifest entry. A launcher that depends on separate
  libraries still needs those libraries or its supported distribution; an installer
  is not a directly executable Minecraft server.
- Already created worlds: open **Inventory → Upload server JAR**. Select the
  software and the new file. This changes the installation source to upload and
  recreates the owned runtime using that JAR. Content and settings permissions are
  required. Bedrock uses its native dedicated-server binary, not Java JARs.

A failed wizard upload keeps the already-created world. Retry its files or open
it to continue, instead of creating a duplicate world.

## Upload a mod or plugin collection

During Java creation, the version/software page is followed by **Choose your mods**
for Fabric, Forge, NeoForge and Custom. This step also appears when you upload your
own server JAR. Select multiple trusted `.jar` files, add further selections or
remove individual files. Mods are optional; the review lists the chosen filenames.
Paper and Purpur offer **Choose your plugins** instead. Vanilla and Bedrock skip
this step. Changing the software or edition clears incompatible selections.

Server JAR, world/archive import and the content batch are applied in that order.
A failed batch keeps the created world and completed uploads; correct the mod
selection and retry without creating another server or repeating a successful
world import. Duplicate filenames, excess size/count or non-JAR extensions block
continuation; archive validation also runs before any batch is installed.

For an existing server, open **Inventory → Upload mod / plugin JARs**. Select several `.jar` files together,
add further selections, or drag files into the picker. Individual selections can
be removed. Confirm that the files are trusted, then upload the batch.

The batch is fully validated before Minecraft stops. Valid Java class/loader
metadata is sufficient; the optional JAR manifest is not required for a mod.
Duplicate filenames or an invalid member reject the complete batch. Forge,
NeoForge, Fabric and Custom receive `mods/`; Paper and Purpur receive `plugins/`.
The server installer stays separate from the mod inventory. Custom launchers must
support the selected mods. Minecraft versions, loader versions and mod dependencies
still need to be compatible; files are not automatically converted between loaders.

A recovery point is saved before applying files. A previously running server is
restarted and checked, with rollback on failure. A stopped server remains stopped.

## Upload a saved world

Open **Worlds → Bring your world**, then choose **World ZIP** or **World folder**.
Folder selection sends all files with their relative paths; no client-side ZIP or
large in-memory world conversion is needed. Browsers that do not offer directory
selection can use ZIP. The creation wizard offers the same folder option for a
world import. Bedrock `.mcworld` exports are ZIP archives and are also supported.

Upload the complete saved world:

- Java: `level.dat`, `region/`, data and any dimensions such as `DIM-1/`, `DIM1/`
  or `dimensions/`. Keep their internal structure.
- Bedrock: `level.dat` and the complete `db/` directory, plus other world files.

An archive can contain wrapper directories or a README alongside the world.
MineMate locates the unique `level.dat` root and removes those wrappers. An upload
containing multiple separate worlds requires selecting one world first. Bedrock
worlds are accepted only by Bedrock servers; Java worlds by Java servers. This
flow does not convert between world formats.

Before replacement, MineMate stops Minecraft and saves a recovery point. The
world goes to the configured Java level directory or Bedrock `worlds/<level-name>`.
A previously running server restarts and is checked; failure restores the previous
world. Invalid world formats are rejected before touching the current server.

## Progress and limits

The dialog displays transfer percentage followed by real installation/import
phases and remains open until the operation completes. Switching upload type
clears stale files and confirmation. Startup errors remain visible in Activity
and Repair. Management dialogs keep their action buttons outside the scrolling
form, including narrow or short viewports.

- JAR / general file batches: at most 100 files.
- World folders: at most 10,000 files, with a complete relative-path manifest.
- Each uploaded file: at most 512 MB; aggregate upload: at most 20 GB. Larger
  folders can be ZIP-compressed, within the archive-upload and expansion limits.
- Archive expansion: 20 GB total, 4 GB per member, 100,000 members, bounded ratios.
- Paths, symbolic links, special files, duplicate paths and incomplete folder
  lists are rejected. Staging files are cleaned after success and failure.

Reverse proxies must allow the chosen request size and operation duration.
Uploads run only after authentication, permission checks and explicit confirmation.

## Host port

Set `MINEMATE_PORT=18080` in `.env` and open `http://HOST-IP:18080`. Update an older
8080 setting explicitly. Compose still forwards to 8080 inside the container.

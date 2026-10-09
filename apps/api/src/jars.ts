import {
  inspectArchive,
  readArchiveMember,
} from "../../../packages/backup/src/archive.ts";
import { relativeSafe } from "../../../packages/backup/src/paths.ts";
import {
  AppError,
  type ServerConfig,
} from "../../../packages/shared/src/index.ts";

export async function validateJar(
  file: string,
  name: string,
  config: ServerConfig,
  server: boolean,
) {
  relativeSafe(name);
  if (
    name.length > 200 ||
    /[\/\\\x00-\x1f]/.test(name) ||
    !/\.jar$/i.test(name)
  )
    throw new AppError("JAR", `${name}: Choose a file ending in .jar.`);
  try {
    await validateJarContents(file, config, server);
  } catch (error) {
    if (error instanceof AppError)
      throw new AppError(
        error.code,
        `${name}: ${error.message}`,
        error.status,
        error.detail,
      );
    throw error;
  }
}

async function validateJarContents(
  file: string,
  config: ServerConfig,
  server: boolean,
) {
  const entries = await inspectArchive(file);
  if (!server) {
    if (
      !["PAPER", "PURPUR", "FABRIC", "FORGE", "NEOFORGE", "CUSTOM"].includes(
        config.software,
      )
    )
      throw new AppError(
        "LOADER",
        "Choose a mod or plugin loader before uploading content.",
      );
    if (entries.some((entry) => entry.name === "install_profile.json"))
      throw new AppError(
        "INSTALLER_AS_MOD",
        "This is a Forge/NeoForge installer, not a mod. Select it only under Server installation.",
      );
    if (
      entries.some(
        (e) =>
          /\.class$/i.test(e.name) ||
          [
            "fabric.mod.json",
            "META-INF/mods.toml",
            "META-INF/neoforge.mods.toml",
            "plugin.yml",
            "paper-plugin.yml",
          ].includes(e.name),
      )
    )
      return;
    // Forge and NeoForge also publish standalone Jar-in-Jar containers. Their
    // classes and mod descriptor live in the referenced nested JAR, not here.
    if (
      ["FORGE", "NEOFORGE"].includes(config.software) &&
      entries.some((e) => e.name === "META-INF/jarjar/metadata.json")
    ) {
      let metadata: { jars?: { path?: unknown }[] };
      try {
        metadata = JSON.parse(
          (await readArchiveMember(
            file,
            "META-INF/jarjar/metadata.json",
            128 * 1024,
          )) ?? "",
        ) as typeof metadata;
      } catch {
        throw new AppError(
          "JARJAR",
          "This JAR has invalid Jar-in-Jar metadata.",
        );
      }
      const members = new Set(
        entries.filter((e) => !e.directory && e.bytes > 0).map((e) => e.name),
      );
      if (
        !Array.isArray(metadata?.jars) ||
        metadata.jars.length === 0 ||
        !metadata.jars.every(
          (jar) =>
            typeof jar?.path === "string" &&
            jar.path.startsWith("META-INF/jarjar/") &&
            jar.path.toLowerCase().endsWith(".jar") &&
            members.has(jar.path),
        )
      )
        throw new AppError(
          "JARJAR",
          "This Jar-in-Jar manifest does not reference an included mod JAR.",
        );
      return;
    }
    throw new AppError(
      "JAR",
      "This JAR has no Java classes or recognized mod/plugin metadata. Select the actual mod or plugin JAR for this server.",
    );
  }
  const profile = await readArchiveMember(file, "install_profile.json");
  if (["FORGE", "NEOFORGE"].includes(config.software)) {
    if (!profile)
      throw new AppError(
        "INSTALLER_JAR",
        "Forge and NeoForge require their installer JAR. Choose Custom for a directly executable server JAR.",
      );
    let metadata: { minecraft?: string; path?: string; version?: string };
    try {
      metadata = JSON.parse(profile) as typeof metadata;
    } catch {
      throw new AppError("INSTALLER_JAR", "The installer profile is invalid.");
    }
    if (
      !metadata ||
      typeof metadata !== "object" ||
      (metadata.minecraft !== undefined &&
        typeof metadata.minecraft !== "string") ||
      (metadata.path !== undefined && typeof metadata.path !== "string")
    )
      throw new AppError("INSTALLER_JAR", "The installer profile is invalid.");
    if (metadata.minecraft && metadata.minecraft !== config.version)
      throw new AppError(
        "INSTALLER_VERSION",
        `This installer requires Minecraft ${metadata.minecraft}. Select that version first.`,
      );
    if (
      (metadata.path &&
        (config.software === "NEOFORGE"
          ? !metadata.path.startsWith("net.neoforged:neoforge:")
          : !metadata.path.startsWith("net.minecraftforge:forge:"))) ||
      (typeof metadata.version === "string" &&
        /^(neo)?forge-/.test(metadata.version) &&
        (config.software === "NEOFORGE") !==
          metadata.version.startsWith("neoforge-"))
    )
      throw new AppError(
        "INSTALLER_LOADER",
        "This installer belongs to a different loader. Select Forge or NeoForge to match it.",
      );
  } else {
    if (profile)
      throw new AppError(
        "INSTALLER_JAR",
        "This is a loader installer. Select Forge or NeoForge instead of a directly executable server.",
      );
    const manifest = await readArchiveMember(
      file,
      "META-INF/MANIFEST.MF",
      65536,
    );
    if (!manifest || !/^Main-Class:\s*\S+/im.test(manifest))
      throw new AppError(
        "SERVER_JAR",
        "The server JAR needs a Main-Class entry. Upload mods separately in Inventory.",
      );
  }
}

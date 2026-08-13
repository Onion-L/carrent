import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun scripts/release-macos.ts <version>");
  process.exit(2);
}

const root = resolve(import.meta.dir, "..");
const desktop = join(root, "apps", "desktop");
const packagePath = join(desktop, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
  version?: string;
  [key: string]: unknown;
};
packageJson.version = version;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null),
) as Record<string, string>;
env.APPLE_KEYCHAIN_PROFILE ??= "carrent-notary";

async function run(command: string, args: string[]) {
  const process = Bun.spawn([command, ...args], {
    cwd: desktop,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

await run("bun", ["run", "dist", "--", "--mac", "--arm64", "--x64", "--publish", "never"]);

const artifacts = [
  {
    app: join("release", "mac", "Carrent.app"),
    sourceDmg: join("release", `Carrent-${version}.dmg`),
    sourceZip: join("release", `Carrent-${version}-mac.zip`),
    dmg: join("release", `Carrent-${version}-intel.dmg`),
    zip: join("release", `Carrent-${version}-intel.zip`),
  },
  {
    app: join("release", "mac-arm64", "Carrent.app"),
    sourceDmg: join("release", `Carrent-${version}-arm64.dmg`),
    sourceZip: join("release", `Carrent-${version}-arm64-mac.zip`),
    dmg: join("release", `Carrent-${version}-apple-silicon.dmg`),
    zip: join("release", `Carrent-${version}-apple-silicon.zip`),
  },
];

for (const artifact of artifacts) {
  await rename(join(desktop, artifact.sourceDmg), join(desktop, artifact.dmg));
  await rename(join(desktop, artifact.sourceZip), join(desktop, artifact.zip));

  await run("codesign", ["--verify", "--deep", "--strict", artifact.app]);
  await run("xcrun", ["stapler", "validate", artifact.app]);
  await run("spctl", ["--assess", "--type", "execute", "--verbose=4", artifact.app]);
  await run("hdiutil", ["verify", artifact.dmg]);

  const mountPoint = await mkdtemp(join(tmpdir(), "carrent-dmg-"));
  let mounted = false;
  try {
    await run("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountPoint,
      artifact.dmg,
    ]);
    mounted = true;

    for (const name of [
      ".DS_Store",
      ".VolumeIcon.icns",
      ".background.tiff",
      "Carrent.app",
      "Applications",
    ]) {
      await lstat(join(mountPoint, name));
    }
  } finally {
    if (mounted) await run("hdiutil", ["detach", mountPoint]);
    await rm(mountPoint, { recursive: true, force: true });
  }
}

for (const artifact of artifacts) {
  console.log(resolve(desktop, artifact.dmg));
}

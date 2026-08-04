import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun .agents/skills/carrent-release/scripts/release-macos.ts <version>");
  process.exit(2);
}

const root = resolve(import.meta.dir, "../../../..");
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

await run("bun", ["run", "dist", "--", "--mac", "--arm64", "--x64"]);

const artifacts = [
  {
    app: join("release", "mac", "Carrent.app"),
    dmg: join("release", `Carrent-${version}.dmg`),
  },
  {
    app: join("release", "mac-arm64", "Carrent.app"),
    dmg: join("release", `Carrent-${version}-arm64.dmg`),
  },
];

for (const artifact of artifacts) {
  await run("codesign", ["--verify", "--deep", "--strict", artifact.app]);
  await run("xcrun", ["stapler", "validate", artifact.app]);
  await run("spctl", ["--assess", "--type", "execute", "--verbose=4", artifact.app]);
  await run("hdiutil", ["verify", artifact.dmg]);
}

for (const artifact of artifacts) {
  console.log(resolve(desktop, artifact.dmg));
}

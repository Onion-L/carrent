import type { UpdateCheckResult } from "../../src/shared/updates";

const RELEASES_API_URL = "https://api.github.com/repos/Onion-L/carrent/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/Onion-L/carrent/releases";

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
}

/**
 * Compares two version tags numerically. A leading "v" is ignored and an
 * absent numeric component is treated as 0, so "1.2" and "1.2.0" compare equal.
 * A version with a pre-release suffix ("-beta.1") is older than the same
 * version without one.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

function compareVersions(a: string, b: string): number {
  const [coreA = "", ...preA] = stripLeadingV(a).split("-");
  const [coreB = "", ...preB] = stripLeadingV(b).split("-");
  const partsA = coreA.split(".").map(toVersionPart);
  const partsB = coreB.split(".").map(toVersionPart);

  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index++) {
    const left = partsA[index] ?? 0;
    const right = partsB[index] ?? 0;
    if (left !== right) return left - right;
  }

  const suffixA = preA.join("-");
  const suffixB = preB.join("-");
  if (suffixA === suffixB) return 0;
  if (suffixA === "") return 1;
  if (suffixB === "") return -1;
  return suffixA < suffixB ? -1 : 1;
}

function stripLeadingV(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function toVersionPart(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fetches the latest non-prerelease GitHub release and compares its tag against
 * the running app version. Failures (offline, private repo, rate limiting, no
 * releases yet) resolve to "no update" instead of throwing, since an update
 * check should never block the Settings screen.
 */
export async function checkForUpdates(
  currentVersion: string,
  fetchLatestRelease: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<UpdateCheckResult> {
  try {
    const response = await fetchLatestRelease(RELEASES_API_URL);
    if (!response.ok) return { hasUpdate: false };

    const release = (await response.json()) as GitHubRelease;
    if (typeof release.tag_name !== "string" || release.tag_name === "") {
      return { hasUpdate: false };
    }

    const latestVersion = stripLeadingV(release.tag_name);
    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      latestVersion,
      releaseUrl:
        typeof release.html_url === "string" && release.html_url !== ""
          ? release.html_url
          : RELEASES_PAGE_URL,
    };
  } catch {
    return { hasUpdate: false };
  }
}

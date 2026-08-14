import fs from "node:fs/promises";
import path from "node:path";
import { resolveKimiCodeHome } from "./kimiContextUsage";
import type { PlanUsageErrorKind, RuntimeQuotaWindow } from "../../src/shared/chat";

const CREDENTIALS_RELATIVE_PATH = path.join("credentials", "kimi-code.json");
const LOCK_RELATIVE_PATH = path.join("oauth", "kimi-code.lock");
const DEFAULT_USAGES_URL = "https://api.kimi.com/coding/v1/usages";
const DEFAULT_TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
const OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
// Refresh only when the access token is inside this margin; the CLI's own
// refreshes keep the file fresh during active sessions.
const TOKEN_EXPIRY_MARGIN_SECONDS = 60;
const USAGE_CACHE_TTL_MS = 60_000;
const LOCK_POLL_MS = 100;
const LOCK_STALE_MS = 5_000;
const DEFAULT_LOCK_WAIT_MS = 10_000;

export type KimiPlanUsageWindows = {
  weekly?: RuntimeQuotaWindow;
  fiveHour?: RuntimeQuotaWindow;
};

export type KimiPlanUsageResult = {
  planUsage: KimiPlanUsageWindows | null;
  error?: PlanUsageErrorKind;
};

export type KimiPlanUsageDeps = {
  /** Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
  /** Epoch milliseconds; injectable for tests. */
  now?: () => number;
  /** Injectable fetch for both the usages and token endpoints. */
  fetchImpl?: typeof fetch;
  usagesUrl?: string;
  tokenUrl?: string;
  lockWaitMs?: number;
};

type KimiCredentials = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch seconds; null when the file does not state an expiry. */
  expiresAt: number | null;
  /** Raw credential object so refresh writes preserve unknown fields. */
  raw: Record<string, unknown>;
};

const usageCache = new Map<string, { expiresAt: number; value: KimiPlanUsageResult }>();

/** Test helper: drop the in-process usage cache. */
export function resetKimiPlanUsageCache(): void {
  usageCache.clear();
}

/**
 * Reads Kimi plan quota (weekly + 5h windows) straight from the REST usage
 * endpoint using the CLI's OAuth token. Refreshes the token first when it is
 * expired or near expiry — access tokens live ~15 minutes, so a passive
 * read-only design would fail on every cold session.
 */
export async function getKimiPlanUsage(deps: KimiPlanUsageDeps = {}): Promise<KimiPlanUsageResult> {
  const now = deps.now ?? Date.now;
  const kimiDir = resolveKimiCodeHome(deps.homeDir);
  const cacheKey = kimiDir;

  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return cached.value;
  }

  let credentials = await readCredentials(path.join(kimiDir, CREDENTIALS_RELATIVE_PATH));
  if (!credentials) {
    return { planUsage: null, error: "no-credentials" };
  }

  if (
    credentials.expiresAt === null ||
    credentials.expiresAt <= now() / 1000 + TOKEN_EXPIRY_MARGIN_SECONDS
  ) {
    const refreshed = await ensureFreshCredentials(kimiDir, credentials, deps, now);
    if ("error" in refreshed) {
      return { planUsage: null, error: refreshed.error };
    }
    credentials = refreshed.credentials;
  }

  const result = await fetchPlanUsage(credentials.accessToken, deps);
  if (!result.planUsage) {
    return { planUsage: null, error: result.error ?? "bad-payload" };
  }

  const value: KimiPlanUsageResult = { planUsage: result.planUsage };
  usageCache.set(cacheKey, { expiresAt: now() + USAGE_CACHE_TTL_MS, value });
  return value;
}

// --- Credentials ---------------------------------------------------------------

async function readCredentials(credentialsPath: string): Promise<KimiCredentials | null> {
  let content: string;
  try {
    content = await fs.readFile(credentialsPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const raw = parsed as Record<string, unknown>;
  if (typeof raw.access_token !== "string" || raw.access_token === "") return null;

  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: readExpiresAt(raw.expires_at),
    raw,
  };
}

function readExpiresAt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  // Tolerate millisecond timestamps for robustness; kimi-code writes seconds.
  return value > 1e12 ? value / 1000 : value;
}

/**
 * The refresh dance: acquire the OAuth lock, re-read the credentials (the CLI
 * may have refreshed while we waited — always refresh with the token currently
 * on disk), POST the refresh grant, and write the merged object atomically.
 */
async function ensureFreshCredentials(
  kimiDir: string,
  stale: KimiCredentials,
  deps: KimiPlanUsageDeps,
  now: () => number,
): Promise<{ credentials: KimiCredentials } | { error: PlanUsageErrorKind }> {
  const credentialsPath = path.join(kimiDir, CREDENTIALS_RELATIVE_PATH);
  const lockPath = path.join(kimiDir, LOCK_RELATIVE_PATH);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const release = await acquireLock(lockPath, deps.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS, now);
  if (!release) {
    // Contended for the whole window (the CLI is likely refreshing). Give the
    // re-read one last chance before giving up as a transient failure.
    const reread = await readCredentials(credentialsPath);
    if (reread && isFresh(reread, now)) return { credentials: reread };
    return { error: "network" };
  }

  try {
    // Mandatory re-read under the lock; never replay a rotated refresh token.
    const reread = await readCredentials(credentialsPath);
    const current = reread ?? stale;
    if (reread && isFresh(reread, now)) {
      return { credentials: reread };
    }
    if (!current.refreshToken) {
      return { error: "unauthorized" };
    }

    const tokenUrl = deps.tokenUrl ?? DEFAULT_TOKEN_URL;
    const fetchImpl = deps.fetchImpl ?? fetch;
    if (!fetchImpl) return { error: "network" };

    let response: Response;
    try {
      // The token endpoint speaks standard OAuth form encoding only; a JSON
      // body is rejected with 400 (verified live against auth.kimi.com).
      response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: OAUTH_CLIENT_ID,
        }).toString(),
      });
    } catch {
      return { error: "network" };
    }
    // Includes `invalid_grant`; never auto-retry — replaying a rotated
    // refresh token risks tripping reuse detection and killing the login.
    if (!response.ok) {
      return {
        error: response.status >= 400 && response.status < 500 ? "unauthorized" : "network",
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { error: "bad-payload" };
    }
    if (!payload || typeof payload !== "object") return { error: "bad-payload" };

    const granted = payload as Record<string, unknown>;
    if (typeof granted.access_token !== "string" || granted.access_token === "") {
      return { error: "bad-payload" };
    }

    const merged: Record<string, unknown> = { ...current.raw, ...granted };
    const expiresInSeconds =
      typeof granted.expires_in === "number" && Number.isFinite(granted.expires_in)
        ? granted.expires_in
        : undefined;
    merged.expires_at =
      expiresInSeconds !== undefined ? Math.floor(now() / 1000) + expiresInSeconds : undefined;

    try {
      await writeCredentialsAtomically(credentialsPath, merged);
    } catch {
      // The in-memory token still works for this request; the next one re-reads.
    }

    return {
      credentials: {
        accessToken: granted.access_token,
        refreshToken:
          typeof granted.refresh_token === "string" ? granted.refresh_token : current.refreshToken,
        expiresAt: readExpiresAt(merged.expires_at),
        raw: merged,
      },
    };
  } finally {
    await release();
  }
}

function isFresh(credentials: KimiCredentials, now: () => number): boolean {
  return (
    credentials.expiresAt !== null &&
    credentials.expiresAt > now() / 1000 + TOKEN_EXPIRY_MARGIN_SECONDS
  );
}

async function writeCredentialsAtomically(
  credentialsPath: string,
  merged: Record<string, unknown>,
): Promise<void> {
  const temporaryPath = `${credentialsPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, credentialsPath);
}

async function acquireLock(
  lockPath: string,
  waitMs: number,
  now: () => number,
): Promise<(() => Promise<void>) | null> {
  const deadline = now() + waitMs;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.write(`${process.pid}\n`);
      await handle.close();
      return async () => {
        await fs.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      try {
        const stat = await fs.stat(lockPath);
        if (now() - stat.mtimeMs > LOCK_STALE_MS) {
          // Take over a lock left behind by a crashed process.
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }

      if (now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

// --- Usages endpoint ------------------------------------------------------------

async function fetchPlanUsage(
  accessToken: string,
  deps: KimiPlanUsageDeps,
): Promise<{ planUsage: KimiPlanUsageWindows | null; error?: PlanUsageErrorKind }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!fetchImpl) return { planUsage: null, error: "network" };

  let response: Response;
  try {
    response = await fetchImpl(deps.usagesUrl ?? DEFAULT_USAGES_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  } catch {
    return { planUsage: null, error: "network" };
  }

  if (response.status === 401 || response.status === 403) {
    return { planUsage: null, error: "unauthorized" };
  }
  if (!response.ok) {
    return { planUsage: null, error: "network" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { planUsage: null, error: "bad-payload" };
  }

  const planUsage = mapUsagesPayload(payload);
  if (!planUsage) {
    return { planUsage: null, error: "bad-payload" };
  }
  return { planUsage };
}

function mapUsagesPayload(payload: unknown): KimiPlanUsageWindows | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const weekly = mapQuotaWindow(root.usage);
  const fiveHour = Array.isArray(root.limits)
    ? root.limits
        .map((entry) =>
          entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null,
        )
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .find((entry) => {
          const window = entry.window;
          if (!window || typeof window !== "object") return false;
          const record = window as Record<string, unknown>;
          return record.duration === 300 && record.timeUnit === "TIME_UNIT_MINUTE";
        })
    : undefined;

  const fiveHourWindow = fiveHour ? mapQuotaWindow(fiveHour.detail ?? undefined) : undefined;

  if (!weekly && !fiveHourWindow) return null;
  return {
    ...(weekly ? { weekly } : {}),
    ...(fiveHourWindow ? { fiveHour: fiveHourWindow } : {}),
  };
}

function mapQuotaWindow(detail: unknown): RuntimeQuotaWindow | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const record = detail as Record<string, unknown>;

  const used = parseQuotaNumber(record.used);
  const limit = parseQuotaNumber(record.limit);
  const resetAt = typeof record.resetTime === "string" ? record.resetTime : undefined;

  let usedPercentage: number | undefined;
  if (used !== undefined && limit !== undefined && limit > 0) {
    usedPercentage = (used / limit) * 100;
  }

  if (
    usedPercentage === undefined &&
    resetAt === undefined &&
    used === undefined &&
    limit === undefined
  ) {
    return undefined;
  }
  return {
    ...(usedPercentage !== undefined ? { usedPercentage } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** The API reports quota numbers as decimal strings. */
function parseQuotaNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

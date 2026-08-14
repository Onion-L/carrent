import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKimiPlanUsage, resetKimiPlanUsageCache } from "./kimiPlanUsage";

const NOW_MS = 1_786_700_000_000;
const USAGES_URL = "https://usage.test/v1/usages";
const TOKEN_URL = "https://auth.test/api/oauth/token";

const LIVE_PAYLOAD = {
  usage: { limit: "100", used: "80", remaining: "20", resetTime: "2026-08-19T05:57:48.869369Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: {
        limit: "100",
        used: "15",
        remaining: "85",
        resetTime: "2026-08-14T06:57:48.869369Z",
      },
    },
    {
      window: { duration: 60, timeUnit: "TIME_UNIT_HOUR" },
      detail: { limit: "999", used: "1", remaining: "998", resetTime: "2026-08-14T07:00:00Z" },
    },
  ],
};

let homeDir: string;
let fetchLog: Array<{ url: string; init?: RequestInit }>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeFetch(handler: FetchHandler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchLog.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

async function writeCredentials(fields: Record<string, unknown>) {
  const dir = path.join(homeDir, ".kimi-code", "credentials");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "kimi-code.json");
  await fs.writeFile(filePath, JSON.stringify(fields), "utf8");
  return filePath;
}

function validCredentials(expiresAt: number): Record<string, unknown> {
  return {
    access_token: "live-access-token",
    refresh_token: "live-refresh-token",
    expires_at: expiresAt,
    token_type: "Bearer",
    scope: "coding:read coding:write",
  };
}

beforeEach(async () => {
  resetKimiPlanUsageCache();
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-plan-usage-test-"));
  fetchLog = [];
});

describe("getKimiPlanUsage", () => {
  it("maps the verified live payload into weekly and 5h windows", async () => {
    await writeCredentials(validCredentials((NOW_MS + 120_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === USAGES_URL ? jsonResponse(LIVE_PAYLOAD) : jsonResponse({}, 500),
      ),
    });

    expect(result).toEqual({
      planUsage: {
        weekly: {
          usedPercentage: 80,
          resetAt: "2026-08-19T05:57:48.869369Z",
          used: 80,
          limit: 100,
        },
        fiveHour: {
          usedPercentage: 15,
          resetAt: "2026-08-14T06:57:48.869369Z",
          used: 15,
          limit: 100,
        },
      },
    });
    // Only the 300-minute window maps to the 5h quota; the hourly entry is
    // ignored and no refresh was attempted for a fresh token.
    expect(fetchLog.map((entry) => entry.url)).toEqual([USAGES_URL]);
  });

  it("returns no-credentials when the credential file is missing", async () => {
    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch(() => jsonResponse(LIVE_PAYLOAD)),
    });
    expect(result).toEqual({ planUsage: null, error: "no-credentials" });
    expect(fetchLog).toEqual([]);
  });

  it("returns no-credentials for a malformed credential file", async () => {
    const dir = path.join(homeDir, ".kimi-code", "credentials");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "kimi-code.json"), "{not json", "utf8");

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch(() => jsonResponse(LIVE_PAYLOAD)),
    });
    expect(result).toEqual({ planUsage: null, error: "no-credentials" });
  });

  it("refreshes credentials when expires_at is missing", async () => {
    const credentials = validCredentials(0);
    delete credentials.expires_at;
    await writeCredentials(credentials);

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === TOKEN_URL
          ? jsonResponse({ access_token: "rotated-access-token", expires_in: 900 })
          : jsonResponse(LIVE_PAYLOAD),
      ),
    });

    expect(result.planUsage?.weekly?.usedPercentage).toBe(80);
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL, USAGES_URL]);
  });

  it("returns unauthorized when the usages endpoint rejects the token", async () => {
    await writeCredentials(validCredentials((NOW_MS + 120_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === USAGES_URL ? jsonResponse({ message: "unauthorized" }, 401) : jsonResponse({}),
      ),
    });
    expect(result).toEqual({ planUsage: null, error: "unauthorized" });
  });

  it("returns bad-payload for a 2xx response with an unexpected shape", async () => {
    await writeCredentials(validCredentials((NOW_MS + 120_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) => (url === USAGES_URL ? jsonResponse([]) : jsonResponse({}))),
    });
    expect(result).toEqual({ planUsage: null, error: "bad-payload" });
  });

  it("returns network for server errors and failed fetches", async () => {
    await writeCredentials(validCredentials((NOW_MS + 120_000) / 1000));

    const serverError = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === USAGES_URL ? jsonResponse({}, 503) : jsonResponse({}),
      ),
    });
    expect(serverError).toEqual({ planUsage: null, error: "network" });

    resetKimiPlanUsageCache();
    fetchLog = [];
    const offline = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch(() => {
        throw new Error("offline");
      }),
    });
    expect(offline).toEqual({ planUsage: null, error: "network" });
  });

  it("refreshes an expired token, writes the merged credentials, and uses the new token", async () => {
    const credentialsPath = await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url, init) => {
        if (url === TOKEN_URL) {
          const params = new URLSearchParams(String(init?.body));
          const headers = init?.headers as Record<string, string> | undefined;
          expect(headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
          expect(params.get("grant_type")).toBe("refresh_token");
          expect(params.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
          expect(params.get("refresh_token")).toBe("live-refresh-token");
          return jsonResponse({
            access_token: "rotated-access-token",
            refresh_token: "rotated-refresh-token",
            expires_in: 900,
            token_type: "Bearer",
          });
        }
        const auth = String(
          init?.headers ? (init.headers as Record<string, string>).authorization : "",
        );
        expect(auth).toBe("Bearer rotated-access-token");
        return jsonResponse(LIVE_PAYLOAD);
      }),
    });

    expect(result.planUsage?.weekly?.usedPercentage).toBe(80);
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL, USAGES_URL]);

    const written = JSON.parse(await fs.readFile(credentialsPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(written.access_token).toBe("rotated-access-token");
    expect(written.refresh_token).toBe("rotated-refresh-token");
    expect(written.expires_at).toBe(NOW_MS / 1000 + 900);
    // Unknown credential fields survive the merge.
    expect(written.scope).toBe("coding:read coding:write");
    // The lock is released afterwards.
    const lockGone = await fs
      .stat(path.join(homeDir, ".kimi-code", "oauth", "kimi-code.lock"))
      .then(
        () => false,
        () => true,
      );
    expect(lockGone).toBe(true);
  });

  it("returns unauthorized for a rejected refresh grant without retrying", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));
    let tokenCalls = 0;

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) => {
        if (url === TOKEN_URL) {
          tokenCalls += 1;
          return jsonResponse({ error: "invalid_grant" }, 400);
        }
        return jsonResponse(LIVE_PAYLOAD);
      }),
    });

    expect(result).toEqual({ planUsage: null, error: "unauthorized" });
    expect(tokenCalls).toBe(1);
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL]);
  });

  it("classifies refresh server failures as network errors", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === TOKEN_URL
          ? jsonResponse({ error: "unavailable" }, 503)
          : jsonResponse(LIVE_PAYLOAD),
      ),
    });

    expect(result).toEqual({ planUsage: null, error: "network" });
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL]);
  });

  it("classifies malformed refresh responses as bad payloads", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === TOKEN_URL ? new Response("{not json", { status: 200 }) : jsonResponse(LIVE_PAYLOAD),
      ),
    });

    expect(result).toEqual({ planUsage: null, error: "bad-payload" });
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL]);
  });

  it("returns network when the refresh request itself fails", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) => {
        if (url === TOKEN_URL) throw new Error("offline");
        return jsonResponse(LIVE_PAYLOAD);
      }),
    });
    expect(result).toEqual({ planUsage: null, error: "network" });
  });

  it("takes over a stale lock left behind by a crashed process", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));
    const lockPath = path.join(homeDir, ".kimi-code", "oauth", "kimi-code.lock");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "99999\n", "utf8");
    const stale = new Date(NOW_MS - 60_000);
    await fs.utimes(lockPath, stale, stale);

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) =>
        url === TOKEN_URL
          ? jsonResponse({ access_token: "rotated-access-token", expires_in: 900 })
          : jsonResponse(LIVE_PAYLOAD),
      ),
    });

    expect(result.planUsage?.weekly?.usedPercentage).toBe(80);
    expect(fetchLog.map((entry) => entry.url)).toEqual([TOKEN_URL, USAGES_URL]);
  });

  it("skips the refresh POST when the CLI refreshed the token while we held off", async () => {
    await writeCredentials(validCredentials((NOW_MS - 60_000) / 1000));
    const credentialsPath = path.join(homeDir, ".kimi-code", "credentials", "kimi-code.json");
    const lockPath = path.join(homeDir, ".kimi-code", "oauth", "kimi-code.lock");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // Another process (the CLI) holds the lock briefly and refreshes the
    // credentials underneath it while we wait.
    await fs.writeFile(lockPath, "99999\n", "utf8");
    setTimeout(() => {
      void fs.writeFile(
        credentialsPath,
        JSON.stringify(validCredentials((NOW_MS + 600_000) / 1000)),
        "utf8",
      );
      void fs.unlink(lockPath).catch(() => {});
    }, 30).unref?.();

    const result = await getKimiPlanUsage({
      homeDir,
      now: () => NOW_MS,
      lockWaitMs: 5_000,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url, init) => {
        expect(url).toBe(USAGES_URL);
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.authorization).toBe("Bearer live-access-token");
        return jsonResponse(LIVE_PAYLOAD);
      }),
    });

    expect(result.planUsage?.weekly?.usedPercentage).toBe(80);
    // The mandatory re-read made the refresh POST unnecessary.
    expect(fetchLog.map((entry) => entry.url)).toEqual([USAGES_URL]);
  });

  it("serves repeat calls from the cache within the TTL", async () => {
    await writeCredentials(validCredentials((NOW_MS + 3_600_000) / 1000));
    let clock = NOW_MS;
    let usagesCalls = 0;

    const deps = {
      homeDir,
      now: () => clock,
      usagesUrl: USAGES_URL,
      tokenUrl: TOKEN_URL,
      fetchImpl: makeFetch((url) => {
        if (url === USAGES_URL) usagesCalls += 1;
        return jsonResponse(LIVE_PAYLOAD);
      }),
    };

    await getKimiPlanUsage(deps);
    clock += 30_000;
    await getKimiPlanUsage(deps);
    expect(usagesCalls).toBe(1);

    clock += 31_000;
    await getKimiPlanUsage(deps);
    expect(usagesCalls).toBe(2);
  });
});

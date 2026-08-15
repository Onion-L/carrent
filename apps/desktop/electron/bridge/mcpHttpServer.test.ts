import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { request as httpRequest } from "node:http";

import { startMcpHttpServer } from "./mcpHttpServer";

type JsonObject = Record<string, unknown>;

const TOKEN = "test-token-value";

describe("MCP HTTP server authentication", () => {
  let url: string;
  let urlWithoutToken: string;
  let port: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = await startMcpHttpServer({
      serverName: "test_mcp",
      token: TOKEN,
      tools: [],
      handleToolCall: async () => ({}),
      unsupportedMethodMessage: (method) => `unsupported: ${method}`,
      noPortErrorMessage: "no port",
    });
    url = server.url;
    urlWithoutToken = server.url.split("?")[0];
    port = new URL(server.url).port;
    close = server.close;
  });

  afterEach(async () => {
    await close();
  });

  function initialize(target: string, headers: Record<string, string> = {}) {
    return fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "auth-test",
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }),
    });
  }

  // fetch cannot override the Host header, so the Host cases go through
  // node:http with full header control.
  function postWithHostHeader(host: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(
        urlWithoutToken,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host,
            authorization: `Bearer ${TOKEN}`,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      request.end(
        JSON.stringify({ jsonrpc: "2.0", id: "host-test", method: "initialize", params: {} }),
      );
    });
  }

  it("authenticates a Bearer header without any query token", async () => {
    const response = await initialize(urlWithoutToken, { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonObject;
    expect(body.result).toBeDefined();
  });

  it("still authenticates the legacy query token", async () => {
    const response = await initialize(url);
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonObject;
    expect(body.result).toBeDefined();
  });

  it("rejects requests with no credentials", async () => {
    const response = await initialize(urlWithoutToken);
    expect(response.status).toBe(401);
  });

  it("rejects a wrong Bearer token", async () => {
    const response = await initialize(urlWithoutToken, { authorization: "Bearer nope" });
    expect(response.status).toBe(401);
  });

  it("rejects a wrong query token", async () => {
    const response = await initialize(`${urlWithoutToken}?token=wrong-token`);
    expect(response.status).toBe(401);
  });

  it("rejects a non-loopback Host header even with a valid token", async () => {
    const { status } = await postWithHostHeader("evil.example");
    expect(status).toBe(403);
  });

  it("accepts the localhost Host spelling with a valid token", async () => {
    const { status, body } = await postWithHostHeader(`localhost:${port}`);
    expect(status).toBe(200);
    expect((JSON.parse(body) as JsonObject).result).toBeDefined();
  });
});

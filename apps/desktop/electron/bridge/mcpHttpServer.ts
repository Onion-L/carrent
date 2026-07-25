import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type JsonRpcId = string | number | null;
export type JsonObject = Record<string, unknown>;

const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {}

export type McpHttpServerOptions = {
  serverName: string;
  token: string;
  tools: readonly unknown[];
  handleToolCall: (params: unknown) => Promise<JsonObject>;
  unsupportedMethodMessage: (method: string) => string;
  noPortErrorMessage: string;
};

export type McpHttpServerHandle = {
  url: string;
  close: () => Promise<void>;
};

// Shared HTTP + JSON-RPC plumbing for Carrent's local MCP servers: a
// token-gated POST /mcp endpoint with a request-size guard, batch support,
// and the standard initialize / tools/list / tools/call dispatch. Each server
// keeps its own tool definitions and tool-call handling.
export async function startMcpHttpServer(
  options: McpHttpServerOptions,
): Promise<McpHttpServerHandle> {
  const server = createServer((request, response) => {
    void handleHttpRequest(options, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error(options.noPortErrorMessage);
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp?token=${encodeURIComponent(options.token)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function handleHttpRequest(
  options: McpHttpServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "POST" || requestUrl.pathname !== "/mcp") {
      sendText(response, 404, "Not found");
      return;
    }

    if (requestUrl.searchParams.get("token") !== options.token) {
      sendText(response, 401, "Unauthorized");
      return;
    }

    const message = JSON.parse(await readRequestBody(request)) as unknown;
    const result = Array.isArray(message)
      ? await Promise.all(message.map((item) => handleJsonRpc(options, item)))
      : await handleJsonRpc(options, message);

    if (result === null || (Array.isArray(result) && result.length === 0)) {
      response.writeHead(204);
      response.end();
      return;
    }

    sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendText(response, 413, "Payload too large");
      return;
    }

    sendJson(response, 200, jsonRpcError(null, -32700, errorMessage(error)));
  }
}

async function handleJsonRpc(
  options: McpHttpServerOptions,
  message: unknown,
): Promise<JsonObject | null> {
  const request = readObject(message);
  const id = readJsonRpcId(request?.id);
  const method = readString(request?.method);
  if (!request || !method) {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
  }

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: readString(readObject(request.params)?.protocolVersion) ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: options.serverName, version: "0.1.0" },
        },
      };
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: options.tools },
      };
    }

    if (method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id,
        result: await options.handleToolCall(request.params),
      };
    }

    return jsonRpcError(id, -32601, options.unsupportedMethodMessage(method));
  } catch (error) {
    return jsonRpcError(id, -32000, errorMessage(error));
  }
}

export function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function toolError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }],
    structuredContent: { error: { code, message } },
  };
}

async function readRequestBody(request: IncomingMessage) {
  const contentLength = request.headers["content-length"];
  if (
    typeof contentLength === "string" &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_REQUEST_BODY_BYTES
  ) {
    await drainRequest(request);
    throw new RequestBodyTooLargeError();
  }

  return new Promise<string>((resolve, reject) => {
    let chunks: Buffer[] = [];
    let receivedBytes = 0;
    let tooLarge = false;

    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const onData = (chunk: Buffer | string) => {
      if (tooLarge) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        chunks = [];
        return;
      }

      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      if (tooLarge) {
        reject(new RequestBodyTooLargeError());
        return;
      }

      resolve(Buffer.concat(chunks, receivedBytes).toString("utf8"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(tooLarge ? new RequestBodyTooLargeError() : error);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function drainRequest(request: IncomingMessage) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      request.off("end", finish);
      request.off("error", finish);
      resolve();
    };
    request.once("end", finish);
    request.once("error", finish);
    request.resume();
  });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response: ServerResponse, statusCode: number, value: string) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

export function readObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

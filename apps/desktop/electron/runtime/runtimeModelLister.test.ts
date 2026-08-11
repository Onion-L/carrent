import { describe, expect, it } from "bun:test";

import type { RuntimeDescriptor } from "../../src/shared/runtimes";
import type { KimiAcpTransport } from "../chat/kimiAcpChat";
import { listKimiRuntimeModels, listRuntimeModels } from "./runtimeModelLister";

function createRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "kimi",
    name: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    configMarkers: ["~/.kimi-code", "~/.config/kimi-code"],
    supportsModelPing: false,
    detection: { localCheck: { mayUseTokens: false } },
    verification: {},
  };
}

class FakeKimiAcpTransport implements KimiAcpTransport {
  closeCount = 0;
  private messageListener: (message: Record<string, unknown>) => void = () => {};
  private errorListener: (error: Error) => void = () => {};
  private closeListener: Parameters<KimiAcpTransport["onClose"]>[0] = () => {};

  constructor(
    private readonly options: {
      failOnInitialize?: boolean;
      hasModel?: boolean;
      closeOnInitialize?: boolean;
      hangOnInitialize?: boolean;
    } = {},
  ) {}

  send(message: Record<string, unknown>) {
    if (message.method === "initialize") {
      if (this.options.hangOnInitialize) return;
      if (this.options.failOnInitialize) {
        this.errorListener(new Error("ACP unavailable"));
        return;
      }
      if (this.options.closeOnInitialize) {
        this.closeListener({ code: 1, signal: null, stderr: "ACP exited" });
        return;
      }
      this.messageListener({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
      return;
    }
    if (message.method === "session/new") {
      this.messageListener({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          configOptions:
            this.options.hasModel !== false
              ? [
                  {
                    id: "model",
                    category: "model",
                    currentValue: "kimi-for-coding",
                    options: [
                      { value: "kimi-for-coding", name: "Kimi for Coding" },
                      { value: "kimi-for-coding-highspeed", name: "Kimi for Coding High Speed" },
                    ],
                  },
                ]
              : [],
        },
      });
    }
  }

  close() {
    this.closeCount += 1;
  }
  onMessage(listener: (message: Record<string, unknown>) => void) {
    this.messageListener = listener;
  }
  onError(listener: (error: Error) => void) {
    this.errorListener = listener;
  }
  onClose(listener: Parameters<KimiAcpTransport["onClose"]>[0]) {
    this.closeListener = listener;
  }

  fail(error = new Error("ACP unavailable")) {
    this.errorListener(error);
  }
}

describe("listKimiRuntimeModels", () => {
  it("reads models from Kimi ACP config options", async () => {
    const result = await listKimiRuntimeModels("/tmp", () => new FakeKimiAcpTransport());
    expect(result).toEqual({
      state: "listed",
      models: [
        { id: "kimi-for-coding", name: "Kimi for Coding", source: "cli" },
        {
          id: "kimi-for-coding-highspeed",
          name: "Kimi for Coding High Speed",
          source: "cli",
        },
      ],
      defaultModelId: "kimi-for-coding",
    });
  });

  it("is the only runtime model listing path", async () => {
    const result = await listRuntimeModels(createRuntimeDescriptor(), {
      kimiTransportFactory: () => new FakeKimiAcpTransport(),
    });
    expect(result.state).toBe("listed");
  });

  it("returns a failed result when the ACP transport errors", async () => {
    const result = await listKimiRuntimeModels(
      "/tmp",
      () => new FakeKimiAcpTransport({ failOnInitialize: true }),
    );

    expect(result).toEqual({
      state: "failed",
      models: [],
      lastError: "ACP unavailable",
    });
  });

  it("returns unsupported when ACP has no model option", async () => {
    const result = await listKimiRuntimeModels(
      "/tmp",
      () => new FakeKimiAcpTransport({ hasModel: false }),
    );

    expect(result).toEqual({ state: "unsupported", models: [] });
  });

  it("returns a failed result when the ACP process closes", async () => {
    const result = await listKimiRuntimeModels(
      "/tmp",
      () => new FakeKimiAcpTransport({ closeOnInitialize: true }),
    );

    expect(result).toEqual({
      state: "failed",
      models: [],
      lastError: "Kimi ACP exited: ACP exited",
    });
  });

  it("closes a pending model listing when it is cancelled", async () => {
    const controller = new AbortController();
    const transport = new FakeKimiAcpTransport({ hangOnInitialize: true });
    const resultPromise = listKimiRuntimeModels("/tmp", () => transport, controller.signal);

    controller.abort();
    const closeCountAfterAbort = transport.closeCount;
    transport.fail();
    const result = await resultPromise;

    expect(closeCountAfterAbort).toBe(1);
    expect(transport.closeCount).toBe(1);
    expect(result).toEqual({
      state: "failed",
      models: [],
      lastError: "Kimi model listing cancelled.",
    });
  });
});

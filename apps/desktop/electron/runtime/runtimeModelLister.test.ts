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
  private messageListener: (message: Record<string, unknown>) => void = () => {};
  private errorListener: (error: Error) => void = () => {};
  private closeListener: Parameters<KimiAcpTransport["onClose"]>[0] = () => {};

  constructor(
    private readonly failOnInitialize = false,
    private readonly hasModel = true,
    private readonly closeOnInitialize = false,
  ) {}

  send(message: Record<string, unknown>) {
    if (message.method === "initialize") {
      if (this.failOnInitialize) {
        this.errorListener(new Error("ACP unavailable"));
        return;
      }
      if (this.closeOnInitialize) {
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
          configOptions: this.hasModel
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

  close() {}
  onMessage(listener: (message: Record<string, unknown>) => void) {
    this.messageListener = listener;
  }
  onError(listener: (error: Error) => void) {
    this.errorListener = listener;
  }
  onClose(listener: Parameters<KimiAcpTransport["onClose"]>[0]) {
    this.closeListener = listener;
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
    const result = await listKimiRuntimeModels("/tmp", () => new FakeKimiAcpTransport(true));

    expect(result).toEqual({
      state: "failed",
      models: [],
      lastError: "ACP unavailable",
    });
  });

  it("returns unsupported when ACP has no model option", async () => {
    const result = await listKimiRuntimeModels(
      "/tmp",
      () => new FakeKimiAcpTransport(false, false),
    );

    expect(result).toEqual({ state: "unsupported", models: [] });
  });

  it("returns a failed result when the ACP process closes", async () => {
    const result = await listKimiRuntimeModels(
      "/tmp",
      () => new FakeKimiAcpTransport(false, true, true),
    );

    expect(result).toEqual({
      state: "failed",
      models: [],
      lastError: "Kimi ACP exited: ACP exited",
    });
  });
});

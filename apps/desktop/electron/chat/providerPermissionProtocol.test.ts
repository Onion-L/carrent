import { describe, expect, it } from "bun:test";
import {
  getProviderApprovalCapability,
  extractCodexPermissionRequest,
  extractClaudePermissionRequest,
} from "./providerPermissionProtocol";

describe("providerPermissionProtocol", () => {
  describe("getProviderApprovalCapability", () => {
    it("codex has no stdin-based approval channel in exec mode", () => {
      const result = getProviderApprovalCapability("codex");
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.reason).toContain("not support");
      }
    });

    it("claude-code has no stdin-based approval channel in --print mode", () => {
      const result = getProviderApprovalCapability("claude-code");
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.reason).toContain("not support");
      }
    });

    it("pi is unsupported", () => {
      const result = getProviderApprovalCapability("pi");
      expect(result.supported).toBe(false);
    });
  });

  describe("extractCodexPermissionRequest", () => {
    it("returns null for non-permission events", () => {
      const result = extractCodexPermissionRequest({
        type: "thread.started",
        thread_id: "abc",
      });
      expect(result).toBe(null);
    });

    it("returns null for unrelated payload", () => {
      const result = extractCodexPermissionRequest({ foo: "bar" });
      expect(result).toBe(null);
    });
  });

  describe("extractClaudePermissionRequest", () => {
    it("returns null for non-permission tool results", () => {
      const result = extractClaudePermissionRequest({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              content: "hello world",
            },
          ],
        },
      });
      expect(result).toBe(null);
    });

    it("returns null for unrelated payload", () => {
      const result = extractClaudePermissionRequest({ foo: "bar" });
      expect(result).toBe(null);
    });
  });
});

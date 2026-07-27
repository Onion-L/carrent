import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createGitRewindCheckpointAccess, createRewindDataStore } from "./rewindDataStore";

async function runGit(workingDirectory: string, args: string[], stdin?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["-C", workingDirectory, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve(stdout.trim());
      else reject(new Error(stderr));
    });
    child.stdin.end(stdin);
  });
}

describe("Rewind data store", () => {
  it("keeps validated nodes and creates barriers for nodes that cannot be validated after relocation", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-rewind-relocation-"));
    const validations: Array<{
      workingDirectory: string;
      ref: string;
      objectId: string;
    }> = [];
    const store = createRewindDataStore(baseDir, {
      validateCheckpoint: async (checkpoint) => {
        validations.push(checkpoint);
        return !checkpoint.ref.endsWith("after") || !checkpoint.ref.includes("thread-2");
      },
      deleteCheckpoint: async () => {},
    });

    try {
      await store.save({
        version: 1,
        nodes: [
          {
            id: "run-1",
            projectId: "project-1",
            threadId: "thread-1",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-1/before",
              objectId: "1111111111111111111111111111111111111111",
            },
            after: {
              ref: "refs/carrent/rewind/thread-1/after",
              objectId: "2222222222222222222222222222222222222222",
            },
          },
          {
            id: "run-2",
            projectId: "project-1",
            threadId: "thread-2",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-2/before",
              objectId: "3333333333333333333333333333333333333333",
            },
            after: {
              ref: "refs/carrent/rewind/thread-2/after",
              objectId: "4444444444444444444444444444444444444444",
            },
          },
          {
            id: "run-other",
            projectId: "project-2",
            threadId: "thread-other",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-other/before",
              objectId: "5555555555555555555555555555555555555555",
            },
            after: {
              ref: "refs/carrent/rewind/thread-other/after",
              objectId: "6666666666666666666666666666666666666666",
            },
          },
          {
            id: "run-orphan",
            projectId: "project-1",
            threadId: "thread-orphan",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-2/orphan-before",
              objectId: "7777777777777777777777777777777777777777",
            },
            after: {
              ref: "refs/carrent/rewind/thread-2/orphan-after",
              objectId: "8888888888888888888888888888888888888888",
            },
          },
        ],
      });

      await store.prepareProjectRelocation({
        projectId: "project-1",
        sourceDirectory: "/old/carrent",
        targetDirectory: "/new/carrent",
      });

      expect(await store.load()).toEqual({
        version: 1,
        nodes: [
          {
            id: "run-1",
            projectId: "project-1",
            threadId: "thread-1",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-1/before",
              objectId: "1111111111111111111111111111111111111111",
            },
            after: {
              ref: "refs/carrent/rewind/thread-1/after",
              objectId: "2222222222222222222222222222222222222222",
            },
          },
          {
            id: "run-2",
            projectId: "project-1",
            threadId: "thread-2",
            state: "barrier",
            reason: "project-directory-relocation",
          },
          {
            id: "run-other",
            projectId: "project-2",
            threadId: "thread-other",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-other/before",
              objectId: "5555555555555555555555555555555555555555",
            },
            after: {
              ref: "refs/carrent/rewind/thread-other/after",
              objectId: "6666666666666666666666666666666666666666",
            },
          },
          {
            id: "run-orphan",
            projectId: "project-1",
            threadId: "thread-orphan",
            state: "barrier",
            reason: "project-directory-relocation",
          },
        ],
      });
      expect(
        validations.every((validation) => validation.workingDirectory === "/new/carrent"),
      ).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("commits deletion of one Thread's nodes and private refs without touching other Threads", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-rewind-deletion-"));
    const deletedCheckpoints: unknown[] = [];
    const store = createRewindDataStore(baseDir, {
      validateCheckpoint: async () => true,
      deleteCheckpoint: async (checkpoint) => {
        deletedCheckpoints.push(checkpoint);
      },
    });

    try {
      await store.save({
        version: 1,
        nodes: [
          {
            id: "run-1",
            projectId: "project-1",
            threadId: "thread-1",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-1/before",
              objectId: "1111111111111111111111111111111111111111",
            },
            after: {
              ref: "refs/carrent/rewind/thread-1/after",
              objectId: "2222222222222222222222222222222222222222",
            },
          },
          {
            id: "run-1-barrier",
            projectId: "project-1",
            threadId: "thread-1",
            state: "barrier",
            reason: "project-directory-relocation",
          },
          {
            id: "run-2",
            projectId: "project-1",
            threadId: "thread-2",
            state: "ready",
            before: {
              ref: "refs/carrent/rewind/thread-2/before",
              objectId: "3333333333333333333333333333333333333333",
            },
            after: {
              ref: "refs/carrent/rewind/thread-2/after",
              objectId: "4444444444444444444444444444444444444444",
            },
          },
        ],
      });

      await store.prepareDeletion("operation-1", {
        threadIds: ["thread-1"],
        projectDirectories: { "project-1": "/code/carrent" },
      });
      expect((await store.load()).nodes.map((node) => node.id)).toEqual(["run-2"]);

      await store.commitDeletion("operation-1");

      expect(deletedCheckpoints).toEqual([
        {
          workingDirectory: "/code/carrent",
          ref: "refs/carrent/rewind/thread-1/before",
          expectedObjectId: "1111111111111111111111111111111111111111",
        },
        {
          workingDirectory: "/code/carrent",
          ref: "refs/carrent/rewind/thread-1/after",
          expectedObjectId: "2222222222222222222222222222222222222222",
        },
      ]);
      expect((await store.load()).nodes.map((node) => node.id)).toEqual(["run-2"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe("Git Rewind checkpoint access", () => {
  it("validates and deletes only the expected private ref object", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "carrent-rewind-git-"));
    const checkpointAccess = createGitRewindCheckpointAccess();
    const ref = "refs/carrent/rewind/thread-1/before";

    try {
      await runGit(workingDirectory, ["init"]);
      const objectId = await runGit(
        workingDirectory,
        ["hash-object", "-w", "-t", "tree", "--stdin"],
        "",
      );
      await runGit(workingDirectory, ["update-ref", ref, objectId]);

      expect(await checkpointAccess.validateCheckpoint({ workingDirectory, ref, objectId })).toBe(
        true,
      );
      expect(
        await checkpointAccess.validateCheckpoint({
          workingDirectory,
          ref,
          objectId: "0000000000000000000000000000000000000000",
        }),
      ).toBe(false);

      await checkpointAccess.deleteCheckpoint({
        workingDirectory,
        ref,
        expectedObjectId: objectId,
      });

      expect(await checkpointAccess.validateCheckpoint({ workingDirectory, ref, objectId })).toBe(
        false,
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from "bun:test";

import { findCommandWords, parseSegments, tokenize } from "./shellCommand";

describe("tokenize", () => {
  it("splits plain words and operators", () => {
    expect(tokenize("echo hi && rm build")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "word", value: "hi" },
      { kind: "operator", value: "&&" },
      { kind: "word", value: "rm" },
      { kind: "word", value: "build" },
    ]);
  });

  it("keeps quoted strings as single literal words", () => {
    expect(tokenize("echo 'rm -rf /'")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "word", value: "rm -rf /" },
    ]);
    expect(tokenize('echo "a;b" | cat')).toEqual([
      { kind: "word", value: "echo" },
      { kind: "word", value: "a;b" },
      { kind: "operator", value: "|" },
      { kind: "word", value: "cat" },
    ]);
  });

  it("treats backslash escapes as literal word characters", () => {
    expect(tokenize("rm\\ -rf /")).toEqual([
      { kind: "word", value: "rm -rf" },
      { kind: "word", value: "/" },
    ]);
  });

  it("marks variables, substitutions, and backticks as opaque tokens", () => {
    expect(tokenize("ls $HOME")).toEqual([{ kind: "word", value: "ls" }, { kind: "opaque" }]);
    expect(tokenize("echo $(whoami)")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "opaque" },
    ]);
    expect(tokenize("echo `id`")).toEqual([{ kind: "word", value: "echo" }, { kind: "opaque" }]);
    expect(tokenize('echo "pre${X}post"')).toEqual([
      { kind: "word", value: "echo" },
      { kind: "opaque" },
    ]);
  });

  it("consumes nested command substitutions without breaking the outer parse", () => {
    expect(tokenize("echo $(echo $(echo x)) done")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "opaque" },
      { kind: "word", value: "done" },
    ]);
  });

  it("emits redirect operators separately from words", () => {
    expect(tokenize("git log 2>/dev/null")).toEqual([
      { kind: "word", value: "git" },
      { kind: "word", value: "log" },
      { kind: "redirect" },
      { kind: "word", value: "/dev/null" },
    ]);
    expect(tokenize("echo hi>out.txt")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "word", value: "hi" },
      { kind: "redirect" },
      { kind: "word", value: "out.txt" },
    ]);
  });

  it("treats newlines as separators and # as a comment start", () => {
    expect(tokenize("ls\nrm build")).toEqual([
      { kind: "word", value: "ls" },
      { kind: "operator", value: "\n" },
      { kind: "word", value: "rm" },
      { kind: "word", value: "build" },
    ]);
    expect(tokenize("echo hi # rm -rf /")).toEqual([
      { kind: "word", value: "echo" },
      { kind: "word", value: "hi" },
    ]);
  });

  it("returns null on unterminated quotes and substitutions", () => {
    expect(tokenize("echo 'unterminated")).toBeNull();
    expect(tokenize('echo "unterminated')).toBeNull();
    expect(tokenize("echo $(unterminated")).toBeNull();
    expect(tokenize("echo `unterminated")).toBeNull();
    expect(tokenize("echo trailing\\")).toBeNull();
  });
});

describe("findCommandWords", () => {
  it("returns the argv of every segment at a command position", () => {
    expect(findCommandWords("echo hi && rm build")).toEqual([
      ["echo", "hi"],
      ["rm", "build"],
    ]);
    expect(findCommandWords("ls | grep x")).toEqual([["ls"], ["grep", "x"]]);
    expect(findCommandWords("true & rm build")).toEqual([["true"], ["rm", "build"]]);
    expect(findCommandWords("ls\nrm build")).toEqual([["ls"], ["rm", "build"]]);
    expect(findCommandWords("(rm build)")).toEqual([["rm", "build"]]);
  });

  it("drops redirects and their targets from the argv", () => {
    expect(findCommandWords("git log 2>/dev/null")).toEqual([["git", "log"]]);
    expect(findCommandWords("echo hi > out.txt")).toEqual([["echo", "hi"]]);
  });

  it("strips leading environment assignments to reach the command", () => {
    expect(findCommandWords("FOO=bar rm build")).toEqual([["rm", "build"]]);
  });

  it("descends into bash -c and sh -c executable strings", () => {
    expect(findCommandWords("bash -c 'rm -rf build'")).toEqual([
      ["bash", "-c", "rm -rf build"],
      ["rm", "-rf", "build"],
    ]);
    expect(findCommandWords("sh -c 'echo a; rm b'")).toEqual([
      ["sh", "-c", "echo a; rm b"],
      ["echo", "a"],
      ["rm", "b"],
    ]);
    expect(findCommandWords("bash -lc 'rm build'")).toEqual([
      ["bash", "-lc", "rm build"],
      ["rm", "build"],
    ]);
  });

  it("descends into the command after sudo, env, nohup, and xargs", () => {
    expect(findCommandWords("sudo rm build")).toContainEqual(["rm", "build"]);
    expect(findCommandWords("env FOO=1 rm build")).toContainEqual(["rm", "build"]);
    expect(findCommandWords("nohup rm build")).toContainEqual(["rm", "build"]);
    expect(findCommandWords("xargs rm")).toContainEqual(["rm"]);
  });

  it("reaches the command behind wrapper options that take separate values", () => {
    expect(findCommandWords("xargs -n 1 rm")).toContainEqual(["rm"]);
    expect(findCommandWords("env -u FOO rm build")).toContainEqual(["rm", "build"]);
    expect(findCommandWords("sudo -u root rm build")).toContainEqual(["rm", "build"]);
  });

  it("descends into trap action strings", () => {
    expect(findCommandWords("trap 'rm -f build' EXIT")).toEqual([
      ["trap", "rm -f build", "EXIT"],
      ["rm", "-f", "build"],
    ]);
  });

  it("keeps opaque tokens as empty argv slots and does not descend into them", () => {
    expect(findCommandWords('bash -c "$CMD"')).toEqual([["bash", "-c", ""]]);
    expect(findCommandWords("ls $HOME")).toEqual([["ls", ""]]);
  });

  it("fails closed on parse errors and past the descent depth cap", () => {
    expect(findCommandWords("echo 'unterminated")).toBeNull();
    const nested = (depth: number) => `${"env ".repeat(depth)}echo hi`;
    expect(findCommandWords(nested(8))).toContainEqual(["echo", "hi"]);
    expect(findCommandWords(nested(9))).toBeNull();
  });
});

describe("parseSegments", () => {
  it("returns per-segment argv when every token is a pure literal", () => {
    expect(parseSegments("git status")).toEqual([["git", "status"]]);
    expect(parseSegments("echo hi && rm build")).toEqual([
      ["echo", "hi"],
      ["rm", "build"],
    ]);
    expect(parseSegments("cat a | grep b; ls\npwd")).toEqual([
      ["cat", "a"],
      ["grep", "b"],
      ["ls"],
      ["pwd"],
    ]);
    expect(parseSegments("echo 'a;b'")).toEqual([["echo", "a;b"]]);
    expect(parseSegments("echo hi;")).toEqual([["echo", "hi"]]);
  });

  it("returns null when any token is opaque", () => {
    expect(parseSegments("ls $HOME")).toBeNull();
    expect(parseSegments("echo $(whoami)")).toBeNull();
    expect(parseSegments("echo `id`")).toBeNull();
  });

  it("returns null on globs, tilde, and redirects", () => {
    expect(parseSegments("ls *.ts")).toBeNull();
    expect(parseSegments("cat ~/.ssh/config")).toBeNull();
    expect(parseSegments("echo hi > out.txt")).toBeNull();
    expect(parseSegments("git log 2>/dev/null")).toBeNull();
  });

  it("returns null on background operators and subshell parentheses", () => {
    expect(parseSegments("true & echo hi")).toBeNull();
    expect(parseSegments("(echo hi)")).toBeNull();
  });

  it("returns null on leading environment assignments", () => {
    expect(parseSegments("FOO=bar bun test")).toBeNull();
  });

  it("returns null on parse errors and empty segments", () => {
    expect(parseSegments("echo 'unterminated")).toBeNull();
    expect(parseSegments("ls && && rm build")).toBeNull();
    expect(parseSegments("")).toBeNull();
  });
});

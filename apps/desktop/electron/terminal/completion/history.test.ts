import { describe, expect, it } from "bun:test";

import { acceptHistoryPrediction, parseZshHistory, predictFromHistory } from "./history";

describe("zsh history prediction", () => {
  it("parses plain and extended history while ignoring malformed and duplicate entries", () => {
    expect(
      parseZshHistory(
        [
          "git status",
          ": 1710000000:0;git checkout main",
          ": broken",
          "git status",
          "\u0000secret",
          ": 1710000001:2;pnpm test",
        ].join("\n"),
      ),
    ).toEqual(["git checkout main", "git status", "pnpm test"]);
  });

  it("uses the newest matching command and accepts all or one word", () => {
    const prediction = predictFromHistory(
      ["git status", "git switch main", "git switch feature/integrated-terminal"],
      "git sw",
    );
    expect(prediction).toEqual({
      command: "git switch feature/integrated-terminal",
      suffix: "itch feature/integrated-terminal",
    });
    expect(acceptHistoryPrediction("git sw", prediction!.suffix, "word")).toBe("git switch ");
    expect(acceptHistoryPrediction("git sw", prediction!.suffix, "all")).toBe(
      "git switch feature/integrated-terminal",
    );
  });
});

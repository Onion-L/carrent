import { describe, expect, it } from "bun:test";

import { adaptFigSpec } from "./figAdapter";

describe("adaptFigSpec", () => {
  it("adapts the bounded static subset deterministically", () => {
    const spec = {
      name: "docker",
      description: "Manage containers",
      subcommands: [
        {
          name: "build",
          description: "Build an image",
          options: [{ name: "--tag", description: "Name and tag" }],
        },
        { name: "ps", description: "List containers" },
      ],
    };
    expect(adaptFigSpec(spec)).toEqual(adaptFigSpec(spec));
    expect(adaptFigSpec(spec)).toMatchObject({
      command: "docker",
      subcommands: [{ name: "build" }, { name: "ps" }],
    });
  });

  it("rejects executable generators and malformed recursive shapes", () => {
    expect(() => adaptFigSpec({ name: "unsafe", generateSpec: () => ({}) })).toThrow();
    expect(() => adaptFigSpec({ name: "broken", subcommands: "nope" })).toThrow();
  });
});

export type CommandOption = {
  name: string;
  description?: string;
  repeatable?: boolean;
};

export type CommandRule = {
  name: string;
  description?: string;
  subcommands?: CommandRule[];
  options?: CommandOption[];
  scripts?: boolean;
};

const command = (name: string, description: string, options?: CommandOption[]): CommandRule => ({
  name,
  description,
  ...(options ? { options } : {}),
});

export const authoredCommandRules: CommandRule[] = [
  {
    name: "git",
    description: "Distributed version control",
    options: [
      { name: "--version", description: "Show version" },
      { name: "--help", description: "Show help" },
      { name: "-C", description: "Run as if started in a directory", repeatable: true },
    ],
    subcommands: [
      command("clone", "Clone a repository"),
      command("init", "Create a repository"),
      command("status", "Show working tree status", [{ name: "--short" }, { name: "--branch" }]),
      command("add", "Add file contents", [{ name: "--all" }, { name: "--patch" }]),
      command("restore", "Restore working tree files", [
        { name: "--staged" },
        { name: "--source" },
      ]),
      command("commit", "Record changes", [
        { name: "--message", description: "Use the given commit message" },
        { name: "--amend", description: "Replace the previous commit" },
        { name: "--no-verify" },
        { name: "--signoff" },
        { name: "--verbose" },
      ]),
      command("branch", "List or manage branches", [{ name: "--all" }, { name: "--delete" }]),
      command("switch", "Switch branches", [{ name: "--create" }, { name: "--detach" }]),
      command("checkout", "Switch branches or restore files", [
        { name: "--branch" },
        { name: "--detach" },
      ]),
      command("merge", "Join development histories", [{ name: "--no-ff" }, { name: "--abort" }]),
      command("rebase", "Reapply commits", [
        { name: "--interactive" },
        { name: "--abort" },
        { name: "--continue" },
      ]),
      command("log", "Show commit logs", [
        { name: "--oneline" },
        { name: "--graph" },
        { name: "--all" },
      ]),
      command("diff", "Show changes", [{ name: "--staged" }, { name: "--stat" }]),
      command("stash", "Stash working tree changes"),
      command("fetch", "Download refs", [{ name: "--all" }, { name: "--prune" }]),
      command("pull", "Fetch and integrate", [{ name: "--rebase" }, { name: "--ff-only" }]),
      command("push", "Update remote refs", [
        { name: "--set-upstream" },
        { name: "--force-with-lease" },
      ]),
      command("remote", "Manage remotes"),
      command("tag", "Manage tags"),
      command("worktree", "Manage working trees"),
    ],
  },
  {
    name: "gh",
    description: "GitHub CLI",
    subcommands: [
      command("auth", "Authenticate with GitHub"),
      command("repo", "Manage repositories"),
      {
        name: "pr",
        description: "Manage pull requests",
        subcommands: [
          "create",
          "list",
          "view",
          "checkout",
          "checks",
          "comment",
          "diff",
          "merge",
          "review",
        ].map((name) => command(name, `${name[0].toUpperCase()}${name.slice(1)} a pull request`)),
      },
      {
        name: "issue",
        description: "Manage issues",
        subcommands: ["create", "list", "view", "close", "comment", "reopen"].map((name) =>
          command(name, `${name[0].toUpperCase()}${name.slice(1)} an issue`),
        ),
      },
      command("run", "View workflow runs"),
      command("workflow", "Manage workflows"),
      command("release", "Manage releases"),
      command("gist", "Manage gists"),
      command("api", "Call the GitHub API"),
    ],
  },
  {
    name: "bun",
    description: "Bun JavaScript toolkit",
    subcommands: [
      "run",
      "test",
      "install",
      "add",
      "remove",
      "update",
      "create",
      "init",
      "build",
      "x",
    ].map((name) => ({ ...command(name, `Bun ${name}`), scripts: name === "run" })),
  },
  {
    name: "npm",
    description: "npm package manager",
    subcommands: [
      "install",
      "uninstall",
      "update",
      "run",
      "test",
      "exec",
      "init",
      "create",
      "publish",
      "pack",
      "config",
    ].map((name) => ({ ...command(name, `npm ${name}`), scripts: name === "run" })),
  },
  {
    name: "npx",
    description: "Execute an npm package binary",
    options: [{ name: "--package", repeatable: true }, { name: "--yes" }, { name: "--no" }],
  },
  {
    name: "pnpm",
    description: "pnpm package manager",
    subcommands: [
      "install",
      "add",
      "remove",
      "update",
      "run",
      "exec",
      "create",
      "workspace",
      "publish",
    ].map((name) => ({ ...command(name, `pnpm ${name}`), scripts: name === "run" })),
  },
  {
    name: "yarn",
    description: "Yarn package manager",
    subcommands: [
      "install",
      "add",
      "remove",
      "upgrade",
      "run",
      "exec",
      "create",
      "workspace",
      "publish",
    ].map((name) => ({ ...command(name, `Yarn ${name}`), scripts: name === "run" })),
  },
];

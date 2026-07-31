import type { CommandOption, CommandRule } from "./commandRules";

function assertStatic(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error("Fig rule nesting is too deep.");
  if (typeof value === "function")
    throw new Error("Executable Fig rule capabilities are unsupported.");
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) assertStatic(child, depth + 1);
}

function text(value: unknown, field: string, required = false) {
  if (value == null && !required) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new Error(`Invalid Fig ${field}.`);
  }
  return value;
}

function options(value: unknown): CommandOption[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid Fig options.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid Fig option.");
    const record = entry as Record<string, unknown>;
    return {
      name: text(record.name, "option name", true)!,
      ...(record.description ? { description: text(record.description, "description") } : {}),
    };
  });
}

function command(value: unknown, depth = 0): CommandRule {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6) {
    throw new Error("Invalid Fig command.");
  }
  const record = value as Record<string, unknown>;
  if (record.subcommands != null && !Array.isArray(record.subcommands)) {
    throw new Error("Invalid Fig subcommands.");
  }
  const subcommands = (record.subcommands as unknown[] | undefined)?.map((entry) =>
    command(entry, depth + 1),
  );
  return {
    name: text(record.name, "command name", true)!,
    ...(record.description ? { description: text(record.description, "description") } : {}),
    ...(subcommands ? { subcommands } : {}),
    ...(record.options ? { options: options(record.options) } : {}),
  };
}

export function adaptFigSpec(spec: unknown): {
  command: string;
  subcommands: CommandRule[];
  rule: CommandRule;
} {
  assertStatic(spec);
  const rule = command(spec);
  return { command: rule.name, subcommands: rule.subcommands ?? [], rule };
}

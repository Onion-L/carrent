import type { CommandRule } from "./commandRules";
import { adaptFigSpec } from "./figAdapter";
import { dockerFigSpec } from "./figSpecs/docker";

export const importedFigRules: CommandRule[] = [adaptFigSpec(dockerFigSpec).rule];

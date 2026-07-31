# Integrated Terminal completion rules

Carrent bundles command rules and never fetches completion data while the user types.

## Updating Fig-derived rules

1. Pin an upstream `withfig/autocomplete` commit and record its SHA in the third-party notice.
2. Select only static names, descriptions, subcommands, and options. Do not import generators, scripts, callbacks, network requests, or process execution.
3. Convert the selected source into a plain data object under `electron/terminal/completion/figSpecs/` and pass it through `adaptFigSpec`.
4. Preserve the upstream copyright and license notice. Review the diff against the pinned source.
5. Add adapter tests for malformed and unsupported shapes, plus an end-to-end candidate test for the imported command.
6. Run terminal completion tests, type checking, lint, and the desktop build. Roll back by removing the rule from `importedFigRules`.

Enhanced completion for bash and fish remains separate work. Their native completion continues to work, but Carrent must define a shell-specific trusted prompt-state protocol before enabling its own history or candidate UI for either shell.

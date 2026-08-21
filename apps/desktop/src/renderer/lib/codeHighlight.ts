import bash from "@shikijs/langs/bash";
import css from "@shikijs/langs/css";
import html from "@shikijs/langs/html";
import javascript from "@shikijs/langs/javascript";
import jsx from "@shikijs/langs/jsx";
import json from "@shikijs/langs/json";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import dracula from "@shikijs/themes/dracula";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import monokai from "@shikijs/themes/monokai";
import nightOwl from "@shikijs/themes/night-owl";
import nord from "@shikijs/themes/nord";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import oneLight from "@shikijs/themes/one-light";
import poimandres from "@shikijs/themes/poimandres";
import solarizedDark from "@shikijs/themes/solarized-dark";
import solarizedLight from "@shikijs/themes/solarized-light";
import tokyoNight from "@shikijs/themes/tokyo-night";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import vitesseLight from "@shikijs/themes/vitesse-light";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  CODE_HIGHLIGHT_THEME_OPTIONS,
  DEFAULT_CODE_HIGHLIGHT_THEME,
  type CodeHighlightThemeId,
} from "../../shared/codeHighlightThemes";

// Fence tag → registered grammar name. Mirrors the language surface the
// previous Prism integration highlighted; anything else renders as plain text.
const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  css: "css",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  python: "python",
  py: "python",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

type ClassicPalette = {
  fg: string;
  bg: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  operator: string;
  property: string;
};

// The exact token colors Markdown code blocks shipped before Shiki (see the
// old --color-code-token-* variables), kept as the default "Classic" theme so
// the migration changes nothing visually.
const CLASSIC_DARK_PALETTE: ClassicPalette = {
  fg: "#E7E6E0",
  bg: "#0C0C0B",
  comment: "#949289",
  keyword: "#C678DD",
  string: "#98C379",
  number: "#D19A66",
  function: "#61AFEF",
  operator: "#56B6C2",
  property: "#E5C07B",
};

const CLASSIC_LIGHT_PALETTE: ClassicPalette = {
  fg: "#1E1E1E",
  bg: "#F1F1EC",
  comment: "#696964",
  keyword: "#893DA0",
  string: "#2A7639",
  number: "#A65923",
  function: "#1863A4",
  operator: "#187079",
  property: "#855D14",
};

// TextMate scopes grouped to the seven classic token colors. Rules run in
// order, so keep broad categories before the specific overrides after them.
function classicTheme(name: string, type: "dark" | "light", palette: ClassicPalette) {
  return {
    name,
    type,
    fg: palette.fg,
    bg: palette.bg,
    settings: [
      // Scopeless first rule is the theme-wide default; without it the very
      // first tokenize call per grammar resolves unmatched scopes unstably.
      { settings: { foreground: palette.fg } },
      { scope: ["comment"], settings: { foreground: palette.comment } },
      {
        scope: [
          "keyword",
          "storage.type",
          "storage.modifier",
          "variable.language",
          "constant.language",
        ],
        settings: { foreground: palette.keyword },
      },
      { scope: ["string"], settings: { foreground: palette.string } },
      { scope: ["entity.other.attribute-name"], settings: { foreground: palette.string } },
      {
        scope: ["entity.name.function", "support.function"],
        settings: { foreground: palette.function },
      },
      { scope: ["keyword.operator"], settings: { foreground: palette.operator } },
      {
        scope: [
          "entity.name.tag",
          "variable.other.property",
          "support.type.property-name",
          "constant.other.symbol",
        ],
        settings: { foreground: palette.property },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: { foreground: palette.number },
      },
    ],
  };
}

// Fully synchronous: grammars and themes are plain objects and the JS regex
// engine needs no WASM fetch, so the highlighter is ready the moment the
// module loads — same contract the Prism integration had.
const highlighter = createHighlighterCoreSync({
  themes: [
    classicTheme("carrent-classic-dark", "dark", CLASSIC_DARK_PALETTE),
    classicTheme("carrent-classic-light", "light", CLASSIC_LIGHT_PALETTE),
    githubDark,
    githubLight,
    oneDarkPro,
    oneLight,
    catppuccinLatte,
    catppuccinMocha,
    vitesseDark,
    vitesseLight,
    solarizedDark,
    solarizedLight,
    dracula,
    nord,
    tokyoNight,
    nightOwl,
    monokai,
    poimandres,
  ],
  langs: [bash, css, html, javascript, jsx, json, markdown, python, tsx, typescript, xml, yaml],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

// Grammars bind theme metadata on first use; tokenize each loaded language
// once so user-visible calls never see the unstable first tokenization.
const warmupTheme = "carrent-classic-dark";
for (const language of highlighter.getLoadedLanguages()) {
  try {
    highlighter.codeToTokens("0", { lang: language, theme: warmupTheme });
  } catch {
    // Special language names that need extra options are fine to skip.
  }
}

const THEMES_BY_ID = new Map(CODE_HIGHLIGHT_THEME_OPTIONS.map((option) => [option.id, option]));

export function resolveCodeLanguage(fenceLanguage: string): string | undefined {
  return LANGUAGE_ALIASES[fenceLanguage.toLowerCase()];
}

export type HighlightedCodeBlock = {
  // Token spans carrying --shiki-light / --shiki-dark variables; index.css
  // picks the active one based on the app's data-theme.
  html: string;
  fgLight: string;
  fgDark: string;
  bgLight: string;
  bgDark: string;
};

const CACHE_LIMIT = 300;
const resultCache = new Map<string, HighlightedCodeBlock>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTokens(
  code: string,
  language: string,
  lightTheme: string,
  darkTheme: string,
): string {
  const lines = highlighter.codeToTokensWithThemes(code, {
    lang: language,
    themes: { light: lightTheme, dark: darkTheme },
  });

  return lines
    .map((line) =>
      line
        .map((token) => {
          const content = escapeHtml(token.content);
          const light = token.variants.light?.color;
          const dark = token.variants.dark?.color;
          if (light === undefined && dark === undefined) return content;
          // Shiki omits one variant when both configured themes are the same.
          // Keep both variables populated so fixed dark themes remain colored
          // when the app switches between its light and dark modes.
          if (dark === undefined) {
            return `<span style="--shiki-light:${light};--shiki-dark:${light}">${content}</span>`;
          }
          if (light === undefined) {
            return `<span style="--shiki-light:${dark};--shiki-dark:${dark}">${content}</span>`;
          }
          if (light === dark) {
            return `<span style="--shiki-light:${light};--shiki-dark:${dark}">${content}</span>`;
          }
          return `<span style="--shiki-light:${light};--shiki-dark:${dark}">${content}</span>`;
        })
        .join(""),
    )
    .join("\n");
}

/**
 * Highlights a fenced code block for the given theme, or returns null when the
 * language is not supported (callers fall back to plain text).
 */
export function highlightCodeBlock(
  code: string,
  fenceLanguage: string,
  themeId: CodeHighlightThemeId,
): HighlightedCodeBlock | null {
  const language = resolveCodeLanguage(fenceLanguage);
  if (language === undefined || code === "") return null;

  const cacheKey = `${themeId}\u0000${language}\u0000${code}`;
  const cached = resultCache.get(cacheKey);
  if (cached !== undefined) {
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, cached);
    return cached;
  }

  const option = THEMES_BY_ID.get(themeId) ?? THEMES_BY_ID.get(DEFAULT_CODE_HIGHLIGHT_THEME);
  if (option === undefined) return null;

  let html: string;
  try {
    html = renderTokens(code, language, option.light, option.dark);
  } catch {
    return null;
  }

  const lightTheme = highlighter.getTheme(option.light);
  const darkTheme = highlighter.getTheme(option.dark);
  const result: HighlightedCodeBlock = {
    html,
    fgLight: lightTheme.fg,
    fgDark: darkTheme.fg,
    bgLight: lightTheme.bg,
    bgDark: darkTheme.bg,
  };

  if (resultCache.size >= CACHE_LIMIT) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey !== undefined) resultCache.delete(oldestKey);
  }
  resultCache.set(cacheKey, result);
  return result;
}

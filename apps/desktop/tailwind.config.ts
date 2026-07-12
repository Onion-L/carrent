import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,js,jsx,ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--color-surface-raised) / <alpha-value>)",
        "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
        fg: "rgb(var(--color-fg) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        subtle: "rgb(var(--color-subtle) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-strong": "rgb(var(--color-border-strong) / <alpha-value>)",
        brand: "rgb(var(--color-brand) / <alpha-value>)",
        "user-bubble": "rgb(var(--color-user-bubble) / <alpha-value>)",
        "user-bubble-fg": "rgb(var(--color-user-bubble-fg) / <alpha-value>)",
        "code-bg": "rgb(var(--color-code-bg) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        "app-10": "var(--font-size-10)",
        "app-11": "var(--font-size-11)",
        "app-12": "var(--font-size-12)",
        "app-13": "var(--font-size-13)",
        "app-14": "var(--font-size-14)",
        "app-15": "var(--font-size-15)",
        "app-16": "var(--font-size-16)",
        "app-18": "var(--font-size-18)",
        "app-22": "var(--font-size-22)",
        "app-32": "var(--font-size-32)",
        "app-36": "var(--font-size-36)",
        xs: ["var(--font-size-xs)", { lineHeight: "var(--line-height-xs)" }],
        sm: ["var(--font-size-sm)", { lineHeight: "var(--line-height-sm)" }],
        base: ["var(--font-size-base)", { lineHeight: "var(--line-height-base)" }],
        lg: ["var(--font-size-lg)", { lineHeight: "var(--line-height-lg)" }],
      },
      lineHeight: {
        5: "var(--line-height-5)",
        6: "var(--line-height-6)",
        7: "var(--line-height-7)",
      },
    },
  },
} satisfies Config;

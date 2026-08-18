declare module "prismjs" {
  type Grammar = Record<string, unknown>;

  const Prism: {
    languages: Record<string, Grammar | undefined>;
    highlight(code: string, grammar: Grammar, language: string): string;
  };

  export default Prism;
}

declare module "prismjs/components/*";

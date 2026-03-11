import {
  createBundledHighlighter,
  createSingletonShorthands,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type HighlightLanguage = "json" | "python" | "sparql" | "text";

const createHighlighter = createBundledHighlighter({
  engine: createJavaScriptRegexEngine,
  langs: {
    json: () => import("shiki/dist/langs/json.mjs"),
    python: () => import("shiki/dist/langs/python.mjs"),
    sparql: () => import("shiki/dist/langs/sparql.mjs"),
  },
  themes: {
    "github-light": () => import("shiki/dist/themes/github-light.mjs"),
  },
});

const { codeToHtml } = createSingletonShorthands(createHighlighter);

export async function highlightCodeToHtml(
  code: string,
  language: HighlightLanguage,
): Promise<string> {
  return codeToHtml(code, {
    lang: language,
    theme: "github-light",
  });
}

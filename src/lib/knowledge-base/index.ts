import fs from "fs";
import path from "path";

function load(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src/lib/knowledge-base", file), "utf-8");
}

export function getKnowledgeBase(): string {
  return [
    load("consultant-engine.md"),
    load("product.md"),
    load("marketing.md"),
    load("finance.md"),
  ].join("\n\n---\n\n");
}

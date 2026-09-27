import test from "node:test";
import assert from "node:assert/strict";
import { renderLatexToString } from "./latex-rendering.js";

test("renders LaTeX as print-ready display math", () => {
  const html = renderLatexToString("\\frac{a}{b}");
  assert.match(html, /katex-display/);
  assert.match(html, /katex-mathml/);
});

test("accepts common MathJax and LaTeX display delimiters", () => {
  for (const expression of ["$$x^2$$", "\\[x^2\\]", "\\(x^2\\)", "$x^2$"]) {
    assert.match(renderLatexToString(expression), /katex-display/);
  }
});

test("shows readable source for invalid LaTeX instead of breaking the page", () => {
  const html = renderLatexToString("\\unknowncommand{x}");
  assert.match(html, /katex-display/);
  assert.match(html, /mathcolor="#cc0000"/);
  assert.match(html, /unknowncommand/);
});

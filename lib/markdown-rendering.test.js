import test from "node:test";
import assert from "node:assert/strict";

test("renders ChatGPT-style Markdown tables, strong text, inline math, and escapes raw HTML", async () => {
  const renderer = await import("./markdown-rendering.js").catch(() => null);
  assert.equal(typeof renderer?.renderMarkdownToString, "function", "Markdown rendering should be available");

  const html = renderer.renderMarkdownToString([
    "| Wording | Form | Note |",
    "| --- | --- | --- |",
    "| **P and Q** | \\(P\\land Q\\) | both true |",
    "| raw | <img src=x onerror=alert(1)> | safe |",
  ].join("\n"));

  assert.match(html, /<table>/);
  assert.match(html, /<th>Wording<\/th>/);
  assert.match(html, /<strong>P and Q<\/strong>/);
  assert.match(html, /katex/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("splits text only at blank lines, keeping Markdown tables together", async () => {
  const renderer = await import("./markdown-rendering.js").catch(() => null);
  assert.equal(typeof renderer?.splitTextBlocks, "function", "Text splitting should be available");

  const source = "Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\\(P\\to Q\\)";
  assert.deepEqual(renderer.splitTextBlocks(source), [
    "Heading",
    "| A | B |\n| --- | --- |\n| 1 | 2 |",
    "\\(P\\to Q\\)",
  ]);
  assert.deepEqual(renderer.splitTextBlocks("   "), []);
});

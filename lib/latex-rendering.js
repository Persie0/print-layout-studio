import katex from "katex";

function stripMathDelimiters(source) {
  const value = String(source ?? "").trim();
  const delimiters = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [opening, closing] of delimiters) {
    if (value.startsWith(opening) && value.endsWith(closing) && value.length >= opening.length + closing.length) {
      return value.slice(opening.length, value.length - closing.length).trim();
    }
  }
  return value;
}

export function renderLatexToString(source) {
  const expression = stripMathDelimiters(source);
  if (!expression) return "";
  return katex.renderToString(expression, {
    displayMode: true,
    output: "htmlAndMathml",
    throwOnError: false,
    trust: false,
  });
}

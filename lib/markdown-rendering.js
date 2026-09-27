import { renderInlineLatexToString } from "./latex-rendering.js";

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(source) {
  const math = [];
  const text = source
    .replace(/\\\\\((.+?)\\\\\)/g, (_, expression) => {
      math.push(expression);
      return `\u0000M${math.length - 1}\u0000`;
    })
    .replace(/\\\((.+?)\\\)/g, (_, expression) => {
      math.push(expression);
      return `\u0000M${math.length - 1}\u0000`;
    })
    .replace(/\$([^$\n]+)\$/g, (_, expression) => {
      math.push(expression);
      return `\u0000M${math.length - 1}\u0000`;
    });

  let html = escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
  html = html.replace(/\u0000M(\d+)\u0000/g, (_, index) => (
    `<span class="markdown-math">${renderInlineLatexToString(math[Number(index)])}</span>`
  ));
  return html;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "")
    .split(/(?<!\\)\|/).map((cell) => cell.replaceAll("\\|", "|").trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines) {
  const headings = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return `<table><thead><tr>${headings.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => (
    `<tr>${headings.map((_, index) => `<td>${renderInline(row[index] ?? "")}</td>`).join("")}</tr>`
  )).join("")}</tbody></table>`;
}

export function renderMarkdownToString(source) {
  const lines = String(source ?? "").replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1])) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) tableLines.push(lines[index++]);
      blocks.push(renderTable(tableLines));
      continue;
    }
    const line = lines[index++];
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [line.replace(/^\s*[-*+]\s+/, "")];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [line.replace(/^\s*\d+\.\s+/, "")];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ""));
      blocks.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }
    const paragraph = [line];
    while (index < lines.length && lines[index].trim() && !(lines[index].includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) && !/^#{1,6}\s/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
  }
  return blocks.join("");
}

export function splitTextBlocks(source) {
  return String(source ?? "").trim().split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
}

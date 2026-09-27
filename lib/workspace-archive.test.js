import test from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { createWorkspaceArchive, readWorkspaceArchive } from "./workspace-archive.js";

const imageBytes = Uint8Array.of(137, 80, 78, 71, 1, 2, 3, 4);

test("exports and restores image bytes, OCR, pages, groups, text blocks, and print settings", async () => {
  const workspace = {
    paper: "a5",
    orientation: "landscape",
    marginMm: 5,
    borderMm: 2,
    gapMm: 3,
    pageCount: 3,
    autoOcrOnPaste: true,
    autoMatchTextSize: false,
    groups: [{ id: "group-1", name: "Group 1", color: "#1769AA", numberImages: true }],
    images: [{
      id: "image-1",
      name: "logic scan.png",
      page: 2,
      width: 1200,
      height: 800,
      textHeightRatio: 0.045,
      ocrScanned: true,
      groupId: "group-1",
      blob: new Blob([imageBytes], { type: "image/png" }),
    }],
    texts: [{ id: "text-1", page: 2, content: "\n| prompt | answer |\n", fontSize: 13, format: "markdown", autoSize: true, autoSizeAdjustmentPercent: 25 }],
  };
  const archive = await createWorkspaceArchive(workspace);
  const restored = readWorkspaceArchive(archive);

  assert.deepEqual({
    paper: restored.paper,
    orientation: restored.orientation,
    marginMm: restored.marginMm,
    borderMm: restored.borderMm,
    gapMm: restored.gapMm,
    pageCount: restored.pageCount,
    autoOcrOnPaste: restored.autoOcrOnPaste,
    autoMatchTextSize: restored.autoMatchTextSize,
    groups: restored.groups,
    texts: restored.texts,
  }, {
    paper: "a5",
    orientation: "landscape",
    marginMm: 5,
    borderMm: 2,
    gapMm: 3,
    pageCount: 3,
    autoOcrOnPaste: true,
    autoMatchTextSize: false,
    groups: workspace.groups,
    texts: workspace.texts,
  });
  assert.deepEqual(restored.images.map(({ id, name, page, width, height, textHeightRatio, ocrScanned, groupId }) => ({
    id, name, page, width, height, textHeightRatio, ocrScanned, groupId,
  })), workspace.images.map((image) => Object.fromEntries(Object.entries(image).filter(([key]) => key !== "blob"))));
  assert.deepEqual(new Uint8Array(await restored.images[0].blob.arrayBuffer()), imageBytes);
});

test("rejects an unrelated ZIP or an export with missing image data", () => {
  assert.throws(() => readWorkspaceArchive(zipSync({ "notes.txt": Uint8Array.of(1) })), /workspace export/i);
  const manifest = {
    version: 1,
    settings: { paper: "a4", orientation: "auto", pageCount: 1, groups: [], texts: [] },
    images: [{ id: "image-1", name: "missing.png", page: 1, width: 10, height: 10, path: "images/0.bin", type: "image/png" }],
    groups: [],
    texts: [],
  };
  assert.throws(() => readWorkspaceArchive(zipSync({ "workspace.json": new TextEncoder().encode(JSON.stringify(manifest)) })), /image data/i);
});

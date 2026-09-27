import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_GROUP_COLORS } from "./image-groups.js";
import { findBestGroupMove } from "./page-balancing.js";
import * as pageBalancing from "./page-balancing.js";

function createWorkspace() {
  const groups = [
    { id: "g1", name: "Group 1", color: IMAGE_GROUP_COLORS[0], numberImages: true },
    { id: "g2", name: "Group 2", color: IMAGE_GROUP_COLORS[1], numberImages: true },
    { id: "g3", name: "Group 3", color: IMAGE_GROUP_COLORS[2], numberImages: false },
  ];
  return {
    groups,
    pageCount: 2,
    borderMm: 1,
    images: [
      { id: "p1-g1", page: 1, groupId: "g1", printedTextMm: 2 },
      { id: "p1-g2", page: 1, groupId: "g2", printedTextMm: 2 },
      { id: "p1-g3", page: 1, groupId: "g3", printedTextMm: 2 },
      { id: "p2-g1", page: 2, groupId: "g1", printedTextMm: 2 },
      { id: "p2-g2", page: 2, groupId: "g2", printedTextMm: 6 },
      { id: "p2-g2-extra", page: 2, groupId: "g2", printedTextMm: 6 },
    ],
    texts: [],
  };
}

function statsFor(workspace, page) {
  const images = workspace.images.filter((image) => image.page === page);
  return {
    fits: images.length > 0,
    average: images.length
      ? images.reduce((sum, image) => sum + image.printedTextMm, 0) / images.length
      : null,
  };
}

function findMove(workspace, pages = [1, 2]) {
  let nextId = 0;
  return findBestGroupMove({
    workspace,
    pages,
    getPageStats: statsFor,
    createId: () => `new-${++nextId}`,
  });
}

test("moves a whole page group when the two averages get closer within their original range", () => {
  const workspace = createWorkspace();
  const result = findMove(workspace);

  assert.ok(result);
  assert.equal(result.sourcePage, 2);
  assert.equal(result.targetPage, 1);
  assert.equal(result.sourceGroupName, "Group 2");
  assert.equal(result.destinationGroupName, "Group 4");
  assert.equal(result.movedImageCount, 2);
  assert.ok(Math.abs(result.after.source - result.after.target) < Math.abs(result.before.source - result.before.target));
  assert.ok(result.after.source >= 2 && result.after.source <= 4);
  assert.ok(result.after.target >= 2 && result.after.target <= 4);
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2").page, 1);
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2").groupId, result.workspace.groups.at(-1).id);
  assert.equal(result.workspace.images.find((image) => image.id === "p1-g2").groupId, "g2");
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2-extra").page, 1);
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2-extra").groupId, result.workspace.groups.at(-1).id);
  assert.equal(result.workspace.groups.at(-1).numberImages, true);
  assert.deepEqual(workspace.images.map((image) => image.page), [1, 1, 1, 2, 2, 2]);
});

test("reuses the original group number when an intact group moves to a page without that group", () => {
  const workspace = {
    groups: [
      { id: "g1", name: "Group 1", color: IMAGE_GROUP_COLORS[0] },
      { id: "g2", name: "Group 2", color: IMAGE_GROUP_COLORS[1], numberImages: true },
      { id: "g3", name: "Group 3", color: IMAGE_GROUP_COLORS[2] },
    ],
    pageCount: 2,
    images: [
      { id: "p1-g1", page: 1, groupId: "g1", printedTextMm: 2 },
      { id: "p2-g2", page: 2, groupId: "g2", printedTextMm: 4 },
      { id: "p2-g3", page: 2, groupId: "g3", printedTextMm: 4 },
    ],
    texts: [],
  };
  const result = findMove(workspace);

  assert.ok(result);
  assert.equal(result.sourceGroupName, "Group 2");
  assert.equal(result.destinationGroupName, "Group 2");
  assert.equal(result.workspace.groups.length, 3);
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2").page, 1);
  assert.equal(result.workspace.images.find((image) => image.id === "p2-g2").groupId, "g2");
  assert.equal(result.workspace.groups.find((group) => group.id === "g2").numberImages, true);
});

test("only considers page pairs included in the requested scope", () => {
  const workspace = createWorkspace();
  assert.equal(findMove(workspace, [1]), null);
});

test("continues with multiple valid group transfers until no improving move remains", () => {
  const workspace = {
    groups: [
      { id: "g1", name: "Group 1", color: IMAGE_GROUP_COLORS[0] },
      { id: "g2", name: "Group 2", color: IMAGE_GROUP_COLORS[1] },
      { id: "g3", name: "Group 3", color: IMAGE_GROUP_COLORS[2] },
      { id: "g4", name: "Group 4", color: IMAGE_GROUP_COLORS[3] },
    ],
    pageCount: 2,
    borderMm: 1,
    images: [
      { id: "p1-g1", page: 1, groupId: "g1", printedTextMm: 2 },
      { id: "p2-g2", page: 2, groupId: "g2", printedTextMm: 4 },
      { id: "p2-g3", page: 2, groupId: "g3", printedTextMm: 4 },
      { id: "p2-g4", page: 2, groupId: "g4", printedTextMm: 4 },
    ],
    texts: [],
  };
  let nextId = 0;
  const result = pageBalancing.findBestGroupMoves({
    workspace,
    pages: [1, 2, 3],
    getPageStats: statsFor,
    createId: () => `batch-${++nextId}`,
  });

  assert.ok(result);
  assert.equal(result.moves.length, 2);
  assert.deepEqual(result.moves.map((move) => [move.sourcePage, move.targetPage, move.destinationGroupName]), [
    [2, 1, "Group 2"],
    [2, 1, "Group 3"],
  ]);
  assert.equal(result.workspace.groups.length, 4);
  const originalRange = 4 - 2;
  const finalAverages = [1, 2].map((page) => statsFor(result.workspace, page).average);
  const finalRange = Math.max(...finalAverages) - Math.min(...finalAverages);
  assert.ok(finalRange < originalRange);
  assert.deepEqual(finalAverages, [10 / 3, 4]);
  assert.deepEqual(result.workspace.images.map((image) => image.page), [1, 1, 1, 2]);
  assert.deepEqual(result.workspace.images.slice(1, 3).map((image) => image.groupId), ["g2", "g3"]);
  assert.deepEqual(workspace.images.map((image) => image.page), [1, 2, 2, 2]);
});

test("does not return a move that pushes either average outside the pair's current range", () => {
  const workspace = createWorkspace();
  const statsWithOutOfRangeTarget = (candidate, page) => {
    const stats = statsFor(candidate, page);
    if (candidate.images.some((image) => image.page === 1 && image.id === "p2-g2") && page === 1) {
      return { ...stats, average: 5 };
    }
    return stats;
  };
  assert.equal(findBestGroupMove({
    workspace,
    pages: [1, 2],
    getPageStats: statsWithOutOfRangeTarget,
    createId: () => "new-group",
  }), null);
});

test("does not count a swap of the two averages as an improvement", () => {
  const workspace = {
    groups: [
      { id: "g1", name: "Group 1", color: IMAGE_GROUP_COLORS[0] },
      { id: "g2", name: "Group 2", color: IMAGE_GROUP_COLORS[1] },
      { id: "g3", name: "Group 3", color: IMAGE_GROUP_COLORS[2] },
    ],
    pageCount: 2,
    images: [
      { id: "p1", page: 1, groupId: "g1", printedTextMm: 5 },
      { id: "p2-move", page: 2, groupId: "g2", printedTextMm: 7 },
      { id: "p2-stay", page: 2, groupId: "g3", printedTextMm: 5 },
    ],
    texts: [],
  };

  assert.equal(findMove(workspace), null);
});

test("does not move a group when its new page layout would not fit", () => {
  const workspace = createWorkspace();
  const statsWithOverflow = (candidate, page) => {
    const stats = statsFor(candidate, page);
    return candidate.images.some((image) => image.id === "p2-g2" && image.page === 1) && page === 1
      ? { ...stats, fits: false }
      : stats;
  };
  assert.equal(findBestGroupMove({
    workspace,
    pages: [1, 2],
    getPageStats: statsWithOverflow,
    createId: () => "new-group",
  }), null);
});

test("does not split groups when the distinct-color group limit has been reached", () => {
  const workspace = createWorkspace();
  workspace.groups = IMAGE_GROUP_COLORS.map((color, index) => ({
    id: `g${index + 1}`,
    name: `Group ${index + 1}`,
    color,
  }));
  assert.equal(findMove(workspace), null);
});

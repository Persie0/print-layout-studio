import test from "node:test";
import assert from "node:assert/strict";
import { createImageGroup, IMAGE_GROUP_COLORS, MAX_IMAGE_GROUPS, normalizeImageGroups } from "./image-groups.js";

test("creates groups with a different high-contrast color until the palette limit", () => {
  let groups = [];
  for (let index = 0; index < MAX_IMAGE_GROUPS; index += 1) {
    const group = createImageGroup(groups, `group-${index + 1}`);
    assert.ok(group);
    assert.equal(groups.some((existing) => existing.color === group.color), false);
    groups = [...groups, group];
  }

  assert.equal(MAX_IMAGE_GROUPS, IMAGE_GROUP_COLORS.length);
  assert.equal(new Set(groups.map((group) => group.color)).size, MAX_IMAGE_GROUPS);
  assert.equal(createImageGroup(groups, "one-too-many"), null);
});

test("uses a free palette color and group name after another group is removed", () => {
  const first = createImageGroup([], "first");
  const second = createImageGroup([first], "second");
  const third = { ...createImageGroup([first, second], "third"), name: "Group 3" };
  const groups = [first, third];
  const next = createImageGroup(groups, "new");

  assert.equal(next.name, "Group 2");
  assert.equal(next.color, IMAGE_GROUP_COLORS[1]);
});

test("does not mutate existing groups while creating a new one", () => {
  const first = createImageGroup([], "first");
  const groups = [first];
  const second = createImageGroup(groups, "second");

  assert.deepEqual(groups, [first]);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.color, first.color);
});

test("normalizes stored groups to unique ids, names, palette colors, and the maximum count", () => {
  const groups = normalizeImageGroups([
    { id: "one", name: "First", color: IMAGE_GROUP_COLORS[0] },
    { id: "two", name: "Second", color: IMAGE_GROUP_COLORS[0] },
    { id: "two", name: "Duplicate ID", color: IMAGE_GROUP_COLORS[2] },
    ...Array.from({ length: MAX_IMAGE_GROUPS }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
      color: "#ffffff",
    })),
  ]);

  assert.equal(groups.length, MAX_IMAGE_GROUPS);
  assert.equal(new Set(groups.map((group) => group.id)).size, MAX_IMAGE_GROUPS);
  assert.equal(new Set(groups.map((group) => group.color)).size, MAX_IMAGE_GROUPS);
  assert.equal(groups[0].color, IMAGE_GROUP_COLORS[0]);
  assert.equal(groups[1].color, IMAGE_GROUP_COLORS[1]);
});

test("preserves opt-in image numbering and defaults old saved groups to unnumbered", () => {
  const groups = normalizeImageGroups([
    { id: "numbered", name: "Numbered", color: IMAGE_GROUP_COLORS[0], numberImages: true },
    { id: "ordinary", name: "Ordinary", color: IMAGE_GROUP_COLORS[1] },
  ]);

  assert.equal(groups[0].numberImages, true);
  assert.equal(groups[1].numberImages, false);
});

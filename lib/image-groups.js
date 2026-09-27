// A compact categorical palette with strong contrast against white paper.
// Ordering spreads adjacent groups across blue, orange, green, magenta, and
// other visually distinct hues before the palette is exhausted.
export const IMAGE_GROUP_COLORS = Object.freeze([
  "#1769AA",
  "#C24E00",
  "#16834A",
  "#A23B72",
  "#59439A",
  "#007D82",
  "#8A6510",
  "#8E343A",
]);

export const MAX_IMAGE_GROUPS = IMAGE_GROUP_COLORS.length;

export function normalizeImageGroups(value) {
  if (!Array.isArray(value)) return [];
  const groups = [];
  const usedIds = new Set();
  const usedColors = new Set();

  for (const candidate of value) {
    if (groups.length >= MAX_IMAGE_GROUPS) break;
    const id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
    if (!id || usedIds.has(id)) continue;

    const color = IMAGE_GROUP_COLORS.includes(candidate.color) && !usedColors.has(candidate.color)
      ? candidate.color
      : IMAGE_GROUP_COLORS.find((available) => !usedColors.has(available));
    if (!color) break;

    const fallbackName = `Group ${groups.length + 1}`;
    const name = typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 40)
      : fallbackName;
    groups.push({ id, name, color });
    usedIds.add(id);
    usedColors.add(color);
  }
  return groups;
}

export function createImageGroup(existingGroups, id) {
  const groups = normalizeImageGroups(existingGroups);
  const newId = typeof id === "string" ? id.trim() : "";
  if (!newId || groups.length >= MAX_IMAGE_GROUPS || groups.some((group) => group.id === newId)) return null;

  const color = IMAGE_GROUP_COLORS.find((available) => !groups.some((group) => group.color === available));
  if (!color) return null;

  let number = 1;
  while (groups.some((group) => group.name === `Group ${number}`)) number += 1;
  return { id: newId, name: `Group ${number}`, color };
}

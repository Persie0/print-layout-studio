import { createImageGroup } from "./image-groups.js";

const AVERAGE_EPSILON = 1e-7;

function isValidAverage(value) {
  return Number.isFinite(value) && value > 0;
}

function validPages(pages, pageCount) {
  return [...new Set(pages)]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
}

/**
 * Finds one whole-group transfer that makes a high-OCR-average page and a
 * low-average page closer while keeping both new averages inside their
 * original range. getPageStats must calculate the actual laid-out page.
 */
export function findBestGroupMove({ workspace, pages, getPageStats, createId, excludedImageIds = new Set() }) {
  if (!workspace || !Array.isArray(workspace.images) || !Array.isArray(workspace.groups) ||
    typeof getPageStats !== "function" || typeof createId !== "function") return null;

  const candidatesPages = validPages(pages, workspace.pageCount);
  if (candidatesPages.length < 2) return null;

  const existingStats = new Map(candidatesPages.map((page) => [page, getPageStats(workspace, page)]));
  const groupsById = new Map(workspace.groups.map((group) => [group.id, group]));
  let bestMove = null;

  for (let firstIndex = 0; firstIndex < candidatesPages.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidatesPages.length; secondIndex += 1) {
      const firstPage = candidatesPages[firstIndex];
      const secondPage = candidatesPages[secondIndex];
      const firstStats = existingStats.get(firstPage);
      const secondStats = existingStats.get(secondPage);
      const firstAverage = firstStats?.average;
      const secondAverage = secondStats?.average;
      if (!isValidAverage(firstAverage) || !isValidAverage(secondAverage)) continue;

      const sourcePage = firstAverage > secondAverage ? firstPage : secondPage;
      const targetPage = sourcePage === firstPage ? secondPage : firstPage;
      const before = {
        source: existingStats.get(sourcePage).average,
        target: existingStats.get(targetPage).average,
      };
      const originalDifference = before.source - before.target;
      if (originalDifference <= AVERAGE_EPSILON) continue;

      const sourceGroupIds = [...new Set(workspace.images
        .filter((image) => image.page === sourcePage && typeof image.groupId === "string" && !excludedImageIds.has(image.id))
        .map((image) => image.groupId))];

      for (const sourceGroupId of sourceGroupIds) {
        const sourceGroup = groupsById.get(sourceGroupId);
        if (!sourceGroup) continue;

        const movedImages = workspace.images.filter((image) =>
          image.page === sourcePage && image.groupId === sourceGroupId && !excludedImageIds.has(image.id));
        if (!movedImages.length) continue;
        const movedIds = new Set(movedImages.map((image) => image.id));
        const allGroupImages = workspace.images.filter((image) => image.groupId === sourceGroupId);
        const canReuseGroup = allGroupImages.length === movedImages.length &&
          !workspace.images.some((image) => image.page === targetPage && image.groupId === sourceGroupId);
        const group = canReuseGroup ? null : createImageGroup(workspace.groups, createId());
        if (!canReuseGroup && !group) continue;
        if (group) group.numberImages = sourceGroup.numberImages === true;
        const destinationGroupId = group?.id ?? sourceGroupId;
        const trialWorkspace = {
          ...workspace,
          groups: group ? [...workspace.groups, group] : workspace.groups,
          images: workspace.images.map((image) => movedIds.has(image.id)
            ? { ...image, page: targetPage, groupId: destinationGroupId }
            : image),
        };

        const newSourceStats = getPageStats(trialWorkspace, sourcePage);
        const newTargetStats = getPageStats(trialWorkspace, targetPage);
        if (newSourceStats?.fits !== true || newTargetStats?.fits !== true ||
          !isValidAverage(newSourceStats.average) || !isValidAverage(newTargetStats.average)) continue;

        const lowerBound = Math.min(before.source, before.target);
        const upperBound = Math.max(before.source, before.target);
        const after = { source: newSourceStats.average, target: newTargetStats.average };
        if ([after.source, after.target].some((average) =>
          average < lowerBound - AVERAGE_EPSILON || average > upperBound + AVERAGE_EPSILON)) continue;

        const newDifference = Math.abs(after.source - after.target);
        const improvement = originalDifference - newDifference;
        if (improvement <= AVERAGE_EPSILON) continue;

        if (!bestMove || improvement > bestMove.improvement + AVERAGE_EPSILON) {
          bestMove = {
            workspace: trialWorkspace,
            sourcePage,
            targetPage,
            sourceGroupId,
            sourceGroupName: sourceGroup.name,
            destinationGroupName: group?.name ?? sourceGroup.name,
            movedImageCount: movedImages.length,
            movedImageIds: [...movedIds],
            before,
            after,
            improvement,
          };
        }
      }
    }
  }

  return bestMove;
}

/** Repeats the best valid transfer, moving each image at most once per run. */
export function findBestGroupMoves({ workspace, pages, getPageStats, createId }) {
  if (!workspace || !Array.isArray(workspace.groups)) return null;
  const moves = [];
  const excludedImageIds = new Set();
  let currentWorkspace = workspace;
  for (let step = 0; step < workspace.images.length; step += 1) {
    const move = findBestGroupMove({
      workspace: currentWorkspace,
      pages,
      getPageStats,
      createId,
      excludedImageIds,
    });
    if (!move) break;
    currentWorkspace = move.workspace;
    moves.push(move);
    for (const imageId of move.movedImageIds) excludedImageIds.add(imageId);
  }

  return moves.length ? { workspace: currentWorkspace, moves } : null;
}

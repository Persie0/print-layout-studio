function intersects(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function contains(outer, inner) {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function pruneFreeRects(rects) {
  const result = [];
  for (let i = 0; i < rects.length; i += 1) {
    const current = rects[i];
    if (current.width <= 0 || current.height <= 0) continue;
    let contained = false;
    for (let j = 0; j < rects.length; j += 1) {
      if (i !== j && contains(rects[j], current)) {
        contained = true;
        break;
      }
    }
    if (!contained) result.push(current);
  }
  return result;
}

function splitFreeRects(freeRects, used) {
  const split = [];
  for (const free of freeRects) {
    if (!intersects(free, used)) {
      split.push(free);
      continue;
    }

    if (used.y > free.y) {
      split.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    if (used.y + used.height < free.y + free.height) {
      split.push({
        x: free.x,
        y: used.y + used.height,
        width: free.width,
        height: free.y + free.height - (used.y + used.height),
      });
    }
    if (used.x > free.x) {
      split.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    if (used.x + used.width < free.x + free.width) {
      split.push({
        x: used.x + used.width,
        y: free.y,
        width: free.x + free.width - (used.x + used.width),
        height: free.height,
      });
    }
  }
  return pruneFreeRects(split);
}

function dimensionsFor(item, imageScale, gap, imageBorder) {
  if (item.type === "image") {
    const ratio = Number(item.width) / Number(item.height);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const contentHeight = imageScale;
    const contentWidth = ratio * imageScale;
    const border = imageBorder * 2;
    const width = contentWidth + border;
    const height = contentHeight + border;
    return { width, height, packedWidth: width + gap, packedHeight: height + gap };
  }

  const width = Number(item.width);
  const height = Number(item.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, packedWidth: width + gap, packedHeight: height + gap };
}

function packAtScale(items, width, height, gap, imageScale, imageBorder) {
  const sortable = items.map((item, index) => ({
    item,
    index,
    dimensions: dimensionsFor(item, imageScale, gap, imageBorder),
  }));
  if (sortable.some((entry) => !entry.dimensions)) return null;

  sortable.sort((a, b) => {
    const areaDifference = b.dimensions.packedWidth * b.dimensions.packedHeight -
      a.dimensions.packedWidth * a.dimensions.packedHeight;
    const sideDifference = Math.max(b.dimensions.packedWidth, b.dimensions.packedHeight) -
      Math.max(a.dimensions.packedWidth, a.dimensions.packedHeight);
    return areaDifference || sideDifference || a.index - b.index;
  });

  let freeRects = [{ x: 0, y: 0, width, height }];
  const placements = [];

  for (const entry of sortable) {
    const { packedWidth, packedHeight, width: itemWidth, height: itemHeight } = entry.dimensions;
    let best = null;
    for (let i = 0; i < freeRects.length; i += 1) {
      const free = freeRects[i];
      if (packedWidth > free.width + 1e-8 || packedHeight > free.height + 1e-8) continue;
      const horizontal = free.width - packedWidth;
      const vertical = free.height - packedHeight;
      const scoreShort = Math.min(horizontal, vertical);
      const scoreLong = Math.max(horizontal, vertical);
      const areaWaste = free.width * free.height - packedWidth * packedHeight;
      if (!best || scoreShort < best.scoreShort ||
        (scoreShort === best.scoreShort && scoreLong < best.scoreLong) ||
        (scoreShort === best.scoreShort && scoreLong === best.scoreLong && areaWaste < best.areaWaste)) {
        best = { x: free.x, y: free.y, scoreShort, scoreLong, areaWaste };
      }
    }

    if (!best) return null;
    const used = { x: best.x, y: best.y, width: packedWidth, height: packedHeight };
    placements.push({
      id: entry.item.id,
      type: entry.item.type,
      x: best.x + gap / 2,
      y: best.y + gap / 2,
      width: itemWidth,
      height: itemHeight,
    });
    freeRects = splitFreeRects(freeRects, used);
  }

  return placements;
}

/**
 * Packs a page using MaxRects best-short-side-fit. Image heights share one
 * scale, which is grown by binary search; text dimensions remain fixed.
 * Coordinates and dimensions use the same units as the printable page.
 */
export function layoutPage({ width, height, gap = 0, imageBorder = 0, items }) {
  const pageWidth = Number(width);
  const pageHeight = Number(height);
  const itemGap = Math.max(0, Number(gap) || 0);
  const borderWidth = Math.max(0, Number(imageBorder) || 0);
  const safeItems = Array.isArray(items) ? items : [];
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    return { fits: false, imageScale: 0, placements: [] };
  }
  if (safeItems.length === 0) return { fits: true, imageScale: 0, placements: [] };

  const images = safeItems.filter((item) => item.type === "image");
  if (images.length === 0) {
    const placements = packAtScale(safeItems, pageWidth, pageHeight, itemGap, 0, 0);
    return placements
      ? { fits: true, imageScale: 0, placements }
      : { fits: false, imageScale: 0, placements: [] };
  }

  let maxRatio = 0;
  for (const image of images) {
    const ratio = Number(image.width) / Number(image.height);
    if (!Number.isFinite(ratio) || ratio <= 0) return { fits: false, imageScale: 0, placements: [] };
    maxRatio = Math.max(maxRatio, ratio);
  }
  const borderEdges = borderWidth * 2;
  const upperBound = Math.min(
    pageHeight - itemGap - borderEdges,
    (pageWidth - itemGap - borderEdges) / maxRatio,
  );
  if (upperBound <= 0) return { fits: false, imageScale: 0, placements: [] };

  const minimum = packAtScale(safeItems, pageWidth, pageHeight, itemGap, 0.001, borderWidth);
  if (!minimum) return { fits: false, imageScale: 0, placements: [] };

  let low = 0.001;
  let high = upperBound;
  let bestPlacements = minimum;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const candidate = (low + high) / 2;
    const placements = packAtScale(safeItems, pageWidth, pageHeight, itemGap, candidate, borderWidth);
    if (placements) {
      low = candidate;
      bestPlacements = placements;
    } else {
      high = candidate;
    }
  }

  return { fits: true, imageScale: low, placements: bestPlacements };
}

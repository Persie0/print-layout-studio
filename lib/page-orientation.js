import { layoutPage } from "./layout.js";

function compareLists(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index] - right[index];
    if (Math.abs(difference) > 1e-8) return difference;
  }
  return left.length - right.length;
}

function scoreLayout(orientation, size, margin, gap, imageBorder, items) {
  const innerWidth = Math.max(1, size.width - margin * 2);
  const innerHeight = Math.max(1, size.height - margin * 2);
  const layout = layoutPage({
    width: innerWidth,
    height: innerHeight,
    gap,
    imageBorder,
    items,
  });
  const placements = new Map(layout.placements.map((placement) => [placement.id, placement]));
  const textHeights = [];
  const imageAreas = [];
  const imageShortSides = [];

  if (layout.fits) {
    for (const item of items) {
      if (item.type !== "image") continue;
      const placement = placements.get(item.id);
      if (!placement) continue;
      const ratio = Number(item.width) / Number(item.height);
      const contentWidth = Math.max(0, placement.width - imageBorder * 2);
      const contentHeight = Math.max(0, placement.height - imageBorder * 2);
      const displayedHeight = Math.min(contentHeight, contentWidth / ratio);
      const displayedWidth = displayedHeight * ratio;
      imageAreas.push(displayedWidth * displayedHeight);
      imageShortSides.push(Math.min(displayedWidth, displayedHeight));
      const textRatio = Number(item.textHeightRatio);
      if (Number.isFinite(textRatio) && textRatio > 0) {
        textHeights.push(displayedHeight * textRatio);
      }
    }
  }

  textHeights.sort((a, b) => a - b);
  imageAreas.sort((a, b) => a - b);
  imageShortSides.sort((a, b) => a - b);
  return {
    orientation,
    width: size.width,
    height: size.height,
    innerWidth,
    innerHeight,
    layout,
    textHeights,
    smallestTextHeight: textHeights.length ? textHeights[0] : null,
    imageAreas,
    imageShortSides,
  };
}

/**
 * Chooses the sheet orientation with the best max-min print size. Detected
 * median text height is the primary score; image area and short side break
 * ties so every image remains as large as possible. Image aspect ratios are
 * preserved by layoutPage, so this only rotates the sheet.
 */
export function choosePageLayout({
  portraitSize,
  landscapeSize,
  margin = 0,
  gap = 0,
  imageBorder = 0,
  items = [],
}) {
  const normalizedMargin = Math.max(0, Number(margin) || 0);
  const normalizedGap = Math.max(0, Number(gap) || 0);
  const normalizedBorder = Math.max(0, Number(imageBorder) || 0);
  const candidates = [
    scoreLayout("portrait", portraitSize, normalizedMargin, normalizedGap, normalizedBorder, items),
    scoreLayout("landscape", landscapeSize, normalizedMargin, normalizedGap, normalizedBorder, items),
  ];
  const [portrait, landscape] = candidates;

  if (portrait.layout.fits !== landscape.layout.fits) {
    return portrait.layout.fits ? portrait : landscape;
  }
  if (!portrait.layout.fits) return portrait;

  const portraitPrimary = portrait.textHeights.length ? portrait.textHeights : portrait.imageAreas;
  const landscapePrimary = landscape.textHeights.length ? landscape.textHeights : landscape.imageAreas;
  const primaryResult = compareLists(portraitPrimary, landscapePrimary);
  if (primaryResult !== 0) return primaryResult > 0 ? portrait : landscape;

  const areaResult = compareLists(portrait.imageAreas, landscape.imageAreas);
  if (areaResult !== 0) return areaResult > 0 ? portrait : landscape;

  const shortSideResult = compareLists(portrait.imageShortSides, landscape.imageShortSides);
  if (shortSideResult !== 0) return shortSideResult > 0 ? portrait : landscape;
  return portrait;
}

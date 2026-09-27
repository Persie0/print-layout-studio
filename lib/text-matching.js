function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function estimateTextHeightRatio(words, imageHeight) {
  const height = Number(imageHeight);
  if (!Number.isFinite(height) || height <= 0 || !Array.isArray(words)) return null;
  const ratios = words.flatMap((word) => {
    const confidence = Number(word?.confidence);
    const box = word?.bbox;
    const wordHeight = Number(box?.y1) - Number(box?.y0);
    if (!word?.text?.trim() || !Number.isFinite(confidence) || confidence < 40 || !Number.isFinite(wordHeight)) return [];
    const ratio = wordHeight / height;
    return ratio >= 0.005 && ratio <= 0.25 ? [ratio] : [];
  });
  return median(ratios);
}

export function estimatePrintedTextHeightMm(image, placement, imageBorderMm = 0) {
  const imageWidth = Number(image?.width);
  const imageHeight = Number(image?.height);
  const textRatio = Number(image?.textHeightRatio);
  const placedWidth = Number(placement?.width);
  const placedHeight = Number(placement?.height);
  if (![imageWidth, imageHeight, textRatio, placedWidth, placedHeight].every(Number.isFinite) ||
    imageWidth <= 0 || imageHeight <= 0 || textRatio <= 0 || placedWidth <= 0 || placedHeight <= 0) {
    return null;
  }

  const borderPt = Math.max(0, Number(imageBorderMm) || 0) * (72 / 25.4);
  const contentWidth = Math.max(0, placedWidth - borderPt * 2);
  const contentHeight = Math.max(0, placedHeight - borderPt * 2);
  const printedImageHeightPt = Math.min(contentHeight, contentWidth * imageHeight / imageWidth);
  if (printedImageHeightPt <= 0) return null;
  return printedImageHeightPt * textRatio * (25.4 / 72);
}

export function estimateAveragePrintedTextHeightMm(images, placements, imageBorderMm = 0) {
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const sizes = placements.flatMap((placement) => {
    if (placement.type !== "image") return [];
    const image = imagesById.get(placement.id);
    const size = estimatePrintedTextHeightMm(image, placement, imageBorderMm);
    return size === null ? [] : [size];
  });
  return sizes.length ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : null;
}

export function getUnscannedImages(images) {
  return images.filter((image) => image.ocrScanned !== true);
}

export function getOcrStatusLabel(image) {
  if (image.ocrScanned !== true) return "Not scanned";
  return Number.isFinite(Number(image.textHeightRatio)) && Number(image.textHeightRatio) > 0
    ? "Text found"
    : "No text found";
}

export function getTextMatchScaleFactors(images) {
  const withText = images.flatMap((image) => {
    const ratio = Number(image.textHeightRatio);
    return Number.isFinite(ratio) && ratio > 0 ? [ratio] : [];
  });
  const targetRatio = median(withText);
  return new Map(images.map((image) => {
    const ratio = Number(image.textHeightRatio);
    const scale = targetRatio !== null && Number.isFinite(ratio) && ratio > 0
      ? Math.max(0.5, Math.min(2, targetRatio / ratio))
      : 1;
    return [image.id, scale];
  }));
}

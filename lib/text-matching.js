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

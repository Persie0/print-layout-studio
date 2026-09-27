export function fitPageIntoFrame(pageWidth, pageHeight, frameWidth, frameHeight, zoom = 1) {
  if (![pageWidth, pageHeight, frameWidth, frameHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return { width: 0, height: 0 };
  }
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale = Math.min(frameWidth / pageWidth, frameHeight / pageHeight) * safeZoom;
  return { width: pageWidth * scale, height: pageHeight * scale };
}

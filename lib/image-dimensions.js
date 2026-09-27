function isValidDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

export async function readImageDimensions(blob, adapters = {}) {
  const bitmapDecoder = Object.hasOwn(adapters, "createImageBitmap")
    ? adapters.createImageBitmap
    : (typeof createImageBitmap === "function" ? createImageBitmap : null);

  if (bitmapDecoder) {
    try {
      const bitmap = await bitmapDecoder(blob);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      if (isValidDimensions(dimensions.width, dimensions.height)) return dimensions;
    } catch {
      // Fall through to the image element decoder for browsers with partial support.
    }
  }

  const ImageConstructor = Object.hasOwn(adapters, "Image")
    ? adapters.Image
    : (typeof Image !== "undefined" ? Image : null);
  const createImage = adapters.createImageElement ?? (() => {
    if (ImageConstructor) return new ImageConstructor();
    return typeof document !== "undefined" ? document.createElement("img") : null;
  });
  const makeUrl = adapters.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeUrl = adapters.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);

  const url = makeUrl(blob);
  try {
    const image = createImage();
    if (!image) throw new Error("This browser cannot decode the selected image.");
    const loaded = typeof image.decode === "function"
      ? image.decode()
      : new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("The image could not be decoded."));
      });
    image.src = url;
    await loaded;
    const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
    if (!isValidDimensions(dimensions.width, dimensions.height)) {
      throw new Error("The image has invalid dimensions.");
    }
    return dimensions;
  } finally {
    revokeUrl(url);
  }
}

import { strToU8, unzipSync, zipSync } from "fflate";
import { normalizeImageGroups } from "./image-groups.js";
import { isPaperFormat } from "./paper-formats.js";

const MAX_PAGES = 30;
const MANIFEST_NAME = "workspace.json";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export async function createWorkspaceArchive(workspace) {
  if (!isRecord(workspace) || !Array.isArray(workspace.images) || !Array.isArray(workspace.texts) ||
    !Array.isArray(workspace.groups)) {
    throw new Error("This workspace could not be exported.");
  }
  if (workspace.images.length > 5000) throw new Error("Workspace exports support up to 5,000 images.");

  const files = {};
  const images = [];
  for (const [index, image] of workspace.images.entries()) {
    if (!(image.blob instanceof Blob)) throw new Error(`Could not export image ${image.name || index + 1}.`);
    const type = image.blob.type || "image/png";
    if (!type.startsWith("image/")) throw new Error(`Could not export image ${image.name || index + 1}.`);
    const path = `images/${index}.bin`;
    files[path] = new Uint8Array(await image.blob.arrayBuffer());
    const metadata = Object.fromEntries(Object.entries(image).filter(([key]) => key !== "blob"));
    images.push({ ...metadata, path, type });
  }

  const settings = Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== "images"));
  files[MANIFEST_NAME] = strToU8(JSON.stringify({
    version: 1,
    settings,
    images,
  }));
  return zipSync(files, { level: 6 });
}

export function readWorkspaceArchive(archiveBytes) {
  let entries;
  try {
    entries = unzipSync(archiveBytes);
  } catch {
    throw new Error("This workspace export ZIP could not be read.");
  }
  if (!entries[MANIFEST_NAME]) throw new Error("Choose a Print Layout workspace export ZIP.");

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(entries[MANIFEST_NAME]));
  } catch {
    throw new Error("The workspace export manifest is invalid.");
  }
  if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.settings) ||
    !Array.isArray(manifest.images) || !Array.isArray(manifest.settings.groups) ||
    !Array.isArray(manifest.settings.texts)) {
    throw new Error("The workspace export manifest is incomplete or unsupported.");
  }

  const settings = manifest.settings;
  const pageCount = Math.round(boundedNumber(settings.pageCount, 1, 1, MAX_PAGES));
  const paper = isPaperFormat(settings.paper) ? settings.paper : null;
  if (!paper) throw new Error("The workspace export has an unsupported paper format.");
  const orientation = ["auto", "portrait", "landscape"].includes(settings.orientation) ? settings.orientation : null;
  if (!orientation) throw new Error("The workspace export has an unsupported orientation.");

  const groups = normalizeImageGroups(settings.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const usedIds = new Set();
  const images = manifest.images.map((image, index) => {
    const path = `images/${index}.bin`;
    if (!isRecord(image) || image.path !== path || !entries[path]) {
      throw new Error(`Image data is missing from the workspace export (image ${index + 1}).`);
    }
    const id = typeof image.id === "string" ? image.id.trim() : "";
    const name = typeof image.name === "string" ? image.name : "";
    const page = Number(image.page);
    const width = Number(image.width);
    const height = Number(image.height);
    const type = typeof image.type === "string" ? image.type : "";
    if (!id || !name || usedIds.has(id) || !Number.isInteger(page) || page < 1 || page > pageCount ||
      !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !type.startsWith("image/")) {
      throw new Error(`Image details are invalid in the workspace export (image ${index + 1}).`);
    }
    usedIds.add(id);
    const textHeightRatio = Number(image.textHeightRatio);
    return {
      id,
      name,
      page,
      width,
      height,
      textHeightRatio: Number.isFinite(textHeightRatio) && textHeightRatio > 0 ? textHeightRatio : undefined,
      ocrScanned: image.ocrScanned === true,
      groupId: typeof image.groupId === "string" && groupIds.has(image.groupId) ? image.groupId : undefined,
      blob: new Blob([entries[path]], { type }),
    };
  });
  if (images.length > 5000) throw new Error("Workspace imports support up to 5,000 images.");

  const texts = settings.texts.map((text, index) => {
    if (!isRecord(text)) throw new Error(`Text details are invalid in the workspace export (text ${index + 1}).`);
    const id = typeof text?.id === "string" ? text.id.trim() : "";
    const content = typeof text?.content === "string" ? text.content : "";
    const page = Number(text?.page);
    const fontSize = Number(text?.fontSize);
    if (!id || usedIds.has(id) || !Number.isInteger(page) || page < 1 || page > pageCount ||
      !Number.isFinite(fontSize) || fontSize <= 0) {
      throw new Error(`Text details are invalid in the workspace export (text ${index + 1}).`);
    }
    usedIds.add(id);
    return {
      id,
      page,
      content,
      fontSize,
      format: text.format === "latex" || text.format === "markdown" ? text.format : "plain",
      autoSize: text.autoSize !== false,
      autoSizeAdjustmentPercent: boundedNumber(text.autoSizeAdjustmentPercent, 0, -75, 100),
    };
  });

  return {
    paper,
    orientation,
    marginMm: boundedNumber(settings.marginMm, 4, 0, 50),
    borderMm: boundedNumber(settings.borderMm, 1, 0, 10),
    gapMm: boundedNumber(settings.gapMm, 2, 0, 20),
    pageCount,
    autoOcrOnPaste: settings.autoOcrOnPaste === true,
    autoMatchTextSize: settings.autoMatchTextSize !== false,
    groups,
    images,
    texts,
  };
}

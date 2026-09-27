import { unzipSync, zipSync } from "fflate";

const DEFAULT_PAGE_LIMIT = 30;
const PAGE_DIRECTORY = /^page[\s_-]*(\d+)$/i;
const IMAGE_MIME_TYPES = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

function cleanArchivePath(value) {
  const parts = value.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
  return parts.some((part) => part === "..") ? [] : parts;
}

function explicitPage(parts, maxPages) {
  for (const part of parts) {
    const match = part.match(PAGE_DIRECTORY);
    if (!match) continue;
    const page = Number(match[1]);
    if (!Number.isInteger(page) || page < 1 || page > maxPages) {
      throw new Error(`Page folders must be numbered from 1 to ${maxPages}.`);
    }
    return page;
  }
  return null;
}

function imageType(name) {
  const extension = name.split(".").pop()?.toLowerCase();
  return IMAGE_MIME_TYPES[extension] ?? "";
}

function safeImageName(name) {
  const baseName = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "_").trim();
  return baseName || "image";
}

function uniqueArchiveName(name, usedNames) {
  const safeName = safeImageName(name);
  const extensionIndex = safeName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";
  let candidate = safeName;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export async function createPageArchive(images, pageCount, maxPages = DEFAULT_PAGE_LIMIT) {
  const highestAssignedPage = images.reduce((highest, image) => Math.max(highest, Number(image.page) || 1), 1);
  const requestedPages = Math.max(1, Number(pageCount) || 1, highestAssignedPage);
  if (requestedPages > maxPages) throw new Error(`Page folders are limited to ${maxPages} pages.`);
  const totalPages = requestedPages;

  const files = {};
  const usedByPage = new Map();
  for (let page = 1; page <= totalPages; page += 1) files[`Page ${page}/`] = new Uint8Array();
  for (const image of images) {
    const page = Number(image.page);
    if (!Number.isInteger(page) || page < 1 || page > maxPages) {
      throw new Error(`Page folders are limited to ${maxPages} pages.`);
    }
    if (!files[`Page ${page}/`]) files[`Page ${page}/`] = new Uint8Array();
    const usedNames = usedByPage.get(page) ?? new Set();
    usedByPage.set(page, usedNames);
    const name = uniqueArchiveName(image.name, usedNames);
    files[`Page ${page}/${name}`] = new Uint8Array(await image.blob.arrayBuffer());
  }
  return zipSync(files, { level: 6 });
}

export function readPageArchive(archiveBytes, maxPages = DEFAULT_PAGE_LIMIT) {
  let entries;
  try {
    entries = unzipSync(archiveBytes);
  } catch {
    throw new Error("This ZIP file could not be read.");
  }

  const imageEntries = [];
  const fallbackFolders = new Set();
  let highestExplicitPage = 0;
  let hasExplicitPageFolder = false;
  for (const [path, data] of Object.entries(entries)) {
    const parts = cleanArchivePath(path);
    if (parts.length === 0) continue;
    const fileName = parts.at(-1);
    const type = path.endsWith("/") ? "" : imageType(fileName);
    const page = explicitPage(parts.slice(0, path.endsWith("/") ? undefined : -1), maxPages);
    if (page !== null) {
      hasExplicitPageFolder = true;
      highestExplicitPage = Math.max(highestExplicitPage, page);
    } else if (parts.length > 1) {
      fallbackFolders.add(parts[0]);
    }
    if (type) imageEntries.push({ parts, data, fileName, type, page });
  }

  const sortedFolders = [...fallbackFolders].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  const fallbackPageByFolder = new Map(sortedFolders.map((folder, index) => [folder, index + 1]));
  let pageCount = hasExplicitPageFolder ? highestExplicitPage : Math.max(1, sortedFolders.length);
  const images = imageEntries.map(({ parts, data, fileName, type, page }) => {
    const assignedPage = page ?? fallbackPageByFolder.get(parts[0]) ?? 1;
    pageCount = Math.max(pageCount, assignedPage);
    return { page: assignedPage, file: new File([data], fileName, { type }) };
  });

  if (images.length === 0) throw new Error("No images were found in this ZIP file.");
  if (pageCount > maxPages) throw new Error(`ZIP files can contain up to ${maxPages} pages.`);
  return { pageCount, images };
}

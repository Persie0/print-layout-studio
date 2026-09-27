import { isPaperFormat } from "@/lib/paper-formats";
import type { PaperFormat } from "@/lib/paper-formats";

export type StoredImage = {
  id: string;
  name: string;
  page: number;
  width: number;
  height: number;
  textHeightRatio?: number;
  ocrScanned?: boolean;
  blob: Blob;
};

export type StoredText = {
  id: string;
  page: number;
  content: string;
  fontSize: number;
};

export type Workspace = {
  paper: PaperFormat;
  orientation: "portrait" | "landscape";
  marginMm: number;
  borderMm: number;
  gapMm: number;
  pageCount: number;
  images: StoredImage[];
  texts: StoredText[];
};

const DATABASE_NAME = "print-layout-studio";
const DATABASE_VERSION = 1;
const WORKSPACE_ID = "active";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("workspace")) {
        database.createObjectStore("workspace", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("images")) {
        database.createObjectStore("images", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  databasePromise = pending;
  return pending;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage transaction was cancelled."));
  });
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const database = await openDatabase();
  const transaction = database.transaction(["workspace", "images"], "readonly");
  const workspaceRequest = requestResult<Record<string, unknown> | undefined>(
    transaction.objectStore("workspace").get(WORKSPACE_ID),
  );
  const imagesRequest = requestResult<Array<{ id: string; blob: Blob }>>(
    transaction.objectStore("images").getAll(),
  );
  const completed = transactionResult(transaction);
  const [record, storedImages] = await Promise.all([workspaceRequest, imagesRequest]);
  await completed;
  if (!record) return null;

  const byId = new Map(storedImages.map((image) => [image.id, image.blob]));
  const metadata = Array.isArray(record.images) ? record.images as Omit<StoredImage, "blob">[] : [];
  const storedBorderMm = record.borderMm === undefined ? 1 : Number(record.borderMm);
  const storedGapMm = record.gapMm === undefined ? 2 : Number(record.gapMm);
  return {
    paper: isPaperFormat(record.paper) ? record.paper : "a4",
    orientation: record.orientation === "landscape" ? "landscape" : "portrait",
    marginMm: Number(record.marginMm) || 4,
    borderMm: Number.isFinite(storedBorderMm) ? Math.max(0, Math.min(10, storedBorderMm)) : 1,
    gapMm: Number.isFinite(storedGapMm) ? Math.max(0, Math.min(20, storedGapMm)) : 2,
    pageCount: Math.max(1, Math.min(30, Number(record.pageCount) || 1)),
    images: metadata.flatMap((image) => {
      const blob = byId.get(image.id);
      return blob ? [{
        ...image,
        textHeightRatio: Number.isFinite(Number(image.textHeightRatio)) ? Number(image.textHeightRatio) : undefined,
        ocrScanned: image.ocrScanned === true,
        blob,
      }] : [];
    }),
    texts: Array.isArray(record.texts) ? record.texts as StoredText[] : [],
  };
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(["workspace", "images"], "readwrite");
  const imageStore = transaction.objectStore("images");
  const { images, ...settings } = workspace;
  transaction.objectStore("workspace").put({
    id: WORKSPACE_ID,
    ...settings,
    images: images.map(({ id, name, page, width, height, textHeightRatio, ocrScanned }) => ({
      id, name, page, width, height, textHeightRatio, ocrScanned,
    })),
  });
  for (const image of images) imageStore.put({ id: image.id, blob: image.blob });
  await transactionResult(transaction);
}

export async function removeStoredImage(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction("images", "readwrite");
  transaction.objectStore("images").delete(id);
  await transactionResult(transaction);
}

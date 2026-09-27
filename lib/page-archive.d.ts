export function createPageArchive(
  images: Array<{ page: number; name: string; blob: Blob }>,
  pageCount: number,
  maxPages?: number,
): Promise<Uint8Array>;

export function readPageArchive(
  archiveBytes: ArrayBuffer | Uint8Array,
  maxPages?: number,
): { pageCount: number; images: Array<{ page: number; file: File }> };

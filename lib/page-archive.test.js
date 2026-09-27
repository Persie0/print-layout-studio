import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, zipSync } from "fflate";
import { createPageArchive, readPageArchive } from "./page-archive.js";

const onePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
));

test("exports each image under its page folder and keeps repeated filenames distinct", async () => {
  const archive = await createPageArchive([
    { page: 1, name: "photo.png", blob: new Blob([onePixelPng]) },
    { page: 1, name: "photo.png", blob: new Blob([Uint8Array.of(7, 8, 9)]) },
    { page: 2, name: "portrait.png", blob: new Blob([onePixelPng]) },
  ], 3);

  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries).sort(), [
    "Page 1/",
    "Page 1/photo (2).png",
    "Page 1/photo.png",
    "Page 2/",
    "Page 2/portrait.png",
    "Page 3/",
  ]);
  assert.deepEqual(entries["Page 1/photo.png"], onePixelPng);
  assert.deepEqual(entries["Page 1/photo (2).png"], Uint8Array.of(7, 8, 9));
});

test("exports every assigned page even if the requested page count is stale", async () => {
  const archive = await createPageArchive([
    { page: 2, name: "assigned.png", blob: new Blob([onePixelPng]) },
  ], 1);
  const entries = unzipSync(archive);
  assert.ok(entries["Page 1/"]);
  assert.ok(entries["Page 2/assigned.png"]);
});

test("imports page folders into the same page assignments", async () => {
  const archive = zipSync({
    "Page 1/red.png": onePixelPng,
    "Page 2/blue.png": Uint8Array.of(4, 5, 6),
    "Page 3/": new Uint8Array(),
  });

  const imported = readPageArchive(archive);
  assert.equal(imported.pageCount, 3);
  assert.deepEqual(imported.images.map(({ page, file }) => [page, file.name, file.type]), [
    [1, "red.png", "image/png"],
    [2, "blue.png", "image/png"],
  ]);
  assert.deepEqual(new Uint8Array(await imported.images[1].file.arrayBuffer()), Uint8Array.of(4, 5, 6));
});

test("maps ordinary top-level folders to pages in natural name order", () => {
  const archive = zipSync({
    "trip 10/photo.png": onePixelPng,
    "trip 2/photo.png": onePixelPng,
  });

  const imported = readPageArchive(archive);
  assert.deepEqual(imported.images.map(({ page }) => page), [2, 1]);
  assert.equal(imported.pageCount, 2);
});

test("rejects archives with no images or page folders beyond the editor limit", () => {
  assert.throws(() => readPageArchive(zipSync({ "notes.txt": Uint8Array.of(1) })), /No images/i);
  assert.throws(() => readPageArchive(zipSync({ "Page 31/photo.png": onePixelPng })), /1 to 30/i);
});

test("rejects image paths that try to escape their page folder", async () => {
  const archive = zipSync({ "Page 1/../outside.png": onePixelPng });
  assert.throws(() => readPageArchive(archive), /No images/i);
});

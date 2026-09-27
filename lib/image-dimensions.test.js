import test from "node:test";
import assert from "node:assert/strict";
import { readImageDimensions } from "./image-dimensions.js";

test("reads natural dimensions with the browser image fallback when bitmap decoding is unavailable", async () => {
  let createdUrl = "";
  let revokedUrl = "";
  class FakeImage {
    naturalWidth = 1200;
    naturalHeight = 800;
    async decode() {}
    set src(value) { createdUrl = value; }
  }

  const result = await readImageDimensions({ name: "photo.png" }, {
    createImageBitmap: null,
    Image: FakeImage,
    createObjectURL: () => "blob:test-photo",
    revokeObjectURL: (url) => { revokedUrl = url; },
  });

  assert.deepEqual(result, { width: 1200, height: 800 });
  assert.equal(createdUrl, "blob:test-photo");
  assert.equal(revokedUrl, "blob:test-photo");
});

test("uses and closes ImageBitmap when the fast decoder is available", async () => {
  let closed = false;
  const result = await readImageDimensions({ name: "photo.png" }, {
    createImageBitmap: async () => ({ width: 640, height: 480, close: () => { closed = true; } }),
  });

  assert.deepEqual(result, { width: 640, height: 480 });
  assert.equal(closed, true);
});

test("uses an image element when the browser exposes it through the document", async () => {
  let src = "";
  const imageElement = {
    naturalWidth: 500,
    naturalHeight: 700,
    async decode() {},
    set src(value) { src = value; },
  };

  const result = await readImageDimensions({ name: "pasted.png" }, {
    createImageBitmap: null,
    Image: null,
    createImageElement: () => imageElement,
    createObjectURL: () => "blob:pasted-image",
    revokeObjectURL: () => {},
  });

  assert.deepEqual(result, { width: 500, height: 700 });
  assert.equal(src, "blob:pasted-image");
});

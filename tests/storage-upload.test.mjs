import assert from "node:assert/strict";
import test from "node:test";

import "../assets/js/storage-upload.js";

const upload = globalThis.FZStorageUpload;

class FakeXhr {
  static latest = null;

  constructor() {
    FakeXhr.latest = this;
    this.headers = {};
    this.upload = {};
    this.status = 200;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = body;
    this.onload();
  }
}

test("sends an R2 upload as the raw file with the signed content type", async () => {
  globalThis.XMLHttpRequest = FakeXhr;
  const file = new Blob(["video"], { type: "video/mp4" });

  await upload.putFile("https://r2.example/upload", file, null, {
    raw: true,
    headers: { "Content-Type": "video/mp4" },
  });

  assert.equal(FakeXhr.latest.method, "PUT");
  assert.equal(FakeXhr.latest.headers["Content-Type"], "video/mp4");
  assert.equal(FakeXhr.latest.headers["x-upsert"], undefined);
  assert.equal(FakeXhr.latest.body, file);
});

test("keeps the existing Supabase multipart upload behavior for images", async () => {
  globalThis.XMLHttpRequest = FakeXhr;
  const file = new Blob(["image"], { type: "image/webp" });

  await upload.putFile("https://supabase.example/upload", file, null, {});

  assert.equal(FakeXhr.latest.headers["x-upsert"], "false");
  assert.equal(FakeXhr.latest.body instanceof FormData, true);
});

test("uses the R2 single-part upload ceiling", () => {
  assert.equal(upload.MAX_VIDEO_BYTES, 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024);
});

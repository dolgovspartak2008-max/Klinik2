import assert from "node:assert/strict";
import test from "node:test";

import {
  createR2Storage,
  parseVideoPath,
  storedR2Path,
} from "../supabase/functions/courses/r2-storage.ts";

test("keeps legacy video paths on Supabase Storage", () => {
  assert.deepEqual(parseVideoPath("lessons/abc/video.mp4"), {
    provider: "supabase",
    key: "lessons/abc/video.mp4",
  });
});

test("recognizes explicitly prefixed R2 video paths", () => {
  assert.deepEqual(parseVideoPath("r2:lessons/abc/video.mp4"), {
    provider: "r2",
    key: "lessons/abc/video.mp4",
  });
  assert.equal(storedR2Path("lessons/abc/video.mp4"), "r2:lessons/abc/video.mp4");
});

test("rejects paths that can escape the video namespace", () => {
  for (const value of ["", "/video.mp4", "../video.mp4", "lessons/../video.mp4", "lessons\\video.mp4", "video.mp4?x=1"]) {
    assert.throws(() => parseVideoPath(value), /invalid video path/);
  }
});

test("signs short-lived GET and content-type-bound PUT URLs", async () => {
  const signed = [];
  const signer = {
    async sign(request, options) {
      signed.push({ request, options });
      const url = new URL(request.url);
      url.searchParams.set("signed", "yes");
      return new Request(url, request);
    },
    async fetch() {
      throw new Error("unexpected fetch");
    },
  };
  const r2 = createR2Storage({
    accountId: "account",
    bucket: "paid-videos",
  }, signer);

  const get = await r2.signGet("lessons/abc/видео 1.mp4", 600);
  const put = await r2.signPut("lessons/abc/video.mp4", "video/mp4", 3600);

  assert.match(get, /^https:\/\/account\.r2\.cloudflarestorage\.com\/paid-videos\/lessons\/abc\/%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE%201\.mp4\?/);
  assert.equal(new URL(get).searchParams.get("X-Amz-Expires"), "600");
  assert.equal(new URL(get).searchParams.get("signed"), "yes");
  assert.equal(put.url.includes("X-Amz-Expires=3600"), true);
  assert.deepEqual(put.headers, { "Content-Type": "video/mp4" });
  assert.equal(put.raw, true);
  assert.equal(signed[1].request.headers.get("Content-Type"), "video/mp4");
  assert.deepEqual(signed[1].options, { aws: { signQuery: true, allHeaders: true } });
});

test("checks and deletes only the requested R2 object", async () => {
  const requests = [];
  const signer = {
    async sign() {
      throw new Error("unexpected sign");
    },
    async fetch(request) {
      requests.push(request);
      return new Response(null, { status: request.method === "HEAD" ? 200 : 204 });
    },
  };
  const r2 = createR2Storage({ accountId: "account", bucket: "paid-videos" }, signer);

  assert.equal(await r2.exists("lessons/abc/video.mp4"), true);
  await r2.remove("lessons/abc/video.mp4");

  assert.deepEqual(requests.map((request) => request.method), ["HEAD", "DELETE"]);
  assert.equal(requests[0].url, "https://account.r2.cloudflarestorage.com/paid-videos/lessons/abc/video.mp4");
});

import { AwsClient } from "aws4fetch";

let client;

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    const error = new Error("r2_not_configured");
    error.status = 503;
    throw error;
  }
  if (!client) client = new AwsClient({ service: "s3", region: "auto", accessKeyId, secretAccessKey });
  return { accountId, bucket, client };
}

function key(value) {
  const text = String(value || "");
  if (!text || text.startsWith("/") || text.endsWith("/") || /[\\?#]/.test(text) || text.split("/").some((part) => !part || part === "." || part === "..")) {
    const error = new Error("bad_path");
    error.status = 400;
    throw error;
  }
  return text;
}

function objectUrl(value) {
  const { accountId, bucket } = config();
  return `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${key(value).split("/").map(encodeURIComponent).join("/")}`;
}

export async function signGet(value, expires = 600) {
  const { client } = config();
  const url = new URL(objectUrl(value));
  url.searchParams.set("X-Amz-Expires", String(expires));
  return (await client.sign(new Request(url), { aws: { signQuery: true } })).url.toString();
}

export async function signPut(value, expires = 3600) {
  const { client } = config();
  const url = new URL(objectUrl(value));
  url.searchParams.set("X-Amz-Expires", String(expires));
  const request = await client.sign(new Request(url, { method: "PUT", headers: { "Content-Type": "video/mp4" } }), {
    aws: { signQuery: true, allHeaders: true },
  });
  return { url: request.url.toString(), headers: { "Content-Type": "video/mp4" }, raw: true };
}

export async function exists(value) {
  const { client } = config();
  const response = await client.fetch(new Request(objectUrl(value), { method: "HEAD" }));
  return response.ok;
}

export async function remove(value) {
  const { client } = config();
  const response = await client.fetch(new Request(objectUrl(value), { method: "DELETE" }));
  if (!response.ok && response.status !== 404) throw new Error("video_unavailable");
}

export function r2Path(value) {
  return `r2:${key(value)}`;
}

export function parseR2Path(value) {
  const text = String(value || "");
  if (!text.startsWith("r2:")) throw new Error("video_unavailable");
  return key(text.slice(3));
}

export type VideoLocation = {
  provider: "supabase" | "r2";
  key: string;
};

type R2Config = {
  accountId: string;
  bucket: string;
};

type AwsSigner = {
  sign(request: Request, options: { aws: { signQuery: true; allHeaders?: true } }): Promise<Request>;
  fetch(request: Request): Promise<Response>;
};

const R2_PREFIX = "r2:";

function videoKey(value: string): string {
  if (!value || value !== value.trim() || value.length > 1024 || value.startsWith("/") || value.endsWith("/") || /[\\?#]/.test(value)) {
    throw new Error("invalid video path");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("invalid video path");
  return value;
}

export function parseVideoPath(value: string): VideoLocation {
  const provider = value.startsWith(R2_PREFIX) ? "r2" : "supabase";
  const key = videoKey(provider === "r2" ? value.slice(R2_PREFIX.length) : value);
  return { provider, key };
}

export function storedR2Path(key: string): string {
  return R2_PREFIX + videoKey(key);
}

function endpoint(config: R2Config, key: string): string {
  const path = videoKey(key).split("/").map(encodeURIComponent).join("/");
  return `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}/${path}`;
}

export function createR2Storage(config: R2Config, signer: AwsSigner) {
  async function signed(method: "GET" | "PUT", key: string, expires: number, contentType?: string): Promise<Request> {
    const url = new URL(endpoint(config, key));
    url.searchParams.set("X-Amz-Expires", String(expires));
    const request = new Request(url, {
      method,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    });
    return signer.sign(request, {
      aws: contentType ? { signQuery: true, allHeaders: true } : { signQuery: true },
    });
  }

  return {
    async signGet(key: string, expires: number): Promise<string> {
      return (await signed("GET", key, expires)).url.toString();
    },

    async signPut(key: string, contentType: string, expires: number) {
      const request = await signed("PUT", key, expires, contentType);
      return { url: request.url.toString(), headers: { "Content-Type": contentType }, raw: true as const };
    },

    async exists(key: string): Promise<boolean> {
      const response = await signer.fetch(new Request(endpoint(config, key), { method: "HEAD" }));
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 HEAD ${response.status}`);
      return true;
    },

    async remove(key: string): Promise<void> {
      const response = await signer.fetch(new Request(endpoint(config, key), { method: "DELETE" }));
      if (!response.ok && response.status !== 404) throw new Error(`R2 DELETE ${response.status}`);
    },
  };
}

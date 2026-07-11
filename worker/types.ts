/**
 * Shared types for the Worker.
 *
 * The repo intentionally hand-declares the Cloudflare runtime surfaces it uses
 * (see the original `ASSETS` typing) instead of pulling in
 * `@cloudflare/workers-types`. This keeps the dependency-free build. Only the
 * minimal slice of the R2 API the CMS uses is declared below.
 */

export interface Fetcher {
  fetch: (request: Request) => Promise<Response>;
}

export interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  writeHttpMetadata: (headers: Headers) => void;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
  delimiter?: string;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
}

export interface R2Bucket {
  get: (key: string) => Promise<R2ObjectBody | null>;
  head: (key: string) => Promise<R2Object | null>;
  put: (
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ) => Promise<R2Object>;
  delete: (keys: string | string[]) => Promise<void>;
  list: (options?: R2ListOptions) => Promise<R2Objects>;
}

export interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  // Forms / newsletter (existing)
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
  MAILERLITE_API_KEY?: string;
  MAILERLITE_GROUP_ID?: string;
  // CMS gateway
  GH_APP_ID?: string;
  GH_APP_INSTALLATION_ID?: string;
  GH_APP_PRIVATE_KEY?: string; // PKCS8 PEM
  GH_OWNER?: string; // committed var, e.g. "norrietaylor"
  GH_REPO?: string; // committed var, e.g. "theridge"
  GH_BRANCH?: string; // committed var, e.g. "main"
  CF_ACCESS_TEAM_DOMAIN?: string; // "<team>" or "<team>.cloudflareaccess.com"
  CF_ACCESS_AUD?: string; // Access application AUD tag
}

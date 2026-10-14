// Image generation via OpenRouter, RouterAI, or Pollinations Quest Pollen.

import { spawn } from "node:child_process";
import { getAiProviderConfig } from "./ai-provider.js";

export const IMAGE_MODELS = [
  { id: "openai/gpt-image-2.5-flare", label: "OpenAI GPT Image 2.5 Flare" },
  { id: "openai/gpt-image-2", label: "OpenAI GPT Image 2" },
  { id: "x-ai/grok-imagine-image-2.0", label: "xAI Grok Imagine Image 2.0" },
  { id: "black-forest-labs/flux.2-klein-4b", label: "FLUX.2 Klein 4B (Pollinations Quest)" },
] as const;

export type ImageModelId = string;

export const POLLINATIONS_IMAGE_MODEL: ImageModelId = "black-forest-labs/flux.2-klein-4b";

export function isImageModelId(value: unknown): value is ImageModelId {
  if (typeof value !== "string") return false;
  return IMAGE_MODELS.some((model) => model.id === value) || isConfiguredCustomImageModel(value);
}

const configuredImageModel = process.env.IMAGE_MODEL?.trim();
function configuredImageApiBaseUrl(): string | null {
  const configured = process.env.IMAGE_API_BASE_URL?.trim();
  if (!configured) return null;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("IMAGE_API_BASE_URL must be a valid absolute HTTP(S) URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("IMAGE_API_BASE_URL must use HTTP(S) and must not contain credentials, a query, or a fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

function isConfiguredCustomImageModel(value: string): boolean {
  return Boolean(configuredImageApiBaseUrl() && process.env.IMAGE_MODEL?.trim() === value && value !== POLLINATIONS_IMAGE_MODEL);
}

if (configuredImageModel && !IMAGE_MODELS.some(model => model.id === configuredImageModel) &&
  !isConfiguredCustomImageModel(configuredImageModel)) {
  throw new Error(`IMAGE_MODEL must be one of: ${IMAGE_MODELS.map((model) => model.id).join(", ")}`);
}

export const DEFAULT_IMAGE_MODEL: ImageModelId = configuredImageModel
  ? configuredImageModel as ImageModelId
  : "openai/gpt-image-2.5-flare";

export function getImageModels() {
  const customModel = process.env.IMAGE_MODEL?.trim();
  if (!customModel || customModel === POLLINATIONS_IMAGE_MODEL || !configuredImageApiBaseUrl()) return IMAGE_MODELS;
  const matching = IMAGE_MODELS.find(model => model.id === customModel);
  if (matching) {
    return IMAGE_MODELS.map(model => model.id === customModel
      ? { ...model, label: `Custom API: ${customModel}` }
      : model);
  }
  return [...IMAGE_MODELS, { id: customModel, label: `Custom API: ${customModel}` }];
}

function isCustomImageApiModel(model: ImageModelId): boolean {
  return isConfiguredCustomImageModel(model);
}

export function imageProviderKeyName(model: ImageModelId): string {
  if (isCustomImageApiModel(model)) return "IMAGE_API_KEY";
  return model === POLLINATIONS_IMAGE_MODEL ? "POLLINATIONS_API_KEY" : getAiProviderConfig().keyName;
}

export function hasImageProviderKey(model: ImageModelId): boolean {
  if (isCustomImageApiModel(model)) return true;
  return Boolean(model === POLLINATIONS_IMAGE_MODEL
    ? process.env.POLLINATIONS_API_KEY
    : getAiProviderConfig().apiKey);
}

function imageDataUrl(reference: string): { bytes: Buffer; mediaType: string; extension: string } {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(reference);
  if (!match) throw new Error("Custom image API references must be PNG or JPEG data URLs");
  return {
    bytes: Buffer.from(match[2], "base64"),
    mediaType: `image/${match[1]}`,
    extension: match[1] === "jpeg" ? "jpg" : "png",
  };
}

async function requestCustomImageApi(
  model: ImageModelId,
  prompt: string,
  references: readonly string[],
): Promise<Response> {
  const baseUrl = configuredImageApiBaseUrl();
  if (!baseUrl) throw new Error("IMAGE_API_BASE_URL is not configured");
  const apiKey = process.env.IMAGE_API_KEY?.trim();
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let body: BodyInit;
  let endpoint: string;
  if (references.length) {
    endpoint = `${baseUrl}/images/edits`;
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", "1024x1024");
    form.append("response_format", "b64_json");
    for (const reference of references) {
      const image = imageDataUrl(reference);
      form.append("image", new Blob([Uint8Array.from(image.bytes)], { type: image.mediaType }), `reference.${image.extension}`);
    }
    body = form;
  } else {
    endpoint = `${baseUrl}/images/generations`;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model, prompt, n: 1, size: "1024x1024", response_format: "b64_json" });
  }

  return fetch(endpoint, { method: "POST", headers, body, redirect: "error" });
}

async function verifyQuestOnlyKey(apiKey: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://gen.pollinations.ai/account/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    throw new Error("Could not verify Pollinations API key. Image generation was not sent.");
  }
  const info = await response.json().catch(() => ({})) as { valid?: boolean; questPollenOnly?: boolean };
  if (!response.ok || info.valid !== true || info.questPollenOnly !== true) {
    throw new Error("POLLINATIONS_API_KEY must be a valid Quest Pollen-only key. Image generation was not sent.");
  }
}

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

interface ImageGenerationResponse {
  data?: Array<{
    b64_json?: string;
    media_type?: string;
  }>;
  error?: { message?: string; code?: string | number } | string;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export async function normalizeImageToPng(
  base64: string,
  declaredMediaType?: string,
): Promise<string> {
  const source = Buffer.from(base64, "base64");
  if (isPng(source)) return base64;

  if (!isJpeg(source)) {
    const format = declaredMediaType ?? "unknown format";
    throw new Error(`AI provider returned unsupported image format: ${format}`);
  }

  const png = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let stderr = "";
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      const message = "code" in err && err.code === "ENOENT" ? "ffmpeg is not installed" : err.message;
      reject(new Error(`JPEG to PNG conversion failed: ${message}`));
    });
    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `JPEG to PNG conversion failed${stderr.trim() ? `: ${stderr.trim()}` : ` (ffmpeg exited with ${code})`}`,
          ),
        );
        return;
      }
      const output = Buffer.concat(chunks);
      if (!isPng(output)) {
        reject(new Error("JPEG to PNG conversion did not produce a PNG"));
        return;
      }
      resolve(output);
    });

    child.stdin.end(source);
  });

  return png.toString("base64");
}

export async function generateSpriteImage(
  prompt: string,
  model: ImageModelId = DEFAULT_IMAGE_MODEL,
  references: readonly string[] = [],
): Promise<string> {
  const isPollinations = model === POLLINATIONS_IMAGE_MODEL;
  const isCustomApi = isCustomImageApiModel(model);
  const provider = isPollinations || isCustomApi ? null : getAiProviderConfig();
  const apiKey = isPollinations ? process.env.POLLINATIONS_API_KEY ?? ""
    : isCustomApi ? process.env.IMAGE_API_KEY ?? "" : provider!.apiKey;
  const providerLabel = isPollinations ? "Pollinations" : isCustomApi ? "Custom image API" : provider!.label;
  if (!apiKey && !isCustomApi) throw new Error(`${imageProviderKeyName(model)} is not set`);
  if (isPollinations) await verifyQuestOnlyKey(apiKey);

  const isFlare = !isCustomApi && model === "openai/gpt-image-2.5-flare";
  const fullPrompt = isFlare ? prompt.trim() : `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;
  const endpoint = isPollinations
    ? references.length ? "https://gen.pollinations.ai/v1/images/edits" : "https://gen.pollinations.ai/v1/images/generations"
    : isCustomApi ? "" : `${provider!.baseUrl}/images`;
  const body = isPollinations
    ? {
      model,
      prompt: fullPrompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
      ...(references.length ? {
        image: references.length === 1 ? references[0] : references.map((image_url) => ({ image_url })),
      } : {}),
    }
    : {
      model,
      prompt: fullPrompt,
      ...(references.length ? { input_references: references.map(url => ({ type: "image_url", image_url: { url } })) } : {}),
      ...(isFlare ? { quality: "medium", background: "auto", output_format: "png" } : {}),
    };

  const res = isCustomApi
    ? await requestCustomImageApi(model, fullPrompt, references)
    : await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const json = (await res.json().catch(() => ({}))) as ImageGenerationResponse;

  if (!res.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${providerLabel} image generation failed: ${message}`);
  }

  const image = json.data?.[0];
  if (!image?.b64_json) {
    throw new Error(`${providerLabel} response did not include an image`);
  }

  return normalizeImageToPng(image.b64_json, image.media_type);
}

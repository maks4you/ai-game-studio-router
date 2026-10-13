// Image-to-video generation via the selected provider's /api/v1/videos endpoint.
// Flow: submit job → poll polling_url every few seconds → on `completed`, return unsigned_urls[0].

import { prepareVideoReference } from "./video-reference.js";
import { getAiProviderConfig, type AiProviderConfig } from "./ai-provider.js";
import { videoFrameError } from "../src/lib/video-capabilities.js";

export const VIDEO_MODELS = [
  { id: "x-ai/grok-imagine-video", label: "Grok Imagine Video", defaultDuration: 2, supportsEndImage: false, maxKeyframeImages: 1 },
  { id: "minimax/hailuo-3", label: "MiniMax H3", defaultDuration: 5, supportsEndImage: true, maxKeyframeImages: 2 },
  // Verified 2026-09-14: OpenRouter rejects paired frames, while MiniMax rejects
  // last_frame without first_frame. Despite the discovery metadata, end frames
  // are unusable on this route; do not inject a start frame when None is selected.
  { id: "minimax/hailuo-3-max", label: "MiniMax H3 Max", defaultDuration: 5, supportsEndImage: false, maxKeyframeImages: 1 },
  { id: "bytedance/seedance-2.0", label: "Seedance 2.0", defaultDuration: 4, supportsEndImage: true, maxKeyframeImages: 2 },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];

export const DEFAULT_VIDEO_MODEL: VideoModelId = "x-ai/grok-imagine-video";

export function isVideoModelId(v: unknown): v is VideoModelId {
  return typeof v === "string" && VIDEO_MODELS.some((m) => m.id === v);
}

export function defaultDurationFor(id: VideoModelId): number {
  return VIDEO_MODELS.find((m) => m.id === id)!.defaultDuration;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 100; // ~5 min cap

const CHROMA_DIRECTIVE =
  "Maintain the exact same flat solid pure chroma green background, " +
  "hex #00b140, throughout the entire clip. No background changes, no " +
  "environmental elements, no shadows on the background, no camera movement. " +
  "The subject animates against the uniform green backdrop. " +
  "Preserve the character's exact design, proportions, colors and rendering style. " +
  "Keep the full character visible with consistent scale and framing. " +
  "Perform only the requested movement; do not add motion or morph the character.";

type JobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface VideoJob {
  id: string;
  status: JobStatus;
  polling_url?: string;
  unsigned_urls?: string[];
  generation_id?: string;
  error?: string | { message?: string };
}

interface ErrorResponse {
  error?: string | { message?: string };
}

export interface VideoDownload {
  url: string;
  headers?: Record<string, string>;
}

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration = 2,
  model: VideoModelId = DEFAULT_VIDEO_MODEL,
  endpoints: { startImage?: string; endImage?: string; characterPrompt?: string; stylePrompt?: string } = {},
): Promise<VideoDownload> {
  const provider = getAiProviderConfig();
  if (!provider.apiKey) throw new Error(`${provider.keyName} is not set`);

  const frameError = videoFrameError(VIDEO_MODELS.find(option => option.id === model)!,
    !!endpoints.startImage, !!endpoints.endImage);
  if (frameError) throw new Error(frameError);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid video duration");
  const transition = endpoints.endImage
    ? (endpoints.startImage
      ? "Move naturally from the supplied first frame to the supplied last frame. "
      : "Choose a natural starting pose and move to the supplied last frame. ") +
      "Finish in the exact ending pose; this is a transition, not a repeating cycle."
    : "Create a seamless cycle with matching starting and ending poses.";
  const characterDescription = endpoints.characterPrompt?.trim();
  const fullText = `${characterDescription ? `Character: ${characterDescription}\n\nMovement: ` : ""}${text.trim()}\n\n${CHROMA_DIRECTIVE}${endpoints.stylePrompt ? `\nArt style: ${endpoints.stylePrompt}` : ""}\n${transition}`;
  const frameImages = [];
  if (endpoints.startImage) {
    frameImages.push({ type: "image_url", image_url: { url: await prepareVideoReference(endpoints.startImage, 1024) },
      frame_type: "first_frame" });
  }
  if (endpoints.endImage) {
    frameImages.push({ type: "image_url", image_url: { url: await prepareVideoReference(endpoints.endImage, 1024) },
      frame_type: "last_frame" });
  }
  // None means no fixed first frame. Use appearance guidance only in reference
  // mode; H3 Max supports text/image-to-video, so it uses prompts when no pose is set.
  const reference = !frameImages.length && model !== "minimax/hailuo-3-max"
    ? { type: "image_url", image_url: { url: await prepareVideoReference(image) } } : null;

  const submitRes = await fetch(`${provider.baseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: fullText,
      duration,
      // Keep H3 Max at the cheaper resolution tier in either generation mode.
      ...(model === "minimax/hailuo-3-max" ? { resolution: "480p" } : {}),
      ...(frameImages.length ? { frame_images: frameImages } : reference ? { input_references: [reference] } : {}),
    }),
  });

  let job = (await submitRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
  if (!submitRes.ok) {
    throw new Error(`${provider.label} video submit failed: ${extractError(job, submitRes.status)}`);
  }
  if (!job.id) {
    throw new Error(`${provider.label} video submit returned no job id`);
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (job.status === "completed") break;
    if (
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "expired"
    ) {
      throw new Error(
        `${provider.label} video ${job.status}: ${extractError(job, 200)}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);

    const pollUrl = job.polling_url
      ? new URL(job.polling_url, new URL(provider.baseUrl).origin).toString()
      : `${provider.baseUrl}/videos/${job.id}`;
    if (!isProviderHost(pollUrl, provider)) {
      throw new Error(`${provider.label} returned an invalid polling URL`);
    }

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    });
    job = (await pollRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
    if (!pollRes.ok) {
      throw new Error(
        `${provider.label} video poll failed: ${extractError(job, pollRes.status)}`,
      );
    }
  }

  if (job.status !== "completed") {
    throw new Error(`${provider.label} video did not complete in time (last status: ${job.status})`);
  }

  return resolveDownloadable(job, provider);
}

function resolveDownloadable(job: VideoJob, provider: AiProviderConfig): VideoDownload {
  const authHeaders = { Authorization: `Bearer ${provider.apiKey}` };
  const unsigned = job.unsigned_urls?.[0];
  if (unsigned) {
    return isProviderHost(unsigned, provider)
      ? { url: unsigned, headers: authHeaders }
      : { url: unsigned };
  }
  return {
    url: `${provider.baseUrl}/videos/${job.id}/content?index=0`,
    headers: authHeaders,
  };
}

function isProviderHost(url: string, provider: AiProviderConfig): boolean {
  try {
    const host = new URL(url);
    const base = new URL(provider.baseUrl);
    if (host.protocol !== "https:" || host.port) return false;
    return host.hostname === base.hostname ||
      (provider.name === "openrouter" && host.hostname.endsWith(".openrouter.ai"));
  } catch {
    return false;
  }
}

function extractError(payload: ErrorResponse, status: number): string {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return `HTTP ${status}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

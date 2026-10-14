import assert from "node:assert/strict";
import test from "node:test";
import { generateSpriteImage, DEFAULT_IMAGE_MODEL, getImageModels, isImageModelId, POLLINATIONS_IMAGE_MODEL } from "../server/image.ts";
import { DEFAULT_IMAGE_MODEL as CLIENT_DEFAULT } from "../src/lib/state.ts";
import { emptyManifest } from "../server/projects.ts";

// Transparent 1x1 PNG: normalization must preserve the exact encoded bytes.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

test("Flare defaults request medium-quality PNG with automatic background through OpenRouter", async t => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
  });
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    assert.equal(init.method, "POST");
    requests.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
  });
  assert.equal(DEFAULT_IMAGE_MODEL, "openai/gpt-image-2.5-flare");
  assert.equal(CLIENT_DEFAULT, DEFAULT_IMAGE_MODEL);
  assert.equal(emptyManifest("test").spriteModel, DEFAULT_IMAGE_MODEL);
  assert.ok(isImageModelId(DEFAULT_IMAGE_MODEL));
  assert.equal(await generateSpriteImage("  Green slime hero  "), png);
  const request = requests[0];
  assert.equal(request.model, DEFAULT_IMAGE_MODEL);
  assert.equal(request.quality, "medium");
  assert.equal(request.background, "auto");
  assert.equal(request.output_format, "png");
  assert.equal(request.prompt, "Green slime hero");
  assert.doesNotMatch(request.prompt as string, /#00b140|no green elements/);

  for (const model of ["openai/gpt-image-2", "x-ai/grok-imagine-image-2.0"] as const) {
    assert.equal(await generateSpriteImage("hero", model), png);
    const legacy = requests.at(-1)!;
    assert.equal(legacy.model, model);
    assert.match(legacy.prompt as string, /#00b140/);
    assert.equal(legacy.background, undefined);
    assert.equal(legacy.quality, undefined);
  }
});

test("RouterAI image generation uses its API endpoint and server-side bearer key", async t => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.ROUTERAI_API_KEY;
  process.env.AI_PROVIDER = "routerai";
  process.env.ROUTERAI_API_KEY = "routerai-test-key";
  t.after(() => {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.ROUTERAI_API_KEY;
    else process.env.ROUTERAI_API_KEY = oldKey;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://routerai.ru/api/v1/images");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer routerai-test-key");
    return Response.json({ data: [{ b64_json: png, media_type: "image/png" }] });
  });

  assert.equal(await generateSpriteImage("pixel hero", "openai/gpt-image-2"), png);
});

test("custom OpenAI-compatible image API supports Tailscale URLs and reference edits", async t => {
  const previous = {
    baseUrl: process.env.IMAGE_API_BASE_URL,
    apiKey: process.env.IMAGE_API_KEY,
    model: process.env.IMAGE_MODEL,
  };
  process.env.IMAGE_API_BASE_URL = "http://100.64.0.12:9001/v1/";
  process.env.IMAGE_API_KEY = "remote-image-secret";
  process.env.IMAGE_MODEL = "interhost/flux-test";
  t.after(() => {
    if (previous.baseUrl === undefined) delete process.env.IMAGE_API_BASE_URL;
    else process.env.IMAGE_API_BASE_URL = previous.baseUrl;
    if (previous.apiKey === undefined) delete process.env.IMAGE_API_KEY;
    else process.env.IMAGE_API_KEY = previous.apiKey;
    if (previous.model === undefined) delete process.env.IMAGE_MODEL;
    else process.env.IMAGE_MODEL = previous.model;
  });

  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ data: [{ b64_json: png, media_type: "image/png" }] });
  });

  assert.ok(isImageModelId("interhost/flux-test"));
  assert.ok(getImageModels().some(model => model.id === "interhost/flux-test"));
  assert.equal(await generateSpriteImage("pixel hero", "interhost/flux-test"), png);
  assert.equal(calls[0].url, "http://100.64.0.12:9001/v1/images/generations");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer remote-image-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    model: "interhost/flux-test",
    prompt: "pixel hero\n\n" +
      "Place the subject on a perfectly flat solid pure chroma green background, hex #00b140 (RGB 0, 177, 64). " +
      "The background must be one uniform color with no gradients, no shadows, no lighting variation, and no texture. " +
      "The subject itself must contain no green elements that could conflict with chroma keying. Centered, full subject visible.",
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  });

  assert.equal(await generateSpriteImage("front view", "interhost/flux-test", [`data:image/png;base64,${png}`]), png);
  assert.equal(calls[1].url, "http://100.64.0.12:9001/v1/images/edits");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer remote-image-secret");
  const form = calls[1].init.body as FormData;
  assert.equal(form.get("model"), "interhost/flux-test");
  assert.equal(form.get("prompt")?.toString().startsWith("front view\n\n"), true);
  assert.equal((form.get("image") as File).name, "reference.png");

  process.env.IMAGE_MODEL = "openai/gpt-image-2.5-flare";
  assert.equal(await generateSpriteImage("remote flare", "openai/gpt-image-2.5-flare"), png);
  const flareBody = JSON.parse(calls[2].init.body as string);
  assert.match(flareBody.prompt, /#00b140/);
  assert.equal(flareBody.background, undefined);
});

test("custom image API permits no auth key and rejects unsafe endpoint URLs", async t => {
  const previous = {
    baseUrl: process.env.IMAGE_API_BASE_URL,
    apiKey: process.env.IMAGE_API_KEY,
    model: process.env.IMAGE_MODEL,
  };
  process.env.IMAGE_API_BASE_URL = "http://100.64.0.12:9001/v1";
  delete process.env.IMAGE_API_KEY;
  process.env.IMAGE_MODEL = "interhost/no-auth-model";
  t.after(() => {
    if (previous.baseUrl === undefined) delete process.env.IMAGE_API_BASE_URL;
    else process.env.IMAGE_API_BASE_URL = previous.baseUrl;
    if (previous.apiKey === undefined) delete process.env.IMAGE_API_KEY;
    else process.env.IMAGE_API_KEY = previous.apiKey;
    if (previous.model === undefined) delete process.env.IMAGE_MODEL;
    else process.env.IMAGE_MODEL = previous.model;
  });

  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).Authorization, undefined);
    return Response.json({ data: [{ b64_json: png, media_type: "image/png" }] });
  });
  assert.equal(await generateSpriteImage("hero", "interhost/no-auth-model"), png);

  process.env.IMAGE_API_BASE_URL = "http://user:password@100.64.0.12:9001/v1";
  assert.throws(() => isImageModelId("interhost/no-auth-model"), /must use HTTP\(S\)/);
});

test("Pollinations image generation verifies Quest-only billing and sends references as edits", async t => {
  const oldKey = process.env.POLLINATIONS_API_KEY;
  process.env.POLLINATIONS_API_KEY = "pollinations-test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = oldKey;
  });
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let questPollenOnly = true;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
    if (url === "https://gen.pollinations.ai/account/key") {
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer pollinations-test-key");
      return Response.json({ valid: true, questPollenOnly });
    }
    return Response.json({ data: [{ b64_json: png, media_type: "image/png" }] });
  });

  assert.ok(isImageModelId(POLLINATIONS_IMAGE_MODEL));
  assert.equal(await generateSpriteImage("pixel hero", POLLINATIONS_IMAGE_MODEL), png);
  assert.equal(await generateSpriteImage("same character, front view", POLLINATIONS_IMAGE_MODEL,
    [`data:image/png;base64,${png}`]), png);
  const generations = calls.filter(call => call.url !== "https://gen.pollinations.ai/account/key");
  assert.equal(generations[0].url, "https://gen.pollinations.ai/v1/images/generations");
  assert.equal(generations[0].body?.model, POLLINATIONS_IMAGE_MODEL);
  assert.equal(generations[0].body?.response_format, "b64_json");
  assert.equal(generations[1].url, "https://gen.pollinations.ai/v1/images/edits");
  assert.equal(generations[1].body?.image, `data:image/png;base64,${png}`);
  const requestCount = calls.length;
  questPollenOnly = false;
  await assert.rejects(generateSpriteImage("pixel hero", POLLINATIONS_IMAGE_MODEL), /Quest Pollen-only key/);
  assert.deepEqual(calls.slice(requestCount).map(call => call.url), ["https://gen.pollinations.ai/account/key"]);
});

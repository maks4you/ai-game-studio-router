import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderConfig, hasAiProviderKey } from "../server/ai-provider.ts";

test("AI provider defaults to OpenRouter for existing installations", t => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldRouterAiKey = process.env.ROUTERAI_API_KEY;
  delete process.env.AI_PROVIDER;
  process.env.OPENROUTER_API_KEY = "openrouter-test-key";
  process.env.ROUTERAI_API_KEY = "routerai-test-key";
  t.after(() => {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldRouterAiKey === undefined) delete process.env.ROUTERAI_API_KEY;
    else process.env.ROUTERAI_API_KEY = oldRouterAiKey;
  });

  assert.deepEqual(getAiProviderConfig(), {
    name: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyName: "OPENROUTER_API_KEY",
    apiKey: "openrouter-test-key",
  });
  assert.equal(hasAiProviderKey(), true);
});

test("RouterAI selection uses its own base URL and API key", t => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldRouterAiKey = process.env.ROUTERAI_API_KEY;
  process.env.AI_PROVIDER = "routerai";
  process.env.ROUTERAI_API_KEY = "routerai-test-key";
  t.after(() => {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldRouterAiKey === undefined) delete process.env.ROUTERAI_API_KEY;
    else process.env.ROUTERAI_API_KEY = oldRouterAiKey;
  });

  assert.deepEqual(getAiProviderConfig(), {
    name: "routerai",
    label: "RouterAI",
    baseUrl: "https://routerai.ru/api/v1",
    keyName: "ROUTERAI_API_KEY",
    apiKey: "routerai-test-key",
  });
  assert.equal(hasAiProviderKey(), true);
});

test("invalid AI provider selection is rejected", t => {
  const oldProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "unknown";
  t.after(() => {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
  });
  assert.throws(getAiProviderConfig, /AI_PROVIDER must be openrouter or routerai/);
});
export type AiProviderName = "openrouter" | "routerai";

export interface AiProviderConfig {
  name: AiProviderName;
  label: string;
  baseUrl: string;
  keyName: "OPENROUTER_API_KEY" | "ROUTERAI_API_KEY";
  apiKey: string;
}

export function getAiProviderConfig(): AiProviderConfig {
  const configuredName = process.env.AI_PROVIDER?.trim() || "openrouter";
  if (configuredName !== "openrouter" && configuredName !== "routerai") {
    throw new Error("AI_PROVIDER must be openrouter or routerai");
  }

  const routerAi = configuredName === "routerai";
  const keyName = routerAi ? "ROUTERAI_API_KEY" : "OPENROUTER_API_KEY";
  return {
    name: configuredName,
    label: routerAi ? "RouterAI" : "OpenRouter",
    baseUrl: routerAi ? "https://routerai.ru/api/v1" : "https://openrouter.ai/api/v1",
    keyName,
    apiKey: process.env[keyName] ?? "",
  };
}

export function hasAiProviderKey(): boolean {
  return Boolean(getAiProviderConfig().apiKey);
}
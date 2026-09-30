import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { logger } from "./logger";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
}

// SDK error messages can contain request URLs (and API keys) or user content.
// Only emit fixed, allowlisted diagnostics; never log the error object or message.
export function providerDiagnostic(error: unknown): { status: number | null; reason: string } {
  const value = error && typeof error === "object" ? error as { status?: unknown; message?: unknown } : {};
  const status = typeof value.status === "number" && Number.isInteger(value.status) &&
    value.status >= 100 && value.status <= 599 ? value.status : null;
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  let reason = "unknown";
  if (message.includes("no longer available")) reason = "model_retired";
  else if (message.includes("high demand") || message.includes("overloaded")) reason = "capacity";
  else if (message.includes("quota") || message.includes("rate limit")) reason = "quota_or_rate_limit";
  else if (message.includes("api key")) reason = "api_key";
  else if (message.includes("permission")) reason = "permission";
  else if (message.includes("billing")) reason = "billing";
  else if (message.includes("not found")) reason = "not_found";
  else if (message.includes("timeout") || message.includes("timed out")) reason = "timeout";
  else if (status === 503) reason = "service_unavailable";
  else if (status === 504) reason = "gateway_timeout";
  else if (status === 429) reason = "rate_limited";
  return { status, reason };
}

export async function generateGeminiContent(
  apiKey: string,
  request: GenerateContentParameters,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  generate?: (request: GenerateContentParameters) => Promise<string>,
): Promise<string> {
  const call = generate ?? (async (payload: GenerateContentParameters) => {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 14_000, retryOptions: { attempts: 1 } },
    });
    const response = await client.models.generateContent(payload);
    return response.text ?? "";
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await call(request);
    } catch (error) {
      const diagnostic = providerDiagnostic(error);
      logger.warn({ model: request.model, ...diagnostic, attempt }, "Gemini generation failed");
      if (attempt === 2 || ![429, 503, 504].includes(diagnostic.status ?? 0)) throw error;
      await sleep(500);
    }
  }
  throw new Error("GEMINI_UNAVAILABLE");
}
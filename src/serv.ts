/**
 * A small client for SERV Reasoning (OpenServ's OpenAI-compatible inference API).
 * Every call returns its token usage and its real cost in US dollars, using
 * the prices SERV publishes in its own model list.
 */

const SERV_URL = "https://inference-api.openserv.ai/v1/chat/completions";
const SERV_MODELS_URL = "https://inference-api.openserv.ai/v1/models";

export interface Model {
  id: string;
  /** US dollars per million input / output tokens. */
  inputPerM: number;
  outputPerM: number;
}

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

const cache = new Map<string, Model>();

/** Looks up a model's price from SERV's model list (prices are in US cents per million tokens). */
export async function servModel(id: string): Promise<Model> {
  const hit = cache.get(id);
  if (hit) return hit;
  const res = await fetch(SERV_MODELS_URL, { headers: { Authorization: `Bearer ${process.env.SERV_API_KEY}` } });
  if (!res.ok) throw new Error(`SERV model list returned ${res.status}`);
  const body = (await res.json()) as { items: { modelId: string; pricing: { input: number; output: number } }[] };
  const found = body.items.find((m) => m.modelId === id);
  if (!found) throw new Error(`SERV has no model ${id}`);
  const model = { id, inputPerM: found.pricing.input / 100, outputPerM: found.pricing.output / 100 };
  cache.set(id, model);
  return model;
}

const MAX_TOKENS = Number(process.env.SRH_MAX_TOKENS) || 4000;
const TIMEOUT_MS = 120_000;

/** `schema`, when given, asks SERV for strict JSON matching it (OpenAI-style structured output). */
export async function chat(model: Model, system: string, user: string, schema?: object): Promise<CallResult> {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is not set");
  const request = () =>
    fetch(SERV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: model.id,
        max_completion_tokens: MAX_TOKENS,
        ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema } } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  const started = Date.now();
  let res = await request();
  for (let attempt = 1; attempt <= 3 && (res.status === 429 || res.status >= 500); attempt++) {
    const wait = Number(res.headers.get("retry-after")) * 1000 || attempt * 4000;
    await new Promise((r) => setTimeout(r, wait));
    res = await request();
  }
  if (!res.ok) throw new Error(`SERV ${model.id} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const inputTokens = body.usage?.prompt_tokens ?? 0;
  const outputTokens = body.usage?.completion_tokens ?? 0;
  return {
    text: body.choices[0]?.message.content ?? "",
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * model.inputPerM + outputTokens * model.outputPerM) / 1_000_000,
    ms: Date.now() - started,
  };
}

/** Pulls the first JSON object out of a model reply. */
export function parseJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

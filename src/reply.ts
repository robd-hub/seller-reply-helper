/**
 * The reply engine. A seller describes their shop once (products, prices,
 * delivery, payment, policies). For each customer message, SERV Reasoning
 * writes a ready-to-send reply in the customer's own language and style
 * (English, Tagalog, Taglish or Singlish), using only facts from the shop info.
 *
 * Anything the shop info doesn't cover, or anything a person should handle
 * (complaints, refunds, haggling below the floor price, custom orders), is
 * flagged "needs you" instead of being guessed.
 */
import { chat, parseJson, servModel, type CallResult } from "./serv.js";

export interface Shop {
  name: string;
  /** Free text: products, prices, delivery, payment, policies, tone. */
  info: string;
}

export interface Reply {
  /** The text to send back to the customer. */
  reply: string;
  language: "English" | "Tagalog" | "Taglish" | "Singlish" | "Other";
  /** Short label for what the customer wants, e.g. "price", "COD", "complaint". */
  intent: string;
  /** True when the seller should check before sending (or answer themselves). */
  needsYou: boolean;
  /** Why it needs the seller, in one plain sentence. Empty when needsYou is false. */
  needsYouReason: string;
  /** The facts from the shop info the reply relied on. */
  factsUsed: string[];
  model: string;
  costUsd: number;
  ms: number;
}

/** The default model: cheap enough that a reply costs a small fraction of a cent. */
export const DEFAULT_MODEL = process.env.SRH_MODEL || "gemini-3.8-flash";

export const SYSTEM_PROMPT = `You write customer-service replies for a small online shop in Southeast Asia (mostly the Philippines and Singapore) that sells through Facebook, Messenger, Instagram, WhatsApp, Telegram, Carousell, Shopee, Lazada or TikTok Shop.

You write AS the shop (first person: "we", "ko", "namin"). Never mention "the seller", "the owner" or "the shop owner" as someone else, and never say you are an AI.

Rules:
1. Use ONLY facts in the SHOP INFO. Never invent prices, stock, sizes, colours, delivery times, fees, discounts, promos or policies. If the shop info does not say, do not guess.
2. Reply in the customer's language and style. English -> English. Tagalog -> Tagalog. Taglish (Tagalog-English mix) -> Taglish. Singlish (Singapore English with particles like lah, leh, lor, can or not, got stock?) -> light, friendly Singlish that a Singapore seller would really send (a particle or two, never overdone or mocking). Match their formality; for Filipino customers use "po" if they do or if they sound older or formal. Keep it short and friendly like a real seller on Messenger (1-4 short sentences). At most one emoji, only if the customer used one or the shop tone allows it.
3. Answer every question in the message. If a question is not covered by the shop info, say politely that you will check and get back to them, and set needsYou true.
4. Set needsYou true when: the answer is not in the shop info; the customer complains, reports a problem, asks for a refund/return/exchange, or is angry; they ask for a discount or deal the shop info does not address (if the shop info clearly says no, politely say no and needsYou can stay false); they want a custom or bulk order not covered; they ask for personal or account details; or the message is unclear. Otherwise needsYou is false.
5. When the shop info clearly answers a question (for example "no returns", "not offered", "fixed price", "no COD"), say so plainly and kindly. Do not add "I'll check with the team", do not hint at exceptions, and do not promise outcomes or timelines the shop info doesn't give. Offer what the shop CAN do instead (an alternative product, the discount that does exist, the exchange that is allowed).
6. When needsYou is true still write a polite holding reply the seller can send right away, ask for anything needed to sort it out (order details, a photo, a payment reference), and never promise anything the shop info doesn't allow. The customer is already chatting with you, so never tell them to message you somewhere else.
7. Do not give out the shop's payment account numbers or addresses unless they are in the shop info.
8. When the customer asks for a total, add it up carefully and show the sum. Mention any minimum order, cut-off time or free-delivery threshold from the shop info that applies to what they asked.
9. Gently move the customer toward ordering when it fits (e.g. ask for name, address and contact number, or the size/colour they want), following the shop's ordering steps if given.

Reply with JSON only, no other text:
{"reply": "<message to send>", "language": "English|Tagalog|Taglish|Singlish|Other", "intent": "<2-4 words>", "needsYou": true|false, "needsYouReason": "<one short sentence, empty if false>", "factsUsed": ["<short fact from shop info>", ...]}`;

export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "language", "intent", "needsYou", "needsYouReason", "factsUsed"],
  properties: {
    reply: { type: "string" },
    language: { type: "string", enum: ["English", "Tagalog", "Taglish", "Singlish", "Other"] },
    intent: { type: "string" },
    needsYou: { type: "boolean" },
    needsYouReason: { type: "string" },
    factsUsed: { type: "array", items: { type: "string" } },
  },
};

export function userPrompt(shop: Shop, message: string): string {
  return `SHOP NAME: ${shop.name}\n\nSHOP INFO:\n${shop.info}\n\nCUSTOMER MESSAGE:\n${message}`;
}

const LANGS = new Set(["English", "Tagalog", "Taglish", "Singlish", "Other"]);

export async function writeReply(shop: Shop, message: string, modelId = DEFAULT_MODEL): Promise<Reply> {
  const model = await servModel(modelId);
  let call: CallResult = await chat(model, SYSTEM_PROMPT, userPrompt(shop, message), REPLY_SCHEMA);
  let parsed = parseJson<Partial<Reply>>(call.text);
  let costUsd = call.costUsd;
  let ms = call.ms;
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    // One retry if the model didn't return usable JSON.
    call = await chat(model, SYSTEM_PROMPT, userPrompt(shop, message), REPLY_SCHEMA);
    parsed = parseJson<Partial<Reply>>(call.text);
    costUsd += call.costUsd;
    ms += call.ms;
  }
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    return {
      reply: "",
      language: "Other",
      intent: "unknown",
      needsYou: true,
      needsYouReason: "The helper couldn't write a reply for this one, so please answer it yourself.",
      factsUsed: [],
      model: modelId,
      costUsd,
      ms,
    };
  }
  const language = LANGS.has(String(parsed.language)) ? (parsed.language as Reply["language"]) : "Other";
  return {
    reply: parsed.reply.trim(),
    language,
    intent: String(parsed.intent ?? "").slice(0, 40),
    needsYou: Boolean(parsed.needsYou),
    needsYouReason: parsed.needsYou ? String(parsed.needsYouReason ?? "") : "",
    factsUsed: Array.isArray(parsed.factsUsed) ? parsed.factsUsed.map(String).slice(0, 8) : [],
    model: modelId,
    costUsd,
    ms,
  };
}

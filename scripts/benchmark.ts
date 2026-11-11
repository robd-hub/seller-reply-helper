/**
 * Runs every test message in data/messages.json through the reply engine and
 * has a stronger SERV model grade each reply against what a good reply must
 * say. Writes data/results-<model>.json.
 *
 *   npm run benchmark -- [model] [ids...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_MODEL, writeReply, type Reply, type Shop } from "../src/reply.js";
import { chat, parseJson, servModel } from "../src/serv.js";

interface TestMessage {
  id: string;
  shop: string;
  lang: string;
  needsYou: boolean;
  flagOptional?: boolean;
  message: string;
  expect: string;
}

export const GRADER = process.env.SRH_GRADER || "claude-sonnet-5.5";

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["accuracy", "language", "tone", "score", "problem"],
  properties: {
    accuracy: { type: "integer" },
    language: { type: "integer" },
    tone: { type: "integer" },
    score: { type: "integer" },
    problem: { type: "string" },
  },
};

const GRADER_SYSTEM = `You grade customer-service replies written for a small online shop. You get the shop info, the customer's message, notes on what a good reply must do, and the reply.
Score each 0-100:
- accuracy: every fact matches the shop info, nothing invented (prices, stock, fees, addresses, policies), every question answered or honestly deferred, and the notes are followed. Any invented fact or wrong price/total caps accuracy at 40.
- language: reply is in the customer's language/style (English, Tagalog, Taglish or Singlish) and sounds natural for a real seller there.
- tone: friendly, short, polite, fits the shop's tone, written as the shop itself.
score = round(0.6*accuracy + 0.25*language + 0.15*tone).
problem: the single biggest issue in one short sentence, or "" if none.
Return JSON only.`;

const [modelArg, ...ids] = process.argv.slice(2);
const model = modelArg || DEFAULT_MODEL;
const shops = JSON.parse(readFileSync("data/shops.json", "utf8")) as (Shop & { id: string })[];
let tests = JSON.parse(readFileSync("data/messages.json", "utf8")) as TestMessage[];
if (ids.length) tests = tests.filter((t) => ids.includes(t.id));
const grader = await servModel(GRADER);

async function run(t: TestMessage) {
  const shop = shops.find((s) => s.id === t.shop)!;
  const reply: Reply = await writeReply(shop, t.message, model);
  const g = await chat(
    grader,
    GRADER_SYSTEM,
    `SHOP INFO:\n${shop.info}\n\nCUSTOMER MESSAGE:\n${t.message}\n\nA GOOD REPLY MUST:\n${t.expect}\n\nREPLY:\n${reply.reply}`,
    GRADE_SCHEMA,
  );
  const grade = parseJson<{ accuracy: number; language: number; tone: number; score: number; problem: string }>(g.text) ?? {
    accuracy: 0,
    language: 0,
    tone: 0,
    score: 0,
    problem: "grader failed",
  };
  const flagOk = t.flagOptional ? true : reply.needsYou === t.needsYou;
  const r = { ...t, reply, grade, flagOk, graderCostUsd: g.costUsd };
  console.log(`${t.id} ${String(grade.score).padStart(3)} flag:${flagOk ? "ok " : "BAD"} ${reply.language.padEnd(8)} ${grade.problem}`);
  return r;
}

const results: Awaited<ReturnType<typeof run>>[] = [];
const queue = [...tests];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const t = queue.shift()!;
      try {
        results.push(await run(t));
      } catch (e) {
        console.error(t.id, String(e).slice(0, 200));
      }
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
const avg = results.reduce((s, r) => s + r.grade.score, 0) / results.length;
const flags = results.filter((r) => r.flagOk).length;
const cost = results.reduce((s, r) => s + r.reply.costUsd, 0);
console.log(
  `\n${model}: ${results.length} replies, avg score ${avg.toFixed(1)}, flags right ${flags}/${results.length}, reply cost $${cost.toFixed(4)} ($${(cost / results.length).toFixed(5)} each)`,
);
if (!ids.length) writeFileSync(`data/results-${model}.json`, JSON.stringify({ model, grader: GRADER, ranAt: new Date().toISOString(), results }, null, 1));

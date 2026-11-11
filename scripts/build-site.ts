/**
 * Builds the static site into out/: site/index.html with the sample shops,
 * the latest benchmark results and the API address filled in.
 *
 *   npm run build            (API_URL defaults to /api/reply, same origin on Vercel)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODEL = process.env.SRH_MODEL || "gemini-3.8-flash";
const API_URL = process.env.API_URL || "/api/reply";

interface Shop { id: string; name: string; info: string; starter: string }
interface Result {
  id: string; shop: string; lang: string; needsYou: boolean; flagOptional?: boolean; message: string;
  reply: { reply: string; language: string; needsYou: boolean; needsYouReason: string; costUsd: number };
  grade: { accuracy: number; score: number }; flagOk: boolean;
}

const shops = JSON.parse(readFileSync("data/shops.json", "utf8")) as Shop[];
const messages = JSON.parse(readFileSync("data/messages.json", "utf8")) as { shop: string; message: string }[];
const file = `data/results-${MODEL}.json`;
if (!existsSync(file)) throw new Error(`No benchmark results at ${file}. Run: npm run benchmark -- ${MODEL}`);
const results = (JSON.parse(readFileSync(file, "utf8")) as { results: Result[] }).results;

const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

const siteShops = shops.map((s) => ({
  name: s.name,
  info: s.info,
  samples: [s.starter, ...messages.filter((m) => m.shop === s.id && m.message !== s.starter).map((m) => m.message)].slice(0, 7),
}));

const count = results.length;
const flagChecks = results.filter((r) => !r.flagOptional).length;
const summary = {
  model: MODEL,
  count,
  avg: results.reduce((s, r) => s + r.grade.score, 0) / count,
  // The grader caps accuracy at 40 when a reply invents a fact.
  noInvented: results.filter((r) => r.grade.accuracy > 40).length,
  flagsRight: results.filter((r) => !r.flagOptional && r.flagOk).length,
  flagChecks,
  costEach: results.reduce((s, r) => s + r.reply.costUsd, 0) / count,
  langs: [...new Set(results.map((r) => r.lang))].sort(),
  examples: results.map((r) => ({
    shop: shopName(r.shop),
    lang: r.lang,
    message: r.message,
    reply: r.reply.reply,
    needsYou: r.reply.needsYou,
    needsYouReason: r.reply.needsYouReason,
    score: r.grade.score,
  })),
};

const html = readFileSync("site/index.html", "utf8")
  .replace("__SHOPS__", JSON.stringify(siteShops).replace(/</g, "\\u003c"))
  .replace("__RESULTS__", JSON.stringify(summary).replace(/</g, "\\u003c"))
  .replace("__MODELS__", readFileSync("data/model-comparison.json", "utf8").replace(/</g, "\\u003c"))
  .replace("__API__", JSON.stringify(API_URL));

mkdirSync("out", { recursive: true });
writeFileSync("out/index.html", html);
if (existsSync("site/og.png")) copyFileSync("site/og.png", "out/og.png");
console.log(`Built out/index.html: ${count} results from ${MODEL}, avg ${summary.avg.toFixed(1)}, API ${API_URL}`);

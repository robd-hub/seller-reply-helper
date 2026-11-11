/**
 * POST /api/reply  {"shopName": "...", "shopInfo": "...", "message": "..."}
 *
 * The live endpoint behind the demo page. Writes one reply with SERV Reasoning.
 * The SERV key stays on the server (a Vercel environment variable).
 *
 * Guard rails, because every call spends real credits:
 *   - shop info and messages are capped in length
 *   - each visitor (by IP) gets PER_IP_PER_HOUR replies an hour
 *   - each server instance stops after DAILY_CAP replies a day
 */
import { writeReply } from "../src/reply.js";

const MAX_INFO = 4000;
const MAX_MESSAGE = 800;
const PER_IP_PER_HOUR = Number(process.env.SRH_PER_IP_PER_HOUR) || 30;
const DAILY_CAP = Number(process.env.SRH_DAILY_CAP) || 1000;

const hits = new Map<string, number[]>();
let day = "";
let today = 0;

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  let body: { shopName?: unknown; shopInfo?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Send JSON like {\"shopInfo\": \"...\", \"message\": \"...\"}." }, 400, origin);
  }
  const name = String(body.shopName ?? "").trim().slice(0, 80) || "My shop";
  const info = String(body.shopInfo ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!info) return json({ error: "Add your shop info first: products, prices, delivery and payment." }, 400, origin);
  if (!message) return json({ error: "Paste a customer message first." }, 400, origin);
  if (info.length > MAX_INFO) return json({ error: `Keep the shop info under ${MAX_INFO} characters.` }, 400, origin);
  if (message.length > MAX_MESSAGE) return json({ error: `Keep the message under ${MAX_MESSAGE} characters.` }, 400, origin);

  const now = Date.now();
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    return json({ error: `That's ${PER_IP_PER_HOUR} replies this hour on the free demo. Try again later.` }, 429, origin);
  }
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    today = 0;
  }
  if (today >= DAILY_CAP) return json({ error: "The demo has hit today's limit. Try again tomorrow." }, 429, origin);
  recent.push(now);
  hits.set(ip, recent);
  today++;

  try {
    const r = await writeReply({ name, info }, message);
    return json(r, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong writing the reply. Please try again." }, 502, origin);
  }
}

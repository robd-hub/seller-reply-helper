# Seller Reply Helper

**Stop typing the same answers all day.** Small online sellers in the Philippines and Singapore answer "how much?", "available pa?", "COD?" and "can deliver or not?" dozens of times a day on Messenger, Shopee, Instagram and Carousell. Seller Reply Helper writes the reply for them.

1. **Describe your shop once:** products, prices, delivery, payment and rules.
2. **Paste a customer message.**
3. **Get a ready-to-send reply** in the customer's own language and style (English, Tagalog, Taglish or Singlish), using only your facts. Complaints, refunds, bulk orders and anything your info doesn't cover are flagged **"needs you"** with a reason, instead of being guessed.

It runs on **SERV Reasoning** (OpenServ's inference API). Built for the OpenServ SERV Hackathon 02 (Open Track).

## Tested, not just demoed

`data/messages.json` holds 55 realistic customer messages for four sample shops: a Quezon City bakery, a phone case shop, an ukay (pre-loved clothes) seller and a Singapore kueh kitchen. They include the hard cases: totals and thresholds, sold-out items, allergy questions, angry buyers, haggling, refund requests and payment disputes. A stronger model (Claude Sonnet 5.5 on SERV) grades every reply on accuracy (no made-up facts), language fit and tone, and checks the "needs you" call.

We ran the same 55 messages through 8 SERV models (`data/model-comparison.json`):

| Model on SERV | Avg grade | "Needs you" right | Cost per reply |
|---|---:|---:|---:|
| **gemini-3.8-flash** (chosen) | **87.6** | **54/55** | $0.0016 |
| gemini-3-flash-preview | 84.7 | 51/54 | $0.0011 |
| serv-mini | 82.0 | 47/55 | $0.0018 |
| gpt-6-luna | 81.3 | 49/55 | $0.0003 |
| gpt-5.4-mini | 80.1 | 47/55 | $0.0018 |
| claude-haiku-4.5 | 76.2 | 53/55 | $0.0027 |
| gemini-3.5-flash-lite | 74.7 | 51/55 | $0.0008 |
| gemini-3.1-flash-lite | 74.7 | 50/55 | $0.0006 |

The full results for the chosen model, every reply included, are in `data/results-gemini-3.8-flash.json` and on the site.

## Business

At well under a cent per reply, a seller who gets 100 messages a day costs about ₱10 a month in AI credits. Planned pricing: free for 20 replies a day, ₱199 / S$6 a month for unlimited replies. Next up: drafts that appear directly inside Messenger and Instagram, then Shopee and Lazada chat.

## Run it

```bash
npm install
export SERV_API_KEY=...          # from console.openserv.ai
npm run reply -- phone "may stock pa ba ng sage for s24 ultra?"
npm run benchmark -- gemini-3.8-flash      # all 55 messages, writes data/results-<model>.json
npm run build                               # static site into out/
```

On Vercel, import the repo and set `SERV_API_KEY`. The site is served from `out/`, and the live demo calls `api/reply.ts`, which is rate-limited per visitor and per day.

| Path | What it is |
|---|---|
| `src/reply.ts` | The reply engine: instructions, JSON schema, the "needs you" rules |
| `src/serv.ts` | SERV Reasoning client with real per-call cost from SERV's price list |
| `api/reply.ts` | Live demo endpoint (Vercel function) |
| `scripts/benchmark.ts` | Runs and grades all test messages |
| `data/` | Sample shops, test messages, results, model comparison |
| `site/index.html` | The page |

/** Try one message: npm run reply -- <shopId> "<message>" [model] */
import { readFileSync } from "node:fs";
import { writeReply, type Shop } from "../src/reply.js";

const [shopId, message, model] = process.argv.slice(2);
const shops = JSON.parse(readFileSync("data/shops.json", "utf8")) as (Shop & { id: string; starter: string })[];
const shop = shops.find((s) => s.id === shopId) ?? shops[0];
const r = await writeReply(shop, message || shop.starter, model);
console.log(JSON.stringify(r, null, 2));

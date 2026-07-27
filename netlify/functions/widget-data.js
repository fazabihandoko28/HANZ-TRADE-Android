import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=1800",
  "access-control-allow-origin": "*"
};

const UAE_GOLD_URL = "https://dubaicityofgold.com/";
const ANTAM_URL = "https://www.logammulia.com/harga-emas-hari-ini";
const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=IDR,AED";

export default async () => {
  const now = new Date();
  const store = getStore("hanz-widget-history");
  const saved = await store.get("latest", { type: "json" }).catch(() => null);
  const lastGood = saved?.current || null;

  try {
    const results = await Promise.allSettled([
      fetchFx(), fetchUaeGold(), fetchAntam(), fetchCandidates()
    ]);

    const fx = settledValue(results[0], null);
    const uaeGold = settledValue(results[1], lastGood?.uae_gold_24k);
    const antamGold = settledValue(results[2], lastGood?.antam_gold_1g);
    const candidates = settledValue(results[3], saved?.bei_candidates || []);

    const usdIdr = fx?.usdIdr ?? lastGood?.usd_idr;
    const aedIdr = fx?.aedIdr ?? lastGood?.aed_idr;
    requirePositive("USD/IDR", usdIdr);
    requirePositive("AED/IDR", aedIdr);
    requirePositive("UAE Gold 24K", uaeGold);
    requirePositive("ANTAM 1g", antamGold);

    const dateKey = localDateKey(now, "Asia/Dubai");
    const prior = saved?.date === dateKey
      ? saved.previous
      : saved?.current || saved?.previous || null;

    const current = {
      usd_idr: Number(usdIdr),
      aed_idr: Number(aedIdr),
      uae_gold_24k: Number(uaeGold),
      antam_gold_1g: Number(antamGold)
    };

    const sourceStatus = {
      fx: resultStatus(results[0], Boolean(lastGood?.usd_idr)),
      uae_gold_24k: resultStatus(results[1], Boolean(lastGood?.uae_gold_24k)),
      antam_gold_1g: resultStatus(results[2], Boolean(lastGood?.antam_gold_1g)),
      bei_candidates: resultStatus(results[3], Boolean(saved?.bei_candidates))
    };
    const stale = Object.values(sourceStatus).some(v => v !== "live");

    const payload = {
      schema_version: 2,
      updated: now.toISOString(),
      timezone: "Asia/Dubai",
      stale,
      usd_idr: metric(current.usd_idr, prior?.usd_idr),
      aed_idr: metric(current.aed_idr, prior?.aed_idr),
      uae_gold_24k: metric(current.uae_gold_24k, prior?.uae_gold_24k),
      antam_gold_1g: metric(current.antam_gold_1g, prior?.antam_gold_1g),
      bei_candidates: candidates,
      source_status: sourceStatus,
      sources: {
        fx: "Frankfurter daily reference rates",
        uae_gold_24k: "Dubai Jewellery Group suggested retail rate",
        antam_gold_1g: "ANTAM Logam Mulia official retail price",
        bei_candidates: process.env.HANZ_CANDIDATES_URL ? "HANZ Intelligence Engine" : "Repository fallback"
      }
    };

    await store.setJSON("latest", {
      date: dateKey,
      current,
      previous: prior,
      bei_candidates: candidates,
      updated: payload.updated
    });

    return json(payload, 200);
  } catch (error) {
    if (lastGood) {
      const emergency = {
        schema_version: 2,
        updated: saved?.updated || now.toISOString(),
        timezone: "Asia/Dubai",
        stale: true,
        usd_idr: metric(lastGood.usd_idr, saved?.previous?.usd_idr),
        aed_idr: metric(lastGood.aed_idr, saved?.previous?.aed_idr),
        uae_gold_24k: metric(lastGood.uae_gold_24k, saved?.previous?.uae_gold_24k),
        antam_gold_1g: metric(lastGood.antam_gold_1g, saved?.previous?.antam_gold_1g),
        bei_candidates: saved?.bei_candidates || [],
        source_status: { fx: "cached", uae_gold_24k: "cached", antam_gold_1g: "cached", bei_candidates: "cached" },
        warning: error instanceof Error ? error.message : String(error)
      };
      return json(emergency, 200, "public, max-age=60");
    }
    return json({
      error: "WIDGET_DATA_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
      updated: now.toISOString()
    }, 503, "no-store");
  }
};

function json(value, status, cacheControl = HEADERS["cache-control"]) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { ...HEADERS, "cache-control": cacheControl }
  });
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function resultStatus(result, hasFallback) {
  if (result.status === "fulfilled") return "live";
  return hasFallback ? "cached" : "unavailable";
}

function requirePositive(label, value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error(`${label} unavailable`);
}

function localDateKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function metric(price, previous) {
  const validPrice = Number(price);
  const validPrevious = Number(previous);
  const changePct = Number.isFinite(validPrevious) && validPrevious > 0
    ? ((validPrice - validPrevious) / validPrevious) * 100
    : 0;
  return {
    price: round(validPrice, validPrice >= 1000 ? 0 : 2),
    previous: Number.isFinite(validPrevious) ? round(validPrevious, validPrevious >= 1000 ? 0 : 2) : null,
    change_pct: round(changePct, 2)
  };
}

async function fetchFx() {
  const data = await getJson(FX_URL);
  const idr = Number(data?.rates?.IDR);
  const aed = Number(data?.rates?.AED);
  if (!Number.isFinite(idr) || !Number.isFinite(aed) || aed <= 0) throw new Error("FX source returned invalid rates");
  return { usdIdr: idr, aedIdr: idr / aed };
}

async function fetchUaeGold() {
  if (process.env.UAE_GOLD_24K_OVERRIDE) return Number(process.env.UAE_GOLD_24K_OVERRIDE);
  const html = await getText(UAE_GOLD_URL);
  const patterns = [
    /24K\s*Gold[^\d]{0,100}(?:AED|Dh)\s*([\d,.]+)/i,
    /24K[^\d]{0,100}(?:AED|Dh)\s*([\d,.]+)/i,
    /(?:AED|Dh)\s*([\d,.]+)[^<]{0,100}24K/i
  ];
  const price = firstNumber(html, patterns, "decimal");
  if (!price) throw new Error("Unable to parse UAE 24K gold price");
  return price;
}

async function fetchAntam() {
  if (process.env.ANTAM_GOLD_1G_OVERRIDE) return Number(process.env.ANTAM_GOLD_1G_OVERRIDE);
  const html = await getText(ANTAM_URL);
  const compact = html.replace(/\s+/g, " ");
  const patterns = [
    /1\s*(?:gr|gram)[^\d]{0,180}(?:Rp\s*)?([\d.]{7,})/i,
    /(?:weight|berat)[^>]*>\s*1\s*(?:gr|gram)[\s\S]{0,350}?(?:Rp\s*)?([\d.]{7,})/i,
    /1\s*gr[\s\S]{0,300}?([1-9]\d{0,2}(?:\.\d{3}){2,})/i
  ];
  const price = firstNumber(compact, patterns, "idr");
  if (!price) throw new Error("Unable to parse ANTAM 1 gram price");
  return price;
}

async function fetchCandidates() {
  if (process.env.HANZ_CANDIDATES_URL) {
    const data = await getJson(process.env.HANZ_CANDIDATES_URL);
    const raw = data.bei_candidates || data.candidates || data.strong_candidates || [];
    return normalizeCandidates(raw);
  }
  try {
    const file = path.resolve(process.cwd(), "public/bei-candidates.json");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    return normalizeCandidates(data.candidates || []);
  } catch {
    return [];
  }
}

function normalizeCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === "string" ? item : item?.symbol)
    .filter(Boolean)
    .map(v => String(v).trim().toUpperCase().replace(/\.JK$/, ""))
    .filter(v => /^[A-Z0-9]{2,8}$/.test(v))
    .slice(0, 8);
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; HANZ-Trade/1.3; +https://hanz-trade.netlify.app)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json", "user-agent": "HANZ-Trade/1.3" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function firstNumber(text, patterns, mode) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    const normalized = mode === "idr"
      ? raw.replace(/\./g, "").replace(/,/g, "")
      : raw.includes(",") && raw.includes(".")
        ? raw.replace(/,/g, "")
        : raw.replace(",", ".");
    const number = Number(normalized);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

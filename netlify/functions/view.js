// netlify/functions/view.mjs — Netlify Functions v2
import { ethers } from "ethers";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- helpers: timeouts ---
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms)),
  ]);

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Probe a PDF URL (HEAD or 1-byte GET for gateways that don’t support HEAD)
async function probePdf(url) {
  try {
    let r = await fetchWithTimeout(url, { method: "HEAD" }, 7000);
    if (r.ok) {
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return true;
    }
    r = await fetchWithTimeout(url, { method: "GET", headers: { Range: "bytes=0-0" } }, 7000);
    if (r.ok) {
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return true;
    }
  } catch (_) {}
  return false;
}

export default async function handler(req) {
  try {
    const {
      RPC_URL,
      NFT_CONTRACT,
      DOCS_CID,
      GATEWAY_URL,
      DOCS_FILE,   // e.g. "report.pdf" or "docs/report.pdf"
      TOKEN_ID,    // optional (ERC-1155)
    } = process.env;

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json({ error: "Missing env vars: RPC_URL, NFT_CONTRACT, DOCS_CID" }, 500);
    }

    const url = new URL(req.url);

    // GET: nonce/health
    if (req.method === "GET") {
      if (url.searchParams.get("nonce")) {
        const nonce = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
        return json({ nonce });
      }
      return json({ ok: true });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Parse input
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    const { address, message, signature } = body || {};
    if (!address || !message || !signature) {
      return json({ error: "Missing address/message/signature" }, 400);
    }

    // Verify signature
    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== address.toLowerCase()) {
      return json({ error: "Invalid signature" }, 401);
    }

    // On-chain check (with timeout)
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let hasToken = false;

    try {
      if (TOKEN_ID) {
        // ERC-1155
        const abi1155 = ["function balanceOf(address account, uint256 id) view returns (uint256)"];
        const c1155 = new ethers.Contract(NFT_CONTRACT, abi1155, provider);
        const bal = await withTimeout(
          c1155.balanceOf(address, ethers.toBigInt(TOKEN_ID)),
          8000, "RPC"
        );
        hasToken = bal > 0n;
      } else {
        // ERC-721
        const abi721 = ["function balanceOf(address owner) view returns (uint256)"];
        const c721 = new ethers.Contract(NFT_CONTRACT, abi721, provider);
        const bal = await withTimeout(
          c721.balanceOf(address),
          8000, "RPC"
        );
        hasToken = bal > 0n;
      }
    } catch (e) {
      return json({ error: `RPC failure: ${e.message || e}` }, 504);
    }

    if (!hasToken) return json({ error: "No eligible token" }, 403);

    // Build URL
    const gw = (GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/+$/,"");
    const base = `${gw}/${DOCS_CID}`;

    // Prefer explicit DOCS_FILE
    if (DOCS_FILE) {
      const url = `${base}/${DOCS_FILE.replace(/^\/+/, "")}`;
      const ok = await probePdf(url);
      if (!ok) return json({ error: "DOCS_FILE not found at CID", tried: [url] }, 404);
      return json({ url });
    }

    // Fallback: try common names
    const candidates = [
      `${base}/index.pdf`,
      `${base}/report.pdf`,
      `${base}/document.pdf`,
      `${base}/docs/index.pdf`,
      `${base}/pdf/index.pdf`,
      `${base}/BACON.pdf`,
      `${base}/private.pdf`,
      base
    ];

    for (const u of candidates) {
      if (await probePdf(u)) return json({ url: u });
    }

    return json({ error: "PDF not found in CID", tried: candidates }, 404);

  } catch (e) {
    console.error("VIEW_FN_ERROR:", e);
    return new Response("Internal Error: " + (e?.message || String(e)), {
      status: 500, headers: { "content-type": "text/plain" }
    });
  }
}

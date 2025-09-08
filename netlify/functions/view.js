// netlify/functions/view.mjs — Netlify Functions v2
import { ethers } from "ethers";

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// HEAD (или Range-GET) для проверки существования PDF
async function probePdf(url) {
  try {
    // сначала HEAD
    let r = await fetch(url, { method: "HEAD" });
    if (r.ok) {
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) return true;
    }
    // некоторые шлюзы не поддерживают HEAD — пробуем запросить 1 байт
    r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
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
      DOCS_FILE,   // опционально: точный путь внутри CID (например, "docs/report.pdf")
      TOKEN_ID,    // опционально: для ERC-1155
    } = process.env;

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return j({ error: "Missing env vars: RPC_URL, NFT_CONTRACT, DOCS_CID" }, 500);
    }

    const u = new URL(req.url);

    // GET → nonce/health
    if (req.method === "GET") {
      if (u.searchParams.get("nonce")) {
        const nonce = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
        return j({ nonce });
      }
      return j({ ok: true });
    }

    if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

    // body: { address, message, signature }
    let body;
    try { body = await req.json(); } catch { return j({ error: "Bad JSON" }, 400); }
    const { address, message, signature } = body || {};
    if (!address || !message || !signature) {
      return j({ error: "Missing address/message/signature" }, 400);
    }

    // verify personal_sign
    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== address.toLowerCase()) return j({ error: "Invalid signature" }, 401);

    // onchain ownership check (mainnet)
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    let ok = false;
    if (TOKEN_ID) {
      // ERC-1155
      const abi1155 = ["function balanceOf(address account, uint256 id) view returns (uint256)"];
      const c1155 = new ethers.Contract(NFT_CONTRACT, abi1155, provider);
      const bal = await c1155.balanceOf(address, ethers.toBigInt(TOKEN_ID));
      ok = bal > 0n;
    } else {
      // ERC-721
      const abi721 = ["function balanceOf(address owner) view returns (uint256)"];
      const c721 = new ethers.Contract(NFT_CONTRACT, abi721, provider);
      const bal = await c721.balanceOf(address);
      ok = bal > 0n;
    }
    if (!ok) return j({ error: "No eligible token" }, 403);

    // Build URL candidates
    const gw = (GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/+$/,"");
    const base = `${gw}/${DOCS_CID}`;

    // 1) Если задан DOCS_FILE — используем его
    const candidates = [];
    if (DOCS_FILE) candidates.push(`${base}/${DOCS_FILE.replace(/^\/+/, "")}`);

    // 2) Иначе пробуем типовые имена/пути
    candidates.push(
      `${base}/index.pdf`,
      `${base}/report.pdf`,
      `${base}/document.pdf`,
      `${base}/docs/index.pdf`,
      `${base}/pdf/index.pdf`,
      `${base}/BACON.pdf`,
      `${base}/private.pdf`
    );

    // 3) На всякий случай — сам корень (если CID указывает на одиночный PDF)
    candidates.push(base);

    // Проверяем кандидатов
    for (const url of candidates) {
      if (await probePdf(url)) return j({ url });
    }

    return j({
      error: "PDF not found in CID",
      tried: candidates
    }, 404);

  } catch (e) {
    console.error("VIEW_FN_ERROR:", e);
    return new Response("Internal Error: " + (e?.message || String(e)), {
      status: 500,
      headers: { "content-type": "text/plain" }
    });
  }
}

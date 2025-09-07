// netlify/functions/view.js
// Netlify Functions v2 (ESM). Return Web-API Response.

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const RPC_URL      = process.env.RPC_URL;      // Your Ethereum RPC (Alchemy/Infura/etc.)
const NFT_CONTRACT = process.env.NFT_CONTRACT; // BACON NFT contract address (ERC-721/1155)
const DOCS_CID     = process.env.DOCS_CID;     // IPFS CID with documents
const GATEWAY_URL  = (process.env.GATEWAY_URL || "https://cloudflare-ipfs.com/ipfs").replace(/\/$/, "");

// Response helpers
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

// Minimal ERC-721 balanceOf via raw JSON-RPC eth_call (no external libs)
async function erc721BalanceOf(rpcUrl, contract, owner) {
  const selector = "0x70a08231"; // keccak256("balanceOf(address)") first 4 bytes
  const addr = owner.toLowerCase().replace(/^0x/, "");
  const data = selector + addr.padStart(64, "0");

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: contract, data }, "latest"],
  };

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`RPC error: ${res.status} ${res.statusText}`);
  }
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC returned error");

  const hex = j.result || "0x0";
  return BigInt(hex);
}

export default async (req, ctx) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json({ error: "Server misconfigured: missing env vars" }, 500);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const address = (body?.address || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return json({ error: "Bad address" }, 400);
    }

    // Optional: add signature verification here if you want.
    const bal = await erc721BalanceOf(RPC_URL, NFT_CONTRACT, address);
    if (bal <= 0n) {
      return json({ error: "You do not hold the required NFT" }, 403);
    }

    const url = `${GATEWAY_URL}/${DOCS_CID}`;
    return json({ ok: true, url }, 200);
  } catch (e) {
    return json({ error: e?.message || "Internal error" }, 500);
  }
};

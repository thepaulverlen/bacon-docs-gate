// netlify/functions/view.js — Functions v2 (ESM). Returns the PDF (binary) on success.
export default async function handler(req) {
  const JSON = { "content-type": "application/json; charset=utf-8" };

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: JSON });
    }

    const RPC_URL      = process.env.RPC_URL;
    const NFT_CONTRACT = process.env.NFT_CONTRACT;
    const DOCS_CID     = process.env.DOCS_CID;
    const GATEWAY      = (process.env.GATEWAY_URL || "https://w3s.link/ipfs").replace(/\/+$/,"");

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500, headers: JSON });
    }

    let body;
    try { body = await req.json(); } catch {}
    const address = (body?.address || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return new Response(JSON.stringify({ error: "Bad address" }), { status: 400, headers: JSON });
    }

    // ERC-721 balanceOf(address): 0x70a08231 + padded address
    const data = "0x70a08231" + address.slice(2).padStart(64, "0");
    const payload = { jsonrpc:"2.0", id:1, method:"eth_call", params:[{ to: NFT_CONTRACT, data }, "latest"] };

    const rpc = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!rpc.ok) {
      return new Response(JSON.stringify({ error: "RPC failed" }), { status: 502, headers: JSON });
    }
    const j = await rpc.json();
    const bal = BigInt(j?.result || "0x0");
    if (bal <= 0n) {
      return new Response(JSON.stringify({ error: "No required NFT" }), { status: 403, headers: JSON });
    }

    // Fetch PDF from IPFS and return as binary
    const ipfs = await fetch(`${GATEWAY}/${DOCS_CID}`);
    if (!ipfs.ok) {
      return new Response(JSON.stringify({ error: "IPFS fetch error" }), { status: 502, headers: JSON });
    }
    const ab = await ipfs.arrayBuffer();

    return new Response(ab, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="docs.pdf"',
        "cache-control": "no-store, no-cache, must-revalidate",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), { status: 500, headers: JSON });
  }
}

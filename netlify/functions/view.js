// Netlify Functions v2 — uses Fetch API Response
import { ethers } from "ethers";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req) {
  try {
    const {
      RPC_URL,
      NFT_CONTRACT,
      DOCS_CID,
      GATEWAY_URL,
      DOCS_FILE,
      TOKEN_ID, // optional for ERC1155
    } = process.env;

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json({ error: "Missing env vars: RPC_URL, NFT_CONTRACT, DOCS_CID" }, 500);
    }

    const url = new URL(req.url);

    // GET for nonce/health
    if (req.method === "GET") {
      if (url.searchParams.get("nonce")) {
        const nonce = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
        return json({ nonce });
      }
      return json({ ok: true });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Expect: { address, message, signature }
    let payload;
    try { payload = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

    const { address, message, signature } = payload || {};
    if (!address || !message || !signature) {
      return json({ error: "Missing address/message/signature" }, 400);
    }

    // Verify personal_sign
    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== address.toLowerCase()) {
      return json({ error: "Invalid signature" }, 401);
    }

    // Check ownership on mainnet
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    let hasToken = false;
    if (TOKEN_ID) {
      // ERC-1155 check
      const abi1155 = ["function balanceOf(address account, uint256 id) view returns (uint256)"];
      const c1155 = new ethers.Contract(NFT_CONTRACT, abi1155, provider);
      const bal = await c1155.balanceOf(address, ethers.toBigInt(TOKEN_ID));
      hasToken = bal > 0n;
    } else {
      // ERC-721 check
      const abi721 = ["function balanceOf(address owner) view returns (uint256)"];
      const c721 = new ethers.Contract(NFT_CONTRACT, abi721, provider);
      const bal = await c721.balanceOf(address);
      hasToken = bal > 0n;
    }

    if (!hasToken) return json({ error: "No eligible token" }, 403);

    // Build doc URL
    const gateway = GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
    const filePath = DOCS_FILE || "index.pdf"; // set DOCS_FILE env if different
    const docUrl = `${gateway}/${DOCS_CID}/${filePath}`;

    return json({ url: docUrl });
  } catch (e) {
    console.error("VIEW_FN_ERROR:", e);
    return new Response("Internal Error: " + (e?.message || String(e)), {
      status: 500, headers: { "content-type": "text/plain" }
    });
  }
}

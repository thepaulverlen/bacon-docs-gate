// netlify/functions/view.mjs — Functions v2 (return Web Fetch API Response)
import { ethers } from "ethers";

// helper for JSON responses
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req, ctx) {
  try {
    const { RPC_URL, NFT_CONTRACT, DOCS_CID, GATEWAY_URL } = process.env;

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json(
        { error: "Missing env vars: RPC_URL, NFT_CONTRACT, DOCS_CID" },
        500
      );
    }

    const url = new URL(req.url);

    // Health / nonce endpoint
    if (req.method === "GET") {
      if (url.searchParams.get("nonce")) {
        const nonce =
          (globalThis.crypto?.randomUUID?.() ??
            Math.random().toString(36).slice(2)) + "";
        return json({ nonce });
      }
      // Optional health probe
      return json({ ok: true });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Expecting: { address, message, signature }
    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }
    const { address, message, signature } = payload || {};
    if (!address || !message || !signature) {
      return json({ error: "Missing address/message/signature" }, 400);
    }

    // Verify EIP-191 personal_sign message
    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== address.toLowerCase()) {
      return json({ error: "Invalid signature" }, 401);
    }

    // Check NFT ownership on Ethereum mainnet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const abi = ["function balanceOf(address owner) view returns (uint256)"];
    const contract = new ethers.Contract(NFT_CONTRACT, abi, provider);
    const bal = await contract.balanceOf(address);
    if (bal === 0n) {
      return json({ error: "No eligible token" }, 403);
    }

    // Build document URL
    const gateway = GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
    // CHANGE FILE NAME HERE if needed:
    const filePath = "index.pdf"; // e.g. "report.pdf" or "docs/index.pdf"
    const docUrl = `${gateway}/${DOCS_CID}/${filePath}`;

    return json({ url: docUrl });
  } catch (e) {
    return new Response(
      "Internal Error: " + (e?.message || String(e)),
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }
}

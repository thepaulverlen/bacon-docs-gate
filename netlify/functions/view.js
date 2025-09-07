// Netlify Function: POST /api/view → возвращает PDF (inline), если адрес владеет NFT
const { ethers } = require("ethers");

const NFT_CONTRACT = "0x1c1509ED7DF9eFB38C513089964C400380f8B704";
const RPC_URL = process.env.RPC_URL;    // Alchemy/Infura HTTPS
const DOCS_CID = process.env.DOCS_CID;  // CID PDF из Pinata (bafy..., без ipfs://)
const GATEWAY = process.env.GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!RPC_URL || !DOCS_CID) return { statusCode: 500, body: "Missing env vars" };

    const { message, signature } = JSON.parse(event.body || "{}");
    if (!message || !signature) return { statusCode: 400, body: "Bad Request" };

    let address;
    try { address = ethers.utils.verifyMessage(message, signature); }
    catch { return { statusCode: 400, body: "Invalid signature" }; }

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const abi = ["function balanceOf(address) view returns (uint256)"];
    const nft = new ethers.Contract(NFT_CONTRACT, abi, provider);
    const bal = await nft.balanceOf(address);
    if (bal.isZero()) return { statusCode: 403, body: "Forbidden" };

    const r = await fetch(`${GATEWAY}/${DOCS_CID}`);
    if (!r.ok) return { statusCode: 502, body: "Upstream error" };
    const buf = Buffer.from(await r.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="docs.pdf"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "frame-ancestors 'self';",
        "X-Content-Type-Options": "nosniff"
      },
      isBase64Encoded: true,
      body: buf.toString("base64")
    };
  } catch {
    return { statusCode: 500, body: "Server error" };
  }
};

// netlify/functions/view.js
const ABI_BALANCE_OF = '0x70a08231'; // keccak256("balanceOf(address)") first 4 bytes

export default async function handler(req) {
  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    const { address } = await req.json().catch(() => ({}));
    if (!address || typeof address !== 'string') {
      return json({ error: 'Bad request: address is required' }, 400);
    }

    const RPC_URL      = process.env.RPC_URL;
    const NFT_CONTRACT = (process.env.NFT_CONTRACT || '').toLowerCase();
    const DOCS_CID     = process.env.DOCS_CID;
    const GATEWAY      = process.env.GATEWAY_URL || 'https://cloudflare-ipfs.com/ipfs';

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json({ error: 'Server is not configured (missing env vars).' }, 500);
    }

    // --- Проверка владения ERC-721 через balanceOf(address) ---
    const addrNoPrefix = address.replace(/^0x/i, '').padStart(64, '0');
    const data = ABI_BALANCE_OF + addrNoPrefix;

    const rpcBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        { to: NFT_CONTRACT, data },
        'latest'
      ]
    };

    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcBody)
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ error: `RPC error: ${t.slice(0, 160)}` }, 502);
    }

    const payload = await r.json();
    const hex = payload?.result;
    if (!hex || !hex.startsWith('0x')) {
      return json({ error: 'Invalid RPC response' }, 502);
    }

    // Преобразуем hex в BigInt и проверим, что баланс > 0
    const balance = BigInt(hex);
    if (balance <= 0n) {
      return json({ error: 'Access denied: no BACON NFT found on this address.' }, 403);
    }

    // OK — формируем ссылку на документы
    const url = `${GATEWAY}/${DOCS_CID}`;
    return json({ url }, 200);

  } catch (e) {
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}

// Утилита для корректного JSON-ответа в Functions v2
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

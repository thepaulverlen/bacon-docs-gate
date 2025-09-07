// netlify/functions/view.js
// Node 18+ (у Netlify fetch есть из коробки)

exports.handler = async (event) => {
  try {
    // Разрешим и GET, и POST
    let address = '';
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.rawQuery || '');
      address = (params.get('address') || '').trim().toLowerCase();
    } else if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      address = (body.address || '').trim().toLowerCase();
    } else {
      return json(405, 'Method Not Allowed');
    }

    // Базовая валидация адреса
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return json(400, 'Bad Request: invalid address');
    }

    // Переменные окружения
    const RPC_URL = process.env.RPC_URL;                  // ваш Alchemy/Infura RPC
    const NFT_CONTRACT = (process.env.NFT_CONTRACT || '').toLowerCase(); // адрес BACON NFT
    const DOCS_CID = process.env.DOCS_CID;               // CID PDF
    const GATEWAY_URL = (process.env.GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs').replace(/\/+$/,'');

    if (!RPC_URL || !NFT_CONTRACT || !DOCS_CID) {
      return json(500, 'Server misconfigured: RPC_URL / NFT_CONTRACT / DOCS_CID required');
    }

    // ===== Проверка наличия NFT через balanceOf(address) =====
    // 0x70a08231 = keccak("balanceOf(address)") первые 4 байта
    const methodId = '0x70a08231';
    const addrNo0x = address.slice(2).padStart(64, '0');
    const data = methodId + addrNo0x;

    const rpcRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: NFT_CONTRACT, data }, 'latest']
      })
    });

    if (!rpcRes.ok) {
      const t = await rpcRes.text().catch(()=> '');
      return json(502, 'RPC error: ' + t);
    }

    const rpcJson = await rpcRes.json();
    const hex = (rpcJson && rpcJson.result) || '0x0';
    const balance = BigInt(hex);

    if (balance <= 0n) {
      return json(403, 'Forbidden: no required NFT');
    }

    // ===== Доступ есть — отдаем PDF с IPFS =====
    const pdfUrl = `${GATEWAY_URL}/${DOCS_CID}`;
    const ipfsRes = await fetch(pdfUrl);

    if (!ipfsRes.ok) {
      const t = await ipfsRes.text().catch(()=> '');
      return json(502, 'IPFS fetch error: ' + t);
    }

    const ab = await ipfsRes.arrayBuffer();
    const base64 = Buffer.from(ab).toString('base64');
    // Попробуем взять content-type от шлюза, fallback — pdf
    const ctype = ipfsRes.headers.get('content-type') || 'application/pdf';

    return {
      statusCode: 200,
      headers: {
        'content-type': ctype,
        'cache-control': 'no-store',
      },
      isBase64Encoded: true,
      body: base64
    };

  } catch (err) {
    return json(500, 'Unexpected error: ' + (err && err.message || String(err)));
  }
};

function json(code, message) {
  return {
    statusCode: code,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: message
  };
}

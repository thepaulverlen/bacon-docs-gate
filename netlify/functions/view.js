// netlify/functions/view.js
// Универсальный обработчик: принимает POST/GET/OPTIONS, отвечает JSON.
// Проверяет наличие токена BACON (ERC-721) на адресе, и если ок — отдаёт ссылку на PDF в IPFS.

export default async (event) => {
  // Общие заголовки (и на всякий случай CORS)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    // 1) Preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }

    // 2) Считываем env
    const RPC_URL     = process.env.RPC_URL;
    const DOCS_CID    = process.env.DOCS_CID;
    const NFT_CONTRACT= process.env.NFT_CONTRACT;
    const GATEWAY_URL = process.env.GATEWAY_URL || 'https://cloudflare-ipfs.com/ipfs';

    if (!RPC_URL || !DOCS_CID || !NFT_CONTRACT) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          ok: false,
          error: 'Server misconfigured: missing RPC_URL, DOCS_CID or NFT_CONTRACT',
        }),
      };
    }

    // 3) Берём адрес из POST JSON либо из query (на случай GET)
    let address;
    if (event.httpMethod === 'POST') {
      try {
        const body = JSON.parse(event.body || '{}');
        address = (body.address || '').toLowerCase();
      } catch {
        // пусто — address останется undefined
      }
    } else if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.rawQuery || '');
      address = (params.get('address') || '').toLowerCase();
    } else {
      // Любой другой метод — 405, но без крашей
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
      };
    }

    if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, error: 'Invalid or missing address' }),
      };
    }

    // 4) Проверяем баланс ERC-721: balanceOf(address)
    //    сигнатура 0x70a08231 + адрес без 0x (паддинг до 32 байт)
    const data = '0x70a08231' + address.slice(2).padStart(64, '0');

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        { to: NFT_CONTRACT, data },
        'latest',
      ],
    };

    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ ok: false, error: 'RPC request failed' }),
      };
    }

    const j = await r.json();
    const hex = j?.result;
    if (!hex || !hex.startsWith('0x')) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: false, error: 'No result from contract' }),
      };
    }

    const balance = BigInt(hex);
    if (balance === 0n) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: false, error: 'No required NFT on this address' }),
      };
    }

    // 5) Ок — отдаём ссылку на документ
    const url = `${GATEWAY_URL.replace(/\/+$/,'')}/${DOCS_CID}`;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, url }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }),
    };
  }
};

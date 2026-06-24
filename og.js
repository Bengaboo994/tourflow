// Netlify function: /.netlify/functions/og
// Fetches a property listing URL and extracts as much data as possible.
// Supports: reveny.es, idealista.com, fotocasa.es, kyero.com, and generic OG tags.

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9'
      },
      redirect: 'follow'
    });
    const html = await res.text();

    // ── HELPERS ──────────────────────────────────────────────────────────
    function og(prop) {
      const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
             || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + prop + '["\']', 'i'));
      return m ? m[1].trim() : null;
    }
    function meta(name) {
      const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'));
      return m ? m[1].trim() : null;
    }
    function between(str, start, end) {
      const si = str.indexOf(start);
      if (si < 0) return null;
      const ei = str.indexOf(end, si + start.length);
      if (ei < 0) return null;
      return str.slice(si + start.length, ei).trim();
    }
    function firstMatch(patterns) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m) return m[1].trim();
      }
      return null;
    }
    function cleanPrice(s) {
      if (!s) return null;
      // Keep only digits and separators, format nicely
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num || num < 10000) return null;
      return '€' + num.toLocaleString('en-US');
    }
    function cleanNum(s) {
      if (!s) return null;
      const m = s.match(/\d+/);
      return m ? m[0] : null;
    }

    // ── IMAGE ─────────────────────────────────────────────────────────────
    const image = og('image') || meta('twitter:image') || null;

    // ── TITLE ─────────────────────────────────────────────────────────────
    let title = og('title') || meta('twitter:title') || null;
    // Clean up common suffixes
    if (title) {
      title = title
        .replace(/\s*[\|\-–]\s*(Reveny|Idealista|Fotocasa|Kyero|Inmobiliaria).*$/i, '')
        .replace(/\s*(till salu|for sale|en venta|à vendre)\s*,?\s*/i, '')
        .trim();
      // If title is just area + location like "Altea Hills   Altea Hills, Alicante"
      // take just the first part
      title = title.split(/\s{2,}/)[0].trim();
    }

    // ── PRICE ─────────────────────────────────────────────────────────────
    const rawPrice = firstMatch([
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /€\s*([\d\s\.]+)/,
      /"price"\s*:\s*"?([\d\.]+)"?/,
      /precio[^>]*>\s*([€\d\s\.]+)/i,
      /pris[^>]*>\s*([€\d\s\.]+)/i,
    ]);
    const price = cleanPrice(rawPrice);

    // ── BEDROOMS ─────────────────────────────────────────────────────────
    const rawRooms = firstMatch([
      /(\d+)\s*(?:sovrum|bedroom|dormitorio|chambre)/i,
      /"bedrooms"\s*:\s*(\d+)/i,
      /ob_bed[^>]*>.*?(\d+)/i,
      /class="[^"]*bed[^"]*"[^>]*>\s*(\d+)/i,
    ]);
    const rooms = cleanNum(rawRooms);

    // ── BATHROOMS ─────────────────────────────────────────────────────────
    const rawBath = firstMatch([
      /(\d+)\s*(?:[Bb]adrum|bathroom|ba[ñn]o|salle[s]?\s*de\s*bain)/i,
      /"bathrooms"\s*:\s*(\d+)/i,
      /ob_bath[^>]*>.*?(\d+)/i,
      /class="[^"]*bath[^"]*"[^>]*>\s*(\d+)/i,
    ]);
    const bathrooms = cleanNum(rawBath);

    // ── BUILT SIZE ────────────────────────────────────────────────────────
    const rawSqm = firstMatch([
      /(\d+)\s*m[²2]/i,
      /"buildingArea"\s*:\s*(\d+)/i,
      /ob_floorplan[^>]*>.*?(\d+)/i,
      /construida[^>]*>.*?(\d+)/i,
    ]);
    const sqm = cleanNum(rawSqm);

    // ── AREA / LOCATION ───────────────────────────────────────────────────
    let area = null;
    // Try from OG title — reveny format: "Detached Villa till salu, Altea Hills   Altea Hills, Alicante"
    const ogTitle = og('title') || '';
    const areaFromTitle = ogTitle.match(/,\s*([A-Z][a-zA-Z\s]+?)\s{2,}/);
    if (areaFromTitle) area = areaFromTitle[1].trim();
    // Try from URL
    if (!area) {
      const urlArea = url.match(/\/([a-z-]+)\/r\d+/i);
      if (urlArea) area = urlArea[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    // Generic: look for location in meta description
    if (!area) {
      const desc = og('description') || meta('description') || '';
      const locMatch = desc.match(/(?:in|en|i)\s+([A-Z][a-zA-Z\s,]+?)(?:\.|,|$)/);
      if (locMatch) area = locMatch[1].trim();
    }

    // ── ADDRESS ───────────────────────────────────────────────────────────
    let address = null;
    const addrMatch = html.match(/(?:Calle|Avenida|Carrer|Urb|Urbanización|Plaza|C\.)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/i);
    if (addrMatch) address = addrMatch[0].trim().slice(0, 60);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        image,
        title,
        price,
        rooms,
        bathrooms,
        sqm,
        area,
        address
      })
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Netlify function: /.netlify/functions/og
// Fetches a property listing URL and extracts as much data as possible.

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
    function firstMatch(patterns) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) return m[1].trim();
      }
      return null;
    }
    function cleanPrice(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num || num < 10000) return null;
      return '€' + num.toLocaleString('en-US');
    }
    function cleanNum(s) {
      if (!s) return null;
      const m = s.match(/\d+/);
      return m ? m[0] : null;
    }

    // ── IMAGE (always from OG) ────────────────────────────────────────────
    const image = og('image') || meta('twitter:image') || null;

    // Declare variables for all fields
    let title = null, price = null, rooms = null, bathrooms = null, sqm = null, area = null, address = null;

    // ── REVENY.ES SPECIFIC ────────────────────────────────────────────────
    if (url.includes('reveny.es')) {
      // Title from H1
      const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      title = h1 ? h1[1].trim() : null;

      // Price: "2.950.000EUR"
      const revPrice = firstMatch([/(\d[\d\.]+)\s*EUR/i]);
      price = cleanPrice(revPrice);

      // Sqm: validate 30-2000
      const revSqm = firstMatch([/(\d{2,4})\s*m[²2]/i]);
      if (revSqm) { const n = parseInt(revSqm, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }

      // Rooms: "4 sovrum"
      rooms = cleanNum(firstMatch([/(\d+)\s*sovrum/i]));

      // Bathrooms: "6 Badrum"
      bathrooms = cleanNum(firstMatch([/(\d+)\s*[Bb]adrum/i]));

      // Area from OG title: "Detached Villa till salu, Villamartín   Villamartin, Alicante"
      const ogT = og('title') || '';
      const areaM = ogT.match(/,\s*([^,]+?)\s{2,}/);
      area = areaM ? areaM[1].trim() : null;

      // No address on reveny (seller privacy)
      address = null;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address })
      };
    }

    // ── IDEALISTA.COM SPECIFIC ────────────────────────────────────────────
    if (url.includes('idealista.com')) {
      // Title: area + city from OG title
      // "Casa o chalet independiente en venta en Calle Covadonga, Los Balcones, Torrevieja"
      const ogT = og('title') || '';
      const ideaArea = ogT.match(/(?:en venta en [^,]+,\s*)([^,—]+)/i);
      title = ideaArea ? ideaArea[1].trim() : null;
      if (!title) {
        // Fallback: take city from description
        const descCity = (og('description') || '').match(/Torrevieja|Orihuela|Alicante|Benidorm|Altea|Calpe|Jávea|Murcia|Cartagena/i);
        title = descCity ? descCity[0] : null;
      }

      // Price: "1.800.000 €"
      const ideaPrice = firstMatch([/(\d[\d\.]+)\s*€/, /(\d[\d\.]+)\s*EUR/i]);
      price = cleanPrice(ideaPrice);

      // Sqm: "900 m² construidos"
      const ideaSqm = firstMatch([/(\d{2,4})\s*m[²2]\s*construidos/i, /(\d{2,4})\s*m[²2]/i]);
      if (ideaSqm) { const n = parseInt(ideaSqm, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }

      // Rooms: "7 habitaciones"
      rooms = cleanNum(firstMatch([/(\d+)\s*habitacion/i, /(\d+)\s*hab\./i]));

      // Bathrooms: "7 baños"
      bathrooms = cleanNum(firstMatch([/(\d+)\s*ba[ñn]o/i]));

      // Area: neighbourhood + city
      const areaMatch = (og('description') || '').match(/en\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s\-]+),\s*(Torrevieja|Orihuela|Alicante|Benidorm|Altea|Calpe|Jávea|Murcia)/i);
      area = areaMatch ? areaMatch[1].trim().split(' - ')[0] : null;
      if (!area) area = title;

      // Address: "Calle Covadonga"
      const addrM = (og('title') || '').match(/en venta en\s+([^,]+)/i);
      address = addrM ? addrM[1].trim() : null;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address })
      };
    }
    const ogTitle = og('title') || '';

    // Title
    if (ogTitle) {
      title = ogTitle
        .replace(/\s*[\|\-–]\s*(Reveny|Idealista|Fotocasa|Kyero|Inmobiliaria).*$/i, '')
        .replace(/^(Detached Villa|Semi-detached|Apartment|Villa|Townhouse|Penthouse|Bungalow|Finca)\s+/i, '')
        .replace(/\s*(till salu|for sale|en venta|à vendre)\s*,?\s*/i, '')
        .split(/\s{2,}/)[0].trim();
    }

    // Price
    const rawPrice = firstMatch([
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /€\s*([\d\s\.,']+)(?:\s|<)/,
      /"price"\s*:\s*"?([\d\.]+)"?/,
    ]);
    price = cleanPrice(rawPrice);

    // Bedrooms
    rooms = cleanNum(firstMatch([
      /(\d+)\s*(?:sovrum|bedroom|dormitorio)/i,
      /"bedrooms"\s*:\s*(\d+)/i,
    ]));

    // Bathrooms
    bathrooms = cleanNum(firstMatch([
      /(\d+)\s*(?:[Bb]adrum|bathroom|ba[ñn]o)/i,
      /"bathrooms"\s*:\s*(\d+)/i,
    ]));

    // Sqm
    const rawSqm = firstMatch([/(\d{2,4})\s*m[²2](?!\d)/i, /"buildingArea"\s*:\s*(\d+)/i]);
    if (rawSqm) { const n = parseInt(rawSqm, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }

    // Area from URL
    if (!area) {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const skip = /^(till-salu|for-sale|en-venta|inmueble|property|r\d+|en|es|sv|de|nl|\d+)$/i;
      const areaPart = pathParts.find(p => !skip.test(p) && p.length > 2);
      if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // Address — skip known office addresses
    const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan'];
    const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Plaza|Paseo)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
    for (const m of addrMatches) {
      const candidate = m[0].trim().slice(0, 60);
      const isOffice = officeAddresses.some(o => candidate.toLowerCase().includes(o));
      if (!isOffice) { address = candidate; break; }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address })
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};


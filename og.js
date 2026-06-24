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

    // ── IMAGE ─────────────────────────────────────────────────────────────
    const image = og('image') || meta('twitter:image') || null;

    // ── TITLE ─────────────────────────────────────────────────────────────
    // For reveny.es: OG title = "Detached Villa till salu, Villamartín   Villamartín, Alicante"
    // We want just the location/area part, not the property type
    let title = null;
    const ogTitle = og('title') || '';

    if (ogTitle) {
      // Pattern: "Type till salu, AREA   AREA, Province" — extract AREA
      const revenyMatch = ogTitle.match(/(?:till salu|for sale|en venta)[,\s]+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+?)(?:\s{2,}|\s*,\s*[A-Z])/i);
      if (revenyMatch) {
        title = revenyMatch[1].trim();
      } else {
        // Generic: strip site name and property type prefix
        title = ogTitle
          .replace(/\s*[\|\-–]\s*(Reveny|Idealista|Fotocasa|Kyero|Inmobiliaria).*$/i, '')
          .replace(/^(Detached Villa|Semi-detached|Apartment|Villa|Townhouse|Penthouse|Bungalow|Finca)\s+/i, '')
          .replace(/\s*(till salu|for sale|en venta|à vendre)\s*,?\s*/i, '')
          .split(/\s{2,}/)[0]
          .trim();
      }
    }

    // ── PRICE ─────────────────────────────────────────────────────────────
    const rawPrice = firstMatch([
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /€\s*([\d\s\.,']+)(?:\s|<)/,
      /"price"\s*:\s*"?([\d\.]+)"?/,
      /precio[^>]*>\s*([€\d\s\.]+)/i,
      /pris[^>]*>\s*([€\d\s\.]+)/i,
    ]);
    const price = cleanPrice(rawPrice);

    // ── BEDROOMS ─────────────────────────────────────────────────────────
    const rawRooms = firstMatch([
      /(\d+)\s*(?:sovrum|bedroom|dormitorio|chambre)/i,
      /ob_bed[^"']*["'][^>]*>[\s\S]{0,30}?(\d+)/i,
      /"bedrooms"\s*:\s*(\d+)/i,
      /class="[^"]*bed[^"]*"[^>]*>[\s\S]{0,20}?(\d+)/i,
    ]);
    const rooms = cleanNum(rawRooms);

    // ── BATHROOMS ─────────────────────────────────────────────────────────
    const rawBath = firstMatch([
      /(\d+)\s*[Bb]adrum/i,
      /(\d+)\s*[Bb]athroom/i,
      /(\d+)\s*[Bb]a[ñn]o/i,
      /ob_bath[^"']*["'][^>]*>[\s\S]{0,30}?(\d+)/i,
      /"bathrooms"\s*:\s*(\d+)/i,
    ]);
    const bathrooms = cleanNum(rawBath);

    // ── BUILT SIZE ────────────────────────────────────────────────────────
    // Must be a plausible property size: 30-2000 m²
    // Avoid matching prices or reference numbers
    const rawSqm = firstMatch([
      /(\d{2,4})\s*m[²2](?!\d)/i,          // 2-4 digit number followed by m² 
      /ob_floorplan[^"']*["'][^>]*>[\s\S]{0,50}?(\d{2,4})\s*m/i,
      /"buildingArea"\s*:\s*(\d+)/i,
      /construida[:\s]+(\d{2,4})/i,
      /superficie[:\s]+(\d{2,4})/i,
      /area[:\s]+(\d{2,4})\s*m/i,
    ]);
    // Validate: must be between 30 and 2000
    let sqm = null;
    if (rawSqm) {
      const n = parseInt(rawSqm, 10);
      if (n >= 30 && n <= 2000) sqm = String(n);
    }

    // ── AREA / LOCATION ───────────────────────────────────────────────────
    let area = null;
    // From OG title for reveny.es format
    if (ogTitle) {
      const areaMatch = ogTitle.match(/(?:till salu|for sale|en venta)[,\s]+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+?)(?:\s{2,})/i);
      if (areaMatch) area = areaMatch[1].trim();
    }
    // From URL path — but skip generic words
    if (!area) {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      // Skip parts that are just language codes, listing types, or reference numbers
      const skip = /^(till-salu|for-sale|en-venta|inmueble|property|r\d+|en|es|sv|de|nl|\d+)$/i;
      const areaPart = pathParts.find(p => !skip.test(p) && p.length > 2);
      if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // ── ADDRESS ───────────────────────────────────────────────────────────
    // Only extract if it looks like a property address, not office address
    // Skip if it's the same as known office addresses (Calle Niágara = Reveny office)
    let address = null;
    const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan'];
    const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Plaza|Paseo|C\.|Av\.)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
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


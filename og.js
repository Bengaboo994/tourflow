// Netlify function: /.netlify/functions/og
// Fetches a property listing URL and extracts as much data as possible.

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
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
        'Accept-Language': 'sv,en;q=0.9',
        'Accept-Charset': 'utf-8'
      },
      redirect: 'follow'
    });
    const buffer = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buffer);

    // ── HELPERS ──────────────────────────────────────────────────────────
    function og(prop) {
      const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
             || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + prop + '["\']', 'i'));
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    }
    function meta(name) {
      const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'));
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    }
    function firstMatch(patterns) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) return m[1].trim();
      }
      return null;
    }
    function decodeHtmlEntities(s) {
      if (!s) return s;
      return s
        .replace(/&raquo;/gi, '\u00BB')
        .replace(/&laquo;/gi, '\u00AB')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#039;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    function cleanPrice(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num || num < 10000) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
    function cleanNum(s) {
      if (!s) return null;
      const m = s.match(/\d+/);
      return m ? m[0] : null;
    }

    // ── HIGHLIGHT DETECTION ───────────────────────────────────────────────
    function detectHighlights(text) {
      const t = text.toLowerCase();
      const found = [];
      const rules = [
        [['beach', 'playa', 'strand', 'beachfront', 'walking distance to beach', 'beläget vid stranden', 'nära stranden'], 'Walking distance to beach'],
        [['prime location', 'prime area', 'privileged', 'privilegiada', 'exclusive area', 'prime position'], 'Prime location'],
        [['quiet', 'tranquil', 'tranquila', 'lugnt', 'peaceful', 'privat läge'], 'Quiet area'],
        [['golf', 'golf course', 'campo de golf', 'golfbana'], 'Near golf'],
        [['amenities', 'restaurant', 'shops', 'shopping', 'comercios', 'restaurantes'], 'Close to amenities'],
        [['private pool', 'piscina privada', 'privat pool', 'egen pool', 'heated pool', 'infinity pool'], 'Private pool'],
        [['community pool', 'piscina comunitaria', 'gemensam pool'], 'Community pool'],
        [['garage', 'garaje', 'garaget', 'parking'], 'Garage'],
        [['sea view', 'sea views', 'vistas al mar', 'havsutsikt', 'panoramic sea', 'ocean view', 'mediterranean view'], 'Sea view'],
        [['south facing', 'orientación sur', 'söderläge', 'south-facing', 'orientado al sur'], 'South facing'],
        [['large terrace', 'covered terrace', 'terraza', 'terrass', 'solarium', 'private terrace'], 'Large terrace'],
        [['private garden', 'garden', 'jardín', 'trädgård', 'landscaped'], 'Private garden'],
        [['key ready', 'move-in ready', 'llave en mano', 'inflyttningsklar', 'ready to move'], 'Key ready'],
        [['renovated', 'renoverad', 'reformed', 'reformada', 'newly renovated'], 'Recently renovated'],
        [['excellent condition', 'perfect condition', 'utmärkt skick', 'immaculate'], 'Excellent condition'],
        [['good condition', 'good state', 'buen estado', 'bra skick'], 'Good condition'],
        [['lift', 'elevator', 'ascensor', 'hiss'], 'Lift'],
        [['rental', 'rental income', 'alquiler', 'uthyrning', 'investment potential'], 'Rental potential'],
        [['excellent value', 'great value', 'price reduced', 'reduced price', 'bargain'], 'Excellent value'],
        [['family', 'family-friendly', 'familiar', 'barnvänlig'], 'Family friendly'],
        [['restaurants nearby', 'near restaurants', 'restaurantes cercanos'], 'Restaurants nearby'],
        [['holiday', 'vacation home', 'holiday home', 'semesterbostad'], 'Holiday home potential'],
      ];
      rules.forEach(function(rule) {
        const keywords = rule[0];
        const label = rule[1];
        if (found.indexOf(label) < 0 && keywords.some(k => t.indexOf(k) >= 0)) {
          found.push(label);
        }
      });
      return found;
    }

    // ── IMAGE ─────────────────────────────────────────────────────────────
    const image = og('image') || meta('twitter:image') || null;

    let title = null, price = null, rooms = null, bathrooms = null, sqm = null, area = null, address = null;

    // ── REVENY.ES SPECIFIC ────────────────────────────────────────────────
    if (url.includes('reveny.es')) {
      const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      title = h1 ? h1[1].trim() : null;
      const revPrice = firstMatch([/(\d[\d\.]+)\s*EUR/i]);
      price = cleanPrice(revPrice);
      const revSqm = firstMatch([/(\d{2,4})\s*m[²2]/i]);
      if (revSqm) { const n = parseInt(revSqm, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }
      rooms = cleanNum(firstMatch([/(\d+)\s*sovrum/i]));
      bathrooms = cleanNum(firstMatch([/(\d+)\s*[Bb]adrum/i]));
      const ogT = og('title') || '';
      const areaM = ogT.match(/,\s*([^,]+?)\s{2,}/);
      area = areaM ? areaM[1].trim() : null;
      address = null;
      const highlights = detectHighlights(html);
      return { statusCode: 200, headers, body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights }) };
    }

    // ── GENERIC PARSER ────────────────────────────────────────────────────

    // Title: clean OG title from HTML entities, site names, property type prefixes
    const ogTitle = og('title') || '';  // og() already decodes entities
    if (ogTitle) {
      title = ogTitle
        .replace(/\s*[\|\-–]\s*(Reveny|Idealista|Fotocasa|Kyero|Inmobiliaria|Movr|Skandia|SkandiaMäklarna|Costa Blanca).*$/i, '')
        .replace(/\s*[»›]\s*(Reveny|Idealista|Fotocasa|Kyero|Inmobiliaria|Movr|Skandia|SkandiaMäklarna).*$/i, '')
        .replace(/^(Resale|Detached Villa|Semi-detached|Apartment|Villa|Townhouse|Penthouse|Bungalow|Finca)\s*[»›|\-]?\s*/i, '')
        .replace(/\s*(till salu|for sale|en venta|à vendre)\s*,?\s*/i, '')
        .replace(/\s*[»›]\s*/g, ', ')
        .replace(/\s*\|\s*/g, ', ')
        .replace(/,\s*,/g, ',')
        .trim();
    }

    // Price: try JSON-LD first, then common patterns
    const rawPrice = firstMatch([
      /"price"\s*:\s*"?([\d\.]+)"?/,
      /"Price"\s*:\s*"?([\d\.]+)"?/,
      /itemprop="price"[^>]+content="([\d\.]+)"/i,
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /EUR\s*([\d\s\.,']+)/i,
      /\u20AC\s*([\d\s\.,']+)(?:\s|<)/,
    ]);
    price = cleanPrice(rawPrice);

    // Bedrooms
    rooms = cleanNum(firstMatch([
      /"bedrooms"\s*:\s*(\d+)/i,
      /(\d+)\s*(?:sovrum|bedroom|dormitorio|hab\.)/i,
    ]));

    // Bathrooms
    bathrooms = cleanNum(firstMatch([
      /"bathrooms"\s*:\s*(\d+)/i,
      /(\d+)\s*(?:[Bb]adrum|bathroom|ba[ñn]o)/i,
    ]));

    // Sqm - find all matches, pick the largest valid one (avoids picking terrace/plot size)
    const sqmMatches = [];
    const sqmPatterns = [/"buildingArea"\s*:\s*(\d+)/i, /(\d{2,4})\s*m[²2](?!\d)/gi];
    for (const p of sqmPatterns) {
      let m; const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      while ((m = re.exec(html)) !== null) { const n = parseInt(m[1], 10); if (n >= 50 && n <= 2000) sqmMatches.push(n); }
    }
    if (sqmMatches.length > 0) sqm = String(Math.max(...sqmMatches));

    // Area: extract from URL path — skip generic segments, take the most specific location part
    if (!area) {
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const skip = /^(till-salu|for-sale|en-venta|resale|new-build|inmueble|property|properties|hitta-hem|lagenhet|radhus|villa|townhouse|penthouse|bungalow|finca|house|r\d+|en|es|sv|de|nl|spain|spanien|costa-blanca|costa-calida|costa-del-sol|\d+)$/i;
        // Take the last non-skipped segment (most specific location)
        const locationParts = pathParts.filter(p => !skip.test(p) && p.length > 2);
        const areaPart = locationParts[locationParts.length - 1];
        if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      } catch(e) {}
    }

    // Address — skip known office addresses and generic words
    const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan', 'and villamartin'];
    const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Paseo)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
    for (const m of addrMatches) {
      const candidate = m[0].trim().slice(0, 60);
      const isOffice = officeAddresses.some(o => candidate.toLowerCase().includes(o));
      if (!isOffice) { address = candidate; break; }
    }

    const highlights = detectHighlights(html);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights })
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

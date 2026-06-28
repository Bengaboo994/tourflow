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

    // ── PROPERTY TYPE DETECTION ───────────────────────────────────────────
    function detectPropertyType(text) {
      const t = text.toLowerCase();
      if (/\b(villa)\b/.test(t)) return 'Villa';
      if (/\b(penthouse|atico|ático)\b/.test(t)) return 'Penthouse';
      if (/\b(townhouse|town house|adosado|radhus)\b/.test(t)) return 'Townhouse';
      if (/\b(apartment|apartamento|lägenhet|piso|flat)\b/.test(t)) return 'Apartment';
      if (/\b(finca|cortijo|country house)\b/.test(t)) return 'Finca';
      if (/\b(bungalow)\b/.test(t)) return 'Bungalow';
      if (/\b(duplex|dúplex)\b/.test(t)) return 'Duplex';
      if (/\b(chalet)\b/.test(t)) return 'Chalet';
      return null;
    }

    // ── SMART TITLE GENERATION ────────────────────────────────────────────
    function generateTitle(rawOgTitle, area, detectedRooms, detectedSqm, htmlText) {
      // Detect property type from OG title + full HTML
      const combined = (rawOgTitle || '') + ' ' + htmlText.slice(0, 3000);
      const propType = detectPropertyType(combined);

      // Detect key selling adjectives from OG title + HTML
      const t = combined.toLowerCase();
      const adjectives = [];
      if (/\b(luxury|luxurious|exclusive|exclusiv|lyx)\b/.test(t)) adjectives.push('Luxury');
      else if (/\b(modern|contemporary|contempor)\b/.test(t)) adjectives.push('Modern');
      else if (/\b(traditional|rustic|charming|charmig)\b/.test(t)) adjectives.push('Charming');
      else if (/\b(new build|nueva construcción|nybyggd|newly built)\b/.test(t)) adjectives.push('New Build');

      // Detect key features for title
      const features = [];
      if (/\b(sea view|vistas al mar|havsutsikt|ocean view)\b/.test(t)) features.push('Sea View');
      else if (/\b(golf|golf course)\b/.test(t)) features.push('Golf');
      else if (/\b(beachfront|beach front|first line|primera línea)\b/.test(t)) features.push('Beachfront');
      else if (/\b(private pool|piscina privada|pool)\b/.test(t)) features.push('Pool');

      // Build title: [Adjective] [Type] [with Feature]
      let parts = [];
      if (adjectives.length) parts.push(adjectives[0]);
      if (propType) parts.push(propType);
      if (!propType) parts.push('Property'); // fallback
      if (features.length) parts.push('with ' + features[0]);

      return parts.join(' ');
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
        [['furniture', 'furnished', 'möblerad', 'amueblado'], 'Furniture included'],
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
    if (url.includes('reveny.es') || url.includes('reveny.se')) {
      const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const rawTitle = h1 ? h1[1].trim() : null;
      const revPrice = firstMatch([/(\d[\d\.]+)\s*EUR/i]);
      price = cleanPrice(revPrice);
      const revSqm = firstMatch([/(\d{2,4})\s*m[²2]/i]);
      if (revSqm) { const n = parseInt(revSqm, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }
      rooms = cleanNum(firstMatch([/(\d+)\s*sovrum/i, /(\d+)\s*bedroom/i]));
      bathrooms = cleanNum(firstMatch([/(\d+)\s*[Bb]adrum/i, /(\d+)\s*bathroom/i]));
      const ogT = og('title') || '';
      const areaM = ogT.match(/,\s*([^,]+?)\s{2,}/);
      area = areaM ? areaM[1].trim() : null;
      address = null;
      title = generateTitle(rawTitle || ogT, area, rooms, sqm, html);
      const highlights = detectHighlights(html);
      return { statusCode: 200, headers, body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights }) };
    }

    // ── KYERO SPECIFIC ────────────────────────────────────────────────────
    if (url.includes('kyero.com')) {
      const ogT = og('title') || '';
      const kyeroPrice = firstMatch([/(\d[\d,\.]+)\s*€/, /€\s*(\d[\d,\.]+)/]);
      price = cleanPrice(kyeroPrice);
      rooms = cleanNum(firstMatch([/(\d+)\s*bedroom/i, /(\d+)\s*bed/i]));
      bathrooms = cleanNum(firstMatch([/(\d+)\s*bathroom/i, /(\d+)\s*bath/i]));
      const sqmM = firstMatch([/(\d{2,4})\s*m²/i, /(\d{2,4})\s*sq\.?\s*m/i]);
      if (sqmM) { const n = parseInt(sqmM, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }
      // Extract area from URL
      try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        area = parts.find(p => p.length > 3 && !/^\d+$/.test(p) && p !== 'property')?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || null;
      } catch(e) {}
      title = generateTitle(ogT, area, rooms, sqm, html);
      const highlights = detectHighlights(html);
      return { statusCode: 200, headers, body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights }) };
    }

    // ── RIGHTMOVE SPECIFIC ────────────────────────────────────────────────
    if (url.includes('rightmove.co.uk')) {
      const ogT = og('title') || '';
      price = cleanPrice(firstMatch([/£\s*([\d,]+)/, /(\d[\d,]+)\s*£/])) ||
              cleanPrice(firstMatch([/€\s*([\d,]+)/, /(\d[\d,]+)\s*€/]));
      rooms = cleanNum(firstMatch([/(\d+)\s*bedroom/i]));
      bathrooms = cleanNum(firstMatch([/(\d+)\s*bathroom/i]));
      const sqmM = firstMatch([/(\d{2,4})\s*m²/i, /(\d{3,5})\s*sq\s*ft/i]);
      if (sqmM) { const n = parseInt(sqmM, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }
      try {
        const areaM = ogT.match(/in\s+([A-Za-z\s]+?)(?:\s*[,\|]|$)/i);
        area = areaM ? areaM[1].trim() : null;
      } catch(e) {}
      title = generateTitle(ogT, area, rooms, sqm, html);
      const highlights = detectHighlights(html);
      return { statusCode: 200, headers, body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights }) };
    }

    // ── THINKSPAIN SPECIFIC ───────────────────────────────────────────────
    if (url.includes('thinkspain.com')) {
      const ogT = og('title') || '';
      price = cleanPrice(firstMatch([/€\s*([\d,\.]+)/, /([\d,\.]+)\s*€/, /([\d,\.]+)\s*EUR/i]));
      rooms = cleanNum(firstMatch([/(\d+)\s*bedroom/i, /(\d+)\s*bed/i]));
      bathrooms = cleanNum(firstMatch([/(\d+)\s*bathroom/i, /(\d+)\s*bath/i]));
      const sqmM = firstMatch([/(\d{2,4})\s*m²/i]);
      if (sqmM) { const n = parseInt(sqmM, 10); sqm = (n >= 30 && n <= 2000) ? String(n) : null; }
      try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        area = parts[parts.length - 2]?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || null;
      } catch(e) {}
      title = generateTitle(ogT, area, rooms, sqm, html);
      const highlights = detectHighlights(html);
      return { statusCode: 200, headers, body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights }) };
    }

    // ── GENERIC PARSER ────────────────────────────────────────────────────
    const ogTitle = og('title') || '';

    // Price: try JSON-LD first, then common patterns
    const rawPrice = firstMatch([
      /"price"\s*:\s*"?([\d\.]+)"?/,
      /"Price"\s*:\s*"?([\d\.]+)"?/,
      /itemprop="price"[^>]+content="([\d\.]+)"/i,
      /\u20AC\s*([\d\s\.,\']+)(?:\s|<)/,
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /EUR\s*([\d\s\.,\']+)/i,
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

    // Sqm
    const sqmMatches = [];
    const sqmPatterns = [/"buildingArea"\s*:\s*(\d+)/i, /(\d{2,4})\s*m[²2](?!\d)/gi, /(\d{2,4})\s*kvm(?!\d)/gi];
    for (const p of sqmPatterns) {
      let m; const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      while ((m = re.exec(html)) !== null) { const n = parseInt(m[1], 10); if (n >= 50 && n <= 2000) sqmMatches.push(n); }
    }
    if (sqmMatches.length > 0) sqm = String(Math.max(...sqmMatches));

    // Area from URL
    if (!area) {
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const skip = /^(till-salu|for-sale|en-venta|resale|new-build|inmueble|property|properties|hitta-hem|lagenhet|radhus|apartment|townhouse|penthouse|bungalow|finca|house|r\d+|en|es|sv|de|nl|spain|spanien|costa-blanca|costa-calida|costa-del-sol|\d+)$/i;
        const locationParts = pathParts.filter(p => !skip.test(p) && p.length > 2);
        const areaPart = locationParts[locationParts.length - 1];
        if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      } catch(e) {}
    }

    // Address
    const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan', 'and villamartin'];
    const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Paseo)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
    for (const m of addrMatches) {
      const candidate = m[0].trim().slice(0, 60);
      const isOffice = officeAddresses.some(o => candidate.toLowerCase().includes(o));
      if (!isOffice) { address = candidate; break; }
    }

    // Smart title
    title = generateTitle(ogTitle, area, rooms, sqm, html);

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

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

  // ── URL-BASED FALLBACK PARSER ─────────────────────────────────────────
  // Extracts title, area and highlights from the URL slug alone.
  // Used when the site blocks our fetch request.
  function parseFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const slug = urlObj.pathname.toLowerCase();
      const parts = slug.split('/').filter(Boolean);

      // Find the longest slug part (usually the property description)
      const descPart = parts.sort((a, b) => b.length - a.length)[0] || '';
      const words = descPart.split('-');

      // Property type
      const typeMap = {
        'villa': 'Villa', 'apartment': 'Apartment', 'apartamento': 'Apartment',
        'bungalow': 'Bungalow', 'townhouse': 'Townhouse', 'penthouse': 'Penthouse',
        'finca': 'Finca', 'chalet': 'Chalet', 'duplex': 'Duplex',
        'studio': 'Studio', 'house': 'House', 'piso': 'Apartment',
        'adosado': 'Townhouse', 'ático': 'Penthouse', 'atico': 'Penthouse',
        'ground': null, // handle "ground floor bungalow" below
      };

      // Detect property type — handle compound types
      let propType = null;
      const slugLower = descPart;
      if (/ground.floor.bungalow/.test(slugLower)) propType = 'Ground Floor Bungalow';
      else if (/ground.floor.apartment/.test(slugLower)) propType = 'Ground Floor Apartment';
      else if (/top.floor/.test(slugLower)) propType = 'Top Floor Apartment';
      else {
        for (const [kw, val] of Object.entries(typeMap)) {
          if (val && words.includes(kw)) { propType = val; break; }
        }
      }

      // Highlights from URL keywords
      const highlightRules = [
        [['pool'], 'Private pool'],
        [['sea', 'view', 'seaview', 'sea-view'], 'Sea view'],
        [['beach', 'beachfront'], 'Walking distance to beach'],
        [['golf'], 'Near golf'],
        [['garage', 'parking'], 'Garage'],
        [['garden'], 'Private garden'],
        [['terrace', 'solarium'], 'Large terrace'],
        [['luxury', 'luxurious'], 'Excellent condition'],
        [['new', 'build', 'newbuild'], 'Key ready'],
        [['lift', 'elevator'], 'Lift'],
        [['furnished'], 'Furniture included'],
      ];
      const highlights = [];
      for (const [kws, label] of highlightRules) {
        if (kws.some(k => words.includes(k))) highlights.push(label);
      }

      // Area: find location words — skip common non-location words
      const skipWords = new Set([
        'property','for','sale','to','buy','in','at','with','and','the','a',
        'floor','ground','top','new','build','villa','apartment','bungalow',
        'townhouse','penthouse','finca','chalet','duplex','studio','house',
        'pool','sea','view','beach','golf','garage','parking','garden',
        'terrace','luxury','lift','furnished','bedroom','bathroom','modern',
        'resale','costa','blanca','calida','sol','almeria','murcia',
        'spain','spanien','es','en','sv','de','nl','ref',
      ]);
      const locationWords = words.filter(w => w.length > 3 && !/^\d+$/.test(w) && !skipWords.has(w));
      // Take first 2 location words as area
      const area = locationWords.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || null;

      // Build title
      const title = propType ? propType + (highlights.includes('Private pool') ? ' with Pool' : '') : null;

      return { title, area, highlights };
    } catch(e) {
      return { title: null, area: null, highlights: [] };
    }
  }

  // ── MAPS URL — extract coordinates ───────────────────────────────────────
  const isMapsUrl = /maps\.app\.goo\.gl|maps\.google\.com|goo\.gl\/maps|google\.com\/maps/.test(url);
  if (isMapsUrl) {
    try {
      const mapsRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow'
      });
      const finalUrl = mapsRes.url || url;

      // Try to extract lat/lng from the final URL
      // Pattern 1: @lat,lng in URL path
      let m = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!m) m = finalUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!m) m = finalUrl.match(/ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
      // Pattern 2: also check the HTML body for coordinates
      if (!m) {
        const body = await mapsRes.text().catch(() => '');
        m = body.match(/"(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})"/);
      }
      if (m) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ lat: parseFloat(m[1]), lng: parseFloat(m[2]), _source: 'maps' })
        };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not extract coordinates from Maps URL', _source: 'maps' }) };
    } catch(e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Maps fetch failed', _source: 'maps' }) };
    }
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

    // If response is too short, site is blocking — use URL fallback
    if (html.length < 500) {
      const fallback = parseFromUrl(url);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          image: null,
          title: fallback.title,
          price: null,
          rooms: null,
          bathrooms: null,
          sqm: null,
          area: fallback.area,
          address: null,
          highlights: fallback.highlights,
          _source: 'url-fallback'
        })
      };
    }

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
      if (/ground.floor.bungalow/.test(t)) return 'Ground Floor Bungalow';
      if (/ground.floor.apartment/.test(t)) return 'Ground Floor Apartment';
      if (/top.floor/.test(t)) return 'Top Floor Apartment';
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
      const combined = (rawOgTitle || '') + ' ' + htmlText.slice(0, 3000);

      // Priority 1: use og:title if it looks like a real property title
      // Skip it if it's a listing-style title ("Bungalow till salu", "Villa for sale in X")
      // or too short/too long to be useful
      const isBadTitle = !rawOgTitle
        || rawOgTitle.length < 6
        || rawOgTitle.length > 80
        || /\b(till salu|for sale|en venta|zu verkaufen|à vendre|te koop|in vendita|na prodej)\b/i.test(rawOgTitle)
        || rawOgTitle.trim().split(/\s+/).length <= 1; // single word like "Bungalow"

      if (!isBadTitle) {
      // Strip location suffix: "in Altea", "en Marbella", "i Estepona" etc
      // Also strip preposition phrases: "near golf", "close to beach"
      const locationSuffix = /\s+(in|en|i|at|på|near|close to|à|à)\s+\w[\w\s]{1,30}$/i;
      const cleaned = rawOgTitle
          .replace(/\s*[-|»]\s*.{0,40}$/, '')   // remove "- Agency Name" suffix
          .replace(/\s*\|\s*.{0,40}$/, '')
          .replace(/\s*,\s*\d[\d\s]*€.*$/, '')   // remove price suffixes
          .replace(locationSuffix, '')            // remove "in Altea", "en Marbella" etc
          .replace(/\s+/g, ' ')
          .trim();
        // Only use if it contains a property type word — otherwise generate
        if (detectPropertyType(cleaned) && cleaned.length > 4) {
          // Optionally enrich with a leading adjective if missing
          const hasAdj = /\b(luxury|modern|charming|stunning|spectacular|spacious|elegant|exclusive|new build|renovated|beachfront)\b/i.test(cleaned);
          if (!hasAdj) {
            const adj = pickAdjective(combined.toLowerCase());
            if (adj) return adj + ' ' + cleaned;
          }
          return cleaned;
        }
      }

      // Priority 2: build from parts — use description text only, NOT og:title
      // (og:title may say "Bungalow" when the property is actually a Villa)
      const descriptionText = htmlText.slice(0, 5000);
      const propType = detectPropertyType(descriptionText);
      const t = descriptionText.toLowerCase();
      const adj = pickAdjective(t);
      const feature = pickFeature(t);
      const parts = [];
      if (adj) parts.push(adj);
      if (propType) parts.push(propType);
      else parts.push('Property');
      if (feature) parts.push('with ' + feature);
      return parts.join(' ');
    }

    function pickAdjective(t) {
      if (/\b(spectacular|espectacular)\b/.test(t))      return 'Spectacular';
      if (/\b(stunning|impresionant)\b/.test(t))         return 'Stunning';
      if (/\b(luxury|luxurious|exclusiv|lyx)\b/.test(t)) return 'Luxury';
      if (/\b(elegant)\b/.test(t))                       return 'Elegant';
      if (/\b(spacious|ampli|rymlig)\b/.test(t))         return 'Spacious';
      if (/\b(charming|charmig|encantad)\b/.test(t))     return 'Charming';
      if (/\b(modern|contemporary|contempor)\b/.test(t)) return 'Modern';
      if (/\b(new build|nueva construcci|nybyggd|newly built)\b/.test(t)) return 'New Build';
      if (/\b(renovated|reformada|renoverad)\b/.test(t)) return 'Renovated';
      if (/\b(traditional|rustic)\b/.test(t))            return 'Traditional';
      if (/\b(cozy|cosy|acogedor)\b/.test(t))            return 'Cosy';
      return null;
    }

    function pickFeature(t) {
      if (/\b(beachfront|beach front|primera l.nea)\b/.test(t)) return 'Beachfront';
      if (/\b(sea view|vistas al mar|havsutsikt|ocean view)\b/.test(t)) return 'Sea View';
      if (/\b(private pool|piscina privada|infinity pool)\b/.test(t)) return 'Private Pool';
      if (/\b(golf course|golf)\b/.test(t)) return 'Golf';
      if (/\b(private garden|jard.n privado)\b/.test(t)) return 'Private Garden';
      if (/\b(mountain view|vistas monta.a)\b/.test(t)) return 'Mountain View';
      return null;
    }

    // ── HIGHLIGHT DETECTION ───────────────────────────────────────────────
    function detectHighlights(text) {
      const t = text.toLowerCase();
      const found = [];
      const rules = [
        [['beach', 'playa', 'strand', 'beachfront', 'walking distance to beach', 'nära stranden'], 'Walking distance to beach'],
        [['prime location', 'prime area', 'privileged', 'exclusive area'], 'Prime location'],
        [['quiet', 'tranquil', 'tranquila', 'lugnt', 'peaceful'], 'Quiet area'],
        [['golf', 'golf course', 'campo de golf', 'golfbana'], 'Near golf'],
        [['amenities', 'restaurant', 'shops', 'shopping', 'comercios'], 'Close to amenities'],
        [['private pool', 'piscina privada', 'privat pool', 'heated pool', 'infinity pool'], 'Private pool'],
        [['community pool', 'piscina comunitaria', 'gemensam pool'], 'Community pool'],
        [['garage', 'garaje', 'parking'], 'Garage'],
        [['sea view', 'sea views', 'vistas al mar', 'havsutsikt', 'ocean view', 'mediterranean view'], 'Sea view'],
        [['south facing', 'orientación sur', 'söderläge', 'south-facing'], 'South facing'],
        [['large terrace', 'covered terrace', 'terraza', 'terrass', 'solarium'], 'Large terrace'],
        [['private garden', 'garden', 'jardín', 'trädgård', 'landscaped'], 'Private garden'],
        [['key ready', 'move-in ready', 'llave en mano', 'inflyttningsklar'], 'Key ready'],
        [['renovated', 'renoverad', 'reformed', 'reformada', 'newly renovated'], 'Recently renovated'],
        [['excellent condition', 'perfect condition', 'immaculate'], 'Excellent condition'],
        [['good condition', 'good state', 'buen estado', 'bra skick'], 'Good condition'],
        [['lift', 'elevator', 'ascensor', 'hiss'], 'Lift'],
        [['rental', 'rental income', 'alquiler', 'uthyrning', 'investment potential'], 'Rental potential'],
        [['excellent value', 'price reduced', 'reduced price', 'bargain'], 'Excellent value'],
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

    // Price
    const rawPrice = firstMatch([
      /"price"\s*:\s*"?([\d\.]+)"?/,
      /"Price"\s*:\s*"?([\d\.]+)"?/,
      /itemprop="price"[^>]+content="([\d\.]+)"/i,
      /\u20AC\s*([\d\s\.,\']+)(?:\s|<)/,
      /(\d[\d\s\.]{4,})\s*EUR/i,
      /EUR\s*([\d\s\.,\']+)/i,
    ]);
    price = cleanPrice(rawPrice);

    rooms = cleanNum(firstMatch([
      /"bedrooms"\s*:\s*(\d+)/i,
      /(\d+)\s*(?:sovrum|bedroom|dormitorio|hab\.)/i,
    ]));

    bathrooms = cleanNum(firstMatch([
      /"bathrooms"\s*:\s*(\d+)/i,
      /(\d+)\s*(?:[Bb]adrum|bathroom|ba[ñn]o)/i,
    ]));

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
    const officeAddresses = ['niágara', 'niagara', 'iiwi', 'guadalmina', 'primera llarga', 'långgatan'];
    const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanización|Paseo)\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s\d,]+/gi);
    for (const m of addrMatches) {
      const candidate = m[0].trim().slice(0, 60);
      const isOffice = officeAddresses.some(o => candidate.toLowerCase().includes(o));
      if (!isOffice) { address = candidate; break; }
    }

    title = generateTitle(ogTitle, area, rooms, sqm, html);

    // If generic parser got nothing useful, try URL fallback to supplement
    const urlFallback = parseFromUrl(url);
    if (!title && urlFallback.title) title = urlFallback.title;
    if (!area && urlFallback.area) area = urlFallback.area;

    const highlights = detectHighlights(html);
    const finalHighlights = highlights.length ? highlights : urlFallback.highlights;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image, title, price, rooms, bathrooms, sqm, area, address, highlights: finalHighlights })
    };

  } catch (err) {
    // Network error or timeout — use URL fallback entirely
    const fallback = parseFromUrl(url);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        image: null,
        title: fallback.title,
        price: null,
        rooms: null,
        bathrooms: null,
        sqm: null,
        area: fallback.area,
        address: null,
        highlights: fallback.highlights,
        _source: 'url-fallback'
      })
    };
  }
};

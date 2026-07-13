// Netlify function: /.netlify/functions/tourflow-scrape
// Powers the "Auto fetch" button on TourFlow's Add Property form. Reuses
// the same robust extraction approach proven on Rebrand (handles sites
// that block plain fetch() requests, or that only render their content
// via JavaScript), but scoped down to what Add Property actually needs:
// the info fields plus ONE hero image. Full multi-photo galleries are out
// of scope here — that's what Rebrand itself is for.

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const rawUrl = event.queryStringParameters && event.queryStringParameters.url;
  console.log('[tourflow-scrape] incoming url:', rawUrl);

  if (!rawUrl) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  let url;
  try {
    const normalized = new URL(rawUrl);
    if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
      throw new Error('Not an http(s) URL');
    }
    url = normalized.href;
    console.log('[tourflow-scrape] normalized url:', url);
  } catch (e) {
    console.error('[tourflow-scrape] URL validation failed for', rawUrl, '-', e && e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Unable to parse listing URL.' }) };
  }

  try {
    console.log('[tourflow-scrape] fetching:', url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9',
        'Accept-Charset': 'utf-8'
      },
      redirect: 'follow'
    });
    console.log('[tourflow-scrape] response status:', res.status, res.ok ? 'ok' : 'not-ok');
    const buffer = await res.arrayBuffer();
    let html = new TextDecoder('utf-8').decode(buffer);
    console.log('[tourflow-scrape] html length:', html.length);

    // A 403/blocked response or very short page doesn't necessarily mean
    // failure — it usually means the site needs a real browser to render.
    // Let extraction run anyway (it'll come back mostly empty on a block
    // page) and let that trigger the rendered-HTML fallback below, rather
    // than giving up immediately.
    const wasBlockedOrThin = !res.ok || html.length < 500;
    if (!html) html = '';

    function decodeHtmlEntities(s) {
      if (!s) return s;
      return s
        .replace(/&raquo;/gi, '\u00BB').replace(/&laquo;/gi, '\u00AB')
        .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
        .replace(/&#039;/gi, "'").replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
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
    function cleanCost(s) {
      if (!s) return null;
      const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!num) return null;
      return '\u20AC' + num.toLocaleString('en-US');
    }
    const NON_PROPERTY_IMAGE_RE = /(logo|icon|sprite|favicon|pixel|spacer|avatar|placeholder|flag|flagcdn|\/flags\/|agent[-_]|staff|headshot|team[-_]?photo|author|profile[-_]?pic|employee|broker[-_]?photo|nearby|similar|related|recommend|map[-_]?icon|location[-_]?icon|badge|watermark)/i;

    function extractAll() {
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

      const ogTitle = og('title') || '';
      const rawPrice = firstMatch([
        /"price"\s*:\s*"?([\d\.]+)"?/, /"Price"\s*:\s*"?([\d\.]+)"?/,
        /itemprop="price"[^>]+content="([\d\.]+)"/i,
        /\u20AC\s*([\d\s\.,\']+)(?:\s|<)/, /(\d[\d\s\.]{4,})\s*EUR/i, /EUR\s*([\d\s\.,\']+)/i,
      ]);
      const price = cleanPrice(rawPrice);
      const rooms = cleanNum(firstMatch([/"bedrooms"\s*:\s*(\d+)/i, /(\d+)\s*(?:sovrum|bedroom|dormitorio|hab\.)/i]));
      const bathrooms = cleanNum(firstMatch([/"bathrooms"\s*:\s*(\d+)/i, /(\d+)\s*(?:[Bb]adrum|bathroom|ba[\u00f1n]o)/i]));

      let sqm = null;
      const sqmMatches = [];
      for (const p of [/"buildingArea"\s*:\s*(\d+)/gi, /(\d{2,4})\s*m[\u00b22](?!\d)/gi, /(\d{2,4})\s*kvm(?!\d)/gi]) {
        let m; while ((m = p.exec(html)) !== null) { const n = parseInt(m[1], 10); if (n >= 50 && n <= 2000) sqmMatches.push(n); }
      }
      if (sqmMatches.length > 0) sqm = String(Math.max(...sqmMatches));

      let plotSize = null;
      const plotMatch = firstMatch([
        /"plotArea"\s*:\s*(\d+)/i,
        /(?:plot|parcela|solar|grundst\u00fcck|tomt)[^0-9]{0,20}(\d{2,5})\s*m[\u00b22]/i,
        /(\d{2,5})\s*m[\u00b22][^0-9]{0,20}(?:plot|parcela|solar)/i
      ]);
      if (plotMatch) { const n = parseInt(plotMatch, 10); if (n >= 30 && n <= 100000) plotSize = String(n); }

      const communityFee = cleanCost(firstMatch([
        /(?:cuota\s*comunitaria|community\s*fee|gastos?\s*de\s*comunidad|hoa\s*fee)[^0-9]{0,20}([\d\.,]+)/i
      ]));
      const ibi = cleanCost(firstMatch([
        /\bibi\b[^0-9]{0,20}([\d\.,]+)/i,
        /(?:property\s*tax|council\s*tax)[^0-9]{0,20}([\d\.,]+)/i
      ]));
      const basura = cleanCost(firstMatch([
        /(?:basura|tasa\s*de\s*basuras?|garbage\s*(?:tax|fee))[^0-9]{0,20}([\d\.,]+)/i
      ]));

      let area = null;
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const skip = /^(till-salu|for-sale|en-venta|resale|new-build|inmueble|property|properties|hitta-hem|lagenhet|radhus|apartment|townhouse|penthouse|bungalow|finca|house|r\d+|en|es|sv|de|nl|spain|spanien|costa-blanca|costa-calida|costa-del-sol|\d+)$/i;
        const locationParts = pathParts.filter(p => !skip.test(p) && p.length > 2);
        const areaPart = locationParts[locationParts.length - 1];
        if (areaPart) area = areaPart.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      } catch (e) {}

      let address = null;
      const addrMatches = html.matchAll(/(?:Calle|Avenida|Carrer|Urb\.?|Urbanizaci\u00f3n|Paseo)\s+[A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s\d,]+/gi);
      for (const m of addrMatches) {
        address = m[0].trim().slice(0, 60);
        break;
      }

      let description = og('description') || meta('description') || null;
      if (description) description = description.slice(0, 4000);

      // Best-effort: since the pasted URL is almost always the source
      // listing agent's own site, try to pick up their contact details for
      // the internal "Agent Info" section. Structured data (schema.org
      // RealEstateAgent / Person) is the most reliable source when present;
      // a plain phone-number pattern is the fallback. This is deliberately
      // best-effort — the AI Enhance step is much more reliable for this
      // and should be treated as the primary source.
      let listingAgentName = null, listingAgentPhone = null, listingAgentFirm = null;
      const agentNameMatch = html.match(/"@type"\s*:\s*"(?:RealEstateAgent|Person)"[^}]*?"name"\s*:\s*"([^"]+)"/i)
                          || html.match(/(?:agente|listing agent|agent)[^:>]{0,10}:?\s*<[^>]+>\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
      if (agentNameMatch) listingAgentName = decodeHtmlEntities(agentNameMatch[1].trim()).slice(0, 60);
      const agentPhoneMatch = html.match(/"telephone"\s*:\s*"([+\d][\d\s\-()]{6,20})"/i)
                           || html.match(/(?:tel|phone|tel[eé]fono)[^:>]{0,10}:?\s*<[^>]*>?\s*(\+?\d[\d\s\-()]{6,18}\d)/i);
      if (agentPhoneMatch) listingAgentPhone = agentPhoneMatch[1].trim();
      const agentFirmMatch = og('site_name')
        || (html.match(/"@type"\s*:\s*"RealEstateAgent"[^}]*?"worksFor"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i) || [])[1];
      if (agentFirmMatch) listingAgentFirm = decodeHtmlEntities(String(agentFirmMatch).trim()).slice(0, 60);

      // Just ONE hero image — og:image first, then the first plausible
      // <img> on the page as a fallback.
      let image = og('image') || meta('twitter:image') || null;
      if (!image) {
        for (const m of html.matchAll(/<img[^>]+>/gi)) {
          const tag = m[0];
          const lazyMatch = tag.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i);
          const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
          let src = (lazyMatch && lazyMatch[1]) || (srcMatch && srcMatch[1]);
          if (!src || src.startsWith('data:')) continue;
          try { src = new URL(src, url).href; } catch (e) { continue; }
          const lower = src.toLowerCase();
          if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower) && !NON_PROPERTY_IMAGE_RE.test(lower)) {
            image = src;
            break;
          }
        }
      }

      return {
        title: ogTitle || null, price, rooms, bathrooms, sqm, plotSize, area, address,
        communityFee, ibi, basura, description, image,
        listingAgentName, listingAgentPhone, listingAgentFirm
      };
    }

    let result = extractAll();
    let usedRenderedFallback = false;
    let renderedFallbackError = null;

    const looksEmpty = !result.title && !result.price;
    const imageThin = !result.image;

    if ((looksEmpty || imageThin || wasBlockedOrThin) && process.env.SCREENSHOTONE_API_KEY) {
      try {
        const renderUrl = 'https://api.screenshotone.com/take'
          + '?access_key=' + encodeURIComponent(process.env.SCREENSHOTONE_API_KEY)
          + '&url=' + encodeURIComponent(url)
          + '&response_type=json'
          + '&metadata_content=true'
          + '&metadata_content_format=html'
          + '&full_page=true'
          + '&block_ads=true'
          + '&block_cookie_banners=true'
          + '&delay=3'
          + '&timeout=30';
        const renderRes = await fetch(renderUrl);
        const renderJson = await renderRes.json();
        const contentUrl = renderJson && renderJson.content && renderJson.content.url;
        if (contentUrl) {
          const contentRes = await fetch(contentUrl);
          html = await contentRes.text();
          const renderedResult = extractAll();
          if (!result.image && renderedResult.image) result.image = renderedResult.image;
          Object.keys(renderedResult).forEach(function(k) {
            if (k === 'image') return;
            if ((result[k] == null || result[k] === '') && renderedResult[k] != null && renderedResult[k] !== '') {
              result[k] = renderedResult[k];
            }
          });
          usedRenderedFallback = true;
        }
      } catch (e) {
        renderedFallbackError = e && e.message ? e.message : String(e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(Object.assign({ sourceUrl: url }, result, {
        _debug: { htmlLength: html.length, usedRenderedFallback, renderedFallbackError }
      }))
    };

  } catch (err) {
    console.error('[tourflow-scrape] unexpected error for', url, ':', err && err.stack ? err.stack : err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'The website rejected the request.', _source: 'error' })
    };
  }
};

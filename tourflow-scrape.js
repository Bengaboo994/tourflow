// Netlify function: /.netlify/functions/tourflow-scrape
// Powers the "Auto fetch" button on TourFlow's Add Property form.
//
// This delegates the actual extraction work to Rebrand's own scraping
// engine at rebrand.casa (rebrand-scrape.js) rather than maintaining a
// second, parallel copy of the same regex/fallback logic. Rebrand's
// engine already handles the hard parts robustly: sites that block plain
// fetch() requests, JS-rendered galleries, Next.js image-optimizer URLs,
// lazy-loading, dedup, etc. Any future improvement made there (e.g. a new
// site pattern fix) benefits TourFlow automatically, with nothing to keep
// in sync here.
//
// This function's own job is just the TourFlow-specific adaptation:
//   - call the shared engine and take its first/best image as the
//     single "hero" image Add Property actually uses (TourFlow doesn't
//     need Rebrand's full multi-photo gallery)
//   - rename a couple of fields to match TourFlow's naming
//     (garbageFee -> basura)
//   - everything else (title, price, rooms, bathrooms, sqm, plotSize,
//     area, address, communityFee, ibi, description, listing agent
//     contact) passes through as-is, since the shared engine already
//     returns them under names TourFlow's fill() logic expects.
//
// NOTE: this assumes rebrand-scrape.js's response shape. If that shape
// changes (field renamed/removed), this adapter needs a matching update.

const REBRAND_ENGINE_URL = 'https://rebrand.casa/.netlify/functions/rebrand-scrape';

exports.handler = async function (event) {
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
  } catch (e) {
    console.error('[tourflow-scrape] URL validation failed for', rawUrl, '-', e && e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Unable to parse listing URL.' }) };
  }

  try {
    console.log('[tourflow-scrape] delegating to shared engine:', REBRAND_ENGINE_URL);
    const res = await fetch(REBRAND_ENGINE_URL + '?url=' + encodeURIComponent(url));
    const data = await res.json();
    console.log('[tourflow-scrape] shared engine responded, imageCount:', data.imageCount, 'error:', data.error || 'none');

    if (data.error) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: data.error }) };
    }

    const heroImage = (data.images && data.images.length) ? data.images[0] : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sourceUrl: data.sourceUrl || url,
        title: data.title,
        price: data.price,
        rooms: data.rooms,
        bathrooms: data.bathrooms,
        sqm: data.sqm,
        plotSize: data.plotSize,
        livingArea: data.livingArea,
        terraceSize: data.terraceSize,
        area: data.area,
        address: data.address,
        communityFee: data.communityFee,
        ibi: data.ibi,
        basura: data.garbageFee,
        description: data.description,
        listingAgentName: data.listingAgentName,
        listingAgentPhone: data.listingAgentPhone,
        listingAgentFirm: data.listingAgentFirm,
        image: heroImage,
        _debug: { engine: 'rebrand.casa/rebrand-scrape', usedRenderedFallback: data._debug && data._debug.usedRenderedFallback }
      })
    };

  } catch (err) {
    console.error('[tourflow-scrape] unexpected error for', url, ':', err && err.stack ? err.stack : err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Could not reach the scraping engine.' })
    };
  }
};

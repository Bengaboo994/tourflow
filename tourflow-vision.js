// Netlify function: /.netlify/functions/tourflow-vision
// Powers the "Enhance" step on TourFlow's Add Property form. Takes a
// full-page screenshot of the listing (via ScreenshotOne) and asks Claude
// to read it like a person would — filling in the fields that plain HTML
// scraping struggles with (year built, orientation, pool, garage,
// furnished, energy cert), and selecting which of TourFlow's fixed
// highlight badges actually apply, based on what's shown on the page.
//
// Requires two environment variables set in Netlify:
//   SCREENSHOTONE_API_KEY  — from screenshotone.com
//   ANTHROPIC_API_KEY      — from console.anthropic.com

// Keep this in sync with the HIGHLIGHTS array in index.html — Claude is
// only allowed to pick from this exact list, so the returned strings
// always match a real highlight button.
const HIGHLIGHT_LABELS = [
  'Walking distance to beach', 'Prime location', 'Quiet area', 'Near golf', 'Close to amenities',
  'Private pool', 'Community pool', 'Garage', 'Sea view', 'South facing', 'Large terrace',
  'Private garden', 'Key ready', 'Furniture included', 'Recently renovated', 'Excellent condition',
  'Good condition', 'Poor condition', 'Excellent value', 'Rental potential', 'Hot listing',
  'Family friendly', 'Restaurants nearby', 'Holiday home potential', 'Everything within walking distance', 'Lift'
];

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  const SCREENSHOTONE_KEY = process.env.SCREENSHOTONE_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SCREENSHOTONE_KEY || !ANTHROPIC_KEY) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ error: 'Missing API key(s) on the server. Add SCREENSHOTONE_API_KEY and ANTHROPIC_API_KEY in Netlify \u2192 Site settings \u2192 Environment variables, then redeploy.' })
    };
  }

  try {
    const shotUrl = 'https://api.screenshotone.com/take'
      + '?access_key=' + encodeURIComponent(SCREENSHOTONE_KEY)
      + '&url=' + encodeURIComponent(url)
      + '&full_page=true'
      + '&format=jpg'
      + '&image_quality=80'
      + '&image_height=7800'
      + '&block_ads=true'
      + '&block_cookie_banners=true'
      + '&block_banners_by_heuristics=true'
      + '&delay=3'
      + '&viewport_width=1400'
      + '&viewport_height=1000'
      + '&timeout=25';

    const shotRes = await fetch(shotUrl);
    if (!shotRes.ok) {
      const t = await shotRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Screenshot failed: ' + t.slice(0, 300) }) };
    }
    const shotBuffer = await shotRes.arrayBuffer();
    const base64Image = Buffer.from(shotBuffer).toString('base64');

    const highlightList = HIGHLIGHT_LABELS.map(l => '"' + l + '"').join(', ');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
            {
              type: 'text',
              text: 'This is a screenshot of a real estate listing page. Read it like a person would and return ONLY a raw JSON object \u2014 no markdown fences, no explanation, nothing before or after \u2014 with exactly these fields: '
                + '{"title": string or null (short natural title focused on property type and key features, never including area/city name or an internal reference ID \u2014 only null if there truly is not enough information), "price": string or null (include currency symbol), "rooms": string or null (bedrooms, just the number), "bathrooms": string or null (just the number), "sqm": string or null (built size in m\u00b2, just the number), "livingArea": string or null (living/usable area in m\u00b2 if separately stated from built size \u2014 sometimes called \u201cboarea\u201d or \u201csuperficie \u00fatil\u201d \u2014 just the number, null if the page only gives one single size figure), "terraceSize": string or null (terrace/balcony area in m\u00b2 if stated, just the number), "plotSize": string or null (plot/land size in m\u00b2, just the number), "area": string or null (neighbourhood/town), "address": string or null, "communityFee": string or null (HOA/community fee, include currency and period), "ibi": string or null (property tax, include currency and period), "basura": string or null (garbage/waste collection tax, include currency and period), '
                + '"yearBuilt": string or null (year the property was built or renovated, just the 4-digit year, e.g. "2018"), '
                + '"orientation": string or null (which direction the property faces \u2014 e.g. "South", "South-East", "North-West" \u2014 only if explicitly stated), '
                + '"pool": string or null (e.g. "Private", "Community", "None" \u2014 only if the page actually addresses whether there is a pool), '
                + '"garage": string or null (e.g. "Yes", "No", "2 spaces" \u2014 only if explicitly addressed), '
                + '"furnished": string or null (e.g. "Yes", "No", "Optional" \u2014 only if explicitly addressed), '
                + '"energyCert": string or null (a single letter A through G if a certificate is shown and complete; if it says "in process"/"en tr\u00e1mite" or similar, return exactly "In Process"; null if there is no energy rating section at all), '
                + '"listingAgentName": string or null (the name of the agent or agency contact person shown on the page as the one to contact about this listing \u2014 often near a phone number or "Contact" section, sometimes just an agency name if no individual is named), '
                + '"listingAgentPhone": string or null (their phone number, exactly as shown), '
                + '"listingAgentFirm": string or null (the name of the agency/company that has this listing, if shown \u2014 this is very likely the site you\u2019re looking at, e.g. its logo or header name), '
                + '"highlights": array of strings, choosing ONLY from this exact list and ONLY including ones you can confirm are actually true for this property from what\u2019s shown on the page \u2014 do not guess or include ones you cannot confirm: [' + highlightList + ']}. '
                + 'Take your time to look at the whole image carefully, including small icon+number rows near the top and any costs/fees or features sections further down, before deciding a field is missing.'
            }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'AI read failed: ' + t.slice(0, 300) }) };
    }

    const claudeData = await claudeRes.json();
    const rawText = (claudeData.content && claudeData.content[0] && claudeData.content[0].text) || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse the AI response as JSON.', raw: rawText.slice(0, 400) }) };
    }

    // Defensive filter: only ever pass through highlights that are
    // actually in the allowed list, in case the model returns something
    // slightly off.
    if (Array.isArray(parsed.highlights)) {
      parsed.highlights = parsed.highlights.filter(h => HIGHLIGHT_LABELS.indexOf(h) !== -1);
    } else {
      parsed.highlights = [];
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ error: 'Failed: ' + (err && err.message ? err.message : String(err)) })
    };
  }
};

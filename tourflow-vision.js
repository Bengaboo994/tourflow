// Netlify function: /.netlify/functions/tourflow-vision
// Powers the "Enhance" step on TourFlow's Add Property form.
//
// This delegates to Rebrand's own rebrand-vision.js at rebrand.casa
// instead of making a second, separate screenshot + Claude call for the
// same page. rebrand-vision.js's prompt already includes the TourFlow-
// specific fields (yearBuilt, orientation, pool, garage, furnished,
// listing agent contact, highlights) precisely so this delegation works —
// see the comment at the top of that file. This function's only job is
// forwarding the request and passing the response straight through.
//
// NOTE: this assumes rebrand-vision.js's response shape. If the shared
// prompt's fields change, this adapter's consumer (fetchTourflowEnhance
// in index.html) may need a matching update.

const REBRAND_ENGINE_URL = 'https://rebrand.casa/.netlify/functions/rebrand-vision';

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  try {
    console.log('[tourflow-vision] delegating to shared engine:', REBRAND_ENGINE_URL);
    const res = await fetch(REBRAND_ENGINE_URL + '?url=' + encodeURIComponent(url));
    const data = await res.json();

    if (data.error) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: data.error }) };
    }

    // Rename garbageFee -> basura to match TourFlow's field naming;
    // everything else already matches what fetchTourflowEnhance expects.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(Object.assign({}, data, {
        basura: data.garbageFee,
        energyCert: data.energyClass
      }))
    };

  } catch (err) {
    console.error('[tourflow-vision] unexpected error for', url, ':', err && err.stack ? err.stack : err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Could not reach the AI enhance engine.' })
    };
  }
};

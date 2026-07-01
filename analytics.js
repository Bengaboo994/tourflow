// ── TourFlow Analytics v1.0 ───────────────────────────────────────────────────
// Lightweight event tracker. Drop <script src="/analytics.js"></script> into
// any TourFlow page AFTER the Supabase client is initialised.
//
// Usage:
//   tfTrack('page_view');
//   tfTrack('tour_created', { tour_id: '...' });
//
// The tracker is intentionally fire-and-forget: errors are swallowed so a
// tracking failure never breaks the user experience.

(function () {
  // ── Config ─────────────────────────────────────────────────────────────────
  var SUPA_URL = 'https://dhcqbdyrbviormfsdcyr.supabase.co';
  var SUPA_KEY = 'sb_publishable_ZKyT9nBrTruUnVDZF0VrWQ_HefTPZB3';
  var TABLE    = 'analytics_events';

  // ── Session ID ─────────────────────────────────────────────────────────────
  // Persisted in sessionStorage so all events in one browser tab share an ID.
  var SESSION_KEY = 'tf_sid';
  function getSessionId() {
    try {
      var sid = sessionStorage.getItem(SESSION_KEY);
      if (!sid) {
        sid = 'sid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(SESSION_KEY, sid);
      }
      return sid;
    } catch (e) { return 'sid_unknown'; }
  }

  // ── UTM params ─────────────────────────────────────────────────────────────
  function getUtm() {
    try {
      var p = new URLSearchParams(window.location.search);
      // Persist UTMs for the session so they survive page navigations
      ['utm_source','utm_medium','utm_campaign'].forEach(function (k) {
        if (p.get(k)) sessionStorage.setItem('tf_' + k, p.get(k));
      });
      return {
        utm_source:   sessionStorage.getItem('tf_utm_source')   || null,
        utm_medium:   sessionStorage.getItem('tf_utm_medium')   || null,
        utm_campaign: sessionStorage.getItem('tf_utm_campaign') || null
      };
    } catch (e) { return {}; }
  }

  // ── Device & browser ───────────────────────────────────────────────────────
  function getDevice() {
    var ua = navigator.userAgent || '';
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
      return /iPad/i.test(ua) ? 'tablet' : 'mobile';
    }
    return 'desktop';
  }
  function getBrowser() {
    var ua = navigator.userAgent || '';
    if (/Edg\//i.test(ua))    return 'Edge';
    if (/OPR\//i.test(ua))    return 'Opera';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua))return 'Firefox';
    if (/Safari\//i.test(ua)) return 'Safari';
    return 'Other';
  }

  // ── Country via Cloudflare header (only works on Netlify/CF edge) ──────────
  // Falls back to null — no external API call needed.
  var _country = null;
  try { _country = document.head.querySelector('meta[name="cf-ipcountry"]') && document.head.querySelector('meta[name="cf-ipcountry"]').content || null; } catch(e){}

  // ── Core track function ────────────────────────────────────────────────────
  window.tfTrack = function (eventName, meta) {
    try {
      // Get current user from Supabase if available
      var userId = null;
      try {
        var stored = localStorage.getItem('sb-' + SUPA_URL.split('//')[1].split('.')[0] + '-auth-token');
        if (stored) {
          var parsed = JSON.parse(stored);
          userId = (parsed && parsed.user && parsed.user.id) || null;
        }
      } catch (e) {}

      var utm = getUtm();
      var payload = {
        event_name:   eventName,
        session_id:   getSessionId(),
        user_id:      userId || null,
        page:         window.location.pathname + window.location.search,
        referrer:     document.referrer || null,
        device:       getDevice(),
        browser:      getBrowser(),
        country:      _country,
        utm_source:   utm.utm_source,
        utm_medium:   utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        meta:         meta || null
      };

      fetch(SUPA_URL + '/rest/v1/' + TABLE, {
        method:  'POST',
        headers: {
          'apikey':       SUPA_KEY,
          'Authorization':'Bearer ' + SUPA_KEY,
          'Content-Type': 'application/json',
          'Prefer':       'return=minimal'
        },
        body: JSON.stringify(payload)
      }).catch(function () {}); // fire-and-forget — never throw

    } catch (e) {} // swallow all errors
  };

  // ── Auto page_view on load ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.tfTrack('page_view'); });
  } else {
    window.tfTrack('page_view');
  }

})();

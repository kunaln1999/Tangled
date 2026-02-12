/*
 * Tangled Cookies & Consent Utilities
 * ----------------------------------
 * What this file does
 *  - Provides tiny helpers to read/write/remove first‑party cookies (client‑set only; NOT HttpOnly)
 *  - Manages consent via a compact `t_consent` cookie (analytics/experiments/marketing)
 *  - Manages non‑tracking UI preferences as first‑party cookies: `t_pref_theme`, `t_pref_lang`
 *  - Optionally assigns an A/B variant `t_ab` ONLY after "experiments" consent
 *  - Exposes a single global: `window.TangledCookies`
 *
 * IMPLEMENTATION
 *  - Uses universal, RFC 6265/6265bis‑compliant cookie semantics
 *  - Relies on the standard `Expires` attribute (not `Max-Age`) for widest compatibility
 *
 * IMPORTANT
 *  - `t_sid` (session) MUST be set by the server with `HttpOnly; Secure; SameSite=Lax`.
 *  - `t_csrf` typically comes from server. If you use a double-submit cookie strategy, it must be readable here.
 *    Otherwise, prefer embedding a CSRF token in a meta tag and read it via `getCsrfTokenFromMeta()`.
 */
(function () {
  'use strict';

  // Ensure Inter font via Google Fonts API with local fallback (same as safety.html)
  (function ensureInterFonts(){
    try {
      if (typeof document === 'undefined') return;
      var hasInterLink = !!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Inter"]');
      var hasPreconnect1 = !!document.querySelector('link[rel="preconnect"][href="https://fonts.googleapis.com"]');
      var hasPreconnect2 = !!document.querySelector('link[rel="preconnect"][href="https://fonts.gstatic.com"]');

      if (!hasPreconnect1) {
        var p1 = document.createElement('link');
        p1.rel = 'preconnect';
        p1.href = 'https://fonts.googleapis.com';
        document.head.appendChild(p1);
      }
      if (!hasPreconnect2) {
        var p2 = document.createElement('link');
        p2.rel = 'preconnect';
        p2.href = 'https://fonts.gstatic.com';
        p2.setAttribute('crossorigin', '');
        document.head.appendChild(p2);
      }

      if (!hasInterLink) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap';
        // Local fallback if Google Fonts fails
        l.onerror = function(){
          var style = document.createElement('style');
          style.type = 'text/css';
          style.textContent = "@font-face{font-family:'Inter';src:url('assets/fonts/Inter-VariableFont_opsz,wght.ttf') format('truetype');font-weight:100 900;font-display:swap;}";
          document.head.appendChild(style);
        };
        document.head.appendChild(l);
      }
    } catch (e) {
      // As a last resort, inject local @font-face
      try {
        var style2 = document.createElement('style');
        style2.type = 'text/css';
        style2.textContent = "@font-face{font-family:'Inter';src:url('assets/fonts/Inter-VariableFont_opsz,wght.ttf') format('truetype');font-weight:100 900;font-display:swap;}";
        document.head.appendChild(style2);
      } catch(_){}
    }
  })();

  // ------------------------------
  // Constants
  // ------------------------------
  const CONSENT_COOKIE = 't_consent';
  const AB_COOKIE = 't_ab';
  const THEME_KEY = 't_pref_theme';
  const LANG_KEY = 't_pref_lang';

  // Default consent (all off). Timestamp records last update (ms epoch)
  const DEFAULT_CONSENT = Object.freeze({
    analytics: false,
    experiments: false,
    marketing: false,
    ts: 0,
  });

  // ------------------------------
  // Low-level cookie helpers — RFC 6265 compliant (standards-only)
  // Uses Expires (not Max-Age) for universal compatibility
  // ------------------------------
  function setCookie(name, value, options = {}) {
    const opts = {
      path: '/',
      // Use either `expires` (Date) OR `expiresDays` (number of days)
      expires: undefined,
      expiresDays: undefined,
      sameSite: 'Lax', // 'Lax' | 'Strict' | 'None'
      secure: true,
      ...options,
    };

    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;

    if (opts.expires instanceof Date) {
      cookie += `; Expires=${opts.expires.toUTCString()}`;
    } else if (typeof opts.expiresDays === 'number') {
      const d = new Date();
      d.setTime(d.getTime() + opts.expiresDays * 864e5);
      cookie += `; Expires=${d.toUTCString()}`;
    }

    if (opts.path) cookie += `; Path=${opts.path}`;
    if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
    if (opts.secure) cookie += `; Secure`;

    document.cookie = cookie;
  }

  function getCookie(name) {
    const target = encodeURIComponent(name) + '=';
    const raw = document.cookie || '';
    const parts = raw.split(';');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (p.startsWith(target)) return decodeURIComponent(p.substring(target.length));
    }
    return null;
  }

  function deleteCookie(name) {
    // Expires in the past (Thu, 01 Jan 1970 00:00:00 GMT) per RFC 6265
    document.cookie = `${encodeURIComponent(name)}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax; Secure`;
  }

  // ------------------------------
  // Consent store (compact string format):
  //  "a=1|e=0|m=0|ts=1700000000000"
  // ------------------------------
  function encodeConsent(obj) {
    const a = obj.analytics ? 1 : 0;
    const e = obj.experiments ? 1 : 0;
    const m = obj.marketing ? 1 : 0;
    const ts = Number(obj.ts || Date.now());
    return `a=${a}|e=${e}|m=${m}|ts=${ts}`;
  }

  function decodeConsent(str) {
    if (!str || typeof str !== 'string') return { ...DEFAULT_CONSENT };
    const out = { ...DEFAULT_CONSENT };
    for (const pair of str.split('|')) {
      const [k, v] = pair.split('=');
      if (!k) continue;
      if (k === 'a') out.analytics = v === '1';
      else if (k === 'e') out.experiments = v === '1';
      else if (k === 'm') out.marketing = v === '1';
      else if (k === 'ts') out.ts = Number(v) || 0;
    }
    return out;
  }

  function getConsent() {
    return decodeConsent(getCookie(CONSENT_COOKIE));
  }

  // Merge and persist consent. `ttlDays` defaults to 365 (12 months approx.)
  function setConsent(partial, ttlDays = 365) {
    const curr = getConsent();
    const next = { ...curr, ...partial, ts: Date.now() };
    setCookie(CONSENT_COOKIE, encodeConsent(next), { expiresDays: ttlDays, sameSite: 'Lax', secure: true });
    return next;
  }

  function hasConsent(category) {
    const c = getConsent();
    return Boolean(c && c[category] === true);
  }

  // ------------------------------
  // Preferences (cookies) — non-tracking UX data (device/browser only)
  // ------------------------------
  function getTheme() {
    return getCookie(THEME_KEY);
  }
  function setTheme(val, { ttlDays = 365 } = {}) {
    if (val == null || val === '') {
      deleteCookie(THEME_KEY);
    } else {
      setCookie(THEME_KEY, String(val), { expiresDays: ttlDays, sameSite: 'Lax', secure: true });
    }
  }

  function getLang() {
    return getCookie(LANG_KEY);
  }
  function setLang(val, { ttlDays = 365 } = {}) {
    if (val == null || val === '') {
      deleteCookie(LANG_KEY);
    } else {
      setCookie(LANG_KEY, String(val), { expiresDays: ttlDays, sameSite: 'Lax', secure: true });
    }
  }

  // ------------------------------
  // Optional: A/B assignment (short TTL, first‑party only)
  // Only runs when experiments consent=true
  // ------------------------------
  function assignAB(options = {}) {
    const { variants = ['A', 'B'], ttlDays = 14 } = options;
    if (!hasConsent('experiments')) return null;
    let v = getCookie(AB_COOKIE);
    if (v && variants.includes(v)) return v;
    // simple uniform pick
    v = variants[Math.floor(Math.random() * variants.length)];
    setCookie(AB_COOKIE, v, { expiresDays: ttlDays, sameSite: 'Lax', secure: true });
    return v;
  }

  // ------------------------------
  // CSRF helpers (choose ONE strategy in your app):
  // ------------------------------
  function getCsrfFromCookie(name = 't_csrf') {
    return getCookie(name); // Works only if CSRF cookie is NOT HttpOnly.
  }
  function getCsrfTokenFromMeta(metaName = 'csrf-token') {
    const el = document.querySelector(`meta[name="${metaName}"]`);
    return el ? el.getAttribute('content') : null;
  }

  // ------------------------------
  // Public API
  // ------------------------------
  window.TangledCookies = {
    // raw cookie ops (non-HttpOnly only)
    set: setCookie,
    get: getCookie,
    remove: deleteCookie,

    // consent
    getConsent,
    setConsent,
    hasConsent,

    // prefs
    prefs: {
      getTheme,
      setTheme,
      getLang,
      setLang,
    },

    // experiments
    assignAB,

    // csrf helpers
    getCsrfFromCookie,
    getCsrfTokenFromMeta,
  };
})();

/*
USAGE EXAMPLES
--------------
// 1) Save consent from a banner
TangledCookies.setConsent({ analytics: true, experiments: true, marketing: false });

// 2) Conditionally load analytics
if (TangledCookies.hasConsent('analytics')) {
  const s = document.createElement('script');
  s.src = '/analytics.js';
  s.defer = true;
  document.head.appendChild(s);
}

// 3) Assign A/B (only after consent)
const variant = TangledCookies.assignAB({ variants: ['control', 'new'], ttlDays: 7 });

// 4) Theme & language prefs (do not require consent)
TangledCookies.prefs.setTheme('dark'); // stores as cookie t_pref_theme
TangledCookies.prefs.setLang('en-IN'); // stores as cookie t_pref_lang
*/


// ----------------------------------------------------
// Extra: Cookie acceptance banner in stool island strip
// ----------------------------------------------------
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const TC = window.TangledCookies;
  const consent = TC && typeof TC.getConsent === 'function' ? TC.getConsent() : null;
  const alreadyConsented = !!(consent && consent.ts);

  // If user has already given a choice, do nothing.
  if (alreadyConsented) {
    // no-op: banner will not be inserted
  } else if (!document.getElementById('cookie-banner-strip')) {
    const bannerHtml = `
<!-- Extra: Cookie acceptance banner – Floating Island (responsive) -->
<div id="cookie-banner-strip" role="region" aria-label="Cookie consent" style="
  position:fixed;
  left:50%;
  transform:translate(-50%, 100%);
  bottom:calc(12px + env(safe-area-inset-bottom, 0px));
  max-width:920px;
  width:calc(100vw - 24px);
  background:#ffffff;
  color:#1f1f1f;
  border:1px solid rgba(0,0,0,.08);
  border-radius:18px;
  box-shadow:0 10px 40px rgba(0,0,0,.18);
  padding:12px 14px;
  padding-bottom:calc(12px + env(safe-area-inset-bottom, 0px));
  z-index:9999;
  animation:cookieIslandUp .4s ease-out .05s forwards;
">
  <div class="cookie-row" style="display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
    <div class="cookie-copy" style="display:flex; gap:12px; align-items:flex-start; min-width:220px; flex:1 1 300px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex:0 0 auto; margin-top:2px;">
        <path d="M20.5 12.5a8.5 8.5 0 11-9-8.48 3 3 0 003.48 3.48 3 3 0 003.52 3.52 3 3 0 002 1.48z" fill="#FFD966" stroke="#1f1f1f" stroke-width="1"/>
        <circle cx="8.5" cy="9.5" r="1.2" fill="#1f1f1f"/>
        <circle cx="11" cy="15" r="1" fill="#1f1f1f"/>
        <circle cx="15.2" cy="11.2" r="1.1" fill="#1f1f1f"/>
      </svg>
      <div style="font-size:14px; line-height:1.45;">
        Tangled uses cookies to make your experience smoother and safer. You can learn more in our <a href="/cookies-policy.html" style="color:#1955D7; text-decoration:underline;">cookies policy</a>.
      </div>
    </div>
    <div id="cookie-actions" style="display:flex; gap:8px; align-items:center; justify-content:flex-end; flex:0 0 auto;">
      <button id="cookie-reject" style="
        background:#fff; color:#1f1f1f; border:1px solid #d9d9df; border-radius:12px; padding:10px 14px; font-weight:500; cursor:pointer; min-height:40px;">Reject all</button>
      <button id="cookie-accept" style="
        background:#1f1f1f; color:#fff; border:0; border-radius:12px; padding:10px 16px; font-weight:500; cursor:pointer; min-height:40px;">Accept all</button>
    </div>
  </div>
</div>
<style>
@keyframes cookieIslandUp { from { transform: translate(-50%, 100%); opacity:0; } to { transform: translate(-50%, 0); opacity:1; } }
@media (prefers-reduced-motion: reduce){ #cookie-banner-strip{ animation:none !important; } }
@media (max-width: 980px){ #cookie-banner-strip{ width: calc(100vw - 24px); } }
@media (max-width: 768px){
  #cookie-actions {
    flex-direction: row;
    gap: 8px;
    width: 100%;
  }
  #cookie-actions button {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
  }
}
</style>
`;
    document.body.insertAdjacentHTML('beforeend', bannerHtml);

    function bindCookieBanner() {
      const strip = document.getElementById('cookie-banner-strip');
      const btnAccept = document.getElementById('cookie-accept');
      const btnReject = document.getElementById('cookie-reject');
      const TCnow = window.TangledCookies;

      if (!strip || !TCnow) return;

      // In case consent was set in another tab very quickly, re-check before wiring
      const c2 = TCnow.getConsent();
      if (c2 && c2.ts) {
        strip.remove();
        return;
      }

      if (btnAccept) {
        btnAccept.addEventListener('click', () => {
          TCnow.setConsent({ analytics: true, experiments: true, marketing: false });
          strip.style.transition = 'opacity 0.3s ease';
          strip.style.opacity = '0';
          setTimeout(() => strip.remove(), 300);
        });
      }
      if (btnReject) {
        btnReject.addEventListener('click', () => {
          TCnow.setConsent({ analytics: false, experiments: false, marketing: false });
          strip.style.transition = 'opacity 0.25s ease';
          strip.style.opacity = '0';
          setTimeout(() => strip.remove(), 250);
        });
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindCookieBanner);
    } else {
      bindCookieBanner();
    }
  }
}
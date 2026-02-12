/*
 * Tangled Consent & Preference Utilities
 * --------------------------------------
 * Manages privacy consent via a compact cookie and UI banner.
 * Optimized for compatibility and stealth against aggressive privacy shields.
 */
(function () {
  'use strict';

  // Ensure Inter font via Google Fonts API
  (function ensureInterFonts() {
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
        l.onerror = function () {
          var style = document.createElement('style');
          style.type = 'text/css';
          style.textContent = "@font-face{font-family:'Inter';src:url('assets/fonts/Inter-VariableFont_opsz,wght.ttf') format('truetype');font-weight:100 900;font-display:swap;}";
          document.head.appendChild(style);
        };
        document.head.appendChild(l);
      }
    } catch (e) { }
  })();

  const CONSENT_COOKIE = 't_consent';
  const THEME_KEY = 't_pref_theme';
  const LANG_KEY = 't_pref_lang';

  const DEFAULT_CONSENT = Object.freeze({
    analytics: false,
    experiments: false,
    marketing: false,
    ts: 0,
  });

  function setCookie(name, value, options = {}) {
    const opts = { path: '/', sameSite: 'Lax', secure: true, ...options };
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;
    if (opts.expiresDays) {
      const d = new Date();
      d.setTime(d.getTime() + opts.expiresDays * 864e5);
      cookie += `; Expires=${d.toUTCString()}`;
    }
    cookie += `; Path=${opts.path}; SameSite=${opts.sameSite}${opts.secure ? '; Secure' : ''}`;
    document.cookie = cookie;
  }

  function getCookie(name) {
    const target = encodeURIComponent(name) + '=';
    const parts = (document.cookie || '').split(';');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (p.startsWith(target)) return decodeURIComponent(p.substring(target.length));
    }
    return null;
  }

  function getConsent() {
    const str = getCookie(CONSENT_COOKIE);
    if (!str) return { ...DEFAULT_CONSENT };
    const out = { ...DEFAULT_CONSENT };
    for (const pair of str.split('|')) {
      const [k, v] = pair.split('=');
      if (k === 'a') out.analytics = v === '1';
      else if (k === 'e') out.experiments = v === '1';
      else if (k === 'm') out.marketing = v === '1';
      else if (k === 'ts') out.ts = Number(v) || 0;
    }
    return out;
  }

  function setConsent(partial) {
    const next = { ...getConsent(), ...partial, ts: Date.now() };
    const val = `a=${next.analytics ? 1 : 0}|e=${next.experiments ? 1 : 0}|m=${next.marketing ? 1 : 0}|ts=${next.ts}`;
    setCookie(CONSENT_COOKIE, val, { expiresDays: 365 });
    return next;
  }

  window.TangledCookies = {
    getConsent,
    setConsent,
    getTheme: () => getCookie(THEME_KEY),
    setTheme: (v) => setCookie(THEME_KEY, v, { expiresDays: 365 }),
  };

  // UI Injection
  if (typeof document !== 'undefined') {
    const consent = getConsent();
    if (consent && consent.ts) return;

    const bannerHtml = `
<div id="t-consent-island" role="region" aria-label="Privacy" style="
  position:fixed; left:50%; transform:translate(-50%, 100%);
  bottom:calc(12px + env(safe-area-inset-bottom, 0px));
  max-width:920px; width:calc(100vw - 24px);
  background:#ffffff; color:#1f1f1f;
  border:1px solid rgba(0,0,0,.08); border-radius:18px;
  box-shadow:0 10px 40px rgba(0,0,0,.18);
  padding:12px 14px; z-index:9999;
  animation:tIslandUp .4s ease-out .05s forwards;
">
  <div class="t-c-row" style="display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
    <div class="t-c-copy" style="display:flex; gap:12px; align-items:flex-start; min-width:220px; flex:1 1 300px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex:0 0 auto; margin-top:2px;">
        <path d="M20.5 12.5a8.5 8.5 0 11-9-8.48 3 3 0 003.48 3.48 3 3 0 003.52 3.52 3 3 0 002 1.48z" fill="#FFD966" stroke="#1f1f1f" stroke-width="1"/>
        <circle cx="8.5" cy="9.5" r="1.2" fill="#1f1f1f"/>
        <circle cx="11" cy="15" r="1" fill="#1f1f1f"/>
        <circle cx="15.2" cy="11.2" r="1.1" fill="#1f1f1f"/>
      </svg>
      <div style="font-size:14px; line-height:1.45;">
        Tangled uses cookies to make your experience smoother and safer. Learn more in our <a href="cookies-policy.html" style="color:#1955D7; text-decoration:underline;">cookies policy</a>.
      </div>
    </div>
    <div id="t-c-btns" style="display:flex; gap:8px; align-items:center; justify-content:flex-end; flex:0 0 auto;">
      <button id="t-c-opt-out" style="background:#fff; color:#1f1f1f; border:1px solid #d9d9df; border-radius:12px; padding:10px 14px; font-weight:500; cursor:pointer; min-height:40px;">Reject all</button>
      <button id="t-c-opt-in" style="background:#1f1f1f; color:#fff; border:0; border-radius:12px; padding:10px 16px; font-weight:500; cursor:pointer; min-height:40px;">Accept all</button>
    </div>
  </div>
  <style>
    @keyframes tIslandUp { from { transform: translate(-50%, 100%); opacity:0; } to { transform: translate(-50%, 0); opacity:1; } }
    @media (prefers-reduced-motion: reduce){ #t-consent-island{ animation:none !important; } }
    @media (max-width: 768px){
      #t-c-btns { width: 100%; display: flex; gap: 8px; margin-top: 8px; }
      #t-c-btns button { flex: 1; height: 44px; }
    }
  </style>
</div>`;

    document.body.insertAdjacentHTML('beforeend', bannerHtml);

    const bind = () => {
      const island = document.getElementById('t-consent-island');
      const inBtn = document.getElementById('t-c-opt-in');
      const outBtn = document.getElementById('t-c-opt-out');
      if (!island) return;

      inBtn?.addEventListener('click', () => {
        window.TangledCookies.setConsent({ analytics: true, experiments: true, marketing: false });
        island.style.transition = 'opacity 0.3s ease';
        island.style.opacity = '0';
        setTimeout(() => island.remove(), 300);
      });
      outBtn?.addEventListener('click', () => {
        window.TangledCookies.setConsent({ analytics: false, experiments: false, marketing: false });
        island.style.transition = 'opacity 0.25s ease';
        island.style.opacity = '0';
        setTimeout(() => island.remove(), 250);
      });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  }
})();
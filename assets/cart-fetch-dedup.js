<script> 
 
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────────
  const DEDUP_WINDOW_MS = 500;   // Reuse a resolved response for this long
  const DEBUG = true;            // Console logging (set false for production)

  // ── State ─────────────────────────────────────────────────────────────────
  const _originalFetch = window.fetch;
  let _enabled = true;

  //  _inflight[url] = { promise, resolvedAt, response }
  //  - While the fetch is pending:  promise is set, resolvedAt is null
  //  - After it resolves:           resolvedAt is set, cleared after DEDUP_WINDOW_MS
  const _inflight = {};

  // Stats
  let _stats = { actual: 0, deduped: 0, cloned: 0 };

  const _log = (...args) => {
    if (DEBUG) console.log('%c[CartDedup]', 'color:#f9a825; font-weight:bold', ...args);
  };

  // ── URL matching ──────────────────────────────────────────────────────────
  const _isCartUrl = (url) => {
    if (typeof url !== 'string') return false;
    // Match /cart.js and /cart.json (GET only — POST to /cart/update.js etc. must pass through)
    return /\/cart\.(js|json)(\?.*)?$/.test(url);
  };

  const _isGetRequest = (args) => {
    // fetch(url) or fetch(url, { method: 'GET' }) or fetch(Request)
    const init = args[1];
    if (!init) return true; // no options = GET
    if (typeof init.method === 'string' && init.method.toUpperCase() !== 'GET') return false;
    if (args[0] instanceof Request && args[0].method.toUpperCase() !== 'GET') return false;
    return true;
  };

  const _normalizeUrl = (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    // Strip query params for dedup key — /cart.js?t=123 and /cart.js share a response
    try {
      const u = new URL(url, window.location.origin);
      return u.pathname; // e.g. "/cart.js"
    } catch {
      return url;
    }
  };

  // ── Patched fetch ─────────────────────────────────────────────────────────
  window.fetch = function (...args) {
    const rawUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    // Only intercept GET /cart.js and /cart.json
    if (!_enabled || !_isCartUrl(rawUrl) || !_isGetRequest(args)) {
      return _originalFetch.apply(this, args);
    }

    const key = _normalizeUrl(rawUrl);
    const entry = _inflight[key];

    // Case 1: There's an in-flight request — piggyback on it
    if (entry && entry.promise && !entry.resolvedAt) {
      _stats.deduped++;
      _log('DEDUP (in-flight) ' + key + ' — ' + _stats.deduped + ' saved so far');
      return entry.promise.then(r => r.clone());
    }

    // Case 2: A recently resolved response is still within the dedup window
    if (entry && entry.resolvedAt && (Date.now() - entry.resolvedAt < DEDUP_WINDOW_MS) && entry.response) {
      _stats.cloned++;
      _log('CLONE (recent) ' + key + ' — resolved ' + (Date.now() - entry.resolvedAt) + 'ms ago');
      return Promise.resolve(entry.response.clone());
    }

    // Case 3: No in-flight or recent response — make the actual request
    _stats.actual++;
    _log('FETCH (actual) ' + key + ' — request #' + _stats.actual);

    const fetchPromise = _originalFetch.apply(this, args).then(response => {
      // Store the response for cloning
      const cloneForStorage = response.clone();
      _inflight[key] = {
        promise: null,
        resolvedAt: Date.now(),
        response: cloneForStorage,
      };
      // Clear after dedup window
      setTimeout(() => {
        if (_inflight[key]?.resolvedAt) {
          delete _inflight[key];
        }
      }, DEDUP_WINDOW_MS + 50);
      return response;
    }).catch(err => {
      // On error, clear so next caller retries
      delete _inflight[key];
      throw err;
    });

    _inflight[key] = { promise: fetchPromise, resolvedAt: null, response: null };
    return fetchPromise.then(r => r.clone());
  };

  // ── Public API ────────────────────────────────────────────────────────────
  window.cartDedup = {
    report() {
      const total = _stats.actual + _stats.deduped + _stats.cloned;
      console.log('%c── Cart Fetch Dedup Report ──', 'color:#f9a825; font-weight:bold; font-size:13px');
      console.log('  Total fetch() calls to /cart.js|json:  ' + total);
      console.log('  Actual HTTP requests:                  ' + _stats.actual);
      console.log('  Deduplicated (in-flight):              ' + _stats.deduped);
      console.log('  Cloned (recent response):              ' + _stats.cloned);
      var saved = _stats.deduped + _stats.cloned;
      var pct = total > 0 ? ((saved / total) * 100).toFixed(0) : 0;
      console.log('  Requests saved:                        ' + saved + ' (' + pct + '%)');
      console.log('%c────────────────────────────', 'color:#f9a825');
    },

    stats() {
      return { ..._stats };
    },

    reset() {
      _stats = { actual: 0, deduped: 0, cloned: 0 };
      Object.keys(_inflight).forEach(k => delete _inflight[k]);
      _log('Stats and cache reset');
    },

    disable() {
      _enabled = false;
      _log('Dedup DISABLED — all fetches pass through');
    },

    enable() {
      _enabled = true;
      _log('Dedup ENABLED');
    },

    teardown() {
      window.fetch = _originalFetch;
      _enabled = false;
      _log('Teardown complete — original fetch restored');
    },
  };

  _log('Loaded — dedup window: ' + DEDUP_WINDOW_MS + 'ms');

})();
</script>
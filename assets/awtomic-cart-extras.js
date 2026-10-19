/**
 * Awtomic Cart Rollup v1.1.1 — OPTIMIZED + INSTRUMENTED
 * ──────────────────────────────────────────────────────
 * Based on v1.0.0 diagnostic findings. Key optimizations:
 *
 *   1. Deduplicated in-flight /cart.js fetches (single promise reuse)
 *   2. Deduplicated in-flight /products/*.js fetches (promise-level cache)
 *   3. Synchronous isProcessing guard BEFORE first await (kills double-fire)
 *   4. Debounced analyzeCart (100ms) — coalesces rapid-fire triggers
 *   5. Non-blocking init — event listeners set up immediately, prewarm is fire-and-forget
 *   6. Cart data passed through from init → analyzeCart (no redundant fetch)
 *   7. Body observer self-disconnects after finding Rebuy
 *   8. Theme detected once at init; not re-detected every cycle
 *
 * Still includes diagnostic probes — run awtomicDiag.report() to compare.
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTICS INFRASTRUCTURE (same as instrumented version)
  // ══════════════════════════════════════════════════════════════════════════
  const _diagStartTime = performance.now();
  const _diagEvents = [];
  const _diagFetches = [];
  let _diagCycleCount = 0;

  const _now = () => performance.now();
  const _elapsed = () => (_now() - _diagStartTime).toFixed(1);
  const _fmt = (ms) => `${ms.toFixed(1)}ms`;
  const _ts = () => `+${_elapsed()}ms`;

  const _event = (label, detail) => {
    const e = { ts: _now() - _diagStartTime, label, detail };
    _diagEvents.push(e);
    console.log(
      `%c[diag ${_ts()}] %c${label}` + (detail ? ` %c— ${detail}` : ''),
      'color:#888', 'color:#69f0ae', detail ? 'color:#aaa' : ''
    );
    return e;
  };

  const _startTimer = (label) => {
    const start = _now();
    const evt = _event(`▶ ${label}`);
    return (detail) => {
      const ms = _now() - start;
      evt.duration = ms;
      evt.detail = `${_fmt(ms)}` + (detail ? ` — ${detail}` : '');
      console.log(
        `%c[diag ${_ts()}] %c■ ${label} %c${_fmt(ms)}` + (detail ? ` — ${detail}` : ''),
        'color:#888', 'color:#ffd54f', 'color:#4fc3f7'
      );
      return ms;
    };
  };

  // Intercept fetch for cart/product URLs (diagnostic only)
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const isRelevant = url.includes('/cart') || url.includes('/products/');
    if (!isRelevant) return _origFetch.apply(this, args);

    const startTs = _now() - _diagStartTime;
    const end = _startTimer(`fetch ${url}`);
    try {
      const response = await _origFetch.apply(this, args);
      const clone = response.clone();
      let size = '?';
      try { const t = await clone.text(); size = `${(t.length/1024).toFixed(1)}KB`; } catch(_){}
      const ms = end(`${response.status} / ${size}`);
      _diagFetches.push({ url, startTs, endTs: startTs + ms, ms, status: response.status, size });
      return response;
    } catch (err) {
      const ms = end(`FAILED: ${err.message}`);
      _diagFetches.push({ url, startTs, endTs: startTs + ms, ms, status: 'ERR', size: '0' });
      throw err;
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // THEME DEFINITIONS (unchanged)
  // ══════════════════════════════════════════════════════════════════════════

  var has = function (s) {
    return !!document.querySelector(s);
  };

  var TABLE_SELECTORS = {
    cartItemRow: 'tr[data-key]',
    title: '.cart-items__title',
    image: '.cart-items__media-image',
    imageContainer: '.cart-items__media-container',
    imageLink: '.cart-items__link',
    variants: '.cart-items__variants',
    variantsWrapper: '.cart-items__variants-wrapper',
    unitPriceWrapper: '.cart-items__unit-price-wrapper',
    price: '.cart-items__price',
    compareAtPrice: '.compare-at-price',
    qtyInput: 'input[type="number"]',
    qtyButtons: '.quantity-minus, .quantity-plus',
    removeButton: '.cart-items__remove',
  };

  var BUBBLE = {
    count: '.cart-bubble__text-count',
    visuallyHidden: '.cart-bubble__text .visually-hidden',
    container: '.cart-bubble',
  };

  var BUBBLE_WIDE = {
    count:
      '[data-testid="cart-bubble"], .cart-count, [id*="cart-count"], .cart-count-bubble span[aria-hidden="true"], .cart-bubble__text-count',
    visuallyHidden: '.visually-hidden',
    container: '.cart-bubble, .cart-count-bubble',
  };

  var themeDefinitions = {
    themes: {
      tinker: {
        name: 'Tinker',
        detect: function () {
          return (
            has('dialog.cart-drawer__dialog') &&
            has('cart-items-component[data-drawer]')
          );
        },
        selectors: TABLE_SELECTORS,
        drawer: {
          selectors: 'dialog.cart-drawer__dialog[open], dialog[open]',
          visibilityCheck: function (el) { return el && el.hasAttribute('open'); },
          itemsComponent: 'cart-items-component[data-drawer]',
          closestContainer: 'dialog.cart-drawer__dialog',
        },
        cartBubble: BUBBLE,
      },
      horizon: {
        name: 'Horizon',
        detect: function () { return has('tr[data-key]') && has('.cart-items__title'); },
        selectors: TABLE_SELECTORS,
        drawer: {
          selectors: 'cart-drawer, [data-drawer], .cart-drawer, #cart-drawer',
          visibilityCheck: function (el) {
            return el && (el.offsetParent || el.hasAttribute('open') || el.classList.contains('active') || el.classList.contains('is-open'));
          },
          itemsComponent: 'cart-items-component[data-drawer]',
          closestContainer: 'cart-drawer, .cart-drawer',
        },
        cartBubble: BUBBLE,
      },
      wonder: {
        name: 'Wonder',
        detect: function () { return has('.wt-cart__item') || has('.wt-cart__list'); },
        selectors: {
          cartItemRow: 'li.wt-cart__item', title: '.wt-cart__item__name a',
          image: 'img.card__img', imageContainer: 'picture.wt-cart__item__thumb',
          imageLink: 'picture.wt-cart__item__thumb a.wt-cart__item__link',
          variants: '.options', variantsWrapper: '.wt-cart__item__data',
          unitPriceWrapper: '.wt-cart__item__price-wrapper', price: 'span.price.price--end',
          compareAtPrice: 's.cart-item__old-price', qtyInput: 'input.js-counter-quantity',
          qtyButtons: '.js-counter-button',
          removeButton: 'cart-remove-button a, a.wt-cart__item__remove',
        },
        drawer: {
          selectors: 'cart-drawer-items.wt-cart__drawer__items, .wt-cart__drawer__body',
          visibilityCheck: function (el) { return el && el.offsetParent !== null; },
          itemsComponent: 'cart-drawer-items.wt-cart__drawer__items',
          closestContainer: '.wt-cart__drawer__body',
        },
        cartBubble: BUBBLE_WIDE,
      },
      dawn: {
        name: 'Dawn',
        detect: function () {
          var onCart = window.location.pathname.includes('/cart');
          return has('quantity-popover') || has('cart-remove-button') || has('cart-items') ||
            (onCart && (has('.cart-item__name') || has('.cart-item__image-container')));
        },
        selectors: {
          cartItemRow: 'tr.cart-item, .cart-item', title: '.cart-item__name, a.cart-item__name',
          image: '.cart-item__image', imageContainer: '.cart-item__image-container',
          imageLink: 'a.cart-item__link', variants: '.product-option',
          variantsWrapper: '.cart-item__details', unitPriceWrapper: '.unit-price, .cart-item__totals',
          price: '.price--end, .product-option', compareAtPrice: '.price--end',
          qtyInput: 'input.quantity__input', qtyButtons: '.quantity__button',
          removeButton: 'cart-remove-button a, .cart-remove-button a',
        },
        drawer: null,
        cartBubble: { count: '.cart-count-bubble span[aria-hidden="true"]', visuallyHidden: '.cart-count-bubble .visually-hidden', container: '.cart-count-bubble' },
      },
      supply: {
        name: 'Supply',
        detect: function () {
          return (has('#CartDrawer.drawer, .drawer#CartDrawer') || has('[data-products]') || window.location.pathname.includes('/cart')) && has('.cart__items, .cart__item');
        },
        selectors: {
          cartItemRow: '.cart__item[data-key]', title: '.cart__item-name',
          image: '.cart__image img', imageContainer: '.cart__image',
          imageLink: '.cart__image a', variants: '.cart__item--variants',
          variantsWrapper: '.cart__item-details', unitPriceWrapper: '.cart__item-price-col',
          price: '.cart__price', compareAtPrice: '.cart__price--strikethrough',
          qtyInput: 'input.js-qty__num', qtyButtons: '.js-qty__adjust',
          removeButton: '.cart__remove a',
        },
        drawer: {
          selectors: '#CartDrawer.drawer--is-open, .drawer.drawer--is-open',
          visibilityCheck: function (el) { return el && el.classList.contains('drawer--is-open'); },
          itemsComponent: '.cart__items', closestContainer: '#CartDrawer, .drawer',
        },
        cartBubble: BUBBLE_WIDE,
      },
      rebuy: {
        name: 'Rebuy',
        detect: function () { return has('#rebuy-cart, .rebuy-cart'); },
        selectors: {
          cartItemRow: 'li.rebuy-cart__flyout-item',
          title: '.rebuy-cart__flyout-item-product-title',
          image: '.rebuy-cart__flyout-item-media img',
          imageContainer: '.rebuy-cart__flyout-item-media',
          imageLink: '.rebuy-cart__flyout-item-media a',
          variants: '.rebuy-cart__flyout-item-discount-message',
          variantsWrapper: '.rebuy-cart__flyout-item-info',
          unitPriceWrapper: '.rebuy-cart__flyout-item-price',
          price: '.rebuy-money.sale span[tabindex], .rebuy-money span[tabindex]',
          compareAtPrice: '.rebuy-money.compare-at span',
          qtyInput: '.rebuy-cart__flyout-item-quantity-widget-label',
          qtyButtons: '.rebuy-cart__flyout-item-quantity-widget-button',
          removeButton: '.rebuy-cart__flyout-item-remove',
        },
        drawer: {
          selectors: '#rebuy-cart.is-visible, #rebuy-cart[aria-hidden="false"], .rebuy-cart.is-visible',
          visibilityCheck: function (el) {
            return el && (el.classList.contains('is-visible') || el.getAttribute('aria-hidden') === 'false');
          },
          itemsComponent: 'ul[data-smartcart-items]',
          closestContainer: '#rebuy-cart, .rebuy-cart',
        },
        cartBubble: BUBBLE_WIDE,
      },
      debut: {
        name: 'Debut',
        detect: function () { return has('[data-section-type="cart-template"]') && has('.list-view-item__title'); },
        selectors: {
          cartItemRow: 'tr.cart__row', title: '.list-view-item__title a',
          image: 'img.cart__image', imageContainer: '.cart__image-wrapper',
          imageLink: '.cart__image-wrapper a', variants: '.cart__meta-text',
          variantsWrapper: '.cart__meta', unitPriceWrapper: '.cart__price-wrapper',
          price: 'td.text-right.small--hide > div', compareAtPrice: '.cart__original-price',
          qtyInput: 'input.cart__qty-input', qtyButtons: '.cart__qty-adjust',
          removeButton: 'a.cart__remove',
        },
        drawer: null,
        cartBubble: { count: '#CartCount > span:first-child', visuallyHidden: '#CartCount .icon__fallback-text', container: '#CartCount' },
      },
      bls: {
        name: 'BLS',
        detect: function () { return has('.bls-minicart-wrapper') && has('.bls-items'); },
        selectors: {
          cartItemRow: 'div.cart-item', title: '.bls-minicart-product-name a',
          image: '.bls-minicart-product__image img', imageContainer: '.bls-minicart-product__image',
          imageLink: '.bls-minicart-product__image a', variants: '.bls-minicart-item-variant',
          variantsWrapper: '.bls-minicart-product-info', unitPriceWrapper: '.bls-minicart-item-prices',
          price: '.bls-minicart-item-price', compareAtPrice: '.bls-minicart-item-original-price',
          qtyInput: 'input.bls-quantity-input', qtyButtons: '.quantity__button',
          removeButton: 'mini-cart-remove-button a, .bls-minicart-item-remove a',
        },
        drawer: {
          selectors: '.bls-minicart-wrapper',
          visibilityCheck: function (el) {
            return el && (el.offsetParent !== null || el.classList.contains('active') || el.classList.contains('is-open') || el.classList.contains('open'));
          },
          itemsComponent: '.bls-items', closestContainer: '.bls-minicart-wrapper',
        },
        cartBubble: BUBBLE_WIDE,
      },
      generic: {
        name: 'Generic',
        detect: function () { return true; },
        selectors: {
          cartItemRow: 'tr[data-key], li[data-key], div[data-key]',
          title: 'a[href*="/products/"]', image: 'img[src*="cdn.shopify.com"]',
          imageContainer: '.image-container, .media-container', imageLink: 'a[href*="/products/"]',
          variants: 'dl, .variant', variantsWrapper: '.variants-wrapper, .product-options',
          unitPriceWrapper: '.price-wrapper, .unit-price', price: '.price, .money',
          compareAtPrice: '.compare-at-price, .was-price', qtyInput: 'input[type="number"]',
          qtyButtons: 'button[name*="plus"], button[name*="minus"]',
          removeButton: 'button[class*="remove"], a[class*="remove"]',
        },
        drawer: {
          selectors: 'cart-drawer, [data-drawer], .cart-drawer, #cart-drawer, dialog[open]',
          visibilityCheck: function (el) {
            return el && (el.offsetParent || el.hasAttribute('open') || el.classList.contains('active') || el.classList.contains('is-open'));
          },
          itemsComponent: 'cart-items-component[data-drawer]',
          closestContainer: 'cart-drawer, .cart-drawer, dialog',
        },
        cartBubble: BUBBLE_WIDE,
      },
    },
    detectionOrder: ['rebuy','tinker','horizon','wonder','dawn','supply','debut','bls','generic'],
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OPTIMIZED CART EXTRAS
  // ══════════════════════════════════════════════════════════════════════════

  const customConfig = window.awtomicCartExtrasConfig || {};
  const DEBUG_MODE = false;
  const debug = (...args) => console.log('[Awtomic Cart Rollup]', ...args);

  const isRebuy = (name) => name === 'Rebuy' || name === 'rebuy';
  const isWonder = (name) => name === 'Wonder' || name === 'wonder';
  const isBls = (name) => name === 'BLS' || name === 'bls';
  const isDirectTheme = (name) => isRebuy(name) || name === 'Supply' || isWonder(name) || isBls(name);

  const detectTheme = () => {
    const endDetect = _startTimer('detectTheme');
    if (customConfig.theme && typeof customConfig.theme === 'object') {
      endDetect('custom theme');
      return {
        name: customConfig.theme.name || 'Custom',
        detect: customConfig.theme.detect || (() => true),
        selectors: customConfig.theme.selectors || {},
        drawer: customConfig.theme.drawer ?? null,
        cartBubble: customConfig.theme.cartBubble || null,
      };
    }
    for (const key of themeDefinitions.detectionOrder) {
      const theme = themeDefinitions.themes[key];
      if (theme?.detect?.()) { endDetect(theme.name); return theme; }
    }
    endDetect('fallback/generic');
    return themeDefinitions.themes.generic || { name: 'Fallback', detect: () => true, selectors: {}, drawer: null, cartBubble: null };
  };

  // ── OPT #8: Detect theme once. Re-detect only when Rebuy element appears. ──
  let THEME = detectTheme();
  _event('init', `Theme: ${THEME.name}, Drawer: ${THEME.drawer ? 'Yes' : 'No'}`);

  // ── Anti-flicker CSS (unchanged) ──────────────────────────────────────────

  const injectAntiFlickerCSS = () => {
    const style = document.createElement('style');
    style.id = 'awtomic-cart-antiflicker';
    style.textContent = `
      body:not(.awtomic-cart-processed) .cart__items:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) [data-products]:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) .cart-items__table:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) cart-items-component[data-drawer]:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) .wt-cart__list:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) .bls-items:not(.awtomic-ready),
      body:not(.awtomic-cart-processed) [data-section-type="cart-template"] table tbody:not(.awtomic-ready) {
        visibility: hidden !important;
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);
    const permanent = document.createElement('style');
    permanent.id = 'awtomic-cart-rollup-styles';
    permanent.textContent = `
      tbody.awtomic-original { display: none !important; }
      tbody.awtomic-processed { display: table-row-group !important; }
      .rebuy-cart__flyout-item-subscription { display: none !important; }
    `;
    document.head.appendChild(permanent);
  };

  const removeAntiFlickerCSS = () => {
    document.body.classList.add('awtomic-cart-processed');
    setTimeout(() => {
      const style = document.getElementById('awtomic-cart-antiflicker');
      if (style) style.remove();
    }, 1000);
  };

  injectAntiFlickerCSS();

  // ── State ─────────────────────────────────────────────────────────────────

  let isProcessing = false;
  let observers = { drawer: null, rebuy: null };
  const productCache = new Map();
  const lastCartData = { page: null, drawer: null, rebuy: null };
  const rollupAlreadyDone = { page: false, drawer: false, rebuy: false };

  // ══════════════════════════════════════════════════════════════════════════
  // OPT #1: Deduplicated /cart.js fetch — single in-flight promise
  // ══════════════════════════════════════════════════════════════════════════
  let _cartFetchInflight = null;
  let _cartFetchLastTime = 0;
  const CART_FETCH_DEDUP_MS = 300; // Reuse recent result within this window

  const fetchCartData = async () => {
    const now = Date.now();

    // If there's already an in-flight request, piggyback on it
    if (_cartFetchInflight) {
      _event('fetchCartData', 'DEDUPED — reusing in-flight promise');
      return _cartFetchInflight;
    }

    const doFetch = async () => {
      try {
        const response = await fetch('/cart.js');
        if (!response.ok) throw new Error(`Cart fetch failed: ${response.status}`);
        return await response.json();
      } catch (err) {
        return null;
      } finally {
        // Keep the promise around briefly so rapid successive calls reuse it
        setTimeout(() => {
          _cartFetchInflight = null;
        }, CART_FETCH_DEDUP_MS);
      }
    };

    _cartFetchInflight = doFetch();
    _cartFetchLastTime = now;
    return _cartFetchInflight;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OPT #2: Deduplicated product fetch — promise-level cache
  // ══════════════════════════════════════════════════════════════════════════
  const _productFetchInflight = new Map();

  const fetchBundleProductData = async (bundleHandle, variantId) => {
    const cacheKey = `${bundleHandle}:${variantId}`;

    // Return from resolved cache
    if (productCache.has(cacheKey)) {
      _event('productCache HIT', cacheKey);
      return productCache.get(cacheKey);
    }

    // Return from in-flight promise (prevents duplicate simultaneous fetches)
    if (_productFetchInflight.has(cacheKey)) {
      _event('productFetch DEDUPED', cacheKey);
      return _productFetchInflight.get(cacheKey);
    }

    _event('productCache MISS', cacheKey);
    const promise = (async () => {
      try {
        const response = await fetch(`/products/${bundleHandle}.js`);
        if (!response.ok) throw new Error(`Product fetch failed: ${response.status}`);
        const productData = await response.json();
        const result = {
          product: productData,
          variant: productData.variants.find(
            (v) => v.id.toString() === variantId.split('/').pop(),
          ),
        };
        productCache.set(cacheKey, result);
        return result;
      } catch (err) {
        return null;
      } finally {
        _productFetchInflight.delete(cacheKey);
      }
    })();

    _productFetchInflight.set(cacheKey, promise);
    return promise;
  };

  // ── Helpers (unchanged) ───────────────────────────────────────────────────

  const groupBundleItems = (cartData) => {
    if (!cartData?.items) return {};
    return cartData.items.reduce((groups, item) => {
      const bundleId = item.properties?.['_bundleUid'];
      if (bundleId) {
        if (!groups[bundleId]) groups[bundleId] = { items: [], properties: item.properties };
        groups[bundleId].items.push(item);
      }
      return groups;
    }, {});
  };

  const getCartContext = () => {
    const endCtx = _startTimer('getCartContext');
    const contexts = [];

    const rebuyCart = document.querySelector('#rebuy-cart, .rebuy-cart');
    if (rebuyCart && (rebuyCart.classList.contains('is-visible') || rebuyCart.getAttribute('aria-hidden') === 'false')) {
      contexts.push({ type: 'rebuy', container: rebuyCart, theme: 'rebuy' });
    }

    const drawerConfig = THEME.drawer;
    if (drawerConfig && !isRebuy(THEME.name)) {
      const drawer = document.querySelector(drawerConfig.selectors);
      if (drawer && drawerConfig.visibilityCheck(drawer)) {
        contexts.push({ type: 'drawer', container: drawer, theme: THEME.name });
      } else {
        const drawerCartItems = document.querySelector(drawerConfig.itemsComponent);
        if (drawerCartItems?.offsetParent) {
          const closestDrawer = drawerCartItems.closest(drawerConfig.closestContainer);
          contexts.push({ type: 'drawer', container: closestDrawer || drawerCartItems, theme: THEME.name });
        }
      }
    }

    const isCartPage = window.location.pathname.includes('/cart') ||
      document.querySelector('.cart-page, [data-cart-page], main.cart, cart-items');
    if (isCartPage && !isRebuy(THEME.name)) {
      contexts.push({ type: 'page', container: document, theme: THEME.name });
    }

    endCtx(`${contexts.length} context(s): ${contexts.map(c => c.type).join(', ') || 'none'}`);
    return contexts.length > 0 ? contexts : null;
  };

  const findAndMatchCartItems = (cartData, tbody, selectors, themeName) => {
    const endMatch = _startTimer('findAndMatchCartItems');
    const effectiveSelectors = selectors || THEME.selectors;
    const effectiveTheme = themeName || THEME.name;
    const matchedCartItemIndices = new Set();

    let rows = Array.from(tbody.querySelectorAll(effectiveSelectors.cartItemRow));
    if (rows.length === 0 && tbody.tagName === 'TBODY') {
      rows = Array.from(tbody.querySelectorAll(':scope > tr'));
    }

    const result = rows.map((row) => {
      let cartItem;
      let cartItemIndex = -1;

      if (row.dataset.key) {
        cartItemIndex = cartData.items.findIndex((item) => item.key === row.dataset.key);
        if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
      }

      if (!cartItem) {
        const keyInput = row.querySelector('input[data-key]');
        if (keyInput?.dataset.key) {
          cartItemIndex = cartData.items.findIndex((item, idx) => !matchedCartItemIndices.has(idx) && item.key === keyInput.dataset.key);
          if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
        }
      }

      if (!cartItem && isRebuy(effectiveTheme)) {
        const classList = Array.from(row.classList);
        const bundleUidClass = classList.find((c) => c.startsWith('property-_bundleuid:'));
        if (bundleUidClass) {
          const bundleUidFromClass = bundleUidClass.split(':')[1];
          cartItemIndex = cartData.items.findIndex((item, idx) => !matchedCartItemIndices.has(idx) && item.properties?.['_bundleUid']?.replace(/-/g, '') === bundleUidFromClass);
          if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
        }
        if (!cartItem) {
          const productClass = classList.find((c) => c.startsWith('product-') && !c.startsWith('product-id-'));
          if (productClass) {
            const handle = productClass.replace('product-', '');
            cartItemIndex = cartData.items.findIndex((item, idx) => !matchedCartItemIndices.has(idx) && item.handle === handle);
            if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
          }
        }
      } else if (!cartItem && effectiveTheme === 'Debut') {
        const qtyInput = row.querySelector('input.cart__qty-input');
        const inputId = qtyInput?.id;
        if (inputId?.startsWith('updates_')) {
          const key = inputId.replace('updates_', '');
          cartItemIndex = cartData.items.findIndex((item, idx) => !matchedCartItemIndices.has(idx) && item.key === key);
          if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
        }
      } else if (!cartItem && isBls(effectiveTheme)) {
        const blsId = row.id;
        if (blsId?.startsWith('bls-minicart-product-')) {
          const key = blsId.replace('bls-minicart-product-', '');
          cartItemIndex = cartData.items.findIndex((item, idx) => !matchedCartItemIndices.has(idx) && item.key === key);
          if (cartItemIndex !== -1) cartItem = cartData.items[cartItemIndex];
        }
      } else if (!cartItem) {
        const idMatch = row.id?.match(/Cart(?:Drawer-)?Item-(\d+)/);
        if (idMatch) {
          const index = parseInt(idMatch[1]) - 1;
          cartItem = cartData.items[index];
          cartItemIndex = index;
        }
      }

      if (cartItemIndex !== -1) matchedCartItemIndices.add(cartItemIndex);
      return cartItem ? { row, cartItem } : null;
    }).filter(Boolean);

    endMatch(`${result.length}/${cartData.items.length} matched from ${rows.length} rows`);
    return result;
  };

  const formatPrice = (cents) => {
    if (typeof window !== 'undefined' && window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      try { return window.Shopify.formatMoney(cents); } catch (e) {}
    }
    return `$${(cents / 100).toFixed(2)}`;
  };

  const onDocReady = (fn) => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();
  const updateElement = (element, props) => element && Object.assign(element, props);
  const setStyles = (element, styles) => element && Object.assign(element.style, styles);
  const queryInRow = (row, selector, selectors) => {
    const effectiveSelectors = selectors || THEME.selectors;
    return row.querySelector(effectiveSelectors[selector]);
  };

  // ── DOM builders (unchanged) ──────────────────────────────────────────────

  const createBundleSubitem = (item) => {
    const subitem = document.createElement('div');
    subitem.className = 'bundle-subitem';
    subitem.style.cssText = 'display: flex; align-items: flex-start; margin-bottom: 8px;';
    if (item.image) {
      const img = Object.assign(document.createElement('img'), { src: item.image, alt: item.product_title });
      img.style.cssText = 'width: 30px; height: 30px; margin-right: 8px; object-fit: cover; flex-shrink: 0;';
      subitem.appendChild(img);
    }
    const details = document.createElement('div');
    details.className = 'bundle-subitem-details';
    details.style.cssText = 'flex: 1; font-size: 0.875em; line-height: 1.4;';
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'font-weight: 500;';
    titleDiv.textContent = item.product_title;
    details.appendChild(titleDiv);
    if (item.variant_title && item.variant_title !== 'Default Title') {
      const variantDiv = document.createElement('div');
      variantDiv.style.cssText = 'color: #6b7280; font-size: 0.9em;';
      variantDiv.textContent = item.variant_title;
      details.appendChild(variantDiv);
    }
    const qtyDiv = document.createElement('div');
    qtyDiv.style.cssText = 'color: #6b7280; font-size: 0.9em; margin-top: 2px;';
    qtyDiv.textContent = `Qty: ${item.quantity}`;
    details.appendChild(qtyDiv);
    subitem.appendChild(details);
    return subitem;
  };

  const updateBundlePrices = (bundleRow, items, selectors) => {
    // BOGO bundles: CartEnhancer owns the price rendering — skip here
    if (bundleRow.dataset.bogoFreeBundle === 'true' || bundleRow.dataset.bogoBaseBundle === 'true') {
      return;
    }

    const effectiveSelectors = selectors || THEME.selectors;
    const discountPercent =
      (typeof window !== 'undefined' && window.theme && window.theme.Discount && typeof window.theme.Discount.getDiscountPercent === 'function')
        ? window.theme.Discount.getDiscountPercent() || 0 : 0;
    const applyPct = (cents, pct) => {
      if (!pct) return cents;
      if (window.theme?.Discount?.applyDiscount) return window.theme.Discount.applyDiscount(cents, pct);
      return Math.round(cents * (1 - pct / 100));
    };
    const bundleOriginalPrice = items.reduce((sum, item) => sum + item.original_line_price, 0);
    const bundleDiscountedPrice = applyPct(bundleOriginalPrice, discountPercent);
    const displayFinal = bundleDiscountedPrice;
    const displayCompareAt = discountPercent ? bundleOriginalPrice : 0;

    const unitPriceWrapper = queryInRow(bundleRow, 'unitPriceWrapper', effectiveSelectors);
    if (unitPriceWrapper) {
      updateElement(unitPriceWrapper.querySelector('span:not(.visually-hidden):not(.compare-at-price)'), { textContent: formatPrice(displayFinal) });
      if (displayCompareAt > displayFinal) {
        updateElement(unitPriceWrapper.querySelector(effectiveSelectors.compareAtPrice), { textContent: formatPrice(displayCompareAt) });
      }
    }

    if (isRebuy(THEME.name)) {
      const priceWrap = bundleRow.querySelector('.rebuy-cart__flyout-item-price');
      if (priceWrap) {
        if (discountPercent && displayCompareAt > displayFinal) {
          priceWrap.innerHTML = `<span class="rebuy-money sale"><span class="sr-only">Sale price</span><span>${formatPrice(displayFinal)}</span></span><span class="rebuy-money compare-at"><span class="sr-only">Compare At Price</span><span>${formatPrice(displayCompareAt)}</span></span>`;
        } else {
          priceWrap.innerHTML = `<span class="rebuy-money"><span class="sr-only">Item Price</span><span>${formatPrice(displayFinal)}</span></span>`;
        }
      }
      const titleEl = bundleRow.querySelector('.rebuy-cart__flyout-item-product-title');
      let badge = bundleRow.querySelector('.rebuy-cart__flyout-item-discount-message');
      if (discountPercent) {
        const badgeText = `Discount Applied ${discountPercent}%`;
        if (badge) { badge.textContent = badgeText; }
        else if (titleEl) { titleEl.insertAdjacentHTML('afterend', `<div class="rebuy-cart__flyout-item-discount-message">${badgeText}</div>`); }
      } else if (badge) { badge.remove(); }
      return;
    }

    let priceEl = queryInRow(bundleRow, 'price', effectiveSelectors);
    if (!priceEl) priceEl = bundleRow.querySelector('td.total strong, td.total, [class*="total"] strong, [class*="price"] strong');
    updateElement(priceEl, { textContent: formatPrice(displayFinal) });
  };

  const disableBundleQuantityControls = (bundleRow, themeName, selectors) => {
    const effectiveTheme = themeName || THEME.name;
    const effectiveSelectors = selectors || THEME.selectors;
    const qtyElement = queryInRow(bundleRow, 'qtyInput', effectiveSelectors);
    if (isRebuy(effectiveTheme)) {
      if (qtyElement) {
        const textNodes = Array.from(qtyElement.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
        if (textNodes.length > 0) textNodes[0].textContent = ' 1 ';
      }
    } else {
      updateElement(qtyElement, { value: '1', readOnly: true, disabled: true });
    }
    bundleRow.querySelectorAll(effectiveSelectors.qtyButtons).forEach((btn) =>
      setStyles(btn, { visibility: 'hidden', opacity: '0', pointerEvents: 'none' })
    );
  };

  const setupRemoveButton = (bundleRow, bundleId, selectors, themeName) => {
    const effectiveSelectors = selectors || THEME.selectors;
    const effectiveTheme = themeName || THEME.name;
    let removeButtons = Array.from(bundleRow.querySelectorAll(effectiveSelectors.removeButton));
    if (removeButtons.length === 0) {
      removeButtons = Array.from(bundleRow.querySelectorAll('button')).filter((btn) => {
        const text = btn.textContent.trim();
        return text === '×' || text === '✕' || text === 'x' || text.toLowerCase().includes('remove');
      });
    }
    if (removeButtons.length === 0) return;

    bundleRow.querySelectorAll('cart-remove-button, mini-cart-remove-button').forEach((crb) => {
      const plain = document.createElement('span');
      plain.className = crb.className;
      if (crb.id) plain.id = crb.id;
      while (crb.firstChild) plain.appendChild(crb.firstChild);
      crb.parentNode.replaceChild(plain, crb);
    });

    const handleRemoveClick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setStyles(bundleRow, { opacity: '0.6', pointerEvents: 'none' });
      try {
        const cartData = await fetchCartData();
        const updates = {};
        if (cartData) {
          cartData.items.forEach((item) => {
            if (item.properties?.['_bundleUid'] === bundleId) updates[item.key] = 0;
          });
        }
        const response = await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        });
        if (response.ok) {
          bundleRow.remove();
          const updatedCartData = await fetchCartData();
          if (updatedCartData) {
            updateCartBubble(updatedCartData);
            lastCartData.page = updatedCartData;
            lastCartData.drawer = updatedCartData;
            lastCartData.rebuy = updatedCartData;
          }
        } else {
          setStyles(bundleRow, { opacity: '', pointerEvents: '' });
        }
      } catch (error) {
        setStyles(bundleRow, { opacity: '', pointerEvents: '' });
      }
    };

    removeButtons.forEach((removeButton) => {
      const wrapper = document.createElement('div');
      const wrapperStyles = isRebuy(effectiveTheme)
        ? { display: 'inline-block', cursor: 'pointer', position: 'absolute', top: '0', right: '0', width: '20px', height: '20px' }
        : { display: 'inline-block', cursor: 'pointer' };
      setStyles(wrapper, wrapperStyles);
      removeButton.parentNode.insertBefore(wrapper, removeButton);
      wrapper.appendChild(removeButton);
      removeButton.href = '#';
      setStyles(removeButton, { pointerEvents: 'none' });
      wrapper.addEventListener('click', handleRemoveClick);
    });
  };

  const updateBundleImage = (bundleRow, product, themeName, selectors) => {
    const effectiveSelectors = selectors || THEME.selectors;
    const imageContainer = queryInRow(bundleRow, 'imageContainer', effectiveSelectors);
    if (!imageContainer) return;
    const productImage = product?.featured_image || product?.images?.[0]?.src;
    if (productImage) {
      const img = imageContainer.querySelector('img');
      if (img) { img.src = productImage; img.alt = product.title || ''; }
      const link = imageContainer.querySelector('a');
      if (link && product.handle) link.href = `/products/${product.handle}`;
    } else {
      imageContainer.style.visibility = 'hidden';
    }
  };

  const addVariantAndSubscription = (variantsWrapper, variant, subscription) => {
    if (!variantsWrapper || !variant) return;
    const existingPropertyLists = Array.from(variantsWrapper.querySelectorAll('ul.list-unstyled'));
    if (variant.title && variant.title !== 'Default Title') {
      const variantDiv = Object.assign(document.createElement('div'), { className: 'cart-items__variant', textContent: variant.title });
      setStyles(variantDiv, { margin: '5px 0', display: 'block' });
      variantsWrapper.insertBefore(variantDiv, variantsWrapper.firstChild);
    }
    if (subscription?.selling_plan && !existingPropertyLists.find((ul) => ul.textContent.includes(subscription.selling_plan.name))) {
      const planList = Object.assign(document.createElement('ul'), { className: 'list-unstyled' });
      const planItem = document.createElement('li');
      planItem.textContent = subscription.selling_plan.name;
      planList.appendChild(planItem);
      planList.setAttribute('role', 'list');
      (existingPropertyLists[existingPropertyLists.length - 1] || variantsWrapper).parentNode.insertBefore(
        planList, existingPropertyLists[existingPropertyLists.length - 1]?.nextSibling || null
      );
    }
  };

  const updateCartBubble = (cartData) => {
    const bundleGroups = groupBundleItems(cartData);
    const bundleItemKeys = new Set(Object.values(bundleGroups).flatMap((g) => g.items.map((i) => i.key)));
    const bundleCount = Object.keys(bundleGroups).length;
    const standaloneCount = cartData.items.filter((i) => !bundleItemKeys.has(i.key)).reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalCount = bundleCount + standaloneCount;

    const bubbleConfig = THEME.cartBubble;
    if (bubbleConfig) {
      const containers = document.querySelectorAll(bubbleConfig.container);
      document.querySelectorAll(bubbleConfig.count).forEach((el) => { el.textContent = totalCount; });
      containers.forEach((container) => {
        container.querySelectorAll(bubbleConfig.visuallyHidden).forEach((el) => {
          el.textContent = THEME.name === 'Dawn' ? `${totalCount} items` : `Total items in cart: ${totalCount}`;
        });
      });
      containers.forEach((el) => el.classList.add('awtomic-ready'));
    }
  };

  // ── createBundleRows (OPT: parallel product fetch before loop) ────────────

  const createBundleRows = async (bundleGroups, matches, themeName, selectors) => {
    const endCreate = _startTimer('createBundleRows');
    const effectiveTheme = themeName || THEME.name;
    const effectiveSelectors = selectors || THEME.selectors;
    let bundlesCreated = 0;

    // OPT: Pre-fetch ALL bundle products in parallel before the loop
    const endPrefetch = _startTimer('  bundleProducts prefetch');
    await Promise.all(
      Object.values(bundleGroups)
        .filter(g => g.properties._bundleHandle && g.properties._variantId)
        .map(g => fetchBundleProductData(g.properties._bundleHandle, g.properties._variantId))
    );
    endPrefetch('all products resolved');

    for (const [bundleId, group] of Object.entries(bundleGroups)) {
      const endBundle = _startTimer(`bundle ${bundleId.slice(0, 8)}…`);

      const containerSelector = isRebuy(effectiveTheme) ? 'ul[data-smartcart-items]'
        : effectiveTheme === 'Supply' ? '.cart__items'
        : isWonder(effectiveTheme) ? 'ul.wt-cart__list'
        : isBls(effectiveTheme) ? '.bls-items' : 'tbody';
      const itemSelector = isRebuy(effectiveTheme) ? `li[data-bundle-id="${bundleId}"]`
        : effectiveTheme === 'Supply' ? `.cart__item[data-bundle-id="${bundleId}"]`
        : `[data-bundle-id="${bundleId}"]`;

      if (matches[0]?.row.closest(containerSelector)?.querySelector(itemSelector)) {
        endBundle('already exists, skipped');
        continue;
      }

      // Product data is now guaranteed in cache from the prefetch above
      const cacheKey = `${group.properties._bundleHandle}:${group.properties._variantId}`;
      const bundleProductData = productCache.get(cacheKey) || null;

      const firstMatch = matches.find((m) => m.cartItem.key === group.items[0].key);
      if (!firstMatch) { endBundle('no firstMatch'); continue; }

      const endDom = _startTimer(`DOM build ${bundleId.slice(0, 8)}…`);

      const bundleRow = isRebuy(effectiveTheme) ? firstMatch.row : firstMatch.row.cloneNode(true);
      Object.assign(bundleRow.dataset, {
        bundleId, bundleHandle: group.properties._bundleHandle,
        awtomicBundle: 'true', key: `bundle-${bundleId}`,
      });

      // Tag bundle row with BOGO status from child properties
      const isBogiFreeBundle = group.items.some(i => i.properties?.['_bogo-free-bundle'] === 'true');
      const isBogoBaseBundle = group.items.some(i => i.properties?.['_bogo-base-bundle'] === 'true');
      if (isBogiFreeBundle) bundleRow.dataset.bogoFreeBundle = 'true';
      if (isBogoBaseBundle) bundleRow.dataset.bogoBaseBundle = 'true';
      if (group.properties._bogoGroupId) bundleRow.dataset.bogoGroupId = group.properties._bogoGroupId;

      const oldVariants = bundleRow.querySelector(effectiveSelectors.variants);
      if (oldVariants) oldVariants.remove();
      if (isRebuy(effectiveTheme)) {
        const propsEl = bundleRow.querySelector('.rebuy-cart__flyout-item-properties');
        if (propsEl) propsEl.style.display = 'none';
      }

      const product = bundleProductData?.product || null;
      const variant = bundleProductData?.variant || null;
      const bundleTitle = product?.title || group.properties.bundle ||
        (group.properties._bundleName
          ? group.properties._bundleName.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          : 'Bundle');
      const bundleUrl = product
        ? `/products/${product.handle}${variant ? `?variant=${variant.id}` : ''}`
        : group.properties._bundleHandle ? `/products/${group.properties._bundleHandle}` : null;

      const allTitleLinks = bundleRow.querySelectorAll(effectiveSelectors.title);
      let titleEl = null;
      for (const link of allTitleLinks) { if (!link.querySelector('img')) { titleEl = link; break; } }
      if (!titleEl && allTitleLinks.length > 0) titleEl = allTitleLinks[0];
      if (titleEl) {
        titleEl.textContent = bundleTitle;
        if (bundleUrl) titleEl.href = bundleUrl;
        const titleCell = titleEl.closest('td, div, li') || titleEl.parentElement;
        if (titleCell) {
          titleCell.querySelectorAll('a[href*="/products/"]').forEach((link) => {
            if (link === titleEl) return;
            if (link.querySelector('img')) { link.querySelectorAll('img').forEach((img) => { img.style.visibility = 'hidden'; }); }
            else { link.remove(); }
          });
        }
      }

      updateBundleImage(bundleRow, product, effectiveTheme, effectiveSelectors);

      const variantsWrapper = bundleRow.querySelector(effectiveSelectors.variantsWrapper);
      let titleWrapper = null;
      if (titleEl && !variantsWrapper) {
        titleWrapper = document.createElement('div');
        titleWrapper.style.cssText = 'display: inline-block; vertical-align: top;';
        titleEl.parentNode.insertBefore(titleWrapper, titleEl);
        titleWrapper.appendChild(titleEl);
      }
      const subitemsTarget = variantsWrapper || titleWrapper || (titleEl && (titleEl.closest('td, div, li') || titleEl.parentElement));
      if (variantsWrapper && variant) {
        addVariantAndSubscription(variantsWrapper, variant, group.items[0].selling_plan_allocation);
      }
      if (subitemsTarget) {
        const subitemsContainer = Object.assign(document.createElement('div'), { className: 'bundle-subitems' });
        setStyles(subitemsContainer, { marginTop: '15px' });
        group.items.forEach((item) => subitemsContainer.appendChild(createBundleSubitem(item)));
        subitemsTarget.appendChild(subitemsContainer);
      }

      updateBundlePrices(bundleRow, group.items, effectiveSelectors);
      disableBundleQuantityControls(bundleRow, effectiveTheme, effectiveSelectors);
      setupRemoveButton(bundleRow, bundleId, effectiveSelectors, effectiveTheme);

      if (!isRebuy(effectiveTheme)) {
        firstMatch.row.parentNode.insertBefore(bundleRow, firstMatch.row);
      }

      endDom(`${group.items.length} subitems`);

      group.items.forEach((item) => {
        const match = matches.find((m) => m.cartItem.key === item.key);
        if (match) {
          if (isRebuy(effectiveTheme) && match.row === firstMatch.row) return;
          match.row.style.display = 'none';
          match.row.dataset.awtomicHidden = 'true';
        }
      });

      bundlesCreated++;
      endBundle(`created (${group.items.length} items)`);
    }

    endCreate(`${bundlesCreated} bundles`);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OPT #3 + #4: analyzeCart with synchronous guard + debounce
  // ══════════════════════════════════════════════════════════════════════════

  let _analyzeDebounceTimer = null;

  const analyzeCartCore = async (existingCartData) => {
    _diagCycleCount++;
    const cycleNum = _diagCycleCount;
    const endCycle = _startTimer(`analyzeCart #${cycleNum}`);

    // OPT #3: Synchronous guard — set BEFORE any await
    if (isProcessing) {
      endCycle('SKIPPED (already processing)');
      return;
    }
    isProcessing = true;

    try {
      // OPT #8: Skip re-detection unless theme is Generic (pre-Rebuy load)
      if (THEME.name === 'Generic') {
        const newTheme = detectTheme();
        if (newTheme.name !== 'Generic') {
          _event(`theme upgrade`, `${THEME.name} → ${newTheme.name}`);
          THEME = newTheme;
        }
      }

      const contexts = getCartContext();
      if (!contexts) {
        removeAntiFlickerCSS();
        endCycle('no contexts found');
        return;
      }

      // OPT #6: Use passed-in cart data if available, otherwise fetch once
      const endFetch = _startTimer(`  #${cycleNum} fetchCartData`);
      const cartData = existingCartData || await fetchCartData();
      if (!cartData) {
        endFetch('null');
        removeAntiFlickerCSS();
        endCycle('no cart data');
        return;
      }
      endFetch(`${cartData.items.length} items` + (existingCartData ? ' (reused)' : ''));

      for (const context of contexts) {
        if (rollupAlreadyDone[context.type]) {
          _event(`  #${cycleNum} skip ${context.type}`, 'already done');
          continue;
        }
        const endProcess = _startTimer(`  #${cycleNum} processCartContext(${context.type})`);
        await processCartContext(context, cartData);
        endProcess('done');
      }

      updateCartBubble(cartData);

      if (isRebuy(THEME.name)) {
        document.dispatchEvent(new CustomEvent('bundle-discount:applied'));
      }

      removeAntiFlickerCSS();
      endCycle(`${contexts.length} context(s) processed`);
    } catch (error) {
      console.error('[Awtomic Cart Rollup] Error in analyzeCart:', error);
      removeAntiFlickerCSS();
      endCycle(`ERROR: ${error.message}`);
    } finally {
      // OPT #3: Always release the lock
      isProcessing = false;
    }
  };

  // OPT #4: Debounced wrapper — coalesces triggers within 100ms
  const analyzeCart = (existingCartData) => {
    if (_analyzeDebounceTimer) clearTimeout(_analyzeDebounceTimer);
    _analyzeDebounceTimer = setTimeout(() => {
      _analyzeDebounceTimer = null;
      analyzeCartCore(existingCartData);
    }, 100);
  };

  // Immediate version for init (no debounce needed on first run)
  const analyzeCartImmediate = (existingCartData) => {
    if (_analyzeDebounceTimer) clearTimeout(_analyzeDebounceTimer);
    _analyzeDebounceTimer = null;
    return analyzeCartCore(existingCartData);
  };

  // ── processCartContext (unchanged logic) ──────────────────────────────────

  const processCartContext = async (context, cartData) => {
    const contextType = context.type;
    if (
      lastCartData[contextType]?.items.length === cartData.items.length &&
      lastCartData[contextType].items.every((item, i) => {
        const newItem = cartData.items[i];
        return newItem && item.key === newItem.key && item.quantity === newItem.quantity;
      })
    ) {
      _event(`processCartContext(${contextType})`, 'unchanged, skipped');
      return;
    }

    lastCartData[contextType] = cartData;

    let itemsContainer, originalContainer;

    try {
      const contextTheme = context.theme;
      const themeSelectors = isRebuy(contextTheme) ? themeDefinitions.themes.rebuy.selectors : THEME.selectors;

      const endFindContainer = _startTimer(`  findContainer(${contextType})`);

      if (isRebuy(contextTheme)) {
        itemsContainer = context.container.querySelector('ul[data-smartcart-items], .rebuy-cart__flyout-items');
        originalContainer = itemsContainer;
      } else if (isBls(contextTheme)) {
        itemsContainer = (context.type === 'drawer' ? context.container : document).querySelector('.bls-items');
        originalContainer = itemsContainer;
      } else if (contextTheme === 'Supply') {
        if (context.type === 'drawer') {
          itemsContainer = context.container.querySelector('.cart__items');
        } else {
          const dataProductsContainers = document.querySelectorAll('[data-products]');
          for (const container of dataProductsContainers) {
            if (container.querySelector('.cart__item')) { itemsContainer = container; break; }
          }
          if (!itemsContainer) itemsContainer = document.querySelector('[data-products], .cart__items');
        }
        originalContainer = itemsContainer;
      } else if (isWonder(contextTheme)) {
        itemsContainer = (context.type === 'drawer' ? context.container : document).querySelector('ul.wt-cart__list');
        originalContainer = itemsContainer;
      } else {
        const searchRoot = context.type === 'drawer' ? context.container : document;
        let cartTable = searchRoot.querySelector('.cart-items__table, table.cart-items');
        if (!cartTable) cartTable = searchRoot.querySelector('form[action*="/cart"] table');
        originalContainer = cartTable?.querySelector('tbody');
        itemsContainer = cartTable;
      }

      endFindContainer(originalContainer ? 'found' : 'NOT FOUND');
      if (!originalContainer) return;

      if (!isDirectTheme(contextTheme)) {
        if (itemsContainer) itemsContainer.classList.add('awtomic-ready');
        if (originalContainer && originalContainer !== itemsContainer) originalContainer.classList.add('awtomic-ready');
      }

      const bundleGroups = groupBundleItems(cartData);
      const bundleGroupCount = Object.keys(bundleGroups).length;

      if (bundleGroupCount > 0) {
        const bundleItemKeys = new Set(Object.values(bundleGroups).flatMap((g) => g.items.map((i) => i.key)));
        const bundleUids = Object.keys(bundleGroups);

        let allRows = Array.from(originalContainer.querySelectorAll(themeSelectors.cartItemRow));
        if (allRows.length === 0 && originalContainer.tagName === 'TBODY') {
          allRows = Array.from(originalContainer.querySelectorAll(':scope > tr'));
        }

        const endVisCheck = _startTimer(`  visibilityCheck(${contextType})`);
        const visibleBundleItems = allRows.filter((row) => {
          if (isRebuy(contextTheme)) {
            const classList = Array.from(row.classList);
            const bundleUidClass = classList.find((c) => c.startsWith('property-_bundleuid:'));
            if (bundleUidClass) {
              const bundleUidFromClass = bundleUidClass.split(':')[1];
              const normalizedClassUid = bundleUidFromClass.replace(/-/g, '');
              return bundleUids.some((uid) => uid.replace(/-/g, '') === normalizedClassUid);
            }
            return false;
          } else {
            let rowKey = row.dataset.key || row.id;
            if (!rowKey) { const ki = row.querySelector('input[data-key]'); if (ki?.dataset.key) rowKey = ki.dataset.key; }
            if (!rowKey) { const qi = row.querySelector('input.cart__qty-input'); if (qi?.id?.startsWith('updates_')) rowKey = qi.id.replace('updates_', ''); }
            if (rowKey?.startsWith('bls-minicart-product-')) rowKey = rowKey.replace('bls-minicart-product-', '');
            const indexIdMatch = rowKey?.match(/^Cart(?:Drawer-)?Item-(\d+)$/);
            if (indexIdMatch) { const idx = parseInt(indexIdMatch[1]) - 1; if (cartData.items[idx]) rowKey = cartData.items[idx].key; }
            return bundleItemKeys.has(rowKey) && row.offsetParent !== null;
          }
        });
        endVisCheck(`${visibleBundleItems.length} of ${allRows.length} rows`);

        if (bundleItemKeys.size > 0 && visibleBundleItems.length === 0) {
          _event(`serverSideRollup(${contextType})`, 'detected — skipping');
          rollupAlreadyDone[context.type] = true;
          return;
        }
      } else {
        _event(`noBundles(${contextType})`, 'nothing to do');
        return;
      }

      // Clean up previous rollup artifacts
      if (isRebuy(contextTheme)) {
        originalContainer.querySelectorAll('li.awtomic-processed, li[data-awtomic-hidden]').forEach((item) => item.remove());
      } else if (isBls(contextTheme)) {
        originalContainer.querySelectorAll('.cart-item[data-awtomic-bundle], .cart-item[data-awtomic-hidden]').forEach((item) => item.remove());
      } else if (contextTheme === 'Supply') {
        originalContainer.querySelectorAll('.cart__item.awtomic-processed, .cart__item[data-awtomic-hidden]').forEach((item) => item.remove());
      } else if (isWonder(contextTheme)) {
        originalContainer.querySelectorAll('li[data-awtomic-bundle], li[data-awtomic-hidden]').forEach((item) => item.remove());
      } else {
        itemsContainer.querySelectorAll('tbody.awtomic-processed').forEach((clone) => clone.remove());
      }

      let containerToProcess;
      if (isDirectTheme(contextTheme)) {
        containerToProcess = originalContainer;
      } else {
        containerToProcess = originalContainer.cloneNode(true);
        containerToProcess.classList.add('awtomic-processed');
        containerToProcess.classList.remove('awtomic-original');
      }

      if (bundleGroupCount > 0) {
        const matches = findAndMatchCartItems(cartData, containerToProcess, themeSelectors, contextTheme);
        await createBundleRows(bundleGroups, matches, contextTheme, themeSelectors);
      }

      if (isDirectTheme(contextTheme)) {
        if (itemsContainer) itemsContainer.classList.add('awtomic-ready');
        if (originalContainer && originalContainer !== itemsContainer) originalContainer.classList.add('awtomic-ready');
      } else {
        originalContainer.classList.add('awtomic-original');
        itemsContainer.appendChild(containerToProcess);
      }

      rollupAlreadyDone[contextType] = true;
    } catch (error) {
      console.error(`[Awtomic Cart Rollup] Error processing ${context.type} cart:`, error);
    }
  };

  // ── Event listeners (with debounced analyzeCart) ──────────────────────────

  const setupEventListeners = () => {
    const createObserver = (callback, options = {}) => {
      const safeCallback = (...args) => {
        try { callback(...args); } catch (error) { console.error('[Awtomic Cart Rollup] Observer callback error:', error); }
      };
      const observer = new MutationObserver(safeCallback);
      return { observe: (el) => observer.observe(el, options), disconnect: () => observer.disconnect() };
    };

    // Events that indicate cart CONTENTS changed — reset rollup flags
    ['cart:update','cart:updated','cart:refresh','cart:refreshed',
     'cart-drawer:updated','cart-drawer:refresh',
     'ajaxCart.afterCartLoad',
    ].forEach((e) =>
      document.addEventListener(e, () => {
        _event('EVENT trigger (cart mutation)', e);
        // Cart contents may have changed — allow re-processing
        Object.keys(rollupAlreadyDone).forEach(function(k) { rollupAlreadyDone[k] = false; });
        Object.keys(lastCartData).forEach(function(k) { lastCartData[k] = null; });
        _cartFetchInflight = null;
        analyzeCart(); // debounced
      })
    );

    // Events that indicate cart DRAWER opened — just re-render existing data
    ['cart-drawer:open','drawer:open','cart:open','theme:cart:open','drawer.didOpen',
    ].forEach((e) =>
      document.addEventListener(e, () => {
        _event('EVENT trigger (drawer open)', e);
        analyzeCart(); // debounced
      })
    );

    document.addEventListener('click', (e) => {
      try {
        if (e.target.closest('[data-open-drawer], [data-cart-drawer], .cart-icon, [href="#cart-drawer"], .js-drawer-open-right, [data-ajax-cart-toggle-class-button]')) {
          _event('CLICK trigger', e.target.closest('[class], [data-open-drawer]')?.className || 'unknown');
          analyzeCart(); // debounced
        }
      } catch (error) {
        console.error('[Awtomic Cart Rollup] Click handler error:', error);
      }
    });

    const observeDrawer = () => {
      if (!THEME.drawer) return;
      if (observers.drawer) observers.drawer.disconnect();

      observers.drawer = createObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'open' || m.attributeName === 'class' || m.attributeName === 'aria-hidden')) {
            const isOpen = m.target.hasAttribute('open') || m.target.classList.contains('active') || m.target.classList.contains('is-open') || m.target.classList.contains('drawer--is-open') || m.target.classList.contains('is-visible');
            if (isOpen) {
              _event('OBSERVER trigger', `drawer opened (attr: ${m.attributeName})`);
              rollupAlreadyDone.drawer = false;
              analyzeCart(); // debounced — coalesces with other triggers
            }
            break;
          }
        }
      }, { attributes: true, attributeFilter: ['open', 'class', 'aria-hidden'] });

      document.querySelectorAll('cart-drawer, [id*="cart-drawer"], [class*="cart-drawer"], #CartDrawer, .bls-minicart-wrapper')
        .forEach((drawer) => observers.drawer.observe(drawer));
    };

    const observeRebuyCart = () => {
      if (observers.rebuy) observers.rebuy.disconnect();
      const rebuyCart = document.querySelector('#rebuy-cart, .rebuy-cart');
      if (rebuyCart) {
        // OPT #8: Re-detect theme now that Rebuy is in the DOM
        if (THEME.name !== 'Rebuy' && THEME.name !== 'rebuy') {
          const newTheme = detectTheme();
          if (newTheme.name !== THEME.name) {
            _event('theme upgrade (rebuy found)', `${THEME.name} → ${newTheme.name}`);
            THEME = newTheme;
          }
        }

        observers.rebuy = createObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'aria-hidden')) {
              const isOpen = m.target.classList.contains('is-visible') || m.target.getAttribute('aria-hidden') === 'false';
              if (isOpen) {
                _event('OBSERVER trigger', `rebuy cart opened (attr: ${m.attributeName})`);
                rollupAlreadyDone.rebuy = false;
                lastCartData.rebuy = null;
                analyzeCart(); // debounced — coalesces with rebuy:smartcart.show
              }
              break;
            }
          }
        }, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
        observers.rebuy.observe(rebuyCart);
      }
    };

    const observeCartPage = () => {
      if (window.location.pathname.includes('/cart')) {
        const cartTable = document.querySelector('table.cart-items, .cart-items__table');
        const cartTableFallback = cartTable || document.querySelector('form[action*="/cart"] table');
        if (cartTableFallback) {
          createObserver(() => analyzeCart(), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }).observe(cartTableFallback);
        }
        if (THEME.name === 'Supply') {
          const cartPageContainer = document.querySelector('[data-products]');
          if (cartPageContainer) {
            createObserver(() => analyzeCart(), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }).observe(cartPageContainer);
          }
        }
      }
      if (THEME.name === 'Supply') {
        const cartItems = document.querySelector('.cart__items');
        if (cartItems) {
          createObserver(() => analyzeCart(), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-count'] }).observe(cartItems);
        }
      }
      if (THEME.name === 'Wonder') {
        document.querySelectorAll('ul.wt-cart__list').forEach((list) => {
          createObserver(() => analyzeCart(), { childList: true, subtree: true }).observe(list);
        });
      }
      if (THEME.name === 'BLS') {
        document.querySelectorAll('.bls-items').forEach((list) => {
          createObserver(() => analyzeCart(), { childList: true, subtree: true }).observe(list);
        });
      }
    };

    // OPT #7: Body observer self-disconnects after finding Rebuy
    const observeBody = () => {
      const bodyObserver = new MutationObserver(() => {
        if (!observers.rebuy) {
          const rebuyCart = document.querySelector('#rebuy-cart, .rebuy-cart');
          if (rebuyCart) {
            _event('body observer', 'Rebuy found — disconnecting body observer');
            bodyObserver.disconnect();
            observeRebuyCart();
          }
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: false });
    };

    const onReady = () => {
      observeDrawer();
      observeRebuyCart();
      observeCartPage();
      observeBody();
    };

    onDocReady(onReady);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // OPT #5: Non-blocking init — listeners first, prewarm is fire-and-forget
  // ══════════════════════════════════════════════════════════════════════════

  const init = async () => {
    const endInit = _startTimer('init');
    try {
      // Set up event listeners IMMEDIATELY — don't wait for network
      setupEventListeners();

      // Fetch cart data once
      const endFetch = _startTimer('  init.fetchCart');
      const cartData = await fetchCartData();
      endFetch(cartData ? `${cartData.items.length} items` : 'no data');

      if (cartData) {
        // OPT #5: Fire-and-forget product prewarm — don't block init
        const groups = Object.values(groupBundleItems(cartData))
          .filter((g) => g.properties._bundleHandle && g.properties._variantId);
        if (groups.length > 0) {
          _event('init.prewarm', `${groups.length} product(s) — fire-and-forget`);
          // These populate productCache; createBundleRows will await them if needed
          groups.forEach((g) => fetchBundleProductData(g.properties._bundleHandle, g.properties._variantId));
        }

        // OPT #6: Pass cart data directly — no second fetch
        updateCartBubble(cartData);
        await analyzeCartImmediate(cartData);
      } else {
        removeAntiFlickerCSS();
      }

      window.awtomicCartRollup = {
        analyze: () => analyzeCartImmediate(),
        version: '1.1.1',
        get theme() { return THEME; },
      };

      endInit('complete');
    } catch (error) {
      console.error('[Awtomic Cart Rollup] Error during initialization:', error);
      removeAntiFlickerCSS();
      endInit(`ERROR: ${error.message}`);
    }
  };

  try {
    init();
  } catch (error) {
    console.error('[Awtomic Cart Rollup] Fatal error:', error);
    removeAntiFlickerCSS();
  }

  // ── Rebuy re-apply (uses deduplicated fetchCartData) ──────────────────────

  const reapplyBundlePricesForRebuy = async () => {
    if (!isRebuy(THEME.name)) return;
    const cartData = await fetchCartData(); // OPT #1: will dedup with any in-flight fetch
    if (!cartData) return;
    const bundleGroups = groupBundleItems(cartData);
    document.querySelectorAll('[data-awtomic-bundle="true"]').forEach((row) => {
      const bundleId = row.dataset.bundleId;
      const group = bundleGroups[bundleId];
      if (group) updateBundlePrices(row, group.items, themeDefinitions.themes.rebuy.selectors);
    });
  };

  document.addEventListener('rebuy:cart.change', () => {
    _event('EVENT trigger', 'rebuy:cart.change (cart mutation — resetting rollup)');
    // Cart contents changed (item added/removed/updated).
    // Reset rollup flags so new bundles get processed.
    rollupAlreadyDone.rebuy = false;
    lastCartData.rebuy = null;
    // Clear the in-flight cart fetch so we get fresh data
    _cartFetchInflight = null;
    // Run full analyzeCart (debounced) to process any new bundles
    analyzeCart();
    // Also reapply prices after Vue reconciles (handles existing bundles)
    setTimeout(reapplyBundlePricesForRebuy, 150);
  });

  document.addEventListener('rebuy:smartcart.show', () => {
    _event('EVENT trigger', 'rebuy:smartcart.show');
    setTimeout(reapplyBundlePricesForRebuy, 150);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC REPORT API (same as instrumented version)
  // ══════════════════════════════════════════════════════════════════════════
  const _divider = () => console.log('─'.repeat(70));

  window.awtomicDiag = {
    reset() {
      _diagEvents.length = 0;
      _diagFetches.length = 0;
      _diagCycleCount = 0;
      productCache.clear();
      _productFetchInflight.clear();
      _cartFetchInflight = null;
      Object.keys(rollupAlreadyDone).forEach(k => rollupAlreadyDone[k] = false);
      Object.keys(lastCartData).forEach(k => lastCartData[k] = null);
      isProcessing = false;
      console.log('%c[diag] Reset complete — all caches and flags cleared.', 'color:#ffd54f');
    },

    report() {
      _divider();
      console.log('%c AWTOMIC CART ROLLUP v1.1.1 — OPTIMIZED DIAGNOSTIC REPORT ', 'background:#1a1a2e; color:#69f0ae; font-weight:bold; font-size:14px; padding:4px 8px');
      _divider();

      console.log('%c\n⏱  Event Timeline:', 'font-weight:bold; color:#ffd54f');
      if (_diagEvents.length === 0) {
        console.log('  (no events captured)');
      } else {
        console.table(_diagEvents.map(e => ({
          'Time': `+${e.ts.toFixed(1)}ms`,
          'Event': e.label,
          'Duration': e.duration ? _fmt(e.duration) : '',
          'Detail': (e.detail || '').slice(0, 80),
        })));
      }

      console.log('%c\n📡 Network Fetches:', 'font-weight:bold; color:#4fc3f7');
      if (_diagFetches.length === 0) {
        console.log('  (none captured)');
      } else {
        const cartFetches = _diagFetches.filter(f => f.url.includes('/cart'));
        const prodFetches = _diagFetches.filter(f => f.url.includes('/products/'));
        console.log(`  /cart.js calls:     ${cartFetches.length}  (total ${_fmt(cartFetches.reduce((s,f) => s+f.ms, 0))})`);
        console.log(`  /products/*.js:     ${prodFetches.length}  (total ${_fmt(prodFetches.reduce((s,f) => s+f.ms, 0))})`);
        console.table(_diagFetches.map(f => ({
          'Start': `+${f.startTs.toFixed(0)}ms`,
          'URL': f.url.length > 50 ? '…' + f.url.slice(-47) : f.url,
          'Duration': _fmt(f.ms),
          'Status': f.status,
          'Size': f.size,
        })));
      }

      console.log('%c\n🎯 Bottleneck Analysis:', 'font-weight:bold; color:#ef5350');
      const totalFetchMs = _diagFetches.reduce((s,f) => s+f.ms, 0);
      const timedEvents = _diagEvents.filter(e => e.duration);
      const analyzeEvents = timedEvents.filter(e => e.label.startsWith('▶ analyzeCart'));
      if (analyzeEvents.length > 0) {
        const totalAnalyzeMs = analyzeEvents.reduce((s,e) => s + e.duration, 0);
        const fetchPct = totalAnalyzeMs > 0 ? ((totalFetchMs / totalAnalyzeMs) * 100).toFixed(0) : '?';
        console.log(`  Total analyzeCart time: ${_fmt(totalAnalyzeMs)} across ${analyzeEvents.length} cycle(s)`);
        console.log(`  Network time:          ${_fmt(totalFetchMs)} (~${fetchPct}%)`);
        console.log(`  DOM/JS time:           ${_fmt(Math.max(0, totalAnalyzeMs - totalFetchMs))} (~${Math.max(0, 100 - parseInt(fetchPct || 0))}%)`);
        const cartFetchCount = _diagFetches.filter(f => f.url.includes('/cart.js')).length;
        if (cartFetchCount > 1) {
          console.log(`%c  ⚠ ${cartFetchCount} calls to /cart.js detected`, 'color:#ffa726');
        } else {
          console.log(`%c  ✓ /cart.js called only ${cartFetchCount} time(s) — dedup working`, 'color:#69f0ae');
        }
        const dedupEvents = _diagEvents.filter(e => e.label.includes('DEDUPED'));
        if (dedupEvents.length > 0) {
          console.log(`%c  ✓ ${dedupEvents.length} fetch(es) deduplicated`, 'color:#69f0ae');
        }
      } else {
        console.log('  No analyzeCart cycles captured yet.');
      }

      const triggers = _diagEvents.filter(e => e.label.includes('trigger') || e.label.includes('OBSERVER') || e.label.includes('EVENT') || e.label.includes('CLICK'));
      if (triggers.length > 0) {
        console.log('%c\n🔔 Trigger Sources:', 'font-weight:bold; color:#ce93d8');
        triggers.forEach(t => console.log(`  +${t.ts.toFixed(0)}ms  ${t.label}  ${t.detail || ''}`));
      }

      const slowPhases = timedEvents.filter(e => e.duration > 50).sort((a, b) => b.duration - a.duration);
      if (slowPhases.length > 0) {
        console.log('%c\n🐌 Slow Phases (>50ms):', 'font-weight:bold; color:#ff8a65');
        slowPhases.forEach(e => console.log(`  ${_fmt(e.duration).padStart(10)}  ${e.label}  ${e.detail || ''}`));
      }

      _divider();
      console.log('%cCompare with v1.0.0 results to verify improvement.', 'color:#aaa; font-style:italic');
      console.log('%cawtomicDiag.reset() to clear and recapture.', 'color:#aaa; font-style:italic');
      _divider();
    },

    waterfall() {
      console.log('%c⏱  Full Event Waterfall:', 'font-weight:bold; color:#ffd54f; font-size:13px');
      _diagEvents.forEach(e => {
        const bar = e.duration ? '█'.repeat(Math.min(50, Math.round(e.duration / 10))) : '';
        console.log(
          `%c${('+' + e.ts.toFixed(0) + 'ms').padStart(10)} %c${e.label.padEnd(45)} %c${bar} %c${e.duration ? _fmt(e.duration) : ''} %c${e.detail || ''}`,
          'color:#888', 'color:#69f0ae', 'color:#4fc3f7', 'color:#ffd54f', 'color:#aaa'
        );
      });
    },

    raw() { return { events: _diagEvents, fetches: _diagFetches, cycleCount: _diagCycleCount }; },

    teardown() {
      window.fetch = _origFetch;
      console.log('%c[diag] Teardown — original fetch restored.', 'color:#ffd54f');
    },
  };

  console.log(
    '%c[Awtomic Cart Rollup v1.1.1 OPTIMIZED] ✓ Loaded — diagnostics active',
    'color:#69f0ae; font-weight:bold; font-size:13px'
  );
  console.log('%c  → Open the cart, then run: awtomicDiag.report()', 'color:#aaa');

})();
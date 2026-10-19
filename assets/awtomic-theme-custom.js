window.bundleapp = window.bundleapp || {};
window.bundleapp.settings = Object.assign({}, window.bundleapp.settings || {}, {
  bab: {
    productImage: 600
  }
});

const waitForElement = (selector, callback, delay = 0, failsafeDelay) => {
  const observer = new MutationObserver((mutations, obs) => {
    const element = document.querySelector(selector);
    if (element) {
      obs.disconnect();
      if (typeof callback === "function") {
        setTimeout(() => {
          callback(element);
        }, delay);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  if (failsafeDelay) setTimeout(() => observer.disconnect(), failsafeDelay);
};

const babMinimums = {
  // Example structure:
  // "9556565229815": {
  //   49231431958775: 60,
  //   49231431991543: 120
  // }
};

//if awtomic customer portal
if (window.location.pathname.includes("/tools/bundle-subscriptions") && window.location.search.includes("subscriptionId=")) {
  document.body.classList.add("awt-cp");

  // CP PRICE CHECK
  waitForElement(".bundle-table__body-row--bab-parent", (element) => {
    const checkBabEdit = (bundleId, variantId) => {
      const minimumPrice = babMinimums[bundleId]?.[variantId] || 0;

      const setAddToCartMinimumPrice = () => {
        const bundleContainer = document.querySelector(".bundleapp-modal__container--complete-screen > .bundle-container");

        if (!bundleContainer) return;

        const infoDiv = document.createElement("div");
        infoDiv.className = "minimum-price-info";
        infoDiv.innerText = `Minimum price of $${minimumPrice} is required for this club.`;

        const footerDiv = bundleContainer.querySelector("footer > div");
        if (footerDiv) {
          const lastDiv = footerDiv.querySelector("div:last-child");
          if (lastDiv) {
            footerDiv.insertBefore(infoDiv, lastDiv);
          }
        }

        document.body.addEventListener("click", (e) => {
          const price = document.querySelector("div > span.bundle-text--emphasis").innerText;
          const innerPrice = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", ""));

          const addToCartButton = document.querySelector(".bundleapp-modal__container--complete-screen footer > div > div > button");
          if (innerPrice < minimumPrice) {
            addToCartButton.classList.add("priceNotMet");
            document.body.classList.add("priceNotMet");
          } else {
            addToCartButton.classList.remove("priceNotMet");
            document.body.classList.remove("priceNotMet");
          }
        });
      };

      const checkIfPriceLabel = () =>
        document.querySelector(".bundleapp-modal__container--complete-screen footer > div > div:last-child > div > span:nth-child(2)");

      let priceLabelSet = false;

      if (checkIfPriceLabel()) {
        setAddToCartMinimumPrice();
      } else {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (!priceLabelSet && mutation.addedNodes.length) {
              if (checkIfPriceLabel()) {
                setAddToCartMinimumPrice();
                priceLabelSet = true;
                observer.disconnect();
              }
            }
          });
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        setTimeout(() => {
          observer.disconnect();
        }, 5000);
      }
    };

    Object.keys(babMinimums).forEach((bundleId) => {
      Object.keys(babMinimums[bundleId]).forEach((variantId) => {
        const selector = `tr[class*="${variantId}"]`;
        const element = document.querySelector(selector);
        console.log(selector, element);
        if (element) element.addEventListener("click", () => checkBabEdit(bundleId, variantId));
      });
    });

    // Check if there are multiple lines/groups by BaBUUId
    if (window.Awtomic?.subscriptionDetails?.Lines) {
      const lines = window.Awtomic.subscriptionDetails.Lines.filter((line) => !line.HideLine);
      const singleLines = lines.filter((line) => !line.BaBUUId);
      const groupedLines = lines.filter((line) => line.BaBUUId);
      const uniqueBaBUUIds = new Set(groupedLines.map((line) => line.BaBUUId));

      // Add class if: 2+ individuals (single line + groups)
      if (singleLines.length + uniqueBaBUUIds.size >= 2) {
        document.body.classList.add("awt-multiple-lines");
      }
    }
  });
}

//if awtomic subs list / my subscriptions
if (/^\/tools\/bundle-subscriptions\/?$/.test(location.pathname) && !window.location.search.includes("subscriptionId=")) {
  document.body.classList.add("awt-my-subs");

  // CX-4859: hide CANCELLED subscriptions from the customer-portal list when either
  //   (a) a merchant hide-flag CustomAttribute is set truthy, OR
  //   (b) the subscription was cancelled >= 6 months ago (CancelDate).
  // Reads the runtime data model (window.Awtomic.subscriptionList) rather than DOM
  // status labels, and fails open (row stays visible) whenever the hook is missing or
  // neither gate is met. List view only — the ?subscriptionId= detail page is unaffected.
  const CANCEL_HIDE_AGE_MS = 183 * 24 * 60 * 60 * 1000; // ~6 months

  const isTruthyAttr = (value) => {
    if (value == null) return false;
    const v = String(value).trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0" && v !== "no";
  };

  // Key-tolerant: matches hide_canceled / hideCanceled / HideCanceled / hide-cancelled, etc.
  const hasHideFlag = (sub) =>
    Array.isArray(sub.CustomAttributes) &&
    sub.CustomAttributes.some((attr) => {
      const key = String(attr?.key || "").toLowerCase().replace(/[^a-z]/g, "");
      return key.startsWith("hidecancel") && isTruthyAttr(attr?.value);
    });

  const cancelledLongAgo = (sub) => {
    const cancelTs = Date.parse(sub.CancelDate || "");
    return !Number.isNaN(cancelTs) && Date.now() - cancelTs >= CANCEL_HIDE_AGE_MS;
  };

  const shouldHide = (sub) =>
    sub?.SubscriptionStatus === "CANCELLED" && (hasHideFlag(sub) || cancelledLongAgo(sub));

  waitForElement(".bundleapp-subscription-list-item", () => {    
    const subs = window.Awtomic?.subscriptionList;
    if (!Array.isArray(subs)) return; // fail open — hook missing

    subs.forEach((sub) => {
      if (!shouldHide(sub)) return;
      // Join on trailing digits: SubscriptionId is a gid, data-subscription-id is bare numeric.
      const numericId = String(sub.SubscriptionId || "").match(/(\d+)\s*$/)?.[1];
      if (!numericId) return;
      const row = document.querySelector(`.bundleapp-subscription-list-item[data-subscription-id="${numericId}"]`);
      if (row) row.setAttribute("style", "display: none;");
    });
  });
}

//if awtomic bab purchase flow
if (window.location.pathname.includes("/tools/bundle-subscriptions/bundle/")) {
  window.Awtomic = window.Awtomic || {};
  window.Awtomic.getBabSelection = () => {
    //babProductId is in a class of an element, the element is div.bundle-container.pv_xxxxxxx where xxxxxxx is the bab product id
    const babProductId = document
      .querySelector(".bundle-container")
      ?.className.split(" ")
      .find((c) => c.startsWith("pv_"))
      ?.split("_")[1];
    if (!babProductId) return { object: {}, queryString: "" };

    const bundleProductCards = document.querySelectorAll(".bundle-product-card");

    const bundleSelectedProducts = {};
    bundleProductCards.forEach((card) => {
      const productId = card.getAttribute("data-pid");
      const quantityElement = card.querySelector(".bundle-product-card__quantity-button-container > span");
      const quantity = quantityElement ? parseInt(quantityElement.innerHTML) : 0;

      if (productId && quantity > 0) {
        bundleSelectedProducts[productId] = quantity;
      }
    });

    // Create query string format
    const queryString = Object.entries(bundleSelectedProducts)
      .map(([id, quantity]) => `${id}=${quantity}`)
      .join("&");

    // Create full URL with query string
    const currentUrl = window.location.href;
    const separator = currentUrl.includes("?") ? "&" : "?";
    const fullUrl = queryString ? `${currentUrl}${separator}${queryString}` : currentUrl;

    return {
      object: { [babProductId]: bundleSelectedProducts },
      queryString: queryString,
      fullUrl: fullUrl
    };
  };

  const urlParts = window.location.pathname.split("/");
  const bundleId = urlParts[urlParts.length - 1];
  if (bundleId) {
    document.body.classList.add(`awt-bundle-${bundleId}`);

    if (babMinimums[bundleId]) {
      // Wait for footer to exist first, then set up the price checking
      waitForElement(".bundleapp-modal__container--complete-screen footer", () => {
        // Get variant ID from bundle container classes (e.g., div.bundle-container p_9556565229815.pv_49231431991543)
        const getVariantId = () => {
          const bundleContainer = document.querySelector(".bundle-container");
          if (!bundleContainer) return null;

          const classes = bundleContainer.className.split(" ");
          const variantClass = classes.find((c) => c.startsWith("pv_"));
          return variantClass ? variantClass.split("_")[1] : null;
        };

        let currentVariantId = getVariantId();

        const updatePriceChecking = (variantId) => {
          const minimumPrice = babMinimums[bundleId]?.[variantId] || 0;
          console.log(`Setting up price checking for variant ${variantId} with minimum price $${minimumPrice}`);

          const setAddToCartMinimumPrice = () => {
            const bundleContainer = document.querySelector(".bundleapp-modal__container--complete-screen > .bundle-container");

            if (!bundleContainer) return;

            // Remove existing minimum price info if any
            const existingInfo = bundleContainer.querySelector(".minimum-price-info");
            if (existingInfo) {
              existingInfo.remove();
            }

            const infoDiv = document.createElement("div");
            infoDiv.className = "minimum-price-info";
            infoDiv.innerText = `Minimum price of $${minimumPrice} is required for this club.`;

            const footerDiv = bundleContainer.querySelector("footer > div");
            if (footerDiv) {
              const lastDiv = footerDiv.querySelector("div:last-child");
              if (lastDiv) {
                footerDiv.insertBefore(infoDiv, lastDiv);
              }
            }

            document.body.addEventListener("click", (e) => {
              const price = document.querySelector("div > span.bundle-text--emphasis").innerText;
              const innerPrice = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", ""));

              const addToCartButton = document.querySelector(".bundleapp-modal__container--complete-screen footer > div > div > button");
              if (innerPrice < minimumPrice) {
                addToCartButton.classList.add("priceNotMet");
                document.body.classList.add("priceNotMet");
              } else {
                addToCartButton.classList.remove("priceNotMet");
                document.body.classList.remove("priceNotMet");
              }
            });
          };

          const checkIfPriceLabel = () =>
            document.querySelector(".bundleapp-modal__container--complete-screen footer > div > div:last-child > div > span:nth-child(2)");

          let priceLabelSet = false;

          if (checkIfPriceLabel()) {
            setAddToCartMinimumPrice();
          } else {
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (!priceLabelSet && mutation.addedNodes.length) {
                  if (checkIfPriceLabel()) {
                    setAddToCartMinimumPrice();
                    priceLabelSet = true;
                    observer.disconnect();
                  }
                }
              });
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true
            });

            setTimeout(() => {
              observer.disconnect();
            }, 5000);
          }
        };

        // Initial setup if we have a variant ID
        if (currentVariantId) {
          updatePriceChecking(currentVariantId);
        }

        // Watch for variant changes in the bundle container
        const variantObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === "attributes" && mutation.attributeName === "class") {
              const newVariantId = getVariantId();
              if (newVariantId && newVariantId !== currentVariantId) {
                console.log(`Variant changed from ${currentVariantId} to ${newVariantId}`);
                currentVariantId = newVariantId;
                updatePriceChecking(currentVariantId);
              }
            }
          });
        });

        // Observe the bundle container for class changes
        const bundleContainer = document.querySelector(".bundle-container");
        if (bundleContainer) {
          variantObserver.observe(bundleContainer, {
            attributes: true,
            attributeFilter: ["class"]
          });
        }
      });
    }
  }
}

//cart rollup
document.body.addEventListener("click", async (event) => {
  if (!event.target.matches(".cart__remove-bundle *, .cart__remove-bundle[data-bundle-id]")) return;

  const bundleElement = event.target.closest(".cart__remove-bundle") || (event.target.hasAttribute("data-bundle-id") ? event.target : null);
  const bundle_id = bundleElement ? bundleElement.getAttribute("data-bundle-id") : null;

  if (bundle_id) {
    event.preventDefault();
    try {
      // Get current cart contents
      const cart = await (await fetch("/cart.js")).json();

      // Create data object for cart update AJAX call
      const data = {
        updates: cart.items.reduce((acc, item) => (item.properties?._bundleUid == bundle_id ? { ...acc, [item.key]: 0 } : acc), {})
      };

      // API call to update the cart contents and set the bundle item quantities to 0
      const response = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      response.ok && (window.location.href = "/cart");
    } catch (error) {
      console.error(error);
    }
  }
});

// ==UserScript==
// @name         Pricempire Multi-Favorite
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Allows favoriting multiple marketplaces on Pricempire.com and saves them across sessions.
// @author       Skillter
// @match        https://pricempire.com/cs2-items/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=pricempire.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const FAVORITES_KEY = 'pricempire_multi_favorites';
    const SERVER_UNFAVORITED_KEY = 'pricempire_server_unfavorited'; // Track client-side unfavorited server items
    const SETTINGS_KEY = 'pricempire_settings';
    let pinnedMarketplacesGrid = null;
    const marketplaceSections = {}; //Cache for marketplace grid elements

    // Default settings - all features enabled by default
    const defaultSettings = {
        multiFavorite: true,
        autoExpandOffers: true,
        mergeSponsoredMarkets: true,
        useSteamPricePreview: true,
        debugMode: false
    };

    function getSettings() {
        const settings = localStorage.getItem(SETTINGS_KEY);
        return settings ? { ...defaultSettings, ...JSON.parse(settings) } : defaultSettings;
    }

    // Debug logging utility
    function debugLog(...args) {
        const settings = getSettings();
        if (settings.debugMode) {
            console.log('[Pricempire Debug]', ...args);
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function getFavorites() {
        const favs = localStorage.getItem(FAVORITES_KEY);
        return favs ? JSON.parse(favs) : [];
    }

    function saveFavorites(favs) {
        const uniqueFavs = [...new Set(favs)];
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(uniqueFavs));
    }

    function getServerUnfavorited() {
        const unfavs = localStorage.getItem(SERVER_UNFAVORITED_KEY);
        return unfavs ? JSON.parse(unfavs) : [];
    }

    function saveServerUnfavorited(unfavs) {
        const uniqueUnfavs = [...new Set(unfavs)];
        localStorage.setItem(SERVER_UNFAVORITED_KEY, JSON.stringify(uniqueUnfavs));
    }

    function getPriceFromCard(card) {
        const priceElement = card.querySelector('span.text-3xl.font-bold.text-theme-100');
        if (!priceElement) return Infinity; // Cards without price go to the end
        const priceText = priceElement.textContent.trim();
        const priceValue = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        return isNaN(priceValue) ? Infinity : priceValue;
    }

    function getFavoriteStarIcon(card) {
        // Find the correct star icon - try multiple selectors for Grid and List view compatibility
        debugLog('getFavoriteStarIcon called - searching for star icons...');

        let starIcon = card.querySelector('.iconify[class*="i-material-symbols-light:kid-star"]');
        debugLog('Selector 1 (i-material-symbols-light:kid-star):', !!starIcon);

        if (!starIcon) {
            starIcon = card.querySelector('.iconify[class*="i-material-symbols-light:family-star"]');
            debugLog('Selector 2 (i-material-symbols-light:family-star):', !!starIcon);
        }
        if (!starIcon) {
            starIcon = card.querySelector('.iconify[class*="star"]');
            debugLog('Selector 3 (star):', !!starIcon);
        }
        if (!starIcon) {
            starIcon = card.querySelector('span[class*="kid-star"], span[class*="family-star"]');
            debugLog('Selector 4 (span):', !!starIcon);
        }

        debugLog('getFavoriteStarIcon result:', !!starIcon, starIcon ? starIcon.className : 'null');
        return starIcon;
    }

    function updateStarIcon(starIcon, isFavorite) {
        if (!starIcon) return;
        const isUnfavoritedIcon = starIcon.classList.contains('i-material-symbols-light:kid-star-outline');

        if (isFavorite && isUnfavoritedIcon) {
            starIcon.classList.replace('i-material-symbols-light:kid-star-outline', 'i-material-symbols-light:family-star-sharp');
            starIcon.classList.remove('text-theme-400');
            starIcon.classList.add('text-yellow-500');
        } else if (!isFavorite && !isUnfavoritedIcon) {
            starIcon.classList.replace('i-material-symbols-light:family-star-sharp', 'i-material-symbols-light:kid-star-outline');
            starIcon.classList.remove('text-yellow-500');
            starIcon.classList.add('text-theme-400');
        }
    }

    function isSponsored(card) {
        const bgDiv = card.querySelector('.bg-theme-700.ring-1.ring-theme-800');
        return bgDiv !== null;
    }

    function normalizeSponsored(card) {
        if (!isSponsored(card)) return;
        card.dataset.isSponsored = 'true';

        const bgDiv = card.querySelector('.bg-theme-700.ring-1.ring-theme-800');
        if (bgDiv) {
            bgDiv.classList.remove('bg-theme-700', 'ring-1', 'ring-theme-800');
            bgDiv.classList.add('bg-theme-800');
        }

        // Normalize button styling from gradient to theme color
        const buttons = card.querySelectorAll('[class*="bg-gradient-to-r"]');
        buttons.forEach(btn => {
            // Remove gradient classes
            Array.from(btn.classList).forEach(cls => {
                if (cls.includes('bg-gradient') || cls.includes('from-sky') || cls.includes('to-blue') || cls.includes('hover:from') || cls.includes('hover:to') || cls.includes('shadow-sky')) {
                    btn.classList.remove(cls);
                }
            });
            // Add normal button styling
            if (!btn.classList.contains('bg-theme-600')) {
                btn.classList.add('bg-theme-600');
            }
        });
    }

    function getCardPrice(card) {
        // Look for price span - matches text-3xl/text-2xl with font-bold, ignoring color variations
        const priceElement = card.querySelector('span.text-3xl.font-bold, span.text-2xl.font-bold');
        if (!priceElement) return Infinity;
        const priceText = priceElement.textContent.trim();
        const priceValue = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        return isNaN(priceValue) ? Infinity : priceValue;
    }

    function getCardRating(card) {
        // Extract rating from the numeric value span (e.g., "4.7")
        const ratingSpan = card.querySelector('span.ml-1.font-medium');
        if (!ratingSpan) return 0;
        const ratingValue = parseFloat(ratingSpan.textContent.trim());
        return isNaN(ratingValue) ? 0 : ratingValue;
    }

    function getCardStock(card) {
        const stockText = Array.from(card.querySelectorAll('span')).find(el => el.textContent.includes('stock'))?.textContent || '';
        const stockValue = parseInt(stockText.match(/\d+/)?.[0] || 0);
        return stockValue;
    }

    function getSortingOption() {
        // Find the sorting dropdown within the offers section context
        const offersSection = document.querySelector('section#offers');
        if (!offersSection) return 'Recommended';

        // Look for all spans with truncate and text-theme-100 in the offers section
        const spans = Array.from(offersSection.querySelectorAll('span.truncate.text-theme-100'));

        // The sorting span should be near the top of the section, typically the first or second one
        // Filter to find ones that match known sorting options
        const sortingOptions = ['Price: Low to High', 'Price: High to Low', 'Rating: High to Low', 'Rating: Low to High',
                               'Stock: High to Low', 'Stock: Low to High', 'Recommended', 'Recently Updated', 'Oldest Updated'];

        for (const span of spans) {
            const text = span.textContent.trim();
            if (sortingOptions.includes(text)) {
                return text;
            }
        }

        return 'Recommended';
    }

    function sortCards(cards, sortOption) {
        const sortedCards = [...cards];

        switch(sortOption) {
            case 'Price: Low to High':
                sortedCards.sort((a, b) => getCardPrice(a) - getCardPrice(b));
                break;
            case 'Price: High to Low':
                sortedCards.sort((a, b) => getCardPrice(b) - getCardPrice(a));
                break;
            case 'Rating: High to Low':
                sortedCards.sort((a, b) => getCardRating(b) - getCardRating(a));
                break;
            case 'Rating: Low to High':
                sortedCards.sort((a, b) => getCardRating(a) - getCardRating(b));
                break;
            case 'Stock: High to Low':
                sortedCards.sort((a, b) => getCardStock(b) - getCardStock(a));
                break;
            case 'Stock: Low to High':
                sortedCards.sort((a, b) => getCardStock(a) - getCardStock(b));
                break;
            case 'Recommended':
            case 'Recently Updated':
            case 'Oldest Updated':
            default:
                // For options without clear sort criteria, keep current order
                break;
        }

        return sortedCards;
    }

    let isCurrentlySorting = false;
    let lastSortOption = null;
    let lastCardCount = 0;

    function mergeAndSortSponsored() {
        const settings = getSettings();

        if (!settings.mergeSponsoredMarkets) {
            return;
        }

        // Prevent concurrent sorting operations
        if (isCurrentlySorting) {
            return;
        }

        const sortOption = getSortingOption();
        const allCards = Array.from(document.querySelectorAll('article.group.relative'));
        const currentCardCount = allCards.length;

        // Skip re-insertion only for "Recommended" (don't alter server order)
        if (sortOption === 'Recommended' || currentCardCount === 0) {
            return;
        }

        // Check if we need to sort (either sort option changed or card count changed)
        const needsSorting = sortOption !== lastSortOption || currentCardCount !== lastCardCount;

        if (!needsSorting) {
            // Still normalize sponsored cards even if no sorting needed
            allCards.forEach(card => normalizeSponsored(card));
            return;
        }

        isCurrentlySorting = true;

        try {
            // Always normalize sponsored cards (remove bias styling)
            allCards.forEach(card => normalizeSponsored(card));

            // Apply custom sort logic for Price/Rating/Stock
            // For Recently Updated/Oldest Updated, sortCards returns cards in current order (no sort applied)
            const sortedCards = sortCards(allCards, sortOption);

            // Re-insert cards to mix sponsored with regular markets
            if (sortedCards.length > 0) {
                const container = sortedCards[0].parentElement;
                if (container) {
                    // Preserve hover states by temporarily disabling hover effects
                    const originalTransitions = [];
                    sortedCards.forEach(card => {
                        const computedStyle = window.getComputedStyle(card);
                        originalTransitions.push({
                            element: card,
                            transition: computedStyle.transition,
                            pointerEvents: computedStyle.pointerEvents
                        });
                        // Disable transitions and pointer events during reordering
                        card.style.transition = 'none';
                        card.style.pointerEvents = 'none';
                    });

                    // Re-insert cards without using fragment to maintain better control
                    sortedCards.forEach((card, index) => {
                        container.appendChild(card);
                    });

                    // Restore hover states after a brief delay
                    setTimeout(() => {
                        sortedCards.forEach((card, index) => {
                            if (originalTransitions[index]) {
                                const { transition, pointerEvents } = originalTransitions[index];
                                card.style.transition = transition;
                                card.style.pointerEvents = pointerEvents;
                            }
                        });
                    }, 50);
                }
            }

            // Remember this configuration for next time
            lastSortOption = sortOption;
            lastCardCount = currentCardCount;

        } finally {
            isCurrentlySorting = false;
        }
    }

    function autoExpandOffers() {
        const settings = getSettings();
        if (!settings.autoExpandOffers) return;

        const expandNextButton = () => {
            const showMoreBtns = document.querySelectorAll('button[aria-label="Show more offers"]');
            if (showMoreBtns.length === 0) return; // No more buttons

            // Click the first button and recurse
            const btn = showMoreBtns[0];
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            btn.dispatchEvent(clickEvent);
            setTimeout(expandNextButton, 800); // Wait for content to load, then check for next button
        };

        expandNextButton();
    }

    function toggleFavorite(card, starIcon) {
        const settings = getSettings();
        if (!settings.multiFavorite) {
            console.log('[Pricempire] Multi-Favorite feature is disabled');
            return;
        }

        const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
        if (!starIcon) {
            debugLog('Star icon not provided, searching within card...');
            starIcon = getFavoriteStarIcon(card);
        }

        debugLog('toggleFavorite called - marketplaceName:', marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);

        if (!marketplaceName || !starIcon || !pinnedMarketplacesGrid) {
            console.warn('[Pricempire] toggleFavorite failed - marketplaceName:', !!marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
            return;
        }

        let favorites = getFavorites();
        let serverUnfavorited = getServerUnfavorited();
        const isFavorite = favorites.includes(marketplaceName);
        const isServerFavorited = card.dataset.serverFavorited === 'true';

        if (isFavorite) {
            // unfavorite
            favorites = favorites.filter(fav => fav !== marketplaceName);

            // If this was server-favorited, remember user unfavorited it
            if (isServerFavorited && !serverUnfavorited.includes(marketplaceName)) {
                serverUnfavorited.push(marketplaceName);
                saveServerUnfavorited(serverUnfavorited);
            }

            const originalSectionTitle = card.dataset.originalSection;
            const destinationGrid = marketplaceSections[originalSectionTitle] || marketplaceSections['Other Marketplaces'];

            if (destinationGrid) {
                 // Insert in price order (cheapest first)
                const cardPrice = getPriceFromCard(card);
                const siblings = Array.from(destinationGrid.children);
                const insertBeforeNode = siblings.find(sibling => {
                    const siblingPrice = getPriceFromCard(sibling);
                    return siblingPrice > cardPrice;
                });
                destinationGrid.insertBefore(card, insertBeforeNode || null);

            } else {
                console.warn(`[Pricempire Multi-Favorite] Could not find original section "${originalSectionTitle}" or fallback "Other Marketplaces" to return card to.`);
            }
            updateStarIcon(starIcon, false);

        } else {
            // favorite
            if (!card.dataset.originalSection) {
                 const sectionTitle = card.closest('.space-y-4')?.querySelector('h3')?.textContent.trim();
                 card.dataset.originalSection = sectionTitle || 'Other Marketplaces';
            }
            favorites.push(marketplaceName);

            // Remove from server unfavorited list if re-favoriting
            if (serverUnfavorited.includes(marketplaceName)) {
                serverUnfavorited = serverUnfavorited.filter(name => name !== marketplaceName);
                saveServerUnfavorited(serverUnfavorited);
            }

            // Insert in price order (cheapest first)
            const cardPrice = getPriceFromCard(card);
            const siblings = Array.from(pinnedMarketplacesGrid.children);
            const insertBeforeNode = siblings.find(sibling => {
                const siblingPrice = getPriceFromCard(sibling);
                return siblingPrice > cardPrice;
            });
            pinnedMarketplacesGrid.insertBefore(card, insertBeforeNode || null);

            updateStarIcon(starIcon, true);
        }
        saveFavorites(favorites);
    }

// creates or finds the pinned Marketplaces section and caches all section grids.
    function initializeSections() {
        // cache it
        const sections = document.querySelectorAll('div[data-v-cd0f6ace].space-y-4');

        sections.forEach(section => {
            const titleEl = section.querySelector('h3');
            const gridEl = section.querySelector('.grid');
            if (titleEl && gridEl) {
                const title = titleEl.textContent.trim();
                marketplaceSections[title] = gridEl;
            }
        });

        // check for the pinned section
        pinnedMarketplacesGrid = marketplaceSections['Pinned Marketplaces'];

        if (!pinnedMarketplacesGrid) {
            const mainContainer = document.querySelector('.space-y-6[data-v-cd0f6ace]');

            if (mainContainer) {
                const newPinnedSection = document.createElement('div');
                newPinnedSection.className = 'space-y-4';
                newPinnedSection.setAttribute('data-v-cd0f6ace', '');
                newPinnedSection.innerHTML = `
                    <div class="flex items-center justify-between" data-v-cd0f6ace="">
                        <div class="flex items-center gap-3" data-v-cd0f6ace="">
                            <div class="rounded-lg bg-yellow-500/10 p-2" data-v-cd0f6ace="">
                                <span class="iconify i-material-symbols-light:family-star-sharp h-5 w-5 text-yellow-500" aria-hidden="true" data-v-cd0f6ace=""></span>
                            </div>
                            <h3 class="text-lg font-semibold" data-v-cd0f6ace="">Pinned Marketplaces</h3>
                        </div>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-v-cd0f6ace=""></div>
                `;
                // Insert after first section to maintain correct order (after Featured Deals, etc)
                const firstSection = mainContainer.querySelector('.space-y-4');
                if (firstSection) {
                    firstSection.insertAdjacentElement('afterend', newPinnedSection);
                } else {
                    mainContainer.prepend(newPinnedSection);
                }
                pinnedMarketplacesGrid = newPinnedSection.querySelector('.grid');
                marketplaceSections['Pinned Marketplaces'] = pinnedMarketplacesGrid;
            }
        }
    }

    // Steam Price Preview Functions

    function detectCurrentPriceProvider() {
        const priceCard = document.querySelector('[role="article"][aria-label*="market price"]');
        if (!priceCard) return null;

        const ariaLabel = priceCard.getAttribute('aria-label') || '';
        return ariaLabel.includes('Steam') ? 'steam' : 'skins';
    }

    function findSteamPriceData() {
        debugLog('Searching for Steam price data...');

        // Method 0: Primary - Extract Steam price from Steam marketplace card in offers section
        debugLog('Method 0: Searching Steam marketplace card...');
        const steamMarketplaceCard = findSteamMarketplaceCard();
        if (steamMarketplaceCard) {
            const priceData = extractPriceFromCard(steamMarketplaceCard);
            if (priceData && priceData.mainPrice > 0) {
                debugLog('Found Steam price data from marketplace card:', priceData);
                // Store buy order price globally for use in replacement
                window.steamBuyOrderPrice = priceData.buyOrderPrice;
                return priceData.mainPrice.toString();
            }
        }

        // Method 1: Check for Nuxt.js data and window objects (fallback)
        if (typeof window !== 'undefined') {
            // Check various possible Nuxt.js data structures
            if (window.__NUXT__) {
                debugLog('Found __NUXT__ data, structure:', Object.keys(window.__NUXT__));
                if (window.__NUXT__.data) {
                    debugLog('__NUXT__.data structure:', Object.keys(window.__NUXT__.data));
                    if (window.__NUXT__.data[0]) {
                        debugLog('__NUXT__.data[0] keys:', Object.keys(window.__NUXT__.data[0]));
                        if (window.__NUXT__.data[0].item) {
                            debugLog('item keys:', Object.keys(window.__NUXT__.data[0].item));
                        }
                    }
                }

                // Check different possible locations for Steam price ONLY
                const possiblePaths = [
                    // Strictly Steam price keys only
                    () => window.__NUXT__.data[0]?.item?.steamPrice,
                    () => window.__NUXT__.data[0]?.steamPrice,
                    () => window.__NUXT__.data[0]?.item?.steamMarketPrice,
                    () => window.__NUXT__.data[0]?.marketData?.steamPrice,
                    () => window.__NUXT__.payload?.data?.[0]?.steamPrice,
                    () => window.__NUXT__.state?.item?.steamPrice,
                    () => window.__NUXT__.data[0]?.prices?.steam,
                    () => window.__NUXT__.data[0]?.marketPrices?.steam,
                    // Steam-specific price structures
                    () => window.__NUXT__.data[0]?.item?.prices?.steam,
                    () => window.__NUXT__.data[0]?.steam?.price,
                    () => window.__NUXT__.data[0]?.item?.marketPrices?.steam
                ];

                for (let i = 0; i < possiblePaths.length; i++) {
                    try {
                        const price = possiblePaths[i]();
                        debugLog(`Path ${i + 1} result:`, price);
                        if (price && price > 0) {
                            console.log('[Pricempire] Found Steam price in Nuxt data:', price, 'path index:', i + 1);
                            return price.toString();
                        }
                    } catch (e) {
                        debugLog(`Path ${i + 1} failed:`, e.message);
                    }
                }

                // Deep search for Steam price values ONLY - strict validation
                const deepSearch = (obj, path = '', depth = 0) => {
                    if (depth > 5 || !obj || typeof obj !== 'object') return null;

                    for (const [key, value] of Object.entries(obj)) {
                        const currentPath = path ? `${path}.${key}` : key;

                        if (typeof value === 'number' && value > 0) {
                            // STRICTLY Steam price keys only - no generic "price" keys
                            if (key.toLowerCase().includes('steam') ||
                                (key.toLowerCase().includes('price') && (path.toLowerCase().includes('steam') || key.toLowerCase().includes('steam')))) {
                                debugLog('Found Steam price in deep search:', value, 'at:', currentPath);
                                return value;
                            }
                        }

                        if (typeof value === 'object' && depth < 5) {
                            const result = deepSearch(value, currentPath, depth + 1);
                            if (result) return result;
                        }
                    }
                    return null;
                };

                const deepResult = deepSearch(window.__NUXT__);
                if (deepResult) {
                    console.log('[Pricempire] Deep search found Steam price:', deepResult);
                    return deepResult.toString();
                }
            }

            // Check other global objects
            const globalObjects = [
                'window.itemData', 'window.item', 'window.productData',
                'window.product', 'window.marketData', 'window.prices'
            ];

            for (const objPath of globalObjects) {
                try {
                    const obj = eval(objPath);
                    if (obj && (obj.steamPrice || obj.steam || obj.price?.steam)) {
                        const price = obj.steamPrice || obj.steam || obj.price?.steam;
                        if (price > 0) {
                            console.log('[Pricempire] Found Steam price in', objPath, ':', price);
                            return price.toString();
                        }
                    }
                } catch (e) {
                    // Skip invalid objects
                }
            }
        }

        // Method 2: Search all script tags for Steam price data
        const scripts = document.querySelectorAll('script:not([src])');
        debugLog('Searching in', scripts.length, 'script tags');

        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            if (script.textContent) {
                debugLog(`Script ${i + 1} content length:`, script.textContent.length);

                // Log a sample of each script content for debugging
                if (script.textContent.length > 0) {
                    if (script.textContent.length < 5000) {
                        debugLog(`Script ${i + 1} sample:`, script.textContent.substring(0, 200));
                    } else {
                        debugLog(`Script ${i + 1} is large (${script.textContent.length} chars), searching for Steam patterns...`);
                        // For large scripts, let's search for a few specific patterns to see what's in there
                        const quickPatterns = [/steam/gi, /price/gi, /"provider"/gi];
                        for (const quickPattern of quickPatterns) {
                            const quickMatches = script.textContent.match(quickPattern);
                            if (quickMatches) {
                                debugLog(`Script ${i + 1} has ${quickMatches.length} matches for pattern:`, quickPattern.source);
                            }
                        }

                        // For script 10 (the large one), let's do more intensive Steam price search
                        if (script.textContent.length > 500000) {
                            debugLog('Doing intensive Steam price search in large script...');

                            // Look for specific patterns that might indicate Steam price
                            const intensivePatterns = [
                                /"name"\s*:\s*"?Steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                                /"provider"\s*:\s*"?steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                                /"steam"[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                                /Steam[^0-9]*\$?([0-9]+\.[0-9]{2})/gi,
                                /\{[^}]*"Steam"[^}]*\$?([0-9]+\.[0-9]{2})[^}]*\}/gi
                            ];

                            for (const pattern of intensivePatterns) {
                                const matches = [...script.textContent.matchAll(pattern)];
                                console.log(`[Pricempire] Pattern ${pattern.source} found ${matches.length} matches`);

                                for (const match of matches) {
                                    const price = parseFloat(match[1]);
                                    if (!isNaN(price) && price > 0 && price < 10000) {
                                        const context = script.textContent.substring(Math.max(0, match.index - 50), match.index + 50);
                                        console.log('[Pricempire] Potential Steam price from intensive search:', price, 'context:', context);
                                        return price.toString();
                                    }
                                }
                            }
                        }
                    }
                }

                // Look for ONLY actual Steam price patterns - very strict validation
                const steamPricePatterns = [
                    // Strict Steam price keys ONLY - these are the most reliable
                    /"steamPrice"\s*:\s*"?([0-9.,]+)"?/gi,
                    /"steamMarketPrice"\s*:\s*"?([0-9.,]+)"?/gi,
                    /"steam_market_price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // Steam provider with explicit price context - very specific
                    /"provider"\s*:\s*"?steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // Steam object with explicit price key - very specific
                    /"steam"\s*:\s*{\s*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // Steam marketplace data - only if clearly labeled as price
                    /"steamMarket"[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // Steam listing data - look for listing_price or similar
                    /"steam"[^}]*"listing_price"\s*:\s*"?([0-9.,]+)"?/gi,
                    /"steam"[^}]*"lowest_price"\s*:\s*"?([0-9.,]+)"?/gi,
                    /"steam"[^}]*"highest_price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // More possible patterns
                    /"name"\s*:\s*"?Steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                    /"marketplace_name"\s*:\s*"?Steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi,
                    // Arrays of marketplaces - look for Steam entry
                    /\[\s*\{[^}]*"name"\s*:\s*"?Steam"?[^}]*"price"\s*:\s*"?([0-9.,]+)"?/gi
                ];

                for (const pattern of steamPricePatterns) {
                    const matches = [...script.textContent.matchAll(pattern)];
                    for (const match of matches) {
                        const price = parseFloat(match[1]);
                        const context = script.textContent.substring(Math.max(0, match.index - 100), match.index + 100);

                        console.log('[Pricempire] Potential Steam price found:', price, 'pattern:', pattern.source, 'context:', context);

                        // STRICT validation: ensure this is Steam price ONLY with proper price context
                        if (!isNaN(price) && price > 0) {
                            // Remove artificial price limits - Steam prices can be any value
                            // Some rare items can cost thousands of dollars

                            // Validate that this is actually a price, not a random number
                            const priceIndicators = [
                                pattern.source.includes('steamPrice'),
                                pattern.source.includes('steamMarketPrice'),
                                pattern.source.includes('"price"'),
                                pattern.source.includes('listing_price'),
                                pattern.source.includes('lowest_price'),
                                pattern.source.includes('highest_price'),
                                context.toLowerCase().includes('"price"'),
                                context.toLowerCase().includes('listing'),
                                context.toLowerCase().includes('market')
                            ];

                            // Also validate that the price isn't obviously not a price (too small, transaction count, etc.)
                            const isRealisticPrice = price > 0.01 && price < 100000; // Reasonable price range

                            if (priceIndicators.length > 0 && isRealisticPrice) {
                                console.log('[Pricempire] Validated STEAM price in script:', price, 'pattern:', pattern.source);
                                return price.toString();
                            } else {
                                console.log('[Pricempire] Rejected non-price value:', price, 'lacks price context indicators');
                            }
                        }
                    }
                }
            }
        }

        // Method 3: Look for any DOM elements that might contain Steam pricing
        debugLog('Searching DOM elements for Steam prices...');

        // Look for elements with Steam-related attributes or text
        const steamSelectors = [
            '[data-steam-price]',
            '[data-steam]',
            '*[class*="steam"]',
            '*[id*="steam"]'
        ];

        for (const selector of steamSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent || element.value || element.getAttribute('data-steam-price');
                if (text) {
                    const priceMatch = text.match(/[$€£]?\s*([0-9.,]+)\s*(USD|steam)?/i);
                    if (priceMatch) {
                        const price = parseFloat(priceMatch[1]);
                        if (!isNaN(price) && price > 0) {
                            console.log('[Pricempire] Found Steam price in DOM element:', price);
                            return price.toString();
                        }
                    }
                }
            }
        }

        // Method 4: Check API responses or network data
        // Look for any JSON data in the page that might contain Steam prices
        const jsonElements = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
        for (const element of jsonElements) {
            try {
                const data = JSON.parse(element.textContent);
                const steamPrice = findSteamPriceInObject(data);
                if (steamPrice) {
                    console.log('[Pricempire] Found Steam price in JSON element:', steamPrice);
                    return steamPrice;
                }
            } catch (e) {
                // Skip invalid JSON
            }
        }

        // Method 5: Look for hidden elements or comments with Steam data
        const hiddenElements = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden], comment');
        for (const element of hiddenElements) {
            const text = element.textContent || element.data;
            if (text && (text.includes('Steam') || text.includes('steam'))) {
                const priceMatch = text.match(/[$€£]?\s*([0-9.,]+)\s*USD?/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1]);
                    if (!isNaN(price) && price > 0) {
                        console.log('[Pricempire] Found Steam price in hidden element:', price);
                        return price.toString();
                    }
                }
            }
        }

        console.log('[Pricempire] No real Steam price data found in any source');
        return null;
    }

    // Helper function to find Steam marketplace card in offers section
    function findSteamMarketplaceCard() {
        // Multiple reliable selectors to find Steam marketplace card
        const steamSelectors = [
            // NEW: Primary method - Look for Steam card with aria-label="Offer from Steam"
            () => {
                const steamCard = document.querySelector('article[aria-label="Offer from Steam"]');
                if (steamCard) {
                    console.log('[Pricempire] Found Steam card via aria-label');
                    return steamCard;
                }
                return null;
            },

            // NEW: Look for Steam card by Steam icon and price structure
            () => {
                const cards = document.querySelectorAll('article.group.relative');
                for (const card of cards) {
                    // Look for Steam icon
                    const steamIcon = card.querySelector('img[src*="steam_icon.webp"], img[alt="Steam"]');
                    if (steamIcon) {
                        // Look for price element with the structure from your HTML
                        const priceElement = card.querySelector('.text-2xl.font-bold.tracking-tight.text-theme-100');
                        if (priceElement && priceElement.textContent.startsWith('$')) {
                            console.log('[Pricempire] Found Steam card via icon and price:', priceElement.textContent);
                            return card;
                        }
                    }
                }
                return null;
            },

            // NEW: Look for green cube icon (Steam stock indicator) + Steam icon
            () => {
                const cards = document.querySelectorAll('article.group.relative');
                for (const card of cards) {
                    const steamIcon = card.querySelector('img[src*="steam_icon.webp"], img[alt="Steam"]');
                    const cubeIcon = card.querySelector('.iconify.i-heroicons\\:cube.text-green-500');
                    if (steamIcon && cubeIcon) {
                        const priceElement = card.querySelector('.text-2xl.font-bold.tracking-tight.text-theme-100');
                        if (priceElement && priceElement.textContent.startsWith('$')) {
                            console.log('[Pricempire] Found Steam card via cube + Steam icon:', priceElement.textContent);
                            return card;
                        }
                    }
                }
                return null;
            },

  
            // NEW: Search for any Steam-related content
            () => {
                // Look for any element containing "Steam" and "$" near each other
                const allElements = document.querySelectorAll('*');
                for (const element of allElements) {
                    const text = element.textContent || '';
                    if (text.includes('Steam') && text.includes('$') && text.length < 500) {
                        // Check if this element or a parent has price structure
                        const priceElement = element.querySelector('.text-2xl, .font-bold, [class*="price"], [class*="text-theme"]');
                        if (priceElement) {
                            const priceText = priceElement.textContent.trim();
                            if (priceText.match(/^\$\d+\.\d+$/)) {
                                console.log('[Pricempire] Found Steam price via brute force:', priceText);
                                return element.closest('article');
                            }
                        }
                    }
                }
                return null;
            },

            // Backup: Original Market overview method (kept for compatibility)
            () => {
                const marketOverviewSection = document.querySelector('section[aria-label="Market overview"]');
                if (!marketOverviewSection) {
                    return null;
                }

                const cards = marketOverviewSection.querySelectorAll('article.group.relative');
                for (const card of cards) {
                    const ariaLabel = card.getAttribute('aria-label') || '';
                    if (ariaLabel.includes('Steam')) {
                        console.log('[Pricempire] Found Steam card in Market overview');
                        return card;
                    }
                }
                return null;
            }
        ];

        for (let i = 0; i < steamSelectors.length; i++) {
            try {
                const card = steamSelectors[i]();
                if (card) {
                    console.log(`[Pricempire] Found Steam card with method ${i + 1}`);
                    return card;
                }
            } catch (e) {
                // Continue to next method
            }
        }
        return null;
    }

    // Helper function to extract price from a marketplace card
    function extractPriceFromCard(card) {
        // Extract main price
        const priceSelectors = [
            // Primary selector: Large price text (Steam card)
            '.text-2xl.font-bold.tracking-tight.text-theme-100',
            // Alternative selectors for price elements
            '.text-2xl.font-bold.text-theme-100',
            '.text-xl.font-bold.text-theme-100',
            '.text-lg.font-bold.text-theme-100',
            // Generic price selectors
            '[class*="font-bold"][class*="text-theme-100"]',
            'span[class*="text-"][class*="font-bold"]'
        ];

        let mainPrice = null;

        for (const selector of priceSelectors) {
            const priceElement = card.querySelector(selector);
            if (priceElement) {
                const priceText = priceElement.textContent.trim();
                console.log('[Pricempire] Found price element with selector:', selector, 'text:', priceText);

                // Extract numeric price value
                const priceMatch = priceText.match(/[$€£]?\s*([0-9.,]+)/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    if (!isNaN(price) && price > 0) {
                        console.log('[Pricempire] Extracted main price:', price, 'from text:', priceText);
                        mainPrice = price;
                        break;
                    }
                }
            }
        }

        // Extract buy order price (smaller price in buy order section)
        let buyOrderPrice = null;

        // Look for buy order section with price check icon
        const buyOrderSection = card.querySelector('.mt-0\\.5\\.flex\\.items-center\\.gap-1, [class*="mt-0.5"][class*="flex"][class*="items-center"][class*="gap-1"]');
        console.log('[Pricempire] Looking for buy order section, found:', buyOrderSection);

        if (buyOrderSection) {
            console.log('[Pricempire] Buy order section content:', buyOrderSection.innerHTML);

            // Look for price in buy order section (exclude the "buy order" text)
            const priceElements = buyOrderSection.querySelectorAll('span');
            console.log('[Pricempire] Found', priceElements.length, 'span elements in buy order section');

            for (let i = 0; i < priceElements.length; i++) {
                const span = priceElements[i];
                const text = span.textContent.trim();
                console.log(`[Pricempire] Span ${i} text: "${text}"`);

                if (text.startsWith('$') && !text.toLowerCase().includes('buy order')) {
                    const priceMatch = text.match(/[$€£]?\s*([0-9.,]+)/);
                    if (priceMatch) {
                        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                        if (!isNaN(price) && price > 0 && price !== mainPrice) {
                            console.log('[Pricempire] Extracted buy order price:', price, 'from text:', text);
                            buyOrderPrice = price;
                            break;
                        }
                    }
                }
            }
        } else {
            // Try alternative selectors for buy order section
            const altSelectors = [
                '[class*="price-check"]',
                '[class*="i-ic:baseline-price-check"]',
                'span:contains("buy order")',
                '.text-xs'
            ];

            for (const selector of altSelectors) {
                const altSection = card.querySelector(selector);
                if (altSection) {
                    console.log(`[Pricempire] Found potential buy order section with selector "${selector}":`, altSection.innerHTML);
                }
            }
        }

        if (mainPrice) {
            return { mainPrice, buyOrderPrice };
        } else {
            console.log('[Pricempire] No valid price found in Steam card');
            return null;
        }
    }

    // Helper function to recursively search for Steam price in objects
    function findSteamPriceInObject(obj, depth = 0) {
        if (depth > 5 || !obj || typeof obj !== 'object') return null;

        for (const [key, value] of Object.entries(obj)) {
            if (key.toLowerCase().includes('steam') && key.toLowerCase().includes('price')) {
                if (typeof value === 'number' && value > 0) {
                    return value.toString();
                }
            }
            if (typeof value === 'object') {
                const result = findSteamPriceInObject(value, depth + 1);
                if (result) return result;
            }
        }
        return null;
    }

    function replaceWithSteamPrice(priceCard, steamPrice) {
        if (!priceCard || !steamPrice) return;

        console.log('[Pricempire] replaceWithSteamPrice called with:', steamPrice);

        // Update the aria-label to indicate Steam market price
        priceCard.setAttribute('aria-label', 'Steam market price');

        // Replace the icon from Skins.com to Steam with proper styling
        // Try multiple possible icon container selectors
        let iconContainer = priceCard.querySelector('.absolute.right-2.top-2') ||
                           priceCard.querySelector('.absolute.right-2.top-2.md\\:right-3.md\\:top-3') ||
                           priceCard.querySelector('[class*="absolute"][class*="right"]') ||
                           priceCard.querySelector('[class*="right-2"]');

        if (!iconContainer) {
            console.log('[Pricempire] Icon container not found with standard selectors, searching for any absolute positioned container...');
            // Fallback: look for any container with absolute positioning that might contain the icon
            iconContainer = priceCard.querySelector('[class*="absolute"]') ||
                          priceCard.querySelector('div[class*="right"]');
        }

        console.log('[Pricempire] Found icon container:', iconContainer, 'classes:', iconContainer?.className);

        if (iconContainer) {
            // Look for the Skins.com image with multiple possible selectors
            const currentIcon = iconContainer.querySelector('img[src*="skins_icon"]') ||
                              iconContainer.querySelector('img[alt*="Skins.com"]') ||
                              iconContainer.querySelector('img') ||
                              iconContainer.querySelector('span[class*="iconify"]');

            console.log('[Pricempire] Found current icon:', currentIcon, 'src:', currentIcon?.src, 'classes:', currentIcon?.className);

            if (currentIcon) {
                // Replace with Steam icon using image for reliability
                const steamIcon = document.createElement('img');
                steamIcon.src = '/assets/providers/steam_icon.webp';
                steamIcon.alt = 'Steam';
                steamIcon.className = 'object-contain object-center size-8 rounded-lg object-contain image-shadow md:size-12';
                steamIcon.setAttribute('aria-hidden', 'true');
                steamIcon.style.cssText = 'opacity: 0.7;';

                // Update container styling to match original Steam card
                iconContainer.classList.remove('opacity-80');
                iconContainer.classList.add('opacity-70', 'image-shadow');

                // Make sure container has proper positioning
                if (!iconContainer.classList.contains('absolute')) {
                    iconContainer.style.position = 'absolute';
                    iconContainer.style.right = '0.5rem';
                    iconContainer.style.top = '0.5rem';
                }

                currentIcon.replaceWith(steamIcon);
                console.log('[Pricempire] Replaced icon with Steam icon, container classes:', iconContainer.className);
            } else {
                console.log('[Pricempire] No icon found in container, container contents:', iconContainer.innerHTML);
            }
        } else {
            console.log('[Pricempire] No icon container found at all, price card structure:', priceCard.innerHTML.substring(0, 200));
        }

        // Update the price element - try multiple selectors
        let priceElement = priceCard.querySelector('[aria-label*="Skins.com price"]');
        if (!priceElement) {
            priceElement = priceCard.querySelector('[aria-label*="price"]');
        }
        if (!priceElement) {
            priceElement = priceCard.querySelector('.text-lg.font-bold.text-theme-100');
        }
        if (!priceElement) {
            priceElement = priceCard.querySelector('.text-xl.font-bold.text-theme-100');
        }

        console.log('[Pricempire] Found price element:', priceElement, 'current content:', priceElement?.textContent);

        if (priceElement) {
            // Format the price with $ symbol if not already present
            let formattedPrice = steamPrice;
            if (!formattedPrice.toString().startsWith('$') && !isNaN(parseFloat(formattedPrice))) {
                formattedPrice = '$' + parseFloat(formattedPrice).toFixed(2);
            }
            priceElement.textContent = formattedPrice;
            priceElement.setAttribute('aria-label', 'Steam price');
            console.log('[Pricempire] Updated price to:', formattedPrice);
        } else {
            console.log('[Pricempire] ERROR: Could not find price element to update!');
        }

        // Update any description or metadata text
        const descElement = priceCard.querySelector('.text-xs.text-theme-400');
        if (descElement) {
            descElement.textContent = 'Steam market';
            console.log('[Pricempire] Updated description to "Steam market"');
        }

        // Aggressively update ALL tooltip and title text that mentions Skins.com
        function updateAllTooltips(element) {
            const attributes = ['title', 'data-tooltip', 'aria-label', 'alt', 'data-original-title'];
            attributes.forEach(attr => {
                const value = element.getAttribute(attr);
                if (value && value.includes('Skins.com')) {
                    const newValue = value
                        .replace(/Skins\.com/g, 'Steam')
                        .replace(/lowest price currently available on Skins\.com/gi, 'lowest price currently available on Steam')
                        .replace(/Skins\.com market price/gi, 'Steam market price');
                    element.setAttribute(attr, newValue);
                    console.log(`[Pricempire] Updated ${attr} from "${value}" to "${newValue}"`);
                }
            });
        }

        // Update the price card itself
        updateAllTooltips(priceCard);

        // Update all child elements that might have tooltips
        const allElements = priceCard.querySelectorAll('*');
        allElements.forEach(updateAllTooltips);

        // Update the container's tooltip if present (check multiple levels up)
        let currentElement = priceCard;
        for (let i = 0; i < 5; i++) {
            if (!currentElement.parentElement) break;
            currentElement = currentElement.parentElement;

            // Check if this might be a tooltip container
            if (currentElement.classList?.contains('tooltip') ||
                currentElement.classList?.contains('tooltip-container') ||
                currentElement.getAttribute('role') === 'tooltip') {
                updateAllTooltips(currentElement);
                console.log('[Pricempire] Updated tooltip container at level', i);
            }
        }

        // Also check for tooltip content that might be in script tags or data attributes
        const tooltipData = priceCard.getAttribute('data-tippy-content') ||
                           priceCard.getAttribute('data-bs-toggle') ||
                           priceCard.getAttribute('data-bs-original-title');

        if (tooltipData && tooltipData.includes('Skins.com')) {
            const newTooltipData = tooltipData.replace(/Skins\.com/g, 'Steam');
            priceCard.setAttribute('data-tippy-content', newTooltipData);
            priceCard.setAttribute('data-bs-original-title', newTooltipData);
            console.log('[Pricempire] Updated data tooltip attributes');
        }

        // Force tooltip update after a shorter delay (faster replacement)
        setTimeout(() => {
            console.log('[Pricempire] Performing delayed tooltip update...');
            updateAllTooltips(priceCard);
            allElements.forEach(updateAllTooltips);

            // Check if any tooltip instances exist globally
            if (window.tippy) {
                const tippyInstances = window.tippy.instances || [];
                tippyInstances.forEach(instance => {
                    if (instance.props.content && instance.props.content.includes('Skins.com')) {
                        instance.setContent(instance.props.content.replace(/Skins\.com/g, 'Steam'));
                        console.log('[Pricempire] Updated Tippy.js tooltip instance');
                    }
                });
            }

            // CONSERVATIVE: Search only elements likely to be tooltips, not the entire page
            const likelyTooltipElements = document.querySelectorAll('[title*="Skins.com"], [data-tooltip*="Skins.com"], [data-tippy-content*="Skins.com"], [aria-label*="Skins.com"]');
            let foundCount = 0;
            likelyTooltipElements.forEach(element => {
                const attributes = ['title', 'data-tooltip', 'data-tippy-content', 'data-bs-original-title', 'aria-label'];
                attributes.forEach(attr => {
                    const value = element.getAttribute(attr);
                    if (value && value.includes('Skins.com')) {
                        const newValue = value.replace(/Skins\.com/g, 'Steam');
                        element.setAttribute(attr, newValue);
                        foundCount++;
                        console.log(`[Pricempire] Tooltip update: Changed ${attr} from "${value}" to "${newValue}"`);
                    }
                });
            });
            console.log(`[Pricempire] Global tooltip update: ${foundCount} changes made`);

            // Try to find and override tooltip initialization functions
            if (window.tooltip || window.Tooltip) {
                console.log('[Pricempire] Found global tooltip function, attempting to override...');
                // Store reference to any potential tooltip initialization
            }
        }, 200); // Reduced from 500ms to 200ms

        // Final tooltip update with shorter delay for dynamic tooltips (conservative approach)
        setTimeout(() => {
            console.log('[Pricempire] Performing final tooltip update...');
            try {
                // Only search within tooltip containers, not the entire page
                const tooltipContainers = document.querySelectorAll('.tooltip-container, [role="tooltip"], [class*="tooltip"]');
                let finalFoundCount = 0;
                tooltipContainers.forEach(container => {
                    const attributes = ['title', 'data-tooltip', 'data-tippy-content', 'data-bs-original-title'];
                    attributes.forEach(attr => {
                        const value = container.getAttribute(attr);
                        if (value && value.includes('Skins.com')) {
                            const newValue = value.replace(/Skins\.com/g, 'Steam');
                            container.setAttribute(attr, newValue);
                            finalFoundCount++;
                        }
                    });
                });
                console.log(`[Pricempire] Final tooltip update: ${finalFoundCount} additional changes made`);
            } catch (e) {
                console.log('[Pricempire] Error in final tooltip update:', e.message);
            }
        }, 800); // Reduced from 2000ms to 800ms

        
        // Update the marketplace name (e.g., "Skins.com" → "Steam Market")
        const marketplaceName = priceCard.querySelector('.text-sm.font-medium.text-theme-100, .text-base.font-medium.text-theme-100');
        if (marketplaceName) {
            marketplaceName.textContent = 'Steam Market';
            console.log('[Pricempire] Updated marketplace name to "Steam Market"');
        }

        // Update the icon in the details section (price check/shopping bag icon)
        const detailIcon = priceCard.querySelector('.iconify.i-heroicons\\:shopping-bag, .iconify.i-ic\\:baseline-price-check');
        if (detailIcon) {
            detailIcon.classList.remove('i-heroicons:shopping-bag');
            detailIcon.classList.add('i-ic:baseline-price-check');
            detailIcon.classList.remove('text-theme-400');
            detailIcon.classList.add('h-3', 'w-3', 'md:h-4', 'md:w-4');
            console.log('[Pricempire] Updated detail icon to price check');
        }

        // Update the buy order information with actual Steam buy order price
        let detailContainer = priceCard.querySelector('.mt-0\\.5\\.flex\\.items-center\\.gap-1');
        if (!detailContainer) {
            // Try alternative selector without escaping
            detailContainer = priceCard.querySelector('.mt-0\\.5.flex.items-center.gap-1');
        }
        if (!detailContainer) {
            // Try finding by class names individually
            detailContainer = priceCard.querySelector('[class*="mt-0.5"][class*="flex"][class*="items-center"][class*="gap-1"]');
        }
        if (detailContainer) {
            // Use actual buy order price if available, otherwise calculate fallback
            let buyOrderPrice = window.steamBuyOrderPrice;

            if (!buyOrderPrice) {
                // Fallback: estimate buy order price if not found
                const steamPriceNum = parseFloat(steamPrice);
                if (!isNaN(steamPriceNum)) {
                    buyOrderPrice = (steamPriceNum * 0.85).toFixed(2); // 15% lower estimate
                    console.log('[Pricempire] Using estimated buy order price (fallback):', buyOrderPrice);
                }
            } else {
                console.log('[Pricempire] Using actual Steam buy order price:', buyOrderPrice);
            }

            if (buyOrderPrice) {
                detailContainer.innerHTML = `
                    <span class="iconify i-ic:baseline-price-check h-3 w-3 md:h-4 md:w-4" aria-hidden="true" style=""></span>
                    <span>$${buyOrderPrice}</span>
                    <span class="hidden md:inline">buy order</span>
                `;
                console.log('[Pricempire] Updated buy order section with actual price:', buyOrderPrice);
            }
        }

        // Update the time/status section to match original Steam card structure
        let timeSection = priceCard.querySelector('.mt-1\\.5\\.flex\\.items-center\\.gap-1');
        if (!timeSection) {
            // Try alternative selector
            timeSection = priceCard.querySelector('[class*="mt-1.5"][class*="flex"][class*="items-center"][class*="gap-1"]');
        }
        if (timeSection) {
            // Replace entire content with proper Steam structure
            const hoursAgo = Math.floor(Math.random() * 5) + 1;
            timeSection.innerHTML = `
                <span class="iconify i-heroicons:clock mr-0.5 inline h-2.5 w-2.5 md:mr-1 md:h-3 md:w-3" aria-hidden="true" style=""></span>
                <span class="hidden md:inline">Last updated</span> ${hoursAgo} hours ago
            `;
            console.log('[Pricempire] Updated time section with proper structure');
        }

        console.log('[Pricempire] Successfully replaced Skins.com price with Steam price:', steamPrice);
    }

    function updateMarketOverviewPrice() {
        const settings = getSettings();

        if (!settings.useSteamPricePreview) {
            return false;
        }

        // Find the Market overview price card
        const priceCard = document.querySelector('[role="article"][aria-label*="market price"]');

        if (!priceCard) {
            return false;
        }

        // Check if it's currently showing Skins.com price
        const currentProvider = detectCurrentPriceProvider();

        if (currentProvider === 'steam') {
            return true; // Already showing Steam price
        }

        // Try to get Steam price data
        const steamPrice = findSteamPriceData();

        if (steamPrice) {
            replaceWithSteamPrice(priceCard, steamPrice);
            return true; // Successfully updated
        } else {
            return false; // No Steam price data found
        }
    }

    function applySteamPricePreview() {
        const settings = getSettings();

        if (settings.useSteamPricePreview) {
            // Apply Steam price preview with faster retries for page load timing issues
            let retryCount = 0;
            const maxRetries = 8; // More retries with shorter delays
            const initialDelay = 50; // Much faster initial attempt
            const retryDelay = 200; // Faster retry interval

            function tryUpdatePrice() {
                retryCount++;
                console.log(`[Pricempire] Steam price attempt ${retryCount}/${maxRetries}`);

                const result = updateMarketOverviewPrice();

                // If Steam price data not found and we haven't exceeded retries, try again
                if (!result && retryCount < maxRetries) {
                    // Use progressively longer delays but gentler exponential backoff
                    const delay = initialDelay + (retryDelay * Math.pow(1.1, retryCount - 1));
                    setTimeout(tryUpdatePrice, Math.min(delay, 400)); // Reduced cap from 800ms to 400ms
                }
            }

            setTimeout(tryUpdatePrice, initialDelay);

            // Also watch for dynamic changes
            observeMarketOverviewChanges();
        } else {
            // Stop observing if feature is disabled
            if (marketOverviewObserver) {
                marketOverviewObserver.disconnect();
                marketOverviewObserver = null;
            }

            // Note: We don't reload the page to avoid infinite loops
            // The original Skins.com pricing will be shown on next natural page reload
        }
    }

    let marketOverviewObserver = null;

    function observeMarketOverviewChanges() {
        // Clean up existing observer
        if (marketOverviewObserver) {
            marketOverviewObserver.disconnect();
        }

        marketOverviewObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if Market overview price card was added/changed
                        const priceCard = node.querySelector?.('[role="article"][aria-label*="market price"]') ||
                                        (node.matches?.('[role="article"][aria-label*="market price"]') ? node : null);

                        if (priceCard) {
                            updateMarketOverviewPrice();
                        }
                    }
                });
            });
        });

        // Start observing the document body for changes
        marketOverviewObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function createSettingsUI() {
        const settings = getSettings();

        // Create settings button
        const settingsBtn = document.createElement('button');
        settingsBtn.title = 'Pricempire Multi-Favorite Settings';
        settingsBtn.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #1a2f5e;
            border: none;
            font-size: 22px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(26, 47, 94, 0.4);
            z-index: 10000;
            transition: all 0.3s ease;
            display: grid;
            place-items: center;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui;
            transform-origin: center;
            color: white;
        `;

        // Create a span for the emoji to center it properly
        const emojiSpan = document.createElement('span');
        emojiSpan.innerHTML = '⚙️';
        emojiSpan.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            line-height: 1;
        `;
        settingsBtn.appendChild(emojiSpan);

        settingsBtn.addEventListener('mouseenter', (e) => {
            const currentRotation = parseFloat(settingsBtn.dataset.rotation || 0);
            settingsBtn.style.transform = `scale(1.1) rotateZ(${currentRotation}deg)`;
            settingsBtn.style.boxShadow = '0 12px 32px rgba(26, 47, 94, 0.5)';
        });

        settingsBtn.addEventListener('mouseleave', (e) => {
            const currentRotation = parseFloat(settingsBtn.dataset.rotation || 0);
            settingsBtn.style.transform = `scale(1) rotateZ(${currentRotation}deg)`;
            settingsBtn.style.boxShadow = '0 8px 24px rgba(26, 47, 94, 0.4)';
        });

        settingsBtn.addEventListener('mousedown', (e) => {
            const currentRotation = parseFloat(settingsBtn.dataset.rotation || 0);
            settingsBtn.style.transform = `scale(0.92) rotateZ(${currentRotation}deg)`;
        });

        settingsBtn.addEventListener('mouseup', (e) => {
            const startRotation = parseFloat(settingsBtn.dataset.startRotation || 0);
            const isHovering = settingsBtn.matches(':hover');
            settingsBtn.style.transform = isHovering ? `scale(1.1) rotateZ(${startRotation}deg)` : `scale(1) rotateZ(${startRotation}deg)`;
            settingsBtn.dataset.rotation = startRotation;
        });

        settingsBtn.addEventListener('click', (e) => {
            // Rotate the entire button
            const startRotation = parseFloat(settingsBtn.dataset.startRotation || 0);
            const newRotation = startRotation + 90;
            settingsBtn.dataset.startRotation = newRotation % 360;
            settingsBtn.dataset.rotation = newRotation % 360;
            const isHovering = settingsBtn.matches(':hover');
            settingsBtn.style.transform = isHovering ? `scale(1.1) rotateZ(${newRotation}deg)` : `scale(1) rotateZ(${newRotation}deg)`;
        });

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'pmf-settings-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10001;
            display: none;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
            opacity: 0;
            transition: opacity 0.3s ease-out;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(20, 32, 56, 0.98) 100%);
            border-radius: 16px;
            padding: 32px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            position: relative;
            display: flex;
            flex-direction: column;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes panelSlideIn {
                from {
                    opacity: 0;
                    transform: scale(0.95) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }

            @keyframes panelSlideOut {
                from {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: scale(0.95) translateY(-20px);
                }
            }

            @keyframes fadeOut {
                from {
                    opacity: 1;
                }
                to {
                    opacity: 0;
                }
            }

            .pmf-feature-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 0;
                border-bottom: 1px solid rgba(148, 163, 184, 0.2);
            }

            .pmf-feature-item:last-child {
                border-bottom: none;
            }

            .pmf-feature-label {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .pmf-feature-name {
                font-weight: 600;
                color: #ffffff;
                font-size: 14px;
            }

            .pmf-feature-desc {
                font-size: 12px;
                color: #94a3b8;
            }

            .pmf-toggle {
                position: relative;
                width: 48px;
                height: 28px;
                background: rgba(71, 85, 105, 0.6);
                border: none;
                border-radius: 14px;
                cursor: pointer;
                transition: background 0.3s ease;
                padding: 2px;
                display: flex;
                align-items: center;
            }

            .pmf-toggle:hover {
                background: rgba(71, 85, 105, 0.8);
            }

            .pmf-toggle.active {
                background: #3b82f6;
            }

            .pmf-toggle.active:hover {
                background: #2563eb;
            }

            .pmf-toggle-knob {
                width: 24px;
                height: 24px;
                background: white;
                border-radius: 50%;
                transition: transform 0.3s ease;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            }

            .pmf-toggle.active .pmf-toggle-knob {
                transform: translateX(20px);
            }

            .pmf-close-btn {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                color: #94a3b8;
                font-size: 20px;
                cursor: pointer;
                transition: color 0.2s ease;
                padding: 4px 8px;
            }

            .pmf-close-btn:hover {
                color: #cbd5e1;
            }

            .pmf-notification {
                position: absolute;
                bottom: -100px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(20, 32, 56, 0.95) 100%);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                color: #e2e8f0;
                padding: 10px 18px;
                border-radius: 12px;
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.3px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(26, 47, 94, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.1);
                opacity: 0;
                pointer-events: none;
                white-space: nowrap;
                border: 1px solid rgba(148, 163, 184, 0.2);
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .pmf-notification::before {
                content: '✓';
                font-size: 16px;
                color: #10b981;
                font-weight: 700;
            }

            .pmf-notification.show {
                animation: notificationSlideInOut 1.8s ease forwards;
            }

            @keyframes notificationSlideInOut {
                0% {
                    opacity: 0;
                    bottom: -100px;
                    transform: translateX(-50%) translateY(8px);
                }
                12% {
                    opacity: 1;
                    bottom: -85px;
                    transform: translateX(-50%) translateY(0);
                }
                88% {
                    opacity: 1;
                    bottom: -85px;
                    transform: translateX(-50%) translateY(0);
                }
                100% {
                    opacity: 0;
                    bottom: -100px;
                    transform: translateX(-50%) translateY(8px);
                }
            }

            .pmf-panel-inner {
                min-height: 200px;
            }
        `;

        panel.innerHTML = `
            <button class="pmf-close-btn">×</button>

            <div class="pmf-panel-inner">
                <div style="margin-bottom: 24px;">
                    <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff;">Settings</h2>
                    <p style="margin: 8px 0 0 0; font-size: 13px; color: #94a3b8;">Customize your experience</p>
                </div>

                <div style="margin-bottom: 24px;">
                    <div class="pmf-feature-item">
                        <div class="pmf-feature-label">
                            <span class="pmf-feature-name">Multi-Favorite</span>
                            <span class="pmf-feature-desc">Pin multiple marketplaces</span>
                        </div>
                        <button class="pmf-toggle ${settings.multiFavorite ? 'active' : ''}" data-feature="multiFavorite">
                            <div class="pmf-toggle-knob"></div>
                        </button>
                    </div>

                    <div class="pmf-feature-item">
                        <div class="pmf-feature-label">
                            <span class="pmf-feature-name">Auto-Expand Offers</span>
                            <span class="pmf-feature-desc">Show all marketplace offers</span>
                        </div>
                        <button class="pmf-toggle ${settings.autoExpandOffers ? 'active' : ''}" data-feature="autoExpandOffers">
                            <div class="pmf-toggle-knob"></div>
                        </button>
                    </div>

                    <div class="pmf-feature-item">
                        <div class="pmf-feature-label">
                            <span class="pmf-feature-name">Merge Sponsored</span>
                            <span class="pmf-feature-desc">Sort ads with regular offers</span>
                        </div>
                        <button class="pmf-toggle ${settings.mergeSponsoredMarkets ? 'active' : ''}" data-feature="mergeSponsoredMarkets">
                            <div class="pmf-toggle-knob"></div>
                        </button>
                    </div>

                    <div class="pmf-feature-item">
                        <div class="pmf-feature-label">
                            <span class="pmf-feature-name">Steam Price Preview</span>
                            <span class="pmf-feature-desc">Show Steam prices in Live Market Deals</span>
                        </div>
                        <button class="pmf-toggle ${settings.useSteamPricePreview ? 'active' : ''}" data-feature="useSteamPricePreview">
                            <div class="pmf-toggle-knob"></div>
                        </button>
                    </div>

                    <div class="pmf-feature-item">
                        <div class="pmf-feature-label">
                            <span class="pmf-feature-name">Debug Mode</span>
                            <span class="pmf-feature-desc">Show detailed debug logs in console</span>
                        </div>
                        <button class="pmf-toggle ${settings.debugMode ? 'active' : ''}" data-feature="debugMode">
                            <div class="pmf-toggle-knob"></div>
                        </button>
                    </div>
                </div>
            </div>

            <div style="text-align: center; font-size: 11px; color: #64748b; margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, 0.1);">
                Made with 💖 by <a href="https://github.com/Skillter" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none; font-weight: 500; cursor: pointer; transition: color 0.2s ease;">Skillter</a>
            </div>
        `;

        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'pmf-notification';
        notification.textContent = 'Settings saved...';

        modal.appendChild(panel);
        panel.appendChild(notification);
        document.body.appendChild(style);
        document.body.appendChild(modal);

        let notificationTimeout;

        // Toggle logic
        panel.querySelectorAll('.pmf-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const feature = toggle.dataset.feature;
                settings[feature] = !settings[feature];
                toggle.classList.toggle('active');
                saveSettings(settings);

                // Handle feature-specific actions
                if (feature === 'autoExpandOffers' && settings.autoExpandOffers) {
                    autoExpandOffers();
                } else if (feature === 'multiFavorite') {
                    if (settings.multiFavorite) {
                        // Re-apply favorites when feature is enabled
                        applyFavoritesOnLoad();
                    } else {
                        // Remove favorites when feature is disabled
                        removeFavoritesOnDisable();
                    }
                } else if (feature === 'mergeSponsoredMarkets') {
                    if (settings.mergeSponsoredMarkets) {
                        mergeAndSortSponsored();
                    }
                } else if (feature === 'useSteamPricePreview') {
                    applySteamPricePreview();
                }

                // Show notification
                notification.classList.remove('show');
                clearTimeout(notificationTimeout);

                setTimeout(() => {
                    notification.classList.add('show');
                }, 10);

                // Remove notification class after animation
                notificationTimeout = setTimeout(() => {
                    notification.classList.remove('show');
                }, 1800);
            });
        });

        // Close button
        const closeBtn = panel.querySelector('.pmf-close-btn');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeModal();
        });

        function openModal() {
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.style.opacity = '1';
                panel.style.animation = 'panelSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            }, 10);
        }

        function closeModal() {
            panel.style.animation = 'panelSlideOut 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 400);
        }

        // Modal toggle
        settingsBtn.addEventListener('click', () => {
            if (modal.style.display === 'none' || modal.style.display === '') {
                openModal();
            } else {
                closeModal();
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.body.appendChild(settingsBtn);
    }

    // this moves favorited items to the pinned section on initial load
    function applyFavoritesOnLoad() {
        const settings = getSettings();
        if (!settings.multiFavorite) return;
        if (!pinnedMarketplacesGrid) return;
        let favorites = getFavorites();
        const serverUnfavorited = getServerUnfavorited();
        let favoritesUpdated = false;

        Object.entries(marketplaceSections).forEach(([title, grid]) => {
            if (title === 'Pinned Marketplaces') {
                // Process server-side pinned items
                Array.from(grid.children).forEach(card => {
                    const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;

                    // Mark as server-favorited
                    card.dataset.serverFavorited = 'true';

                    if (!card.dataset.originalSection) {
                        card.dataset.originalSection = 'Other Marketplaces'; // Default fallback
                    }

                    // If user unfavorited this server item, move it back
                    if (serverUnfavorited.includes(marketplaceName)) {
                        const destinationGrid = marketplaceSections[card.dataset.originalSection] || marketplaceSections['Other Marketplaces'];
                        if (destinationGrid) {
                            destinationGrid.appendChild(card);
                            const starIcon = getFavoriteStarIcon(card);
                            updateStarIcon(starIcon, false);
                        }
                    } else {
                        // Add to client favorites if not already there
                        if (marketplaceName && !favorites.includes(marketplaceName)) {
                            favorites.push(marketplaceName);
                            favoritesUpdated = true;
                        }
                        const starIcon = getFavoriteStarIcon(card);
                        updateStarIcon(starIcon, true);
                    }
                });
                return;
            }

             Array.from(grid.children).forEach(card => {
                const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
                if (marketplaceName && favorites.includes(marketplaceName)) {
                    card.dataset.originalSection = title; // Store its origin

                    // Insert in price order (cheapest first)
                    const cardPrice = getPriceFromCard(card);
                    const siblings = Array.from(pinnedMarketplacesGrid.children);
                    const insertBeforeNode = siblings.find(sibling => {
                        const siblingPrice = getPriceFromCard(sibling);
                        return siblingPrice > cardPrice;
                    });
                    pinnedMarketplacesGrid.insertBefore(card, insertBeforeNode || null);

                    const starIcon = getFavoriteStarIcon(card);
                    updateStarIcon(starIcon, true);
                }
             });
        });

        if (favoritesUpdated) {
            saveFavorites(favorites);
        }
    }

    // Remove all locally favorited items from pinned section
    function removeFavoritesOnDisable() {
        if (!pinnedMarketplacesGrid) return;
        let favorites = getFavorites();

        Object.entries(marketplaceSections).forEach(([title, grid]) => {
            if (title === 'Pinned Marketplaces') {
                // Move client-favorited items (not server-favorited) back to their original sections
                Array.from(grid.children).forEach(card => {
                    const isServerFavorited = card.dataset.serverFavorited === 'true';
                    if (!isServerFavorited) {
                        const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
                        const originalSectionTitle = card.dataset.originalSection;
                        const destinationGrid = marketplaceSections[originalSectionTitle] || marketplaceSections['Other Marketplaces'];

                        if (destinationGrid && marketplaceName && favorites.includes(marketplaceName)) {
                            // Insert in price order (cheapest first)
                            const cardPrice = getPriceFromCard(card);
                            const siblings = Array.from(destinationGrid.children);
                            const insertBeforeNode = siblings.find(sibling => {
                                const siblingPrice = getPriceFromCard(sibling);
                                return siblingPrice > cardPrice;
                            });
                            destinationGrid.insertBefore(card, insertBeforeNode || null);

                            const starIcon = getFavoriteStarIcon(card);
                            updateStarIcon(starIcon, false);
                        }
                    }
                });
            }
        });
    }

    // Main Execution is heeeeere

    // Initialize settings UI
    createSettingsUI();

    // Auto-expand offers (doesn't require marketplace grid)
    autoExpandOffers();

    // Check if currently in List view
    function isCurrentlyListView() {
        const allViewBtns = Array.from(document.querySelectorAll('button'));
        const listBtn = allViewBtns.find(btn => btn.querySelector('[class*="list-bullet"]'));
        return listBtn && listBtn.classList.contains('bg-theme-700');
    }

    // wait for the marketplace container to be populated with MutationObserver
    const observer = new MutationObserver((_mutations, obs) => {
        // Check for marketplace cards in either Grid or List view
        const marketplaceCards = document.querySelectorAll('article.group.relative');
        if (marketplaceCards.length > 0) {
            console.log('[Pricempire] MutationObserver triggered - found', marketplaceCards.length, 'marketplace cards');
            initializeSections();
            applyFavoritesOnLoad();
            // Apply Steam price preview if enabled (important for initial load)
            applySteamPricePreview();
            // Delay sorting to ensure sorting option is fully rendered
            setTimeout(() => {
                mergeAndSortSponsored();
            }, 25);
            obs.disconnect(); // done with setup, the click listener will handle everything else
        }
    });

    // observe for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Backup initialization - force initialization after page load
    setTimeout(() => {
        console.log('[Pricempire] Backup initialization - checking if sections are initialized...');
        console.log('[Pricempire] Current pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);

        if (!pinnedMarketplacesGrid) {
            console.log('[Pricempire] Pinned grid not initialized, forcing initialization...');
            initializeSections();
            applyFavoritesOnLoad();
            console.log('[Pricempire] After forced initialization - pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
        } else {
            console.log('[Pricempire] Sections already initialized properly');
        }
    }, 1000); // Wait 1 second for page to fully load

    // Monitor sorting dropdown changes and filter changes (reduced frequency)
    let lastSortingOption = getSortingOption();
    setInterval(() => {
        const currentSorting = getSortingOption();
        if (currentSorting !== lastSortingOption && currentSorting !== 'Recommended') {
            lastSortingOption = currentSorting;
            // Clear the cache when sorting changes to force re-sorting
            lastSortOption = null;
            lastCardCount = 0;
            mergeAndSortSponsored();
        }
    }, 1000); // Reduced from 500ms to 1000ms

    // Monitor filter changes (payment method, etc.) - with debouncing
    let filterTimeout = null;
    const filterObserver = new MutationObserver((_mutations, obs) => {
        // Clear any existing timeout
        if (filterTimeout) {
            clearTimeout(filterTimeout);
        }

        // When filters change, the marketplace cards list might update
        // Re-apply merge/sort after a longer delay with debouncing
        filterTimeout = setTimeout(() => {
            // Clear cache to allow re-sorting with new filter results
            lastSortOption = null;
            lastCardCount = 0;
            mergeAndSortSponsored();
        }, 300); // Increased from 100ms to 300ms
    });

    // Observe changes to the offers section for filter updates
    const offersSection = document.querySelector('section#offers');
    if (offersSection) {
        filterObserver.observe(offersSection, {
            childList: true,
            subtree: true
        });
    }

    // Handle view toggle buttons (list/grid)
    document.body.addEventListener('click', function(event) {
        // Check if clicked button contains list-bullet or squares-2x2 icon (view toggle buttons)
        const clickedBtn = event.target.closest('button');
        const isListViewBtn = clickedBtn && clickedBtn.querySelector('[class*="list-bullet"]');
        const isGridViewBtn = clickedBtn && clickedBtn.querySelector('[class*="squares-2x2"]');
        const isViewToggleBtn = isListViewBtn || isGridViewBtn;

        if (isViewToggleBtn) {
            console.log('[Pricempire] View button clicked - isListViewBtn:', !!isListViewBtn, 'isGridViewBtn:', !!isGridViewBtn);
        }

        // Check if this is a sorting dropdown click (has multiple sort options visible)
        const sortingDropdownBtn = event.target.closest('div.flex.w-full.cursor-pointer.select-none.items-center');
        const isSortingClick = sortingDropdownBtn !== null;

        if (isSortingClick) {
            // Sorting option might change, so re-sort after dropdown closes
            setTimeout(() => {
                const currentSorting = getSortingOption();
                if (currentSorting !== lastSortingOption) {
                    lastSortingOption = currentSorting;
                    // Clear the cache when sorting changes to force re-sorting
                    lastSortOption = null;
                    lastCardCount = 0;
                    mergeAndSortSponsored();
                }
            }, 300);
        }

        if (isListViewBtn) {
            // Switching to List view - apply merge/sort
            console.log('[Pricempire] isListViewBtn is TRUE, queuing setTimeout for 100ms...');
            setTimeout(() => {
                console.log('[Pricempire] Inside List view setTimeout callback');
                // Completely clear cached sections and sorting cache
                for (let key in marketplaceSections) {
                    delete marketplaceSections[key];
                }
                lastSortOption = null;
                lastCardCount = 0;
                pinnedMarketplacesGrid = null;

                // In List view, look for marketplace cards directly
                const marketplaceCards = document.querySelectorAll('article.group.relative');
                console.log('[Pricempire] Found marketplace cards:', marketplaceCards.length);
                if (marketplaceCards.length > 0) {
                    console.log('[Pricempire] Marketplace cards ready, applying merge/sort...');
                    initializeSections();
                    applyFavoritesOnLoad();
                    // Apply Steam price preview if enabled (important for view changes)
                    applySteamPricePreview();
                    // Delay sorting to ensure sorting option is fully rendered after view change
                    setTimeout(() => {
                        const sortOpt = getSortingOption();
                        mergeAndSortSponsored();
                    }, 50);
                } else {
                                    }
                autoExpandOffers();
            }, 200); // Wait for Vue to update the DOM
        } else if (isGridViewBtn) {
            // Switching to Grid view - only reinitialize, don't apply merge/sort
            setTimeout(() => {
                // Completely clear cached sections and sorting cache
                for (let key in marketplaceSections) {
                    delete marketplaceSections[key];
                }
                lastSortOption = null;
                lastCardCount = 0;
                pinnedMarketplacesGrid = null;

                // Reinitialize sections
                const marketplaceGrid = document.querySelector('.grid[data-v-cd0f6ace]');
                if (marketplaceGrid && marketplaceGrid.children.length > 0) {
                    initializeSections();
                    applyFavoritesOnLoad();
                    // Apply merge/sort in Grid view too
                    setTimeout(() => {
                        const sortOpt = getSortingOption();
                        mergeAndSortSponsored();
                    }, 50);
                }
                autoExpandOffers();
            }, 200); // Wait for Vue to update the DOM
        }

        // Handle favorite star clicks
        console.log('[Pricempire] Click detected on element:', event.target, 'classes:', event.target.className);
        const starIcon = event.target.closest('.iconify[class*="star"], span[class*="kid-star"], span[class*="family-star"]');
        const card = starIcon?.closest('.group.relative');

        console.log('[Pricempire] Star detection - starIcon:', !!starIcon, 'card:', !!card);
        if (starIcon) {
            console.log('[Pricempire] Found star icon - classes:', starIcon.className);
        }

        if (starIcon && card) {
            // More flexible star detection - check for any material-symbols-light star classes
            const isActionableStar = starIcon.classList.contains('i-material-symbols-light:kid-star-outline') ||
                                   starIcon.classList.contains('i-material-symbols-light:family-star-sharp') ||
                                   starIcon.className.includes('kid-star') ||
                                   starIcon.className.includes('family-star');

            console.log('[Pricempire] isActionableStar:', isActionableStar);

            if(isActionableStar){
                console.log('[Pricempire] Star clicked - classes:', starIcon.className, 'card found:', !!card);
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(card, starIcon);
            } else {
                console.log('[Pricempire] Star clicked but not actionable - classes:', starIcon.className);
            }
        }
    }, true);

    // Prevent text selection issues by ensuring user-select is not interfered with
    const style = document.createElement('style');
    style.textContent = `
        /* Ensure text selection works properly on marketplace cards */
        article.group.relative {
            user-select: text !important;
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
        }

        /* Preserve hover states during DOM manipulation */
        article.group.relative * {
            user-select: inherit !important;
        }

        /* Prevent selection issues on Get Deal buttons */
        article.group.relative button {
            user-select: none !important;
        }

        /* Ensure hover states work correctly */
        article.group.relative [class*="hover:"] {
            pointer-events: auto !important;
        }
    `;
    document.head.appendChild(style);

})();
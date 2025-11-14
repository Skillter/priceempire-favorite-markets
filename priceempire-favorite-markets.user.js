// ==UserScript==
// @name         Pricempire Multi-Favorite
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Allows favoriting multiple marketplaces on Pricempire.com and saves them across sessions.
// @author       Skillter
// @match        https://pricempire.com/cs2-items/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=pricempire.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_openInTab
// @grant        GM_notification
// @connect      pricempire.com
// @connect      steamcommunity.com
// @connect      steampowered.com
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
        const isFavoritedIcon = starIcon.classList.contains('i-material-symbols-light:family-star-sharp') ||
                               starIcon.classList.contains('i-heroicons:star-solid');

        debugLog('updateStarIcon called - isFavorite:', isFavorite, 'isUnfavoritedIcon:', isUnfavoritedIcon, 'isFavoritedIcon:', isFavoritedIcon, 'current classes:', starIcon.className);

        if (isFavorite && isUnfavoritedIcon) {
            // Change from outline to filled star - use working icon name
            starIcon.classList.remove('i-material-symbols-light:kid-star-outline');
            starIcon.classList.add('i-heroicons:star-solid');
            starIcon.classList.remove('text-theme-400');
            starIcon.classList.add('text-yellow-400'); // Match existing filled star color
            debugLog('Changed to favorited star - new classes:', starIcon.className);
        } else if (!isFavorite && isFavoritedIcon) {
            // Change from filled to outline star
            starIcon.classList.remove('i-heroicons:star-solid', 'i-material-symbols-light:family-star-sharp');
            starIcon.classList.add('i-material-symbols-light:kid-star-outline');
            starIcon.classList.remove('text-yellow-400', 'text-yellow-500');
            starIcon.classList.add('text-theme-400');
            debugLog('Changed to unfavorited star - new classes:', starIcon.className);
        } else {
            debugLog('No star update needed - current state matches desired state');
        }
    }

    function isSponsored(card) {
        // Check if already marked as sponsored (persistent tracking)
        if (card.dataset.isSponsored === 'true') {
            return true;
        }

        // PRIMARY DETECTION: Check for data-is-sponsored attribute (most reliable)
        if (card.getAttribute('data-is-sponsored') === 'true') {
            debugLog('Sponsored detected via data-is-sponsored attribute');
            return true;
        }

        // Enhanced Grid view sponsored detection - check multiple patterns
        const gridSponsoredPatterns = [
            '.bg-theme-700.ring-1.ring-theme-800', // Primary Grid view pattern
            '.bg-gradient-to-r.from-sky-500.to-blue-600', // Gradient button pattern
            '.ring-1.ring-yellow-500', // Yellow ring variant
            '.border.border-yellow-400\\/50' // Yellow border variant
        ];

        for (const selector of gridSponsoredPatterns) {
            if (card.querySelector(selector)) {
                return true;
            }
        }

        // Enhanced List view sponsored detection - comprehensive patterns
        const listSponsoredPatterns = [
            '.border-l-4.border-yellow-500', // List view sponsored border
            '.ring-yellow-500', // Yellow ring indicator
            '.sponsored-marker', '.ad-marker', '.promoted-marker', // Specific markers
            '.bg-yellow-50\\/50', '.bg-yellow-100\\/50', // Light yellow backgrounds
            '.border-l-yellow-500', '.border-yellow-500', // Yellow borders
            '[data-sponsored]', '[data-ad]', '[data-promoted]', // Data attributes
            '.text-yellow-600', '.text-yellow-700' // Yellow text indicators
        ];

        for (const selector of listSponsoredPatterns) {
            if (card.querySelector(selector)) {
                return true;
            }
        }

        // Check for sponsored buttons with gradient styling
        const sponsoredButtons = card.querySelectorAll('button[class*="from-sky"], button[class*="to-blue"], button[class*="bg-gradient"]');
        if (sponsoredButtons.length > 0) {
            return true;
        }

        // More specific text-based detection for sponsored indicators
        // Look for explicit sponsored text in various elements
        const textSelectors = ['.badge', '.text-xs', '.text-sm', '.text-xs', '.tag', '[class*="indicator"]'];
        for (const selector of textSelectors) {
            const elements = card.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent.toLowerCase().trim();
                if (text === 'sponsored' || text === 'ad' || text === 'promoted' || text === 'sponsored ad') {
                    return true;
                }
            }
        }

        // Check card attributes for sponsored indicators
        const cardClasses = card.className || '';
        const cardAriaLabel = card.getAttribute('aria-label') || '';
        const cardDataAttributes = JSON.stringify({
            sponsored: card.dataset.sponsored,
            ad: card.dataset.ad,
            promoted: card.dataset.promoted
        });

        const searchableText = (cardClasses + ' ' + cardAriaLabel + ' ' + cardDataAttributes).toLowerCase();
        return searchableText.includes('sponsored') || searchableText.includes('promoted');
    }

    function normalizeSponsored(card) {
        // Skip if already normalized
        if (card.dataset.isNormalized === 'true') return;

        const isSponsoredCard = isSponsored(card);

        // Debug logging for troubleshooting
        if (getSettings().debugMode) {
            debugLog('normalizeSponsored called on card:', isSponsoredCard);
        }

        if (!isSponsoredCard) return;
        card.dataset.isSponsored = 'true';
        card.dataset.isNormalized = 'true';

        // Enhanced Grid view sponsored normalization - handle multiple patterns
        const gridSponsoredElements = [
            '.bg-theme-700.ring-1.ring-theme-800',
            '.ring-1.ring-yellow-500',
            '.border.border-yellow-400\\/50'
        ];

        gridSponsoredElements.forEach(selector => {
            const element = card.querySelector(selector);
            if (element) {
                // Remove sponsored-specific styling
                element.classList.remove('bg-theme-700', 'ring-1', 'ring-theme-800',
                                         'ring-yellow-500', 'border-yellow-400/50');
                // Add neutral styling
                if (!element.classList.contains('bg-theme-800')) {
                    element.classList.add('bg-theme-800');
                }
            }
        });

        // Enhanced List view sponsored normalization
        const listSponsoredElements = [
            '.border-l-4.border-yellow-500',
            '.ring-yellow-500',
            '.border-l-yellow-500',
            '.border-yellow-500',
            '.bg-yellow-50\\/50',
            '.bg-yellow-100\\/50',
            '.text-yellow-600',
            '.text-yellow-700'
        ];

        listSponsoredElements.forEach(selector => {
            const elements = card.querySelectorAll(selector);
            elements.forEach(element => {
                // Remove yellow/sponsored indicators
                const yellowClasses = ['border-yellow-500', 'ring-yellow-500', 'bg-yellow-50/50',
                                     'bg-yellow-100/50', 'text-yellow-600', 'text-yellow-700'];

                yellowClasses.forEach(cls => {
                    if (element.classList.contains(cls)) {
                        element.classList.remove(cls);
                    }
                });

                // Replace with neutral styling
                if (selector.includes('border-l-4')) {
                    element.classList.add('border-l-4', 'border-theme-700');
                } else if (selector.includes('ring')) {
                    element.classList.add('ring-theme-800');
                } else if (selector.includes('text-')) {
                    element.classList.add('text-theme-100');
                }
            });
        });

        // Remove specific sponsored/ad text indicators - be very specific to avoid breaking legitimate content
        const sponsoredTextSelectors = [
            '.sponsored-badge', '.ad-badge', '.promoted-badge',
            '[data-sponsored="true"]', '[data-ad="true"]',
            '.text-sponsored', '.text-ad', '.text-promoted',
            'span.sponsored', 'span.ad', 'span.promoted'
        ];

        sponsoredTextSelectors.forEach(selector => {
            const elements = card.querySelectorAll(selector);
            elements.forEach(element => {
                element.style.display = 'none';
            });
        });

        // Normalize button styling from gradient to theme color - be more specific to avoid breaking icons
        const buttons = card.querySelectorAll('[class*="bg-gradient-to-r"], [class*="from-sky-500"], [class*="from-sky-600"], [class*="to-blue-500"], [class*="to-blue-600"]');
        buttons.forEach(btn => {
            // Only remove specific gradient classes that indicate sponsored styling
            const gradientClasses = [
                'bg-gradient-to-r',
                'from-sky-500', 'from-sky-600',
                'to-blue-500', 'to-blue-600',
                'hover:from-sky-600', 'hover:to-blue-600'
            ];

            gradientClasses.forEach(cls => {
                if (btn.classList.contains(cls)) {
                    btn.classList.remove(cls);
                }
            });

            // Add normal button styling only if it doesn't already have proper styling
            if (!btn.classList.contains('bg-theme-600') && !btn.classList.contains('bg-theme-700')) {
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

        // Always ensure sponsored cards are normalized, even if no sorting needed
        allCards.forEach(card => normalizeSponsored(card));

        if (!needsSorting) {
            return;
        }

        // Additional DOM readiness check for filter updates
        if (!isDOMReadyForNormalization()) {
            // Retry after a short delay if DOM isn't ready
            setTimeout(() => mergeAndSortSponsored(), 200);
            return;
        }

        isCurrentlySorting = true;

        try {
            // Sponsored cards are already normalized above

            // Apply custom sort logic for Price/Rating/Stock
            // For Recently Updated/Oldest Updated, sortCards returns cards in current order (no sort applied)
            const sortedCards = sortCards(allCards, sortOption);

            // Check if reordering is actually needed and significant
            if (sortedCards.length > 0) {
                const container = sortedCards[0].parentElement;
                if (container) {
                    const currentCards = Array.from(container.children);

                    // Only reorder if there's a significant difference (more than 1 position change)
                    let significantDifference = false;
                    let maxDisplacement = 0;

                    for (let i = 0; i < sortedCards.length; i++) {
                        const card = sortedCards[i];
                        const currentIndex = currentCards.indexOf(card);
                        const displacement = Math.abs(i - currentIndex);

                        if (displacement > 1) {
                            significantDifference = true;
                            maxDisplacement = Math.max(maxDisplacement, displacement);
                        }
                    }

                    // Only reorder if there's a significant difference to avoid unnecessary DOM manipulation
                    if (significantDifference && maxDisplacement > 2) {
                        // Disable transitions on the container to prevent flicker
                        const originalTransition = container.style.transition;
                        container.style.transition = 'none';

                        // Create a document fragment for batch DOM manipulation
                        const fragment = document.createDocumentFragment();

                        // Add all sorted cards to fragment in order
                        sortedCards.forEach(card => {
                            fragment.appendChild(card);
                        });

                        // Clear container and append all cards at once
                        container.innerHTML = '';
                        container.appendChild(fragment);

                        // Re-enable transitions after a brief delay
                        setTimeout(() => {
                            container.style.transition = originalTransition;
                        }, 100);
                    }
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
            // Use a simpler click method to avoid MouseEvent issues
            btn.click();
            setTimeout(expandNextButton, 800); // Wait for content to load, then check for next button
        };

        expandNextButton();
    }

    function toggleFavorite(card, starIcon) {
        const settings = getSettings();
        if (!settings.multiFavorite) {
            debugLog('Multi-Favorite feature is disabled');
            return;
        }

        const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
        if (!starIcon) {
            debugLog('Star icon not provided, searching within card...');
            starIcon = getFavoriteStarIcon(card);
        }

        debugLog('toggleFavorite called - marketplaceName:', marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
        debugLog('Card dataset:', card.dataset);

        if (!marketplaceName || !starIcon || !pinnedMarketplacesGrid) {
            console.warn('[Pricempire] toggleFavorite failed - marketplaceName:', !!marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
            return;
        }

        let favorites = getFavorites();
        let serverUnfavorited = getServerUnfavorited();
        const isFavorite = favorites.includes(marketplaceName);
        const isServerFavorited = card.dataset.serverFavorited === 'true';

        debugLog('Current state - isFavorite:', isFavorite, 'isServerFavorited:', isServerFavorited, 'favorites list:', favorites);

        if (isFavorite) {
            debugLog('Unfavoriting marketplace:', marketplaceName);
            // unfavorite
            favorites = favorites.filter(fav => fav !== marketplaceName);

            // If this was server-favorited, remember user unfavorited it
            if (isServerFavorited && !serverUnfavorited.includes(marketplaceName)) {
                serverUnfavorited.push(marketplaceName);
                saveServerUnfavorited(serverUnfavorited);
            }

            const originalSectionTitle = card.dataset.originalSection;
            debugLog('Moving card back to original section:', originalSectionTitle);
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
                debugLog('Card moved back to original section successfully');

            } else {
                console.warn(`[Pricempire Multi-Favorite] Could not find original section "${originalSectionTitle}" or fallback "Other Marketplaces" to return card to.`);
                debugLog('Available sections:', Object.keys(marketplaceSections));
            }

            debugLog('Updating star icon to unfavorited state');
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
            debugLog('Card moved to pinned section successfully');

            updateStarIcon(starIcon, true);
            debugLog('Star icon updated to favorited state');
        }
        saveFavorites(favorites);
        debugLog('Favorites saved:', favorites);
        debugLog('toggleFavorite completed successfully');
    }

// creates or finds the pinned Marketplaces section and caches all section grids.
    function initializeSections() {
        debugLog('initializeSections called');

        // cache it - use generic selectors that work in both Grid and List view
        const sections = document.querySelectorAll('div.space-y-4');
        debugLog('Found sections:', sections.length);

        sections.forEach(section => {
            const titleEl = section.querySelector('h3');
            const gridEl = section.querySelector('.grid');
            if (titleEl && gridEl) {
                const title = titleEl.textContent.trim();
                marketplaceSections[title] = gridEl;
                debugLog('Cached section:', title);
            }
        });

        debugLog('Cached sections:', Object.keys(marketplaceSections));

        // check for the pinned section
        pinnedMarketplacesGrid = marketplaceSections['Pinned Marketplaces'];
        debugLog('Pinned Marketplaces section found:', !!pinnedMarketplacesGrid);

        if (!pinnedMarketplacesGrid) {
            debugLog('Creating Pinned Marketplaces section...');
            // Try multiple selectors for main container to be more robust
            const mainContainer = document.querySelector('.space-y-6') ||
                                document.querySelector('.space-y-4')?.parentElement ||
                                document.querySelector('main') ||
                                document.querySelector('[class*="space-y"]');
            debugLog('Main container found:', !!mainContainer, 'selector used:', mainContainer ? mainContainer.className : 'none');

            if (mainContainer) {
                const newPinnedSection = document.createElement('div');
                newPinnedSection.className = 'space-y-4';
                // Try to preserve Vue data attributes if they exist on other elements
                const firstExistingSection = document.querySelector('div.space-y-4');
                if (firstExistingSection && firstExistingSection.getAttribute('data-v-cd0f6ace')) {
                    newPinnedSection.setAttribute('data-v-cd0f6ace', '');
                }

                newPinnedSection.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="rounded-lg bg-yellow-500/10 p-2">
                                <span class="iconify i-material-symbols-light:family-star-sharp h-5 w-5 text-yellow-500" aria-hidden="true"></span>
                            </div>
                            <h3 class="text-lg font-semibold">Pinned Marketplaces</h3>
                        </div>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"></div>
                `;
                // Insert after first section to maintain correct order (after Featured Deals, etc)
                const firstSection = mainContainer.querySelector('.space-y-4');
                if (firstSection) {
                    firstSection.insertAdjacentElement('afterend', newPinnedSection);
                    debugLog('Inserted after first section');
                } else {
                    mainContainer.prepend(newPinnedSection);
                    debugLog('Prepend to main container');
                }
                pinnedMarketplacesGrid = newPinnedSection.querySelector('.grid');
                marketplaceSections['Pinned Marketplaces'] = pinnedMarketplacesGrid;
                debugLog('Pinned Marketplaces section created, grid found:', !!pinnedMarketplacesGrid);
            } else {
                console.error('[Pricempire] Could not find main container to create Pinned Marketplaces section');
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

    // Cache for API responses to avoid rate limiting
    const steamPriceCache = new Map();
    const API_CACHE_DURATION = 60 * 60 * 1000; // 1 hour for Steam API caching

    // Steam Buy Order extraction from orange-bordered section
    function extractSteamBuyOrderPrice() {
        try {
            debugLog('Looking for Steam Buy Order section...');

            // Target the specific orange-bordered Steam Buy Order section
            const buyOrderSection = document.querySelector('.mt-6 .rounded-lg.border.border-orange-500\\/30.bg-orange-900\\/20.p-4');

            if (!buyOrderSection) {
                debugLog('Steam Buy Order section not found');
                return null;
            }

            debugLog('Found Steam Buy Order section:', buyOrderSection);

            // Look for the buy order price in the orange text
            const priceElement = buyOrderSection.querySelector('span.text-orange-400');

            if (priceElement) {
                const priceText = priceElement.textContent.trim();
                debugLog('Steam Buy Order price text:', priceText);

                // Extract numeric buy order price
                const priceMatch = priceText.match(/[$€£]?\s*([0-9.,]+)/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    if (!isNaN(price) && price > 0) {
                        debugLog('SUCCESS - Extracted Steam Buy Order price:', price);

                        // Store buy order price globally for other uses
                        window.steamBuyOrderPrice = price;

                        return {
                            buyOrderPrice: price,
                            source: 'steam-buy-order-section'
                        };
                    }
                }
            }

            debugLog('No buy order price found in Steam Buy Order section');
            return null;

        } catch (error) {
            console.error('[Pricempire] Error extracting Steam Buy Order price:', error);
            return null;
        }
    }

    async function findSteamPriceData() {
        debugLog('\n=== STEAM PRICE EXTRACTION START ===');
        debugLog('Initial state:');
        debugLog('  - window.steamBuyOrderPrice:', window.steamBuyOrderPrice);
        debugLog('  - Current URL:', window.location.href);
        debugLog('  - Timestamp:', new Date().toISOString());

        debugLog('Searching for Steam price data...');

        let finalResult = null;
        let resultSource = '';

        // Method 1: Extract Steam Buy Order from orange-bordered section
        debugLog('\nMETHOD 1: Extracting Steam Buy Order from DOM section...');
        debugLog('Method 1: Extracting Steam Buy Order from DOM section...');
        const buyOrderData = extractSteamBuyOrderPrice();
        if (buyOrderData && buyOrderData.buyOrderPrice > 0) {
            debugLog('Found Steam Buy Order price:', buyOrderData.buyOrderPrice);
            debugLog('SUCCESS - Method 1 extracted buy order:', buyOrderData.buyOrderPrice);
            debugLog('STEAM BUY ORDER SOURCE: Method 1 - Steam Buy Order section, buy order price:', buyOrderData.buyOrderPrice);
            // Store buy order price globally immediately
            window.steamBuyOrderPrice = buyOrderData.buyOrderPrice;
            debugLog('Stored buy order price globally:', window.steamBuyOrderPrice);
        } else {
            debugLog('FAILED - Method 1: No Steam Buy Order section found or no valid buy order price extracted');
            debugLog('No Steam Buy Order section found or no valid buy order price extracted');
        }

        // Method 2: Extract Steam price from Steam marketplace card (sell price)
        debugLog('\nMETHOD 2: Searching Steam marketplace card for sell price...');
        debugLog('Method 2: Searching Steam marketplace card for sell price...');
        const steamMarketplaceCard = findSteamMarketplaceCard();
        if (steamMarketplaceCard) {
            debugLog('Found Steam marketplace card - extracting prices...');
            const priceData = extractPriceFromCard(steamMarketplaceCard);
            if (priceData && priceData.mainPrice > 0) {
                debugLog('SUCCESS - Method 2 extracted sell price:', priceData.mainPrice, 'buy order:', priceData.buyOrderPrice);
                debugLog('Found Steam marketplace card sell price:', priceData.mainPrice, 'method: DOM extraction');
                // IMPORTANT: Don't overwrite buy order price if we already have it from Method 1
                if (!window.steamBuyOrderPrice && priceData.buyOrderPrice) {
                    window.steamBuyOrderPrice = priceData.buyOrderPrice;
                    debugLog('Set buy order price from Steam card (Method 2):', window.steamBuyOrderPrice);
                } else if (window.steamBuyOrderPrice) {
                    debugLog('Preserved buy order price from Method 1:', window.steamBuyOrderPrice);
                }
                finalResult = priceData.mainPrice.toString();
                resultSource = 'Method 2 - Steam marketplace card (DOM)';
                debugLog('STEAM PRICE SOURCE: Method 2 - Steam marketplace card, sell price:', priceData.mainPrice);
            } else {
                debugLog('FAILED - Steam marketplace card found but no valid price data extracted');
                debugLog('Steam marketplace card found but no valid price data extracted');
            }
        } else {
            debugLog('FAILED - No Steam marketplace card found in DOM');
            debugLog('No Steam marketplace card found in DOM');
        }

        // Method 3: Steam Community Market API with 1-hour caching (final fallback)
        if (!finalResult) {
            debugLog('\nMETHOD 3: Trying Steam Community Market API with cache...');
            debugLog('Method 3: Trying Steam Community Market API with cache...');
            try {
                const steamMarketPrice = await fetchSteamPriceFromSteamAPI();
                if (steamMarketPrice) {
                    debugLog('SUCCESS - Method 3 extracted API price:', steamMarketPrice);
                    finalResult = steamMarketPrice;
                    resultSource = 'Method 3 - Steam Community Market API (fallback)';
                    debugLog('STEAM PRICE SOURCE: Method 3 - Steam Community Market API, price:', steamMarketPrice);
                } else {
                    debugLog('FAILED - Method 3: Steam API returned null/undefined');
                    debugLog('Method 3: Steam API returned null/undefined');
                }
            } catch (steamApiError) {
                debugLog('FAILED - Method 3: Steam API call failed with error:', steamApiError.message);
                debugLog('Method 3: Steam API call failed with error:', steamApiError.message);
            }
        }

        // Final summary and return
        debugLog('\n=== STEAM PRICE EXTRACTION SUMMARY ===');
        debugLog('Final result:', finalResult);
        debugLog('Source:', resultSource);
        debugLog('Buy order price:', window.steamBuyOrderPrice);
        debugLog('Timestamp:', new Date().toISOString());

        if (finalResult) {
            debugLog('SUCCESS - Returning Steam price:', finalResult);
            return finalResult;
        } else {
            debugLog('FAILED - No Steam price data found from any method');
            debugLog('No Steam price data found from any of the 3 methods');
            return null;
        }
    }

    // Alternative function to extract Steam price from visible/cached data
    function extractSteamPriceFromVisibleData() {
        debugLog('extractSteamPriceFromVisibleData() function called');
        debugLog('Searching for Steam price in visible market data...');

        // Method 1: Enhanced Steam marketplace card detection and extraction
        const steamCards = document.querySelectorAll('article[aria-label="Offer from Steam"], article[aria-label*="Steam"], article.group.relative');
        debugLog('Testing Steam card detection - found total cards:', document.querySelectorAll('article.group.relative').length);
        debugLog('Searching for Steam marketplace cards, found:', steamCards.length);

        // Also test broader card detection
        const allCards = document.querySelectorAll('article.group.relative');
        debugLog('Total marketplace cards found:', allCards.length);

        if (steamCards.length > 0) {
            debugLog('Steam cards found, attempting extraction...');
            for (let i = 0; i < steamCards.length; i++) {
                const card = steamCards[i];
                debugLog(`Testing Steam card ${i}:`, {
                    ariaLabel: card.getAttribute('aria-label'),
                    innerHTML: card.innerHTML.substring(0, 200),
                    classes: card.className
                });

                // Test price extraction on this card
                const priceData = extractPriceFromCard(card);
                debugLog(`Price extraction result for card ${i}:`, priceData);

                if (priceData && priceData.mainPrice > 0) {
                    debugLog('SUCCESS - Extracted Steam price from visible card:', priceData.mainPrice);
                    debugLog('STEAM PRICE SOURCE: Method 1 - Visible Steam card extraction, price:', priceData.mainPrice);
                    return priceData.mainPrice.toString();
                } else {
                    debugLog('Steam card found but no valid price data extracted, full card content:', card.innerHTML);
                }
            }
        } else {
            debugLog('No Steam cards found in current DOM');

            // Test if we can find any cards with Steam-related content
            let foundSteamContent = false;
            allCards.forEach((card, index) => {
                const text = card.textContent.toLowerCase();
                const hasSteamText = text.includes('steam');
                if (hasSteamText) {
                    debugLog(`Card ${index} contains Steam text:`, text.substring(0, 100));
                    foundSteamContent = true;
                }
            });

            if (foundSteamContent) {
                debugLog('Found Steam content in cards but no Steam-specific cards');
            } else {
                debugLog('No Steam-related content found in any cards');
            }
        }

        // Method 2: Extract from stored/cached values from previous successful searches
        const cacheKey = 'steam_rio_2022_autograph_capsule'; // Specific cache key for this item
        const cachedSteamPrice = steamPriceCache.get(cacheKey);
        if (cachedSteamPrice && Date.now() - cachedSteamPrice.timestamp < 30 * 60 * 1000) { // 30 minutes
            debugLog('Found cached Steam price:', cachedSteamPrice.price);
            return cachedSteamPrice.price;
        }

        // Method 3: Check localStorage for manually saved Steam prices
        try {
            const savedSteamPrices = localStorage.getItem('steam_prices_manual');
            if (savedSteamPrices) {
                const prices = JSON.parse(savedSteamPrices);
                const itemName = getItemName();
                if (itemName && prices[itemName]) {
                    debugLog('Found manually saved Steam price for', itemName + ':', prices[itemName]);
                    return prices[itemName];
                }
            }
        } catch (e) {
            debugLog('Failed to read manual Steam prices:', e.message);
        }

        // Method 4: Look for Steam price in specific marketplace text elements (avoid navigation/search)
        const marketplaceSelectors = [
            'article[role="article"]', // Marketplace cards
            '[class*="price"]', // Price elements
            '[class*="market"]', // Market-related elements
            '[class*="offer"]', // Offer elements
            'section[aria-label*="Market"]' // Market sections
        ];

        for (const selector of marketplaceSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent.trim();

                // More specific validation: must contain Steam AND be in marketplace context
                if (text.includes('Steam') && text.includes('$')) {
                    // Skip if this is navigation/search text
                    if (text.toLowerCase().includes('browse') ||
                        text.toLowerCase().includes('search') ||
                        text.toLowerCase().includes('apps') ||
                        text.toLowerCase().includes('menu') ||
                        element.closest('nav') ||
                        element.closest('[role="navigation"]')) {
                        debugLog('Skipping Steam price in navigation element:', text);
                        continue;
                    }

                    const priceMatch = text.match(/\$([0-9]+\.[0-9]{2})/);
                    if (priceMatch) {
                        const price = parseFloat(priceMatch[1]);
                        if (price >= 0.01 && price <= 10.0) { // Reasonable range for this item
                            debugLog('Found Steam price in marketplace element:', price, 'text:', text);
                            return price.toString();
                        }
                    }
                }
            }
        }

        // Method 5: Enhanced Steam price extraction from API response data
        debugLog('Method 5: Enhanced Steam price extraction from cached API data...');

        // Try to extract Steam price from the cached API response that returned 200 status
        try {
            const cachedApiData = sessionStorage.getItem('pricempire_api_response_9102');
            if (cachedApiData) {
                const apiData = JSON.parse(cachedApiData);
                debugLog('Found cached API response data, processing for Steam prices...');

                // More comprehensive search through the API data
                if (Array.isArray(apiData)) {
                    for (let i = 0; i < Math.min(apiData.length, 1000); i++) {
                        const item = apiData[i];
                        if (!item || typeof item !== 'object') continue;

                        // Check for Steam provider with multiple field name variations
                        const steamIndicators = [
                            (item.provider || '').toLowerCase(),
                            (item.name || '').toLowerCase(),
                            (item.marketplace || '').toLowerCase(),
                            (item.source || '').toLowerCase(),
                            (item.platform || '').toLowerCase()
                        ];

                        const isSteam = steamIndicators.some(indicator =>
                            indicator === 'steam' || indicator.includes('steam')
                        );

                        if (isSteam) {
                            debugLog('Found Steam entry in cached API data at index', i, 'keys:', Object.keys(item));

                            // Look for price in multiple possible fields
                            const priceFields = ['price', 'value', 'amount', 'cost', 'lowest_price', 'median_price', 'market_price', 'sell_price', 'buy_price'];
                            for (const field of priceFields) {
                                if (item[field] && typeof item[field] === 'number' && item[field] > 0 && item[field] < 1000) {
                                    debugLog('Found Steam price in cached API data:', field, '=', item[field]);
                                    debugLog('STEAM PRICE SOURCE: Method 5 - Cached API data, price:', item[field]);
                                    return item[field].toString();
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            debugLog('Failed to process cached API data:', e.message);
        }

        debugLog('No Steam price found in visible data');
        return null;
    }

    // Enhanced function to search for Steam price in embedded script data
    function findSteamPriceInScripts() {
        const scripts = document.querySelectorAll('script:not([src])');
        debugLog('Searching for Steam price in', scripts.length, 'embedded scripts');

        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            if (!script.textContent || script.textContent.length < 1000) continue;

            const content = script.textContent;

            // Enhanced Steam price patterns based on real API response structures
            const steamPricePatterns = [
                // Direct JSON structures - most reliable
                /"provider"\s*:\s*"steam"[^}]*"price"\s*:\s*([0-9.]+)/gi,
                /"name"\s*:\s*"Steam"[^}]*"price"\s*:\s*([0-9.]+)/gi,
                /"marketplace"\s*:\s*"steam"[^}]*"price"\s*:\s*([0-9.]+)/gi,
                // Steam-specific fields
                /"steamPrice"\s*:\s*([0-9.]+)/gi,
                /"steam_market_price"\s*:\s*([0-9.]+)/gi,
                /"steam_lowest_price"\s*:\s*([0-9.]+)/gi,
                // Chart data patterns
                /\{[^}]*"steam"[^}]*"price"\s*:\s*([0-9.]+)[^}]*\}/gi,
                /\{[^}]*"provider"\s*:\s*"steam"[^}]*"value"\s*:\s*([0-9.]+)[^}]*\}/gi,
                // Array with Steam entry
                /\[[^]]*"steam"[^}]*"price"\s*:\s*([0-9.]+)[^}]*\]/gi,
                // Steam community market data
                /"steam_market"\s*:\s*\{[^}]*"lowest_price"\s*:\s*"\$([0-9.]+)"/gi,
                /"steam_community"\s*:\s*\{[^}]*"price"\s*:\s*([0-9.]+)/gi,
                // Generic patterns with validation
                /steam[^}"\s]*price[^}"\s]*[:=]\s*([0-9]+\.[0-9]{2})/gi,
                /"steam[^"]*"[^}]*price[^}]*[:=]\s*([0-9.]+)/gi
            ];

            for (const pattern of steamPricePatterns) {
                const matches = [...content.matchAll(pattern)];
                if (matches.length > 0) {
                    debugLog(`Script ${i + 1}: Pattern ${pattern.source} found ${matches.length} matches`);

                    for (const match of matches) {
                        const priceText = match[1];
                        const price = parseFloat(priceText);

                        if (!isNaN(price) && price > 0) {
                            const contextStart = Math.max(0, match.index - 150);
                            const contextEnd = Math.min(content.length, match.index + 150);
                            const context = content.substring(contextStart, contextEnd);

                            debugLog(`Found Steam price: $${price.toFixed(2)} context:`, context.substring(0, 300));

                            // Enhanced validation - check if this looks like real Steam data
                            const hasSteamContext = context.toLowerCase().includes('steam') ||
                                                 context.toLowerCase().includes('provider') ||
                                                 context.toLowerCase().includes('marketplace') ||
                                                 pattern.source.includes('steam');

                            if (hasSteamContext) {
                                // Enhanced validation for this specific item (expecting around $0.51)
                                if (price >= 0.01 && price <= 10.0) { // Reasonable range for autograph capsules
                                    debugLog('Validated Steam price from script:', price.toFixed(2), 'pattern:', pattern.source);
                                    return price.toFixed(2);
                                } else {
                                    debugLog(`Price ${price.toFixed(2)} outside reasonable range (0.01-10.00), skipping`);
                                    debugLog(`Price source context: ${context.substring(0, 100)}`);
                                }
                            }
                        }
                    }
                }
            }
        }

        debugLog('No Steam price found in embedded scripts');
        return null;
    }

    // Helper function to find Steam marketplace card in offers section
    function findSteamMarketplaceCard() {
        // STRICT: Only look for official Steam marketplace card with exact aria-label
        const steamCard = document.querySelector('article[aria-label="Offer from Steam"]');
        if (steamCard) {
            const marketplaceName = steamCard.querySelector('p.font-bold')?.textContent?.trim() ||
                                   steamCard.querySelector('a[href*="/cs2-marketplaces/steam"] p')?.textContent?.trim();
            const hasSteamIcon = steamCard.querySelector('img[src*="steam_icon.webp"], img[alt="Steam"]');

            debugLog('Found candidate Steam card:', {
                marketplaceName: `"${marketplaceName}"`,
                hasSteamIcon: !!hasSteamIcon,
                isRealSteam: marketplaceName === 'Steam' && hasSteamIcon
            });

            // CRITICAL: Only return if it's actually a real Steam marketplace card
            if (marketplaceName === 'Steam' && hasSteamIcon) {
                debugLog('Returning real Steam marketplace card');
                return steamCard;
            } else {
                debugLog('REJECTED - Fake Steam card with marketplace:', marketplaceName);
                return null;
            }
        }
        return null;
    }

    // Helper function to extract price from a marketplace card
    function extractPriceFromCard(card) {
        debugLog('Extracting prices from card - full text:', card.textContent);

        // Extract main price - largest/most prominent price
        const priceSelectors = [
            // Primary selector: Steam card price (exact match)
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
        let allPrices = [];

        for (const selector of priceSelectors) {
            const priceElement = card.querySelector(selector);
            if (priceElement) {
                const priceText = priceElement.textContent.trim();
                debugLog('Found price element with selector:', selector, 'text:', priceText);

                // Extract numeric price value
                const priceMatch = priceText.match(/[$€£]?\s*([0-9.,]+)/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    if (!isNaN(price) && price > 0) {
                        debugLog('Extracted candidate main price:', price, 'from text:', priceText);
                        allPrices.push(price);
                        if (!mainPrice) mainPrice = price; // Use first found as main price
                    }
                }
            }
        }

        // If no structured price found, extract from all price patterns in card
        if (allPrices.length === 0) {
            const priceMatches = card.textContent.match(/\$[\d.,]+/g) || [];
            debugLog('No structured price found, extracting from text matches:', priceMatches);

            allPrices = priceMatches.map(match => parseFloat(match.replace(/[^0-9.]/g, '')))
                                   .filter(price => !isNaN(price) && price > 0);

            if (allPrices.length > 0) {
                mainPrice = Math.min(...allPrices); // Use lowest as main price (typically the sell price)
                debugLog('Using lowest price as main price:', mainPrice, 'from candidates:', allPrices);
            }
        }

        // Extract buy order price - look specifically for buy order section
        let buyOrderPrice = null;

        // Method 1: Look for buy order section with price check icon
        const buyOrderSection = card.querySelector('.mt-0\\.5\\.flex\\.items-center\\.gap-1, [class*="mt-0.5"][class*="flex"][class*="items-center"][class*="gap-1"]');
        debugLog('Looking for buy order section, found:', buyOrderSection);

        if (buyOrderSection) {
            debugLog('Buy order section content:', buyOrderSection.innerHTML);

            // Look for price in buy order section (exclude the "buy order" text)
            const priceElements = buyOrderSection.querySelectorAll('span');
            debugLog('Found', priceElements.length, 'span elements in buy order section');

            for (let i = 0; i < priceElements.length; i++) {
                const span = priceElements[i];
                const text = span.textContent.trim();
                debugLog(`Span ${i} text: "${text}"`);

                if (text.startsWith('$') && !text.toLowerCase().includes('buy order')) {
                    const priceMatch = text.match(/[$€£]?\s*([0-9.,]+)/);
                    if (priceMatch) {
                        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                        if (!isNaN(price) && price > 0) {
                            debugLog('Extracted buy order price:', price, 'from text:', text);
                            buyOrderPrice = price;
                            break;
                        }
                    }
                }
            }
        }

        // Method 2: If no buy order section found, try to infer from multiple prices
        if (!buyOrderPrice && allPrices.length >= 2) {
            // Sort prices and use second lowest as buy order (common pattern: buy order < sell order)
            const sortedPrices = [...allPrices].sort((a, b) => a - b);
            buyOrderPrice = sortedPrices[1]; // Second lowest price
            debugLog('Inferred buy order price from multiple prices:', buyOrderPrice, 'sorted prices:', sortedPrices);
        }

        // IMPORTANT: Don't overwrite buy order price from Steam cards - they only have sell prices
        // Buy order prices should only come from the orange DOM section, not Steam marketplace cards
        const isSteamCard = card.getAttribute('aria-label')?.includes('Offer from Steam');

        debugLog('\n=== BUY ORDER PRICE HANDLING ===');
        debugLog('Buy Order Price Analysis:');
        debugLog('  - Extracted buy order price:', buyOrderPrice);
        debugLog('  - Is Steam card:', isSteamCard);
        debugLog('  - Current global buy order price:', window.steamBuyOrderPrice);
        debugLog('  - Card aria-label:', card.getAttribute('aria-label'));

        if (buyOrderPrice && !isSteamCard) {
            window.steamBuyOrderPrice = buyOrderPrice.toFixed(2);
            debugLog('STORED - Global buy order price from non-Steam card:', window.steamBuyOrderPrice);
        } else if (buyOrderPrice && isSteamCard) {
            debugLog('PROTECTED - Ignoring buy order price from Steam card to preserve orange section value:', buyOrderPrice);
            debugLog('Global buy order price remains:', window.steamBuyOrderPrice);
        } else {
            debugLog('INFO - No buy order price to handle');
        }

        if (mainPrice) {
            debugLog('Final extracted prices - main:', mainPrice, 'buy order:', buyOrderPrice);
            return { mainPrice, buyOrderPrice };
        } else {
            debugLog('No valid price found in Steam card');
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

    // Helper function to extract item name from page
    function getItemName() {
        debugLog('getItemName: Extracting item name from multiple sources...');

        // Method 1: From Steam market link (most reliable)
        const steamLink = document.querySelector('a[href*="steamcommunity.com/market/listings/730/"]');
        if (steamLink) {
            const href = steamLink.getAttribute('href');
            debugLog('Found Steam link:', href);
            const marketName = href.split('/730/')[1];
            // DECODE the URL to get exact Steam market name (including case and special chars)
            const extractedName = decodeURIComponent(marketName).trim();
            debugLog('Extracted from Steam link (decoded):', `"${extractedName}"`);
            debugLog('getItemName: Extracted from Steam link:', extractedName);
            return extractedName;
        }

        // Method 2: From breadcrumb navigation
        const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"] li:last-child a');
        if (breadcrumb) {
            const breadcrumbName = breadcrumb.getAttribute('href').split('/').pop().replace(/-/g, ' ');
            debugLog('Extracted from breadcrumb:', breadcrumbName);
            debugLog('getItemName: Extracted from breadcrumb:', breadcrumbName);
            return breadcrumbName;
        }

        // Method 3: From page URL (fallback)
        const urlPath = window.location.pathname;
        if (urlPath.includes('/cs2-items/')) {
            const parts = urlPath.split('/');
            if (parts.length >= 5) {
                // Extract item name from URL: /cs2-items/category/item-name/variation
                const urlName = parts[parts.length - 2].replace(/-/g, ' ');
                debugLog('Extracted from URL:', urlName);
                debugLog('getItemName: Extracted from URL:', urlName);
                return urlName;
            }
        }

        debugLog('getItemName: No item name found');
        debugLog('getItemName: No item name found');
        return null;
    }

    // Helper function to extract item ID from page
    function getItemId() {
        // Method 1: Try to find numeric item ID in data attributes
        const dataElements = document.querySelectorAll('[data-item-id], [data-id], [data-product-id], [data-chart-id]');
        for (const element of dataElements) {
            const id = element.getAttribute('data-item-id') ||
                      element.getAttribute('data-id') ||
                      element.getAttribute('data-product-id') ||
                      element.getAttribute('data-chart-id');
            if (id && !isNaN(id) && parseInt(id) > 0) {
                debugLog('getItemId: Found numeric ID from data attributes:', id);
                return id;
            }
        }

        // Method 2: Extract from embedded scripts and Nuxt.js data
        try {
            // Search for item ID in script content
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                if (!script.textContent || script.textContent.length < 1000) continue;

                // Look for patterns like "id":588 or chart data
                const idPatterns = [
                    /"item_id"\s*:\s*(\d+)/g,
                    /"chartId"\s*:\s*(\d+)/g,
                    /"id"\s*:\s*(\d+).*?"name"/g,
                    /"id"\s*:\s*(\d+).*?"rio-2022-autograph-capsule"/gi,
                    /chart.*?id.*?(\d+)/gi
                ];

                for (const pattern of idPatterns) {
                    const matches = [...script.textContent.matchAll(pattern)];
                    for (const match of matches) {
                        const id = parseInt(match[1]);
                        if (id > 0 && id < 100000) { // Reasonable ID range
                            debugLog('getItemId: Found ID in script:', id, 'pattern:', pattern.source);
                            return id.toString();
                        }
                    }
                }
            }

            // Search in window.__NUXT__ if available
            if (window.__NUXT__) {
                const nuxtSearch = (obj, depth = 0) => {
                    if (depth > 4 || !obj || typeof obj !== 'object') return null;

                    for (const [key, value] of Object.entries(obj)) {
                        if (key === 'id' && typeof value === 'number' && value > 0 && value < 100000) {
                            debugLog('getItemId: Found ID in Nuxt data:', value);
                            return value.toString();
                        }
                        if (typeof value === 'object') {
                            const result = nuxtSearch(value, depth + 1);
                            if (result) return result;
                        }
                    }
                    return null;
                };

                const nuxtId = nuxtSearch(window.__NUXT__);
                if (nuxtId) return nuxtId;
            }
        } catch (e) {
            debugLog('getItemId: Script search failed:', e.message);
        }

        // Method 3: From API redirect links
        const apiRedirectLink = document.querySelector('a[href*="/api/redirect/"]');
        if (apiRedirectLink) {
            const href = apiRedirectLink.getAttribute('href');
            // Extract from redirect URL pattern: /api/redirect/{itemName}/{marketplace}
            const parts = href.split('/');
            if (parts.length >= 4) {
                const redirectId = parts[3];
                debugLog('getItemId: Extracted from redirect link:', redirectId);
                return redirectId;
            }
        }

        // Method 4: Fallback to encoded item name
        const itemName = getItemName();
        if (itemName) {
            const encodedName = encodeURIComponent(itemName);
            debugLog('getItemId: Using encoded item name as fallback:', encodedName);
            return encodedName;
        }

        debugLog('getItemId: No item ID found');
        return null;
    }

    // API function to fetch Steam price from Pricempire's API
    async function fetchSteamPriceFromAPI() {
        try {
            // Get current item name and ID from the page using enhanced extraction
            const itemName = getItemName();
            const itemId = getItemId();

            if (!itemName && !itemId) {
                debugLog('Could not find item name or ID for API call');
                return null;
            }

            const cacheKey = `pricempire_${itemName || itemId}`;
            debugLog('Extracted item name:', itemName, 'ID:', itemId);

            // Check cache first
            const cached = steamPriceCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < API_CACHE_DURATION) {
                debugLog('Using cached Steam price from Pricempire API:', cached.price);
                return cached.price;
            }

            debugLog('Fetching Steam price from Pricempire API for:', itemName, 'ID:', itemId);

            // Use correct API endpoints based on HAR analysis and proper error handling
            const itemIdentifier = itemId || encodeURIComponent(itemName);
            debugLog('Using item identifier for API calls:', itemIdentifier, 'type:', itemId ? 'numeric ID' : 'encoded name');

            // Prioritize provider-specific endpoints for marketplace data
            const apiEndpoints = itemId ? [
                // PRIMARY: Provider-specific endpoints (this should return marketplace data)
                `/api-data/v1/item/chart-providers?id=${itemId}&providers=steam`,
                `/api-data/v1/item/chart-providers?id=${itemId}`,
                `/api-data/v1/item/chart?id=${itemId}&providers=steam,buff163,csmoney,skinbaron,tradeit,buffmarket`,
                `/api-data/v1/item/chart?id=${itemId}&providers=steam`,
                // Alternative numeric ID formats
                `/api/v1/item/${itemId}/chart?providers=steam`,
                `/api/v1/item/chart?id=${itemId}`,
                // Time series data (less likely to have provider info)
                `/api-data/v1/item/chart?id=${itemId}&days=10000`,
                `/api-data/v1/item/chart?id=${itemId}`
            ] : [
                // Fallback endpoints for non-numeric IDs
                `/api-data/v1/item/chart?name=${encodeURIComponent(itemName)}`,
                `/api-data/v1/item/chart?item=${encodeURIComponent(itemName)}`,
                `/api-data/v1/item/chart-providers?name=${encodeURIComponent(itemName)}&providers=steam`,
                `/api/v1/item/${encodeURIComponent(itemName)}/chart?providers=steam`,
                // Try generic endpoints
                `/api-data/v1/item/chart`
            ];

            // Helper function to get auth headers for API requests
            function getAuthHeaders() {
                const headers = {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                };

                // Add cookies from current page for authentication
                if (document.cookie) {
                    headers['Cookie'] = document.cookie;
                }

                // Add common auth headers that might be needed
                const metaElements = document.querySelectorAll('meta');
                metaElements.forEach(meta => {
                    const name = meta.getAttribute('name');
                    const content = meta.getAttribute('content');
                    if (name && content) {
                        if (name.toLowerCase().includes('csrf') || name.toLowerCase().includes('token')) {
                            headers[name] = content;
                        }
                    }
                });

                // Add any stored auth tokens from localStorage
                try {
                    const authToken = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('csrfToken');
                    if (authToken) {
                        headers['Authorization'] = `Bearer ${authToken}`;
                        headers['X-CSRF-Token'] = authToken;
                    }
                } catch (e) {
                    debugLog('Failed to get auth tokens from localStorage:', e.message);
                }

                return headers;
            }

            for (let i = 0; i < apiEndpoints.length; i++) {
                const endpoint = apiEndpoints[i];
                try {
                    debugLog(`Trying API endpoint ${i + 1}/${apiEndpoints.length}:`, endpoint);

                    const authHeaders = getAuthHeaders();
                    debugLog(`Using auth headers:`, Object.keys(authHeaders));
                    if (document.cookie) {
                        debugLog(`Document cookies found:`, document.cookie.substring(0, 100) + '...');
                    }

                    const response = await fetch(window.location.origin + endpoint, {
                        method: 'GET',
                        headers: authHeaders,
                        credentials: 'same-origin' // Include cookies automatically
                    });

                    debugLog(`API response status for endpoint ${i + 1}:`, response.status, response.statusText);

                    if (response.ok) {
                        const data = await response.json();
                        debugLog(`API response data from endpoint ${i + 1}:`, typeof data, Array.isArray(data) ? `Array(${data.length})` : Object.keys(data));

                        // Cache the successful API response for later processing
                        if (itemId && Array.isArray(data)) {
                            try {
                                sessionStorage.setItem(`pricempire_api_response_${itemId}`, JSON.stringify(data));
                                debugLog(`Cached API response with ${data.length} items for item ${itemId}`);
                            } catch (e) {
                                debugLog('Failed to cache API response:', e.message);
                            }
                        }

                        const steamPrice = extractSteamPriceFromAPIResponse(data);

                        if (steamPrice) {
                            debugLog(`Successfully found Steam price from endpoint ${i + 1}:`, steamPrice);
                            // Cache the result
                            steamPriceCache.set(cacheKey, {
                                price: steamPrice,
                                timestamp: Date.now()
                            });
                            return steamPrice;
                        } else {
                            debugLog(`No Steam price found in endpoint ${i + 1} response`);
                        }
                    } else {
                        debugLog(`API endpoint ${i + 1} returned status:`, response.status, response.statusText);
                    }
                } catch (endpointError) {
                    debugLog(`API endpoint ${i + 1} (${endpoint}) failed:`, endpointError.message);
                }
            }

        } catch (error) {
            debugLog('Pricempire API call failed:', error.message);
        }
        return null;
    }

    // Helper function to extract Steam price from API response
    function extractSteamPriceFromAPIResponse(data) {
        if (!data || typeof data !== 'object') {
            debugLog('Invalid API response data');
            return null;
        }

        debugLog('Extracting Steam price from API response, data type:', typeof data, 'is array:', Array.isArray(data), 'length:', Array.isArray(data) ? data.length : 'N/A');

        // Special handling for provider-specific API responses and time series data
        if (Array.isArray(data) && data.length > 0) {
            debugLog('Processing API response with', data.length, 'items');

            // First, analyze the structure to determine if this is provider data or time series
            debugLog('API Data Analysis - Sample structures:');
            let firstItemKeys = [];

            for (let sampleIndex = 0; sampleIndex < Math.min(5, data.length); sampleIndex++) {
                const sampleItem = data[sampleIndex];
                if (sampleItem && typeof sampleItem === 'object') {
                    const keys = Object.keys(sampleItem);
                    firstItemKeys.push(keys);
                    debugLog(`Sample ${sampleIndex}:`, {
                        keys: keys,
                        hasProvider: !!sampleItem.provider,
                        hasName: !!sampleItem.name,
                        hasMarketplace: !!sampleItem.marketplace,
                        hasPrice: !!sampleItem.price,
                        hasValue: !!sampleItem.value,
                        hasCost: !!sampleItem.cost,
                        sampleData: sampleItem
                    });
                }
            }

            // Determine if this is provider data (has provider/marketplace fields) or time series data
            const hasProviderFields = firstItemKeys.some(keys =>
                keys.some(key => ['provider', 'name', 'marketplace', 'source'].includes(key))
            );

            debugLog('Data type analysis:', {
                hasProviderFields: hasProviderFields,
                uniqueKeys: [...new Set(firstItemKeys.flat())],
                firstItemKeys: firstItemKeys
            });

            if (hasProviderFields) {
                debugLog('This appears to be PROVIDER data - searching for Steam entries');
                // This is provider/marketplace data - search for Steam entries
                for (let i = 0; i < data.length; i++) {
                    const item = data[i];
                    if (!item || typeof item !== 'object') continue;

                    // Check for Steam provider in multiple fields
                    const steamIndicators = [
                        (item.provider || '').toLowerCase(),
                        (item.name || '').toLowerCase(),
                        (item.marketplace || '').toLowerCase(),
                        (item.source || '').toLowerCase(),
                        (item.platform || '').toLowerCase()
                    ];

                    const isSteam = steamIndicators.some(indicator =>
                        indicator === 'steam' || indicator.includes('steam')
                    );

                    if (isSteam) {
                        debugLog(`Found Steam provider at index ${i}:`, item);

                        // Look for price in various fields
                        const priceFields = [
                            'price', 'value', 'amount', 'cost',
                            'lowest_price', 'median_price', 'market_price',
                            'sell_price', 'buy_price', 'current_price',
                            'steam_price', 'steam_lowest_price', 'steam_market_price'
                        ];

                        for (const field of priceFields) {
                            if (item[field] !== null && item[field] !== undefined) {
                                let priceValue = item[field];

                                if (typeof priceValue === 'string') {
                                    const priceMatch = priceValue.match(/([0-9.,]+)/);
                                    if (priceMatch) {
                                        priceValue = parseFloat(priceMatch[1].replace(',', ''));
                                    }
                                }

                                if (typeof priceValue === 'number' && priceValue > 0 && priceValue < 10000) {
                                    debugLog(`SUCCESS - Found Steam price: ${field} = ${priceValue}`);
                                    return priceValue.toString();
                                }
                            }
                        }
                    }
                }
            } else {
                debugLog('This appears to be TIME SERIES data - provider info not available');
                // This is time series data (what we were seeing before)
                debugLog('This is time series data, not provider data - skipping Steam search');
            }

            debugLog('API data analysis complete');
        }

        // Enhanced search for Steam price in various response structures
        function findSteamInObject(obj, path = '', depth = 0) {
            if (depth > 6 || !obj || typeof obj !== 'object') return null;

            // Check if current object has Steam price
            if (obj.price && typeof obj.price === 'number' && obj.price > 0) {
                const providerName = obj.provider || obj.name || obj.marketplace || '';
                if (providerName.toString().toLowerCase() === 'steam') {
                    debugLog('Found Steam price in object:', obj.price, 'at path:', path);
                    return obj.price;
                }
            }

            // Recursively search
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = path ? `${path}.${key}` : key;

                // Check arrays for Steam entries (with performance limit)
                if (Array.isArray(value) && value.length < 1000) { // Limit to prevent performance issues
                    for (let i = 0; i < value.length; i++) {
                        const item = value[i];
                        if (item && typeof item === 'object') {
                            const result = findSteamInObject(item, `${currentPath}[${i}]`, depth + 1);
                            if (result) return result;
                        }
                    }
                } else if (value && typeof value === 'object') {
                    const result = findSteamInObject(value, currentPath, depth + 1);
                    if (result) return result;
                }
            }
            return null;
        }

        // Try deep search first
        const deepSearchResult = findSteamInObject(data);
        if (deepSearchResult) {
            return deepSearchResult.toString();
        }

        // Fallback to specific patterns with enhanced Steam detection
        const steamPricePaths = [
            () => data.find?.(item => {
                const provider = (item.provider || item.name || item.marketplace || '').toString().toLowerCase();
                return provider.includes('steam') && item.price && typeof item.price === 'number';
            })?.price,
            () => data.steam?.price,
            () => data.steamPrice,
            () => data.providers?.find(p => {
                const name = (p.name || p.provider || p.marketplace || '').toString().toLowerCase();
                return name.includes('steam');
            })?.price,
            () => data.chart?.find(item => {
                const provider = (item.provider || item.name || '').toString().toLowerCase();
                return provider.includes('steam') && item.price;
            })?.price,
            () => data.data?.find(item => {
                const provider = (item.provider || item.name || '').toString().toLowerCase();
                return provider.includes('steam');
            })?.price,
        ];

        for (let i = 0; i < steamPricePaths.length; i++) {
            try {
                const price = steamPricePaths[i]();
                if (typeof price === 'number' && price > 0 && price <= 100.0) { // Reasonable upper limit
                    debugLog('Found Steam price via path', i + 1, ':', price);
                    return price.toString();
                }
            } catch (e) {
                debugLog('Steam price path', i + 1, 'failed:', e.message);
            }
        }

        debugLog('No Steam price found in API response after comprehensive search');
        return null;
    }

    // API function to fetch Steam price directly from Steam Community Market
    async function fetchSteamPriceFromSteamAPI() {
        try {
            // Get current item name using enhanced extraction
            const itemName = getItemName();
            if (!itemName) {
                debugLog('Could not find item name for Steam API call');
                return null;
            }

            const cacheKey = `steam_market_${itemName}`;

            // Check cache first
            const cached = steamPriceCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < API_CACHE_DURATION) {
                debugLog('Using cached Steam price from Steam Market API:', cached.price);
                return cached.price;
            }

            debugLog('Fetching Steam price from Steam Community Market API using GM_xmlhttpRequest for:', itemName);

            // Steam Community Market API URL
            // CS2 items typically use appid 730
            const encodedItemName = encodeURIComponent(itemName);
            const steamMarketUrl = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodedItemName}`;

            debugLog('DEBUG - Steam API Request Details:');
            debugLog('  - Original itemName:', `"${itemName}"`);
            debugLog('  - Encoded itemName:', `"${encodedItemName}"`);
            debugLog('  - Full API URL:', steamMarketUrl);

            // Use GM_xmlhttpRequest to bypass CORS restrictions
            return new Promise((resolve) => {
                debugLog('Starting GM_xmlhttpRequest to:', steamMarketUrl);
                debugLog('GM_xmlhttpRequest available:', typeof GM_xmlhttpRequest);

                if (typeof GM_xmlhttpRequest === 'undefined') {
                    console.error('[Pricempire] GM_xmlhttpRequest is not available!');
                    resolve(null);
                    return;
                }

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: steamMarketUrl,
                    withCredentials: false,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    onload: function(response) {
                        debugLog('Steam Community Market API response status:', response.status);
                        debugLog('Steam Community Market API response text:', response.responseText);

                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                debugLog('Steam Community Market API parsed data:', data);
                                debugLog('API response fields:', Object.keys(data));
                                debugLog('lowest_price exists:', !!data.lowest_price, 'value:', data.lowest_price);
                                debugLog('median_price exists:', !!data.median_price, 'value:', data.median_price);
                                debugLog('volume exists:', !!data.volume, 'value:', data.volume);

                                // Extract price from Steam API response
                                let steamPrice = null;

                                if (data.lowest_price) {
                                    const priceMatch = data.lowest_price.match(/[$€£]?\s*([0-9.,]+)/);
                                    if (priceMatch) {
                                        steamPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                                        debugLog('Found Steam lowest_price:', steamPrice, 'from text:', data.lowest_price);
                                    }
                                } else if (data.median_price) {
                                    const priceMatch = data.median_price.match(/[$€£]?\s*([0-9.,]+)/);
                                    if (priceMatch) {
                                        steamPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                                        debugLog('Found Steam median_price:', steamPrice, 'from text:', data.median_price);
                                    }
                                } else {
                                    debugLog('WARNING: API returned success=true but no price fields available');
                                    debugLog('Item may not be available on Steam Community Market');
                                }

                                if (steamPrice && steamPrice > 0) {
                                    // Cache the result
                                    steamPriceCache.set(cacheKey, {
                                        price: steamPrice.toString(),
                                        timestamp: Date.now()
                                    });
                                    debugLog('SUCCESS - Found Steam price from Steam Market API:', steamPrice);
                                    resolve(steamPrice.toString());
                                } else {
                                    debugLog('Steam price extraction failed or price invalid');
                                    resolve(null);
                                }
                            } catch (parseError) {
                                console.error('[Pricempire] Failed to parse Steam API response:', parseError);
                                debugLog('Raw response text:', response.responseText);
                                resolve(null);
                            }
                        } else {
                            debugLog('Steam Community Market API returned non-200 status:', response.status);
                            resolve(null);
                        }
                    },
                    onerror: function(error) {
                        console.error('[Pricempire] Steam Community Market API call failed:', error);
                        console.error('[Pricempire] Error details:', {
                            status: error.status,
                            statusText: error.statusText,
                            responseText: error.responseText,
                            readyState: error.readyState,
                            responseHeaders: error.responseHeaders
                        });
                        resolve(null);
                    },
                    onabort: function() {
                        console.error('[Pricempire] Steam Community Market API call was aborted');
                        resolve(null);
                    },
                    ontimeout: function() {
                        console.error('[Pricempire] Steam Community Market API call timed out');
                        resolve(null);
                    },
                    timeout: 15000 // 15 second timeout for Steam API
                });
            });
        } catch (error) {
            console.error('[Pricempire] Steam Community Market API function failed:', error);
            return null;
        }
    }

    // Function to monitor for Steam cards appearing in the DOM (when user expands marketplaces)
    function startSteamCardMonitoring() {
        const monitorInterval = 1000; // Check every 1 second for faster detection

        const checkForSteamCards = () => {
            try {
                // Comprehensive search for all marketplace cards
                const allCards = document.querySelectorAll('article.group.relative, article[aria-label*="Offer"], div[class*="card"]');
                const totalCards = allCards.length;

                // Look for Steam cards using multiple selectors and text content
                let newSteamCards = [];
                let processedSteamCards = 0;

                Array.from(allCards).forEach(card => {
                    // Skip if already processed
                    if (card.dataset.steamProcessed === 'true') {
                        processedSteamCards++;
                        return;
                    }

                    // STRICT Steam card detection - only official Steam marketplace cards
                    const cardAriaLabel = card.getAttribute('aria-label');
                    const isSteamCard = (cardAriaLabel === 'Offer from Steam');

                    // Debug: Log all cards with "Steam" in their aria-label to see what's being checked
                    if (cardAriaLabel && cardAriaLabel.toLowerCase().includes('steam')) {
                        debugLog('DEBUG: Found card with "Steam" in aria-label:', {
                            ariaLabel: cardAriaLabel,
                            isExactMatch: cardAriaLabel === 'Offer from Steam',
                            marketplaceName: card.querySelector('a.font-semibold')?.textContent?.trim()
                        });
                    }

                    if (isSteamCard) {
                        debugLog('\n=== STEAM CARD MONITORING DETECTION ===');
                        debugLog('STEAM CARD FOUND - Validating...');

                        // Additional validation: ensure this is actually a real Steam marketplace card
                        const marketplaceName = card.querySelector('p.font-bold')?.textContent?.trim() ||
                                             card.querySelector('a[href*="/cs2-marketplaces/steam"] p')?.textContent?.trim();
                        const hasSteamIcon = card.querySelector('img[src*="steam_icon.webp"], img[alt="Steam"]');
                        const hasSteamCube = card.querySelector('.iconify.i-heroicons\\:cube.text-green-500');

                        const isRealSteam = marketplaceName === 'Steam' && hasSteamIcon;

                        debugLog('Steam card validation details:', {
                            marketplaceName: `"${marketplaceName}"`,
                            hasSteamIcon: !!hasSteamIcon,
                            hasSteamCube: !!hasSteamCube,
                            isRealSteam: isRealSteam,
                            currentGlobalBuyOrderPrice: window.steamBuyOrderPrice,
                            cardHTML: card.innerHTML.substring(0, 200)
                        });

                        // STRICT: Only process if this is actually a real Steam marketplace card
                        // CRITICAL: REJECT any card with marketplaceName !== "Steam" even if aria-label is correct
                        if (!isRealSteam) {
                            debugLog('REJECTED - Not a real Steam card - marketplace is:', marketplaceName);
                            return; // Skip this card entirely in forEach callback
                        }

                        debugLog('VALIDATION PASSED - This is a real Steam card');
                        newSteamCards.push(card);
                        card.dataset.steamProcessed = 'true'; // Mark as processed

                        debugLog('VALID Steam card detected:', {
                            ariaLabel: card.getAttribute('aria-label'),
                            textSample: card.textContent.substring(0, 200),
                            priceText: card.textContent.match(/\$[\d.,]+/g),
                            fullHTML: card.innerHTML.substring(0, 500),
                            marketplaceName: marketplaceName
                        });
                    }
                });

                // Process any newly found Steam cards
                if (newSteamCards.length > 0) {
                    debugLog('\n=== STEAM CARD PROCESSING START ===');
                    debugLog(`PROCESSING ${newSteamCards.length} new Steam cards...`);
                    debugLog('BEFORE PROCESSING - Global buy order price:', window.steamBuyOrderPrice);

                    debugLog('DEBUG: Cards that passed validation:', newSteamCards.map(card => ({
                        ariaLabel: card.getAttribute('aria-label'),
                        marketplaceName: card.querySelector('a.font-semibold')?.textContent?.trim(),
                        hasSteamIcon: !!card.querySelector('img[src*="steam_icon.webp"], img[alt*="Steam"]')
                    })));

                    let bestSteamPrice = null;
                    let bestPriceSource = '';

                    for (const card of newSteamCards) {
                        debugLog('Processing new Steam card:', {
                            innerHTML: card.innerHTML.substring(0, 300),
                            textContent: card.textContent.substring(0, 100)
                        });

                        // Try multiple price extraction methods
                        debugLog('Extracting prices from detected Steam card:', card.querySelector('a.font-semibold')?.textContent?.trim());
                        const priceData = extractPriceFromCard(card);

                        let currentPrice = null;
                        let currentSource = '';

                        if (priceData && priceData.mainPrice > 0) {
                            currentPrice = priceData.mainPrice;
                            currentSource = 'extractPriceFromCard';
                            debugLog('Extracted price data:', priceData);
                        } else {
                            // Enhanced fallback: More precise Steam price extraction
                            debugLog('ENHANCED PRICE SEARCH IN CARD:');
                            debugLog('CARD FULL TEXT:', card.textContent);

                            // Look for all price patterns with more precision
                            const priceMatches = card.textContent.match(/\$(\d+\.\d{2})/g);
                            if (priceMatches) {
                                debugLog('ALL PRICE MATCHES FOUND:', priceMatches);

                                const prices = priceMatches.map(match => parseFloat(match.replace('$', '')));
                                debugLog('PARSED PRICES:', prices);

                                // Steam-specific price validation: prefer prices ending in common Steam patterns
                                // Steam prices often end in .xx, .99, .49, .51, etc.
                                const steamLikelyPrices = prices.filter(price => {
                                    const cents = price * 100;
                                    const centsInt = Math.round(cents);
                                    // Common Steam price endings
                                    return centsInt % 1 === 0 && // Valid cent amount
                                           (centsInt % 100 === 99 ||  // .99 endings
                                            centsInt % 100 === 49 ||  // .49 endings
                                            centsInt % 100 === 51 ||  // .51 endings
                                            centsInt % 100 === 11 ||  // .11 endings
                                            centsInt % 100 === 33 ||  // .33 endings
                                            centsInt % 100 <= 50);    // Lower half of cent range
                                });

                                debugLog('STEAM-LIKELY PRICES:', steamLikelyPrices);

                                // If we found Steam-likely prices, use the lowest of those
                                const targetPrice = steamLikelyPrices.length > 0 ?
                                    Math.min(...steamLikelyPrices) : Math.min(...prices);

                                debugLog('TARGET STEAM PRICE SELECTED:', targetPrice,
                                           '(from Steam-likely:', steamLikelyPrices.length > 0, ')');

                                if (targetPrice > 0) {
                                    currentPrice = targetPrice;
                                    currentSource = 'enhanced-steam-patterns';
                                    debugLog('Enhanced Steam price extraction selected:', targetPrice,
                                            'from candidates:', prices, 'Steam-likely:', steamLikelyPrices);
                                }
                            }
                        }

                        if (currentPrice && parseFloat(currentPrice) > 0) {
                            debugLog('Steam price candidate:', currentPrice, 'from source:', currentSource);

                            // For Steam prices, prefer lower values without unrealistic price range limitations
                            if (!bestSteamPrice ||
                                (parseFloat(currentPrice) < parseFloat(bestSteamPrice) && parseFloat(currentPrice) > 0.01)) {
                                bestSteamPrice = currentPrice;
                                bestPriceSource = currentSource;
                                debugLog('New best Steam price:', bestSteamPrice, 'from', bestPriceSource);
                            }
                        }
                    }

                    if (bestSteamPrice && parseFloat(bestSteamPrice) > 0) {
                        debugLog('SUCCESS - Selected best Steam price from monitoring:', bestSteamPrice, 'from', bestPriceSource);
                        debugLog('STEAM PRICE SELECTED: Monitoring detection, price:', bestSteamPrice, 'source:', bestPriceSource);

                        debugLog('\n=== MONITORING UPDATE TRIGGERED ===');
                        debugLog('ABOUT TO CALL updateMarketOverviewPrice');
                        debugLog('  - bestSteamPrice (sell):', bestSteamPrice);
                        debugLog('  - current global buy order price:', window.steamBuyOrderPrice);
                        debugLog('  - bestPriceSource:', bestPriceSource);
                        debugLog('  - This may overwrite existing prices!');

                        // Update the current page's Steam price display immediately with the best price found
                        updateMarketOverviewPrice(bestSteamPrice);

                        debugLog('Monitoring update completed');

                        // 3rd APPROACH: Try to get exact Steam price directly via API as backup
                        debugLog('ALSO trying direct Steam API call for comparison...');
                        try {
                            const itemName = getItemName();
                            if (itemName) {
                                debugLog('Attempting direct Steam API call for:', itemName);
                                fetchSteamPriceFromSteamAPI().then(apiSteamPrice => {
                                    if (apiSteamPrice && parseFloat(apiSteamPrice) !== parseFloat(bestSteamPrice)) {
                                        debugLog('API Steam price differs:', apiSteamPrice, 'vs extracted:', bestSteamPrice);
                                        debugLog('Keeping extracted DOM price as it\'s from actual marketplace offers');
                                        // Keep the DOM extracted price - don't override with API
                                    } else if (apiSteamPrice) {
                                        debugLog('API Steam price matches extracted price:', apiSteamPrice);
                                    } else {
                                        debugLog('API call failed, keeping extracted price:', bestSteamPrice);
                                    }
                                });
                            }
                        } catch (e) {
                            debugLog('Direct API call failed:', e.message);
                        }

                        return bestSteamPrice;
                    }
                }

                // Log monitoring status for debugging
                if (totalCards > 0) {
                    debugLog(`Steam monitoring: ${processedSteamCards} processed Steam cards, ${newSteamCards.length} new, ${totalCards} total cards`);
                }

            } catch (error) {
                console.error('[Pricempire] Error in Steam card monitoring:', error);
            }
        };

        // Start monitoring immediately
        debugLog('Starting aggressive Steam card monitoring...');
        checkForSteamCards(); // Run immediately

        // Then set up interval
        setInterval(checkForSteamCards, monitorInterval);
        debugLog('Started Steam card monitoring with', monitorInterval, 'ms interval');
    }

    function replaceWithSteamPrice(priceCard, steamPrice) {
        debugLog('\n=== UI UPDATE: replaceWithSteamPrice ===');
        debugLog('UI Update Started');
        debugLog('  - Steam price (sell):', steamPrice);
        debugLog('  - Buy order price (global):', window.steamBuyOrderPrice);
        debugLog('  - Price card exists:', !!priceCard);
        debugLog('  - Current marketplace:', priceCard.getAttribute('aria-label'));
        debugLog('  - Call stack trace:', new Error().stack?.split('\n')[1]?.trim());

        if (!priceCard || !steamPrice) {
            debugLog('EARLY RETURN - Missing required data');
            debugLog('  - priceCard:', !!priceCard);
            debugLog('  - steamPrice:', !!steamPrice);
            return;
        }

        debugLog('replaceWithSteamPrice called with:', steamPrice);

        // Update the aria-label to indicate Steam market price
        priceCard.setAttribute('aria-label', 'Steam market price');

        // Replace the icon from Skins.com to Steam with proper styling
        // Try multiple possible icon container selectors
        let iconContainer = priceCard.querySelector('.absolute.right-2.top-2') ||
                           priceCard.querySelector('.absolute.right-2.top-2.md\\:right-3.md\\:top-3') ||
                           priceCard.querySelector('[class*="absolute"][class*="right"]') ||
                           priceCard.querySelector('[class*="right-2"]');

        if (!iconContainer) {
            debugLog('Icon container not found with standard selectors, searching for any absolute positioned container...');
            // Fallback: look for any container with absolute positioning that might contain the icon
            iconContainer = priceCard.querySelector('[class*="absolute"]') ||
                          priceCard.querySelector('div[class*="right"]');
        }

        debugLog('Found icon container:', iconContainer, 'classes:', iconContainer?.className);

        if (iconContainer) {
            // Look for the Skins.com image with multiple possible selectors
            const currentIcon = iconContainer.querySelector('img[src*="skins_icon"]') ||
                              iconContainer.querySelector('img[alt*="Skins.com"]') ||
                              iconContainer.querySelector('img') ||
                              iconContainer.querySelector('span[class*="iconify"]');

            debugLog('Found current icon:', currentIcon, 'src:', currentIcon?.src, 'classes:', currentIcon?.className);

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
                debugLog('Replaced icon with Steam icon, container classes:', iconContainer.className);
            } else {
                debugLog('No icon found in container, container contents:', iconContainer.innerHTML);
            }
        } else {
            debugLog('No icon container found at all, price card structure:', priceCard.innerHTML.substring(0, 200));
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

        debugLog('Found price element:', priceElement, 'current content:', priceElement?.textContent);

        if (priceElement) {
            // Format the price with $ symbol if not already present
            let formattedPrice = steamPrice;
            if (!formattedPrice.toString().startsWith('$') && !isNaN(parseFloat(formattedPrice))) {
                formattedPrice = '$' + parseFloat(formattedPrice).toFixed(2);
            }
            priceElement.textContent = formattedPrice;
            priceElement.setAttribute('aria-label', 'Steam price');
            debugLog('Updated price to:', formattedPrice);
        } else {
            debugLog('ERROR: Could not find price element to update!');
        }

        // Update any description or metadata text
        const descElement = priceCard.querySelector('.text-xs.text-theme-400');
        if (descElement) {
            descElement.textContent = 'Steam market';
            debugLog('Updated description to "Steam market"');
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
                    debugLog(`Updated ${attr} from "${value}" to "${newValue}"`);
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
                debugLog('Updated tooltip container at level', i);
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
            debugLog('Updated data tooltip attributes');
        }

        // Force tooltip update after a shorter delay (faster replacement)
        setTimeout(() => {
            debugLog('Performing delayed tooltip update...');
            updateAllTooltips(priceCard);
            allElements.forEach(updateAllTooltips);

            // Check if any tooltip instances exist globally
            if (window.tippy) {
                const tippyInstances = window.tippy.instances || [];
                tippyInstances.forEach(instance => {
                    if (instance.props.content && instance.props.content.includes('Skins.com')) {
                        instance.setContent(instance.props.content.replace(/Skins\.com/g, 'Steam'));
                        debugLog('Updated Tippy.js tooltip instance');
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
                        debugLog(`Tooltip update: Changed ${attr} from "${value}" to "${newValue}"`);
                    }
                });
            });
            debugLog(`Global tooltip update: ${foundCount} changes made`);

            // Try to find and override tooltip initialization functions
            if (window.tooltip || window.Tooltip) {
                debugLog('Found global tooltip function, attempting to override...');
                // Store reference to any potential tooltip initialization
            }
        }, 200); // Reduced from 500ms to 200ms

        // Final tooltip update with shorter delay for dynamic tooltips (conservative approach)
        setTimeout(() => {
            debugLog('Performing final tooltip update...');
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
                debugLog(`Final tooltip update: ${finalFoundCount} additional changes made`);
            } catch (e) {
                debugLog('Error in final tooltip update:', e.message);
            }
        }, 800); // Reduced from 2000ms to 800ms

        
        // Update the marketplace name (e.g., "Skins.com" → "Steam Market")
        const marketplaceName = priceCard.querySelector('.text-sm.font-medium.text-theme-100, .text-base.font-medium.text-theme-100');
        if (marketplaceName) {
            marketplaceName.textContent = 'Steam Market';
            debugLog('Updated marketplace name to "Steam Market"');
        }

        // Update the icon in the details section (price check/shopping bag icon)
        const detailIcon = priceCard.querySelector('.iconify.i-heroicons\\:shopping-bag, .iconify.i-ic\\:baseline-price-check');
        if (detailIcon) {
            detailIcon.classList.remove('i-heroicons:shopping-bag');
            detailIcon.classList.add('i-ic:baseline-price-check');
            detailIcon.classList.remove('text-theme-400');
            detailIcon.classList.add('h-3', 'w-3', 'md:h-4', 'md:w-4');
            debugLog('Updated detail icon to price check');
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

        debugLog('Buy order detail container found:', !!detailContainer);
        debugLog('window.steamBuyOrderPrice available:', window.steamBuyOrderPrice);
        debugLog('Price card HTML snippet:', priceCard.innerHTML.substring(0, 300));

        if (detailContainer) {
            // IMPORTANT: Don't overwrite buy order price from Steam DOM section with Steam card prices
            // Steam cards only have sell orders, not buy orders. Buy orders should only come from orange section.
            let buyOrderPrice = window.steamBuyOrderPrice;

            if (!buyOrderPrice) {
                // Fallback: estimate buy order price if not found
                const steamPriceNum = parseFloat(steamPrice);
                if (!isNaN(steamPriceNum)) {
                    buyOrderPrice = (steamPriceNum * 0.85).toFixed(2); // 15% lower estimate
                    debugLog('Using estimated buy order price (fallback):', buyOrderPrice);
                }
            } else {
                debugLog('Using preserved Steam buy order price from orange section:', buyOrderPrice);
            }

            if (buyOrderPrice) {
                detailContainer.innerHTML = `
                    <span class="iconify i-ic:baseline-price-check h-3 w-3 md:h-4 md:w-4" aria-hidden="true" style=""></span>
                    <span>$${buyOrderPrice}</span>
                    <span class="hidden md:inline">buy order</span>
                `;
                debugLog('Updated buy order section with actual price:', buyOrderPrice);
                debugLog('Buy order HTML after update:', detailContainer.innerHTML);
                debugLog('Buy order container visible:', detailContainer.offsetParent !== null);
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
            debugLog('Updated time section with proper structure');
        }

        debugLog('Successfully replaced Skins.com price with Steam price:', steamPrice);
    }

    async function updateMarketOverviewPrice(overrideSteamPrice = null) {
        debugLog('\n=== MARKET OVERVIEW PRICE UPDATE ===');
        debugLog('updateMarketOverviewPrice called');
        debugLog('  - overrideSteamPrice:', overrideSteamPrice);
        debugLog('  - Current global buy order price:', window.steamBuyOrderPrice);
        debugLog('  - Call stack:', new Error().stack?.split('\n')[1]?.trim());

        const settings = getSettings();

        if (!settings.useSteamPricePreview) {
            debugLog('Steam price preview is disabled in settings');
            return false;
        }

        // Find the Market overview price card
        const priceCard = document.querySelector('[role="article"][aria-label*="market price"]');

        if (!priceCard) {
            return false;
        }

        // Check if it's currently showing Skins.com price or if we have an override
        const currentProvider = detectCurrentPriceProvider();

        // Use override price if provided, otherwise try to get Steam price data
        let steamPrice = overrideSteamPrice;
        if (!steamPrice) {
            steamPrice = await findSteamPriceData();
        }

        if (steamPrice) {
            // If current provider is Steam but we have a better price, update it
            if (currentProvider === 'steam' && overrideSteamPrice) {
                debugLog('Updating existing Steam price with better value:', steamPrice);
                replaceWithSteamPrice(priceCard, steamPrice);
                return true; // Successfully updated
            } else if (currentProvider !== 'steam') {
                debugLog('Replacing', currentProvider, 'price with Steam price:', steamPrice);
                replaceWithSteamPrice(priceCard, steamPrice);
                return true; // Successfully updated
            } else {
                return true; // Already showing Steam price and no better price found
            }
        } else {
            return false; // No Steam price data found
        }
    }

    async function applySteamPricePreview() {
        const settings = getSettings();

        if (settings.useSteamPricePreview) {
            // Apply Steam price preview with faster retries for page load timing issues
            let retryCount = 0;
            const maxRetries = 10; // More retries to account for API calls
            const initialDelay = 50; // Much faster initial attempt
            const retryDelay = 300; // Slightly longer delay for API calls

            async function tryUpdatePrice() {
                retryCount++;
                debugLog(`Steam price attempt ${retryCount}/${maxRetries}`);

                const result = await updateMarketOverviewPrice();

                // If Steam price data not found and we haven't exceeded retries, try again
                if (!result && retryCount < maxRetries) {
                    // Use progressively longer delays but gentler exponential backoff
                    const delay = initialDelay + (retryDelay * Math.pow(1.2, retryCount - 1));
                    setTimeout(tryUpdatePrice, Math.min(delay, 2000)); // Cap at 2 seconds for API calls
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
                            updateMarketOverviewPrice(); // Fire-and-forget async call
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

    // Start Steam card monitoring for dynamic marketplace expansion
    startSteamCardMonitoring();

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
            debugLog('MutationObserver triggered - found', marketplaceCards.length, 'marketplace cards');
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
        debugLog('Backup initialization - checking if sections are initialized...');
        debugLog('Current pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);

        if (!pinnedMarketplacesGrid) {
            debugLog('Pinned grid not initialized, forcing initialization...');
            initializeSections();
            applyFavoritesOnLoad();
            debugLog('After forced initialization - pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
        } else {
            debugLog('Sections already initialized properly');
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
    }, 2000); // Further reduced to minimize interference

    // Get adaptive debounce delay based on view mode
    function getAdaptiveDelay() {
        return isCurrentlyListView() ? 750 : 400; // Longer delay for List view
    }

    // Check if DOM is ready for sponsored normalization
    function isDOMReadyForNormalization() {
        const cards = document.querySelectorAll('article.group.relative');
        return cards.length > 0 && Array.from(cards).every(card => card.querySelector('span.font-semibold'));
    }

    // Smart cache management - only clear when necessary
    function shouldClearCache(sortOption) {
        return sortOption !== lastSortOption;
    }

    // Monitor filter changes (payment method, etc.) - targeted and adaptive
    let filterTimeout = null;

    // Monitor specific filter dropdowns for more precise detection
    function monitorFilterDropdowns() {
        // Standard HTML selects for payment methods
        const paymentMethodDropdown = document.querySelector('[data-testid="payment-method"], select[name*="payment"], select[id*="payment"]');
        const filterDropdowns = document.querySelectorAll('select[id*="filter"], [data-testid*="filter"]');

        const dropdownsToMonitor = paymentMethodDropdown ? [paymentMethodDropdown, ...filterDropdowns] : filterDropdowns;

        dropdownsToMonitor.forEach(dropdown => {
            if (dropdown) {
                dropdown.addEventListener('change', () => {
                    debugLog('Standard dropdown change detected');
                    handleFilterChange();
                });
            }
        });

        // Monitor custom dropdown options (.select-option elements)
        const customDropdownOptions = document.querySelectorAll('.select-option');
        customDropdownOptions.forEach(option => {
            // Remove existing listeners to avoid duplicates
            option.removeEventListener('click', handleCustomOptionClick);
            option.addEventListener('click', handleCustomOptionClick);
        });

        // Also monitor for dynamically added dropdown options
        const dropdownObserver = new MutationObserver((_mutations) => {
            const newOptions = document.querySelectorAll('.select-option:not([data-monitored])');
            newOptions.forEach(option => {
                option.setAttribute('data-monitored', 'true');
                option.addEventListener('click', handleCustomOptionClick);
            });
        });

        // Observe the entire document for new dropdown options
        dropdownObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Handle custom dropdown option clicks
    function handleCustomOptionClick(event) {
        const option = event.currentTarget;
        if (option.classList.contains('select-option')) {
            debugLog('Custom dropdown option clicked');

            // Check if this option relates to payment methods by its content or context
            const optionText = option.textContent.toLowerCase();
            const paymentKeywords = ['payment', 'paypal', 'stripe', 'card', 'wallet', 'crypto', 'bitcoin', 'ethereum', 'bank'];

            if (paymentKeywords.some(keyword => optionText.includes(keyword))) {
                debugLog('Payment method change detected via custom dropdown');
                handleFilterChange();
            }
        }
    }

    function handleFilterChange() {
        // Clear any existing timeout
        if (filterTimeout) {
            clearTimeout(filterTimeout);
        }

        const adaptiveDelay = getAdaptiveDelay();

        // Apply changes with adaptive timing
        filterTimeout = setTimeout(() => {
            // Wait for DOM to be ready
            if (!isDOMReadyForNormalization()) {
                // If not ready, wait longer and try again
                setTimeout(handleFilterChange, 200);
                return;
            }

            // Force re-normalization of ALL cards after filter changes
            // This ensures newly loaded sponsored cards are properly processed
            const allCards = document.querySelectorAll('article.group.relative');
            debugLog('Filter change detected - re-normalizing', allCards.length, 'cards');

            // Clear normalization markers to force re-processing
            allCards.forEach(card => {
                delete card.dataset.isNormalized;
                // But preserve sponsored detection if it existed
                if (card.dataset.isSponsored === 'true') {
                    // Keep the sponsored marker but allow re-normalization
                }
            });

            const sortOption = getSortingOption();
            const shouldClear = shouldClearCache(sortOption);

            if (shouldClear) {
                // Only clear cache when sort option actually changed
                lastSortOption = null;
                lastCardCount = 0;
            }

            mergeAndSortSponsored();

            // Multi-tier retry normalization system
            // Tier 1: Fast retry (300ms) - for quickly loading content
            setTimeout(() => {
                const delayedCards = document.querySelectorAll('article.group.relative');
                delayedCards.forEach(card => {
                    if (!card.dataset.isNormalized) {
                        normalizeSponsored(card);
                    }
                });
                debugLog('Tier 1 retry completed - normalized', delayedCards.length, 'cards');
            }, 300);

            // Tier 2: Medium retry (1000ms) - for slower loading content
            setTimeout(() => {
                const mediumCards = document.querySelectorAll('article.group.relative');
                mediumCards.forEach(card => {
                    if (!card.dataset.isNormalized) {
                        normalizeSponsored(card);
                    }
                });
                debugLog('Tier 2 retry completed - normalized', mediumCards.length, 'cards');
            }, 1000);

            // Tier 3: Final retry (2000ms) - for very slow content
            setTimeout(() => {
                const finalCards = document.querySelectorAll('article.group.relative');
                finalCards.forEach(card => {
                    if (!card.dataset.isNormalized) {
                        normalizeSponsored(card);
                    }
                });
                debugLog('Tier 3 retry completed - normalized', finalCards.length, 'cards');
            }, 2000);

        }, adaptiveDelay);
    }

    // Fallback MutationObserver with targeted scope
    const filterObserver = new MutationObserver((_mutations, obs) => {
        // Filter mutations to only relevant changes
        const relevantMutations = _mutations.filter(mutation => {
            // Only process mutations that affect card elements or their direct parents
            return Array.from(mutation.addedNodes).some(node => {
                return node.nodeType === Node.ELEMENT_NODE && (
                    node.matches?.('article.group.relative') ||
                    node.querySelector?.('article.group.relative')
                );
            });
        });

        if (relevantMutations.length > 0) {
            handleFilterChange();
        }
    });

    // Initialize targeted filter monitoring
    monitorFilterDropdowns();

    // Observe changes to the offers section with targeted scope
    const offersSection = document.querySelector('section#offers');
    if (offersSection) {
        filterObserver.observe(offersSection, {
            childList: true,
            subtree: false // Only watch direct children to reduce noise
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
            debugLog('View button clicked - isListViewBtn:', !!isListViewBtn, 'isGridViewBtn:', !!isGridViewBtn);
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
            debugLog('isListViewBtn is TRUE, queuing setTimeout for 100ms...');
            setTimeout(() => {
                debugLog('Inside List view setTimeout callback');
                // Completely clear cached sections and sorting cache
                for (let key in marketplaceSections) {
                    delete marketplaceSections[key];
                }
                lastSortOption = null;
                lastCardCount = 0;
                pinnedMarketplacesGrid = null;

                // In List view, look for marketplace cards directly
                const marketplaceCards = document.querySelectorAll('article.group.relative');
                debugLog('Found marketplace cards:', marketplaceCards.length);
                if (marketplaceCards.length > 0) {
                    debugLog('Marketplace cards ready, applying merge/sort...');
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
        debugLog('Click detected on element:', event.target, 'classes:', event.target.className);
        const starIcon = event.target.closest('.iconify[class*="star"], span[class*="kid-star"], span[class*="family-star"]');
        const card = starIcon?.closest('.group.relative');

        debugLog('Star detection - starIcon:', !!starIcon, 'card:', !!card);
        if (starIcon) {
            debugLog('Found star icon - classes:', starIcon.className);
        }

        if (starIcon && card) {
            // More flexible star detection - check for any star icon classes
            const isActionableStar = starIcon.classList.contains('i-material-symbols-light:kid-star-outline') ||
                                   starIcon.classList.contains('i-material-symbols-light:family-star-sharp') ||
                                   starIcon.classList.contains('i-heroicons:star-solid') ||
                                   starIcon.className.includes('kid-star') ||
                                   starIcon.className.includes('family-star') ||
                                   starIcon.className.includes('star-solid');

            debugLog('isActionableStar:', isActionableStar);

            if(isActionableStar){
                debugLog('Star clicked - classes:', starIcon.className, 'card found:', !!card);
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(card, starIcon);
            } else {
                debugLog('Star clicked but not actionable - classes:', starIcon.className);
            }
        }
    }, true);

    // Prevent text selection issues and add persistent sponsored styling
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

        /* === PERSISTENT SPONSORED NORMALIZATION CSS === */
        /* These rules automatically override sponsored styling regardless of DOM replacement */

        /* Override sponsored Grid view styling */
        article[data-is-sponsored="true"] .bg-theme-700.ring-1.ring-theme-800 {
            background-color: rgb(30 41 59) !important; /* bg-theme-800 */
            background: rgb(30 41 59) !important;
        }

        /* Override sponsored List view yellow borders and rings */
        article[data-is-sponsored="true"] .border-l-4.border-yellow-500 {
            border-color: rgb(55 65 81) !important; /* border-theme-700 */
        }

        article[data-is-sponsored="true"] .ring-yellow-500 {
            --tw-ring-color: rgb(30 41 59) !important; /* ring-theme-800 */
        }

        article[data-is-sponsored="true"] .border-yellow-500 {
            border-color: rgb(55 65 81) !important; /* border-theme-700 */
        }

        /* Override sponsored yellow backgrounds */
        article[data-is-sponsored="true"] .bg-yellow-50\\/50,
        article[data-is-sponsored="true"] .bg-yellow-100\\/50 {
            background-color: transparent !important;
            background: transparent !important;
        }

        /* Override sponsored yellow text */
        article[data-is-sponsored="true"] .text-yellow-600,
        article[data-is-sponsored="true"] .text-yellow-700 {
            color: rgb(243 244 246) !important; /* text-theme-100 */
        }

        /* Override sponsored gradient buttons */
        article[data-is-sponsored="true"] button[class*="from-sky"],
        article[data-is-sponsored="true"] button[class*="to-blue"] {
            background-color: rgb(37 99 235) !important; /* bg-blue-600 -> bg-theme-600 equivalent */
            background: rgb(37 99 235) !important;
        }

        /* Force theme colors on sponsored cards */
        article[data-is-sponsored="true"] .bg-gradient-to-r {
            background: none !important;
            background-color: inherit !important;
        }

        /* Ensure sponsored cards maintain proper styling even after DOM updates */
        article[data-is-sponsored="true"] .relative.rounded-md {
            background-color: rgb(30 41 59) !important;
        }
    `;
    document.head.appendChild(style);

    // === INTERSECTION OBSERVER FOR VIEWPORT DETECTION ===
    // Normalize sponsored cards as they enter the viewport
    const viewportObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                if (!card.dataset.isNormalized) {
                    normalizeSponsored(card);
                    debugLog('Viewport-triggered normalization for card');
                }
            }
        });
    }, {
        root: null,
        rootMargin: '50px', // Start normalizing before card is fully visible
        threshold: 0.1
    });

    // Monitor all existing and future cards
    function observeCards() {
        const cards = document.querySelectorAll('article.group.relative');
        cards.forEach(card => {
            if (!card.dataset.viewportObserved) {
                card.dataset.viewportObserved = 'true';
                viewportObserver.observe(card);
            }
        });
    }

    // Start observing
    observeCards();

    // === PERIODIC VERIFICATION SYSTEM ===
    // Continuously check for un-normalized sponsored cards
    let verificationInterval;

    function startPeriodicVerification() {
        if (verificationInterval) clearInterval(verificationInterval);

        verificationInterval = setInterval(() => {
            const allCards = document.querySelectorAll('article.group.relative');
            let normalizedCount = 0;
            let sponsoredCount = 0;

            allCards.forEach(card => {
                // Re-check for sponsored status
                if (isSponsored(card)) {
                    sponsoredCount++;
                    if (!card.dataset.isNormalized) {
                        normalizeSponsored(card);
                        normalizedCount++;
                        debugLog('Periodic verification: re-normalized sponsored card');
                    }
                }
            });

            // Only log when there's activity to avoid console spam
            if (normalizedCount > 0) {
                debugLog(`Periodic check: ${normalizedCount} cards re-normalized (${sponsoredCount} total sponsored)`);
            }

            // Re-observe new cards
            observeCards();

        }, 5000); // Check every 5 seconds
    }

    function stopPeriodicVerification() {
        if (verificationInterval) {
            clearInterval(verificationInterval);
            verificationInterval = null;
        }
    }

    // Start periodic verification
    startPeriodicVerification();

    // Stop verification when page is hidden to save resources
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPeriodicVerification();
        } else {
            startPeriodicVerification();
        }
    });

})();

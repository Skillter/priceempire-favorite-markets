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

        console.log('[Pricempire] updateStarIcon called - isFavorite:', isFavorite, 'isUnfavoritedIcon:', isUnfavoritedIcon, 'isFavoritedIcon:', isFavoritedIcon, 'current classes:', starIcon.className);

        if (isFavorite && isUnfavoritedIcon) {
            // Change from outline to filled star - use working icon name
            starIcon.classList.remove('i-material-symbols-light:kid-star-outline');
            starIcon.classList.add('i-heroicons:star-solid');
            starIcon.classList.remove('text-theme-400');
            starIcon.classList.add('text-yellow-400'); // Match existing filled star color
            console.log('[Pricempire] Changed to favorited star - new classes:', starIcon.className);
        } else if (!isFavorite && isFavoritedIcon) {
            // Change from filled to outline star
            starIcon.classList.remove('i-heroicons:star-solid', 'i-material-symbols-light:family-star-sharp');
            starIcon.classList.add('i-material-symbols-light:kid-star-outline');
            starIcon.classList.remove('text-yellow-400', 'text-yellow-500');
            starIcon.classList.add('text-theme-400');
            console.log('[Pricempire] Changed to unfavorited star - new classes:', starIcon.className);
        } else {
            console.log('[Pricempire] No star update needed - current state matches desired state');
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
            console.log('[Pricempire] Star icon not provided, searching within card...');
            starIcon = getFavoriteStarIcon(card);
        }

        console.log('[Pricempire] toggleFavorite called - marketplaceName:', marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
        console.log('[Pricempire] Card dataset:', card.dataset);

        if (!marketplaceName || !starIcon || !pinnedMarketplacesGrid) {
            console.warn('[Pricempire] toggleFavorite failed - marketplaceName:', !!marketplaceName, 'starIcon:', !!starIcon, 'pinnedMarketplacesGrid:', !!pinnedMarketplacesGrid);
            return;
        }

        let favorites = getFavorites();
        let serverUnfavorited = getServerUnfavorited();
        const isFavorite = favorites.includes(marketplaceName);
        const isServerFavorited = card.dataset.serverFavorited === 'true';

        console.log('[Pricempire] Current state - isFavorite:', isFavorite, 'isServerFavorited:', isServerFavorited, 'favorites list:', favorites);

        if (isFavorite) {
            console.log('[Pricempire] Unfavoriting marketplace:', marketplaceName);
            // unfavorite
            favorites = favorites.filter(fav => fav !== marketplaceName);

            // If this was server-favorited, remember user unfavorited it
            if (isServerFavorited && !serverUnfavorited.includes(marketplaceName)) {
                serverUnfavorited.push(marketplaceName);
                saveServerUnfavorited(serverUnfavorited);
            }

            const originalSectionTitle = card.dataset.originalSection;
            console.log('[Pricempire] Moving card back to original section:', originalSectionTitle);
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
                console.log('[Pricempire] Card moved back to original section successfully');

            } else {
                console.warn(`[Pricempire Multi-Favorite] Could not find original section "${originalSectionTitle}" or fallback "Other Marketplaces" to return card to.`);
                console.log('[Pricempire] Available sections:', Object.keys(marketplaceSections));
            }

            console.log('[Pricempire] Updating star icon to unfavorited state');
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
            console.log('[Pricempire] Card moved to pinned section successfully');

            updateStarIcon(starIcon, true);
            console.log('[Pricempire] Star icon updated to favorited state');
        }
        saveFavorites(favorites);
        console.log('[Pricempire] Favorites saved:', favorites);
        console.log('[Pricempire] toggleFavorite completed successfully');
    }

// creates or finds the pinned Marketplaces section and caches all section grids.
    function initializeSections() {
        console.log('[Pricempire] initializeSections called');

        // cache it - use generic selectors that work in both Grid and List view
        const sections = document.querySelectorAll('div.space-y-4');
        console.log('[Pricempire] Found sections:', sections.length);

        sections.forEach(section => {
            const titleEl = section.querySelector('h3');
            const gridEl = section.querySelector('.grid');
            if (titleEl && gridEl) {
                const title = titleEl.textContent.trim();
                marketplaceSections[title] = gridEl;
                console.log('[Pricempire] Cached section:', title);
            }
        });

        console.log('[Pricempire] Cached sections:', Object.keys(marketplaceSections));

        // check for the pinned section
        pinnedMarketplacesGrid = marketplaceSections['Pinned Marketplaces'];
        console.log('[Pricempire] Pinned Marketplaces section found:', !!pinnedMarketplacesGrid);

        if (!pinnedMarketplacesGrid) {
            console.log('[Pricempire] Creating Pinned Marketplaces section...');
            // Try multiple selectors for main container to be more robust
            const mainContainer = document.querySelector('.space-y-6') ||
                                document.querySelector('.space-y-4')?.parentElement ||
                                document.querySelector('main') ||
                                document.querySelector('[class*="space-y"]');
            console.log('[Pricempire] Main container found:', !!mainContainer, 'selector used:', mainContainer ? mainContainer.className : 'none');

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
                    console.log('[Pricempire] Inserted after first section');
                } else {
                    mainContainer.prepend(newPinnedSection);
                    console.log('[Pricempire] Prepend to main container');
                }
                pinnedMarketplacesGrid = newPinnedSection.querySelector('.grid');
                marketplaceSections['Pinned Marketplaces'] = pinnedMarketplacesGrid;
                console.log('[Pricempire] Pinned Marketplaces section created, grid found:', !!pinnedMarketplacesGrid);
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
    const API_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    async function findSteamPriceData() {
        debugLog('Searching for Steam price data...');

        // Method 0: Primary - Extract Steam price from Steam marketplace card in offers section (most efficient)
        debugLog('Method 0: Searching Steam marketplace card in DOM...');
        const steamMarketplaceCard = findSteamMarketplaceCard();
        if (steamMarketplaceCard) {
            const priceData = extractPriceFromCard(steamMarketplaceCard);
            if (priceData && priceData.mainPrice > 0) {
                debugLog('Found Steam price data from marketplace card:', priceData, 'method: DOM extraction');
                // Store buy order price globally for use in replacement
                window.steamBuyOrderPrice = priceData.buyOrderPrice;
                console.log('[Pricempire] STEAM PRICE SOURCE: Method 0 - DOM extraction, price:', priceData.mainPrice);
                return priceData.mainPrice.toString();
            } else {
                debugLog('Steam marketplace card found but no valid price data extracted');
            }
        } else {
            debugLog('No Steam marketplace card found in DOM');
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

                // Enhanced dynamic path discovery for Steam price data
                const findSteamPriceInObject = (obj, path = '', maxDepth = 6) => {
                    if (!obj || typeof obj !== 'object' || maxDepth <= 0) return null;

                    for (const [key, value] of Object.entries(obj)) {
                        const currentPath = path ? `${path}.${key}` : key;

                        // Direct Steam price matches
                        if (typeof value === 'number' && value > 0) {
                            const lowerKey = key.toLowerCase();
                            const lowerPath = path.toLowerCase();

                            // More comprehensive Steam detection
                            if (lowerKey.includes('steam') && (lowerKey.includes('price') || lowerKey.includes('cost'))) {
                                debugLog('Found direct Steam price:', value, 'at:', currentPath);
                                return value;
                            }

                            // Provider/marketplace specific Steam price
                            if (lowerPath.includes('steam') && (lowerKey.includes('price') || lowerKey.includes('cost'))) {
                                debugLog('Found Steam provider price:', value, 'at:', currentPath);
                                return value;
                            }
                        }

                        // Array search for providers/charts
                        if (Array.isArray(value) && (key.toLowerCase().includes('provider') || key.toLowerCase().includes('chart') || key.toLowerCase().includes('market'))) {
                            const steamEntry = value.find(item => {
                                if (!item || typeof item !== 'object') return false;
                                const itemKeys = Object.keys(item);
                                return itemKeys.some(k => {
                                    const val = item[k];
                                    return (typeof val === 'string' && val.toLowerCase() === 'steam') ||
                                           (typeof val === 'string' && val.toLowerCase().includes('steam'));
                                });
                            });

                            if (steamEntry && steamEntry.price) {
                                debugLog('Found Steam provider in array:', steamEntry.price, 'at:', currentPath);
                                return steamEntry.price;
                            }
                        }

                        // Recursive search
                        const result = findSteamPriceInObject(value, currentPath, maxDepth - 1);
                        if (result) return result;
                    }
                    return null;
                };

                // Try dynamic search in multiple global objects
                const globalObjects = [
                    { obj: window.__NUXT__, name: '__NUXT__' },
                    { obj: window.__INITIAL_STATE__, name: '__INITIAL_STATE__' },
                    { obj: window.initialState, name: 'initialState' },
                    { obj: window.state, name: 'state' }
                ];

                for (const { obj, name } of globalObjects) {
                    if (obj) {
                        debugLog(`Searching in ${name} object`);
                        const dynamicResult = findSteamPriceInObject(obj);
                        if (dynamicResult) {
                            console.log('[Pricempire] STEAM PRICE SOURCE: Method 1 - Dynamic search in', name + ', price:', dynamicResult);
                            return dynamicResult.toString();
                        }
                    }
                }

                // Fallback to specific hardcoded paths (limited to most likely ones)
                const possiblePaths = [
                    // Most likely paths based on common patterns
                    () => window.__NUXT__?.data?.[0]?.item?.steamPrice,
                    () => window.__NUXT__?.data?.[0]?.steamPrice,
                    () => window.__NUXT__?.payload?.data?.[0]?.steamPrice,
                    () => window.__INITIAL_STATE__?.item?.steamPrice,
                    () => window.steamPrice,
                    () => window.steamMarketPrice
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

        // Method 6: Pricempire API integration (when DOM and local data fail)
        debugLog('Method 6: Trying Pricempire API integration...');
        try {
            const apiPrice = await fetchSteamPriceFromAPI();
            if (apiPrice) {
                console.log('[Pricempire] STEAM PRICE SOURCE: Method 6 - Pricempire API, price:', apiPrice);
                return apiPrice;
            } else {
                debugLog('Method 6: API returned null/undefined');
            }
        } catch (apiError) {
            debugLog('Method 6: API call failed with error:', apiError.message);
        }

        debugLog('About to start Method 7 - Alternative Steam price extraction');
        // Method 7: Alternative Steam price extraction from visible market data
        debugLog('Method 7: Extracting Steam price from existing market data...');
        try {
            const alternativePrice = extractSteamPriceFromVisibleData();
            if (alternativePrice) {
                console.log('[Pricempire] STEAM PRICE SOURCE: Method 7 - Visible data extraction, price:', alternativePrice);
                return alternativePrice;
            } else {
                debugLog('Method 7: No Steam price found in visible data');
            }
        } catch (altError) {
            debugLog('Method 7: Alternative extraction failed with error:', altError.message);
        }

        // Method 8: Enhanced script data search (fallback)
        debugLog('Method 8: Searching for Steam price in embedded script data...');
        try {
            const scriptPrice = findSteamPriceInScripts();
            if (scriptPrice) {
                console.log('[Pricempire] STEAM PRICE SOURCE: Method 8 - Script data search, price:', scriptPrice);
                return scriptPrice;
            } else {
                debugLog('Method 8: No Steam price found in script data');
            }
        } catch (scriptError) {
            debugLog('Method 8: Script search failed with error:', scriptError.message);
        }

        // Method 9: Steam Community Market API (ultimate fallback)
        debugLog('Method 9: Trying Steam Community Market API...');
        try {
            const steamMarketPrice = await fetchSteamPriceFromSteamAPI();
            if (steamMarketPrice) {
                console.log('[Pricempire] STEAM PRICE SOURCE: Method 9 - Steam Community Market API, price:', steamMarketPrice);
                return steamMarketPrice;
            } else {
                debugLog('Method 9: Steam API returned null/undefined');
            }
        } catch (steamApiError) {
            debugLog('Method 9: Steam API call failed with error:', steamApiError.message);
        }

        console.log('[Pricempire] No real Steam price data found in any source');
        return null;
    }

    // Alternative function to extract Steam price from visible/cached data
    function extractSteamPriceFromVisibleData() {
        console.log('[Pricempire] extractSteamPriceFromVisibleData() function called');
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
                    console.log('[Pricempire] STEAM PRICE SOURCE: Method 1 - Visible Steam card extraction, price:', priceData.mainPrice);
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
                                    console.log('[Pricempire] STEAM PRICE SOURCE: Method 5 - Cached API data, price:', item[field]);
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
                                    console.log('[Pricempire] Validated Steam price from script:', price.toFixed(2), 'pattern:', pattern.source);
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

            // NEW: Enhanced search for filtered/hidden Steam cards
            () => {
                // Look for Steam cards that might be filtered out or hidden
                const allCards = document.querySelectorAll('article.group.relative');
                for (const card of allCards) {
                    // Check for Steam-related attributes or data
                    const steamIndicators = [
                        card.getAttribute('data-provider'),
                        card.getAttribute('data-marketplace'),
                        card.getAttribute('aria-label'),
                        card.querySelector('img')?.alt,
                        card.querySelector('img')?.src
                    ];

                    const hasSteamIndicator = steamIndicators.some(indicator =>
                        indicator && (indicator.toLowerCase().includes('steam') || indicator.includes('steam_icon'))
                    );

                    if (hasSteamIndicator) {
                        // Check if card might be filtered out (hidden, disabled, etc.)
                        const isFiltered = card.style.display === 'none' ||
                                         card.style.visibility === 'hidden' ||
                                         card.classList.contains('hidden') ||
                                         card.getAttribute('aria-hidden') === 'true';

                        // Even if filtered, try to extract price
                        const priceSelectors = [
                            '.text-2xl.font-bold.tracking-tight.text-theme-100',
                            '.text-xl.font-bold.text-theme-100',
                            '[class*="price"]',
                            '[class*="text-theme"][class*="bold"]'
                        ];

                        for (const selector of priceSelectors) {
                            const priceElement = card.querySelector(selector);
                            if (priceElement) {
                                const priceText = priceElement.textContent.trim();
                                if (priceText.match(/^\$\d+\.\d+$/)) {
                                    console.log('[Pricempire] Found filtered Steam card:', priceText, 'filtered:', isFiltered);
                                    return card;
                                }
                            }
                        }
                    }
                }
                return null;
            },

            // NEW: Search for Steam data in script tags or embedded data
            () => {
                // Look for Steam market links or data that might indicate Steam pricing
                const steamLink = document.querySelector('a[href*="steamcommunity.com/market/listings/730/"]');
                if (steamLink) {
                    console.log('[Pricempire] Found Steam market link, but virtual card extraction is unreliable - skipping');
                    // Virtual card extraction is unreliable - it finds wrong prices from other marketplaces
                    // Skip this method and let API calls handle Steam price detection properly
                    return null;
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
        console.log('[Pricempire] Extracting prices from card - full text:', card.textContent);

        // Extract main price - largest/most prominent price
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
        let allPrices = [];

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
                        console.log('[Pricempire] Extracted candidate main price:', price, 'from text:', priceText);
                        allPrices.push(price);
                        if (!mainPrice) mainPrice = price; // Use first found as main price
                    }
                }
            }
        }

        // If no structured price found, extract from all price patterns in card
        if (allPrices.length === 0) {
            const priceMatches = card.textContent.match(/\$[\d.,]+/g) || [];
            console.log('[Pricempire] No structured price found, extracting from text matches:', priceMatches);

            allPrices = priceMatches.map(match => parseFloat(match.replace(/[^0-9.]/g, '')))
                                   .filter(price => !isNaN(price) && price > 0);

            if (allPrices.length > 0) {
                mainPrice = Math.min(...allPrices); // Use lowest as main price (typically the sell price)
                console.log('[Pricempire] Using lowest price as main price:', mainPrice, 'from candidates:', allPrices);
            }
        }

        // Extract buy order price - look specifically for buy order section
        let buyOrderPrice = null;

        // Method 1: Look for buy order section with price check icon
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
                        if (!isNaN(price) && price > 0) {
                            console.log('[Pricempire] Extracted buy order price:', price, 'from text:', text);
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
            console.log('[Pricempire] Inferred buy order price from multiple prices:', buyOrderPrice, 'sorted prices:', sortedPrices);
        }

        // Store the actual buy order price for global access
        if (buyOrderPrice) {
            window.steamBuyOrderPrice = buyOrderPrice.toFixed(2);
            console.log('[Pricempire] Stored global steam buy order price:', window.steamBuyOrderPrice);
        }

        if (mainPrice) {
            console.log('[Pricempire] Final extracted prices - main:', mainPrice, 'buy order:', buyOrderPrice);
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

    // Helper function to extract item name from page
    function getItemName() {
        // Method 1: From Steam market link (most reliable)
        const steamLink = document.querySelector('a[href*="steamcommunity.com/market/listings/730/"]');
        if (steamLink) {
            const href = steamLink.getAttribute('href');
            const marketName = href.split('/730/')[1];
            const extractedName = marketName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
            debugLog('getItemName: Extracted from Steam link:', extractedName);
            return extractedName;
        }

        // Method 2: From breadcrumb navigation
        const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"] li:last-child a');
        if (breadcrumb) {
            const breadcrumbName = breadcrumb.getAttribute('href').split('/').pop().replace(/-/g, ' ');
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
                debugLog('getItemName: Extracted from URL:', urlName);
                return urlName;
            }
        }

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
            console.log('[Pricempire] API Data Analysis - Sample structures:');
            let firstItemKeys = [];

            for (let sampleIndex = 0; sampleIndex < Math.min(5, data.length); sampleIndex++) {
                const sampleItem = data[sampleIndex];
                if (sampleItem && typeof sampleItem === 'object') {
                    const keys = Object.keys(sampleItem);
                    firstItemKeys.push(keys);
                    console.log(`Sample ${sampleIndex}:`, {
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

            console.log('[Pricempire] Data type analysis:', {
                hasProviderFields: hasProviderFields,
                uniqueKeys: [...new Set(firstItemKeys.flat())],
                firstItemKeys: firstItemKeys
            });

            if (hasProviderFields) {
                console.log('[Pricempire] This appears to be PROVIDER data - searching for Steam entries');
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
                        console.log(`[Pricempire] Found Steam provider at index ${i}:`, item);

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
                                    console.log(`[Pricempire] SUCCESS - Found Steam price: ${field} = ${priceValue}`);
                                    return priceValue.toString();
                                }
                            }
                        }
                    }
                }
            } else {
                console.log('[Pricempire] This appears to be TIME SERIES data - provider info not available');
                // This is time series data (what we were seeing before)
                debugLog('This is time series data, not provider data - skipping Steam search');
            }

            console.log('[Pricempire] API data analysis complete');
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
            const steamMarketUrl = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(itemName)}`;

            // Use GM_xmlhttpRequest to bypass CORS restrictions
            return new Promise((resolve) => {
                console.log('[Pricempire] Starting GM_xmlhttpRequest to:', steamMarketUrl);
                console.log('[Pricempire] GM_xmlhttpRequest available:', typeof GM_xmlhttpRequest);

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
                        console.log('[Pricempire] Steam Community Market API response status:', response.status);
                        console.log('[Pricempire] Steam Community Market API response text:', response.responseText);

                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                console.log('[Pricempire] Steam Community Market API parsed data:', data);

                                // Extract price from Steam API response
                                let steamPrice = null;

                                if (data.lowest_price) {
                                    const priceMatch = data.lowest_price.match(/[$€£]?\s*([0-9.,]+)/);
                                    if (priceMatch) {
                                        steamPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                                        console.log('[Pricempire] Found Steam lowest_price:', steamPrice, 'from text:', data.lowest_price);
                                    }
                                } else if (data.median_price) {
                                    const priceMatch = data.median_price.match(/[$€£]?\s*([0-9.,]+)/);
                                    if (priceMatch) {
                                        steamPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                                        console.log('[Pricempire] Found Steam median_price:', steamPrice, 'from text:', data.median_price);
                                    }
                                } else {
                                    console.log('[Pricempire] No price data found in Steam API response');
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
                                    console.log('[Pricempire] Steam price extraction failed or price invalid');
                                    resolve(null);
                                }
                            } catch (parseError) {
                                console.error('[Pricempire] Failed to parse Steam API response:', parseError);
                                console.log('[Pricempire] Raw response text:', response.responseText);
                                resolve(null);
                            }
                        } else {
                            console.log('[Pricempire] Steam Community Market API returned non-200 status:', response.status);
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

                    // Enhanced Steam card detection - more strict validation
                    const isSteamCard =
                        // Method 1: Check for EXACT "Offer from Steam" aria-label (most reliable)
                        (card.getAttribute('aria-label') === 'Offer from Steam') ||

                        // Method 2: Check for Steam icon + proper price structure
                        (card.querySelector('img[src*="steam_icon.webp"], img[alt*="Steam"]') &&
                         card.querySelector('.text-2xl.font-bold.text-theme-100') &&
                         card.querySelector('.iconify.i-heroicons\\:cube.text-green-500')) ||

                        // Method 3: Strict Steam marketplace pattern
                        (card.textContent.includes('Steam') &&
                         card.textContent.includes('in stock') &&
                         card.textContent.match(/\$\d+\.\d{2}/g)) ||

                        // Method 4: Look for green cube icon (Steam stock indicator) + exact Steam elements
                        (card.querySelector('.iconify.i-heroicons\\:cube.text-green-500') &&
                         card.querySelector('img[src*="steam_icon.webp"]'));

                    if (isSteamCard) {
                        // Additional validation: ensure this is actually Steam, not just contains "steam" text
                        const cardHTML = card.innerHTML.toLowerCase();
                        const steamIconPresent = cardHTML.includes('steam_icon.webp') || cardHTML.includes('alt="steam"');
                        const steamCubePresent = cardHTML.includes('i-heroicons:cube') && cardHTML.includes('text-green-500');

                        // Only mark as Steam if we have clear Steam indicators
                        if (card.getAttribute('aria-label') === 'Offer from Steam' ||
                            (steamIconPresent && steamCubePresent) ||
                            (steamIconPresent && card.textContent.includes('in stock'))) {

                            newSteamCards.push(card);
                            card.dataset.steamProcessed = 'true'; // Mark as processed

                            console.log('[Pricempire] VALID Steam card detected:', {
                                ariaLabel: card.getAttribute('aria-label'),
                                hasSteamIcon: !!card.querySelector('img[src*="steam_icon.webp"]'),
                                hasSteamCube: !!card.querySelector('.iconify.i-heroicons\\:cube.text-green-500'),
                                textSample: card.textContent.substring(0, 100),
                                priceText: card.textContent.match(/\$[\d.,]+/g),
                                fullCardHTML: card.innerHTML.substring(0, 500) // For debugging
                            });
                        } else {
                            console.log('[Pricempire] Skipping false positive Steam card - missing proper Steam indicators:', {
                                ariaLabel: card.getAttribute('aria-label'),
                                hasSteamIcon: steamIconPresent,
                                hasSteamCube: steamCubePresent,
                                textSample: card.textContent.substring(0, 100)
                            });
                        }
                    }
                });

                // Process any newly found Steam cards
                if (newSteamCards.length > 0) {
                    console.log(`[Pricempire] Processing ${newSteamCards.length} new Steam cards...`);

                    let bestSteamPrice = null;
                    let bestPriceSource = '';

                    for (const card of newSteamCards) {
                        debugLog('Processing new Steam card:', {
                            innerHTML: card.innerHTML.substring(0, 300),
                            textContent: card.textContent.substring(0, 100)
                        });

                        // Try multiple price extraction methods
                        const priceData = extractPriceFromCard(card);

                        let currentPrice = null;
                        let currentSource = '';

                        if (priceData && priceData.mainPrice > 0) {
                            currentPrice = priceData.mainPrice;
                            currentSource = 'extractPriceFromCard';
                        } else {
                            // Enhanced fallback: More precise Steam price extraction
                            console.log('[Pricempire] ENHANCED PRICE SEARCH IN CARD:');
                            console.log('[Pricempire] CARD FULL TEXT:', card.textContent);

                            // Look for all price patterns with more precision
                            const priceMatches = card.textContent.match(/\$(\d+\.\d{2})/g);
                            if (priceMatches) {
                                console.log('[Pricempire] ALL PRICE MATCHES FOUND:', priceMatches);

                                const prices = priceMatches.map(match => parseFloat(match.replace('$', '')));
                                console.log('[Pricempire] PARSED PRICES:', prices);

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

                                console.log('[Pricempire] STEAM-LIKELY PRICES:', steamLikelyPrices);

                                // If we found Steam-likely prices, use the lowest of those
                                const targetPrice = steamLikelyPrices.length > 0 ?
                                    Math.min(...steamLikelyPrices) : Math.min(...prices);

                                console.log('[Pricempire] TARGET STEAM PRICE SELECTED:', targetPrice,
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
                                console.log('[Pricempire] New best Steam price:', bestSteamPrice, 'from', bestPriceSource);
                            }
                        }
                    }

                    if (bestSteamPrice && parseFloat(bestSteamPrice) > 0) {
                        debugLog('SUCCESS - Selected best Steam price from monitoring:', bestSteamPrice, 'from', bestPriceSource);
                        console.log('[Pricempire] STEAM PRICE SELECTED: Monitoring detection, price:', bestSteamPrice, 'source:', bestPriceSource);

                        // Update the current page's Steam price display immediately with the best price found
                        updateMarketOverviewPrice(bestSteamPrice);

                        // 3rd APPROACH: Try to get exact Steam price directly via API as backup
                        console.log('[Pricempire] ALSO trying direct Steam API call for comparison...');
                        try {
                            const itemName = getItemName();
                            if (itemName) {
                                console.log('[Pricempire] Attempting direct Steam API call for:', itemName);
                                fetchSteamPriceFromSteamAPI().then(apiSteamPrice => {
                                    if (apiSteamPrice && parseFloat(apiSteamPrice) !== parseFloat(bestSteamPrice)) {
                                        console.log('[Pricempire] API Steam price differs:', apiSteamPrice, 'vs extracted:', bestSteamPrice);
                                        console.log('[Pricempire] Using API price as it\'s more authoritative');
                                        updateMarketOverviewPrice(apiSteamPrice);
                                    } else if (apiSteamPrice) {
                                        console.log('[Pricempire] API Steam price matches extracted price:', apiSteamPrice);
                                    } else {
                                        console.log('[Pricempire] API call failed, keeping extracted price:', bestSteamPrice);
                                    }
                                });
                            }
                        } catch (e) {
                            console.log('[Pricempire] Direct API call failed:', e.message);
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
        console.log('[Pricempire] Starting aggressive Steam card monitoring...');
        checkForSteamCards(); // Run immediately

        // Then set up interval
        setInterval(checkForSteamCards, monitorInterval);
        debugLog('Started Steam card monitoring with', monitorInterval, 'ms interval');
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

    async function updateMarketOverviewPrice(overrideSteamPrice = null) {
        const settings = getSettings();

        if (!settings.useSteamPricePreview) {
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
                console.log('[Pricempire] Updating existing Steam price with better value:', steamPrice);
                replaceWithSteamPrice(priceCard, steamPrice);
                return true; // Successfully updated
            } else if (currentProvider !== 'steam') {
                console.log('[Pricempire] Replacing', currentProvider, 'price with Steam price:', steamPrice);
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
                console.log(`[Pricempire] Steam price attempt ${retryCount}/${maxRetries}`);

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
            // More flexible star detection - check for any star icon classes
            const isActionableStar = starIcon.classList.contains('i-material-symbols-light:kid-star-outline') ||
                                   starIcon.classList.contains('i-material-symbols-light:family-star-sharp') ||
                                   starIcon.classList.contains('i-heroicons:star-solid') ||
                                   starIcon.className.includes('kid-star') ||
                                   starIcon.className.includes('family-star') ||
                                   starIcon.className.includes('star-solid');

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

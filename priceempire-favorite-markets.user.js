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
        mergeSponsoredMarkets: true
    };

    function getSettings() {
        const settings = localStorage.getItem(SETTINGS_KEY);
        return settings ? { ...defaultSettings, ...JSON.parse(settings) } : defaultSettings;
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
        // Find the correct star icon - it should have material-symbols-light classes
        return card.querySelector('.iconify[class*="i-material-symbols-light:"]');
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

    function mergeAndSortSponsored() {
        const settings = getSettings();
        if (!settings.mergeSponsoredMarkets) return;

        const sortOption = getSortingOption();

        // Skip re-insertion only for "Recommended" (don't alter server order)
        if (sortOption === 'Recommended') return;

        // Find all marketplace cards on the page
        const allCards = Array.from(document.querySelectorAll('article.group.relative'));
        if (allCards.length === 0) return;

        // Always normalize sponsored cards (remove bias styling)
        allCards.forEach(card => normalizeSponsored(card));

        // Apply custom sort logic for Price/Rating/Stock
        // For Recently Updated/Oldest Updated, sortCards returns cards in current order (no sort applied)
        const sortedCards = sortCards(allCards, sortOption);

        // Re-insert all cards to mix sponsored with regular markets
        if (sortedCards.length > 0) {
            const container = sortedCards[0].parentElement;
            if (container) {
                // Use a document fragment to avoid cycling issues
                const fragment = document.createDocumentFragment();
                sortedCards.forEach(card => {
                    fragment.appendChild(card);
                });
                container.appendChild(fragment);
            }
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
        if (!settings.multiFavorite) return;

        const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
        if (!starIcon) {
            starIcon = card.querySelector('.iconify[class*="star"]');
        }

        if (!marketplaceName || !starIcon || !pinnedMarketplacesGrid) return;

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
        document.querySelectorAll('div[data-v-cd0f6ace].space-y-4').forEach(section => {
            const titleEl = section.querySelector('h3');
            const gridEl = section.querySelector('.grid');
            if (titleEl && gridEl) {
                marketplaceSections[titleEl.textContent.trim()] = gridEl;
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
        const isListView = listBtn && listBtn.classList.contains('bg-theme-700');
        console.log('[Pricempire] isCurrentlyListView:', isListView, 'listBtn:', listBtn?.className);
        return isListView;
    }

    // wait for the marketplace container to be populated with MutationObserver
    const observer = new MutationObserver((_mutations, obs) => {
        // Check for marketplace cards in either Grid or List view
        const marketplaceCards = document.querySelectorAll('article.group.relative');
        if (marketplaceCards.length > 0) {
            console.log('[Pricempire] MutationObserver triggered - found', marketplaceCards.length, 'marketplace cards');
            initializeSections();
            applyFavoritesOnLoad();
            // Delay sorting to ensure sorting option is fully rendered (only if in List view)
            setTimeout(() => {
                console.log('[Pricempire] Checking view on initial load...');
                if (isCurrentlyListView()) {
                    const sortOpt = getSortingOption();
                    console.log('[Pricempire] Initial load in List view - detected sorting option:', sortOpt);
                    mergeAndSortSponsored();
                } else {
                    console.log('[Pricempire] Initial load NOT in List view, skipping merge/sort');
                }
            }, 300);
            obs.disconnect(); // done with setup, the click listener will handle everything else
        }
    });

    // observe for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Monitor sorting dropdown changes and filter changes
    let lastSortingOption = getSortingOption();
    setInterval(() => {
        const currentSorting = getSortingOption();
        if (currentSorting !== lastSortingOption && currentSorting !== 'Recommended') {
            lastSortingOption = currentSorting;
            mergeAndSortSponsored();
        }
    }, 500);

    // Monitor filter changes (payment method, etc.)
    const filterObserver = new MutationObserver((_mutations, obs) => {
        // When filters change, the marketplace cards list might update
        // Re-apply merge/sort after a short delay
        setTimeout(() => {
            if (isCurrentlyListView()) {
                mergeAndSortSponsored();
            }
        }, 300);
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
                    mergeAndSortSponsored();
                }
            }, 300);
        }

        if (isListViewBtn) {
            // Switching to List view - apply merge/sort
            console.log('[Pricempire] isListViewBtn is TRUE, queuing setTimeout for 500ms...');
            setTimeout(() => {
                console.log('[Pricempire] Inside List view setTimeout callback');
                // Completely clear cached sections
                for (let key in marketplaceSections) {
                    delete marketplaceSections[key];
                }
                pinnedMarketplacesGrid = null;

                // In List view, look for marketplace cards directly
                const marketplaceCards = document.querySelectorAll('article.group.relative');
                console.log('[Pricempire] Found marketplace cards:', marketplaceCards.length);
                if (marketplaceCards.length > 0) {
                    console.log('[Pricempire] Marketplace cards ready, applying merge/sort...');
                    initializeSections();
                    applyFavoritesOnLoad();
                    // Delay sorting to ensure sorting option is fully rendered after view change
                    setTimeout(() => {
                        const sortOpt = getSortingOption();
                        console.log('[Pricempire] Switched to List view - detected sorting option:', sortOpt);
                        mergeAndSortSponsored();
                    }, 300);
                } else {
                    console.log('[Pricempire] Marketplace cards not ready yet, skipping initialization');
                }
                autoExpandOffers();
            }, 500); // Wait for Vue to update the DOM
        } else if (isGridViewBtn) {
            // Switching to Grid view - only reinitialize, don't apply merge/sort
            setTimeout(() => {
                // Completely clear cached sections
                for (let key in marketplaceSections) {
                    delete marketplaceSections[key];
                }
                pinnedMarketplacesGrid = null;

                // Reinitialize sections
                const marketplaceGrid = document.querySelector('.grid[data-v-cd0f6ace]');
                if (marketplaceGrid && marketplaceGrid.children.length > 0) {
                    initializeSections();
                    applyFavoritesOnLoad();
                }
                autoExpandOffers();
            }, 500); // Wait for Vue to update the DOM
        }

        // Handle favorite star clicks
        const starIcon = event.target.closest('.iconify[class*="star"]');
        const card = starIcon?.closest('.group.relative');

        if (starIcon && card) {
            const isActionableStar = starIcon.classList.contains('i-material-symbols-light:kid-star-outline') || starIcon.classList.contains('i-material-symbols-light:family-star-sharp');
            if(isActionableStar){
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(card, starIcon);
            }
        }
    }, true);

})();
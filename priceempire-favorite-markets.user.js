// ==UserScript==
// @name         Pricempire Multi-Favorite
// @namespace    http://tampermonkey.net/
// @version      1.0   
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
    let pinnedMarketplacesGrid = null;
    const marketplaceSections = {}; //Cache for marketplace grid elements

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

    function updateStarIcon(starIcon, isFavorite) {
        if (!starIcon) return;
        const isUnfavoritedIcon = starIcon.classList.contains('i-material-symbols-light:kid-star-outline');

        if (isFavorite && isUnfavoritedIcon) {
            starIcon.classList.replace('i-material-symbols-light:kid-star-outline', 'i-material-symbols-light:family-star-sharp');
            starIcon.classList.add('text-yellow-500');
        } else if (!isFavorite && !isUnfavoritedIcon) {
            starIcon.classList.replace('i-material-symbols-light:family-star-sharp', 'i-material-symbols-light:kid-star-outline');
            starIcon.classList.remove('text-yellow-500');
        }
    }

    function toggleFavorite(card) {
        const marketplaceName = card.querySelector('a.font-semibold')?.textContent.trim() || card.querySelector('img')?.alt;
        const starIcon = card.querySelector('.iconify[class*="star"]');

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
                mainContainer.prepend(newPinnedSection);
                pinnedMarketplacesGrid = newPinnedSection.querySelector('.grid');
                marketplaceSections['Pinned Marketplaces'] = pinnedMarketplacesGrid;
            }
        }
    }



    // this moves favorited items to the pinned section on initial load
    function applyFavoritesOnLoad() {
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
                            const starIcon = card.querySelector('.iconify[class*="star"]');
                            updateStarIcon(starIcon, false);
                        }
                    } else {
                        // Add to client favorites if not already there
                        if (marketplaceName && !favorites.includes(marketplaceName)) {
                            favorites.push(marketplaceName);
                            favoritesUpdated = true;
                        }
                        const starIcon = card.querySelector('.iconify[class*="star"]');
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

                    const starIcon = card.querySelector('.iconify[class*="star"]');
                    updateStarIcon(starIcon, true);
                }
             });
        });

        if (favoritesUpdated) {
            saveFavorites(favorites);
        }
    }

    // Main Execution is heeeeere

    // wait for the marketplace container to be populated with MutationObserver
    const observer = new MutationObserver((mutations, obs) => {
        const marketplaceGrid = document.querySelector('.grid[data-v-cd0f6ace]');
        if (marketplaceGrid && marketplaceGrid.children.length > 0) {
            initializeSections();
            applyFavoritesOnLoad();
            obs.disconnect(); // done with setup, the click listener will handle everything else
        }
    });

    // observe for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    document.body.addEventListener('click', function(event) {
        const starIcon = event.target.closest('.iconify[class*="star"]');
        const card = starIcon?.closest('.group.relative');

        
        if (starIcon && card) {
            const isActionableStar = starIcon.classList.contains('i-material-symbols-light:kid-star-outline') || starIcon.classList.contains('i-material-symbols-light:family-star-sharp');
            if(isActionableStar){
                event.preventDefault();
                event.stopPropagation();
                toggleFavorite(card);
            }
        }
    }, true);

})();
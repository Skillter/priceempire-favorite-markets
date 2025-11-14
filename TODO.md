# TODO: Priceempire Multi-Favorite Marketplaces Userscript

## Medium Priority Issues

### Steam Price Preview Filter Bug
**Problem**: When payment methods filter out Steam from marketplace offers, or if Steam is hidden behind "Show X More Offers", the Steam Price Preview feature fails because it can't find Steam price data and falls back to Skins.com pricing.

**Root Cause**: The script searches for Steam marketplace cards among the visible offers, but when Steam is filtered out by payment method selection, no Steam cards exist in the DOM to extract price data from.

**Solution Needed**: Implement alternative Steam price detection methods that don't rely on visible Steam cards:

- [ ] Use Nuxt.js data structures to find Steam price directly
- [ ] Fallback to Steam API when local data isn't available
- [ ] Cache Steam prices from previous page loads
- [ ] Implement Steam price search in filtered results
- [ ] Consider Steam Community Market API as backup source

**Impact**: Users see incorrect Skins.com pricing instead of Steam prices when the bug requirements are met

---
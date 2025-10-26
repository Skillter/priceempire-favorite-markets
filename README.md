# Pricempire Multi-Favorite Marketplaces

Pricempire only lets you favorite one marketplace at a time, which is annoying if you compare prices across multiple platforms. This userscript removes that limitation by letting you pin as many marketplaces as you want. Just click the star icons to create your own "Pinned Marketplaces" section that persists across sessions.

## Installation

### Step 1: Install Tampermonkey

This userscript requires a userscript manager to run. We recommend Tampermonkey, which is available for all major browsers:

- **Chrome**: [Install from Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Firefox**: [Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- **Edge, Safari, Opera**: Also supported via their respective extension stores

### Step 2: Install the Userscript

**The Easy Way:**

Simply click this link after installing Tampermonkey: [Install Pricempire Multi-Favorite](https://github.com/Skillter/priceempire-favorite-markets/raw/refs/heads/master/priceempire-favorite-markets.user.js)

Tampermonkey will automatically detect the userscript and prompt you to install it.

**The Manual Way:**

1. Click on the Tampermonkey icon in your browser toolbar
2. Select "Create a new script"
3. Delete the default template code
4. Copy and paste the entire contents of `priceempire-favorite-markets.user.js` from this repository
5. Press Ctrl+S (or Cmd+S on Mac) to save
6. Navigate to any Pricempire CS2 item page to see the script in action

## Browser Compatibility

Works on all modern browsers that support ES6+ JavaScript and localStorage. Tested on Chrome, Firefox, and Edge.

## Contributing

Found a bug or have a feature request? Feel free to open an issue or submit a pull request. All contributions are welcome.

## Support This Project

If this userscript saves you time and makes browsing Pricempire more convenient, please consider starring this repository. It helps others discover the tool and motivates continued development.

## License

This project is open source and available for personal use. Feel free to modify it for your own needs.

## How It Works

The script uses a MutationObserver to detect when Pricempire loads marketplace cards. It then creates or identifies a "Pinned Marketplaces" section and populates it based on your saved preferences.

Two localStorage keys manage the state:

- `pricempire_multi_favorites`: Stores all favorited marketplace names
- `pricempire_server_unfavorited`: Tracks server-favorited items you've manually unfavorited

When you reload the page, the script checks both lists to determine which marketplaces should appear in the pinned section and which should remain in their original locations.

---

**Note**: This is an unofficial userscript and is not affiliated with or endorsed by Pricempire.com.

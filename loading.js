// loading.js

// Determine the minimum loader display time based on the referrer
let MINIMUM_LOADER_DISPLAY_TIME_MS;
const referrer = document.referrer.toLowerCase(); // Get referrer and convert to lowercase for case-insensitive check

if (referrer.includes("your_clubs")) {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 1750; // If coming from a page with "your_clubs" in its URL
    console.log(`Coming from 'your_clubs', setting minimum loader display time to ${MINIMUM_LOADER_DISPLAY_TIME_MS}ms.`);
} else {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 750; // Otherwise, use 750ms
    console.log(`Not coming from 'your_clubs', setting minimum loader display time to ${MINIMUM_LOADER_DISPLAY_TIME_MS}ms.`);
}


let loadCompleted = false; // Flag to track if window.onload has fired
let minTimePassed = false; // Flag to track if the minimum display time has passed

// Initial action: Disable scrolling on the body as soon as this script executes
// (which is very early, ideally before any content is visible)
document.body.classList.add('no-scroll');
console.log("Scrolling disabled on body.");


// Function to check if both conditions are met to hide the loader
function attemptHideLoadingScreen() {
    if (loadCompleted && minTimePassed) {
        const overlay = document.getElementById('loading-overlay');
        const content = document.getElementById('content'); // Your main app content div

        if (overlay) {
            overlay.classList.add('hidden'); // Add the 'hidden' class to fade out/hide
            // Optional: Remove the overlay from DOM completely after transition ends
            overlay.addEventListener('transitionend', () => {
                // Ensure it's truly hidden before removing to avoid flickering
                if (overlay.classList.contains('hidden')) {
                    overlay.style.display = 'none'; // Set display:none after fade
                    document.body.classList.remove('no-scroll'); // Re-enable scrolling HERE
                    console.log("Scrolling re-enabled on body.");
                }
            }, { once: true });
        } else {
            // If overlay wasn't found, ensure scrolling is re-enabled as a fallback
            document.body.classList.remove('no-scroll');
            console.log("Loading overlay not found, re-enabling scrolling as fallback.");
        }

        if (content) {
            content.style.display = 'block'; // Show the main content
        }
        console.log("Loading screen hidden. Main content displayed.");
    }
}

// 1. Set a timeout for the minimum display time
// This will set 'minTimePassed' to true after the determined duration.
setTimeout(() => {
    minTimePassed = true;
    console.log(`Minimum display time of ${MINIMUM_LOADER_DISPLAY_TIME_MS}ms passed.`);
    attemptHideLoadingScreen(); // Attempt to hide the loader
}, MINIMUM_LOADER_DISPLAY_TIME_MS);

// 2. Add a listener for the window's 'load' event
// This will set 'loadCompleted' to true once ALL resources (images, scripts, etc.) are loaded.
window.addEventListener('load', () => {
    loadCompleted = true;
    console.log("window.onload event fired.");
    attemptHideLoadingScreen(); // Attempt to hide the loader
});

// Export a function to show the loading screen manually, if ever needed
// (e.g., for SPA navigation or specific asynchronous tasks)
export function showLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.remove('hidden'); // Make it visible
        overlay.style.display = 'flex'; // Ensure display is flex if it was set to none previously
        document.body.classList.add('no-scroll'); // Re-disable scrolling if showing manually
        console.log("Manually showing loader, scrolling disabled.");
    }
    if (content) {
        content.style.display = 'none'; // Hide content if re-showing loader
    }
}
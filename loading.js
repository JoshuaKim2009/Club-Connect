// loading.js

const MINIMUM_LOADER_DISPLAY_TIME_MS = 1750;

let loadCompleted = false; // Flag to track if window.onload has fired
let minTimePassed = false; // Flag to track if the minimum display time has passed

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
                }
            }, { once: true });
        }
        if (content) {
            content.style.display = 'block'; // Show the main content
        }
        console.log("Loading screen hidden. Main content displayed.");
    }
}

// 1. Set a timeout for the minimum display time (500ms)
// This will set 'minTimePassed' to true after the specified duration.
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
    }
    if (content) {
        content.style.display = 'none'; // Hide content if re-showing loader
    }
    // If you intend to use this for multi-stage loading, you'd need to
    // reset 'loadCompleted' and 'minTimePassed' and potentially restart timers.
    // For a simple initial page load, this export is mostly for completeness.
}

// The hideLoadingScreen export from previous versions is not needed here
// as 'attemptHideLoadingScreen' handles the logic internally based on flags.

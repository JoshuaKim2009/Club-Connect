// loading.js

// Determine the minimum loader display time based on the referrer
let MINIMUM_LOADER_DISPLAY_TIME_MS;
const referrer = document.referrer.toLowerCase();

if (referrer.includes("your_clubs")) {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 1750;
    console.log(`[LOADING SCRIPT] Coming from 'your_clubs', setting minimum loader display time to ${MINIMUM_LOADER_DISPLAY_TIME_MS}ms.`);
} else {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 100;
    console.log(`[LOADING SCRIPT] Not coming from 'your_clubs', setting minimum loader display time to ${MINIMUM_LOADER_DISPLAY_TIME_MS}ms.`);
}


let loadCompleted = false;
let minTimePassed = false;

// Initial action: Disable scrolling on the body as soon as this script executes
document.body.classList.add('no-scroll');
console.log("[LOADING SCRIPT] Scrolling disabled on body.");


function revealContentStaggered() {
    const contentItems = document.querySelectorAll('#content > *');
    const STAGGER_DELAY_MS = 100;

    if (contentItems.length > 0) {
        console.log(`[LOADING SCRIPT] Initiating staggered reveal for ${contentItems.length} direct children of #content.`);
        contentItems.forEach((item, index) => {
            setTimeout(() => {
                item.classList.add('revealed-child');
            }, index * STAGGER_DELAY_MS);
        });
    } else {
        console.warn("[LOADING SCRIPT] No direct children found inside #content for staggered reveal.");
    }
}


function attemptHideLoadingScreen() {
    console.log(`[LOADING SCRIPT] Attempting to hide loader. loadCompleted: ${loadCompleted}, minTimePassed: ${minTimePassed}`);

    if (loadCompleted && minTimePassed) {
        const overlay = document.getElementById('loading-overlay');
        const content = document.getElementById('content');

        if (overlay) {
            console.log("[LOADING SCRIPT] Overlay found. Adding 'hidden' class to overlay, and removing 'no-scroll' from body.");
            overlay.classList.add('hidden'); // Start the fade-out transition

            // *** CRUCIAL CHANGE HERE: Remove no-scroll from body immediately ***
            document.body.classList.remove('no-scroll');
            console.log("[LOADING SCRIPT] Scrolling re-enabled on body (simultaneously with fade-out start).");

            // Only set display:none AFTER the transition is visually complete
            // This ensures it doesn't block clicks even after opacity 0.
            overlay.addEventListener('transitionend', () => {
                if (overlay.classList.contains('hidden')) { // Check if it's actually hidden
                    overlay.style.display = 'none';
                    console.log("[LOADING SCRIPT] Overlay display set to 'none' after transitionend.");
                }
            }, { once: true });

        } else {
            console.error("[LOADING SCRIPT] ERROR: #loading-overlay element not found!");
            // Fallback: re-enable immediately if overlay not found
            document.body.classList.remove('no-scroll');
            console.log("[LOADING SCRIPT] Loading overlay not found, re-enabling scrolling as fallback.");
        }

        if (content) {
            console.log("[LOADING SCRIPT] Content container found. Setting #content to display:block.");
            content.style.display = 'block'; // Make the #content container visible
            revealContentStaggered(); // Start the staggered reveal for its children
        } else {
            console.error("[LOADING SCRIPT] ERROR: #content element not found!");
        }

        console.log("[LOADING SCRIPT] Main loader logic completed.");
    } else {
        console.log("[LOADING SCRIPT] Conditions not yet met to hide loader.");
    }
}

setTimeout(() => {
    minTimePassed = true;
    console.log(`[LOADING SCRIPT] Minimum display time (${MINIMUM_LOADER_DISPLAY_TIME_MS}ms) passed.`);
    attemptHideLoadingScreen();
}, MINIMUM_LOADER_DISPLAY_TIME_MS);

window.addEventListener('load', () => {
    loadCompleted = true;
    console.log("[LOADING SCRIPT] window.onload event fired.");
    attemptHideLoadingScreen();
});

export function showLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        document.body.classList.add('no-scroll');
        console.log("[LOADING SCRIPT] Manually showing loader, scrolling disabled.");
    }
    if (content) {
        content.style.display = 'none';
    }
}

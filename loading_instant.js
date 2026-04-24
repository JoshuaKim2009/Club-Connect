let MINIMUM_LOADER_DISPLAY_TIME_MS;
const referrer = document.referrer.toLowerCase();

if (referrer.includes("your_clubs")) {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 1750;
} else {
    MINIMUM_LOADER_DISPLAY_TIME_MS = 500;
}

let loadCompleted = false;
let minTimePassed = false;

document.body.classList.add('no-scroll');

function revealContentStaggered() {
    const contentItems = document.querySelectorAll('#content > *');
    // No stagger — add 'revealed-child' to everything at once
    contentItems.forEach((item) => {
        item.classList.add('revealed-child');
    });
}

function attemptHideLoadingScreen() {
    if (minTimePassed) {
        const overlay = document.getElementById('loading-overlay');
        const content = document.getElementById('content');

        if (overlay) {
            overlay.classList.add('hidden');
            document.body.classList.remove('no-scroll');
            overlay.addEventListener('transitionend', () => {
                if (overlay.classList.contains('hidden')) {
                    overlay.style.display = 'none';
                }
            }, { once: true });
        } else {
            document.body.classList.remove('no-scroll');
        }

        if (content) {
            content.style.display = 'block';
            revealContentStaggered();
        }
    }
}

setTimeout(() => {
    minTimePassed = true;
    attemptHideLoadingScreen();
}, MINIMUM_LOADER_DISPLAY_TIME_MS);

window.addEventListener('load', () => {
    loadCompleted = true;
    attemptHideLoadingScreen();
});

export function showLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        document.body.classList.add('no-scroll');
    }
    if (content) {
        content.style.display = 'none';
    }
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection, query, orderBy, where, limit, getDocs, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

import { showAppAlert } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';
import { handleUserSwitch } from './auth-guard.js';
import { cacheRole } from './roleCache.js';

const firebaseConfig = {
	apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
	authDomain: "club-connect-data.firebaseapp.com",
	projectId: "club-connect-data",
	storageBucket: "club-connect-data.firebasestorage.app",
	messagingSenderId: "903230180616",
	appId: "1:903230180616:web:a13856c505770bcc0b30bd",
	measurementId: "G-B8DR377JX6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');
const closestEventDisplay = document.getElementById('closestEventDisplay');

const overviewSection = document.getElementById('adminActionsSection');
const overviewRow = overviewSection.querySelector('.button-row-2');
const linksButton = document.getElementById('links-button');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

const clubId = getUrlParameter('id') || getUrlParameter('clubId');

let myUid = "";
let myRole = null;
let pageInitialized = false;
let loadingScreenHidden = false;

let cachedMemberData = null;
let clubMemberUIDsSet = null;
let pendingRequestCount = 0;
let stopClubListener = null;

document.body.classList.add('no-scroll');


function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isAdminRole(role) {
    return role === 'manager' || role === 'admin';
}

// Local calendar day, not UTC.
function localDateString(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;

    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');

    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    } else {
        document.body.classList.remove('no-scroll');
    }

    if (content) {
        content.style.display = 'block';
        Array.from(content.querySelectorAll(':scope > *')).forEach((item, i) => {
            setTimeout(() => item.classList.add('revealed-child'), i * 150);
        });
    }
}

function showContainerError(message, showRetry = false, topMargin = '165px') {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
        <div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}


// Every button that just goes somewhere else with the club id attached.
document.querySelectorAll('[data-page]').forEach((button) => {
    if (button.id === 'collaborationsButton') return;
    button.addEventListener('click', () => {
        window.location.href = `${button.dataset.page}?clubId=${clubId}`;
    });
});

// Temporary: collaborations isn't built yet, just show a heads-up instead of navigating.
document.getElementById('collaborationsButton')?.addEventListener('click', () => {
    showAppAlert("Collaborations are coming soon!");
});


onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    if (pageInitialized) return;
    pageInitialized = true;

    myUid = user.uid;

    if (!clubId) {
        hideLoadingScreen();
        showContainerError("No club ID provided.");
        return;
    }

    clubPageTitle.textContent = "";

    // The event lookup only needs the club id, and it's the slowest thing on the page, so let it run while reading the club and member docs.
    const eventLookup = loadNextEvent(clubId);

    try {
        const [clubSnap, memberSnap] = await Promise.all([
            getDoc(doc(db, "clubs", clubId)),
            getDoc(doc(db, "clubs", clubId, "members", myUid))
        ]);

        if (!clubSnap.exists()) {
            hideLoadingScreen();
            showContainerError("This club doesn't exist.");
            return;
        }

        if (!memberSnap.exists()) {
            cacheRole(clubId, myUid, null);
            hideLoadingScreen();
            showContainerError("You're not a member of this club.");
            return;
        }

        cachedMemberData = memberSnap.data();

        renderClubHeader(clubSnap.data());
        applyRole(cachedMemberData.role || 'member');

        renderNextEvent(await eventLookup, true);
        hideLoadingScreen();

        setupUnreadTrackers(clubId);
        await Promise.all(unreadTrackers.map(t => t.resync()));
        unreadTrackers.forEach(t => t.listen());

        listenToOwnMemberDoc();
        listenToDirectMessages();

    } catch (error) {
        hideLoadingScreen();
        console.error("Error loading club page:", error);
        showContainerError("Oops! Something went wrong.", true);
    }
});


function renderClubHeader(clubData) {
    clubMemberUIDsSet = new Set(clubData.memberUIDs || []);
    pendingRequestCount = (clubData.pendingMemberUIDs || []).length;

    clubPageTitle.textContent = clubData.clubName || 'Unnamed Club';
    clubDetailsDiv.innerHTML = `
        <div class="club-info-container">
            <p>Join Code <button id="copyJoinCodeButton" class="copy-button">${escapeHtml(clubData.joinCode || 'N/A')}</button></p>
        </div>
    `;

    const copyButton = document.getElementById('copyJoinCodeButton');
    if (copyButton && clubData.joinCode) {
        copyButton.addEventListener('click', () => copyToClipboard(clubData.joinCode, copyButton));
    }
}

// Swaps the page between the member and manager layouts and turns the manager-only club listener on or off.
function applyRole(role) {
    myRole = role;
    cacheRole(clubId, myUid, role);

    const admin = isAdminRole(role);
    document.body.classList.toggle('is-admin', admin);
    document.body.classList.toggle('is-member', !admin);

    if (admin) {
        linksButton.textContent = 'CLUB LINKS';
        if (linksButton.parentElement !== overviewSection) overviewSection.appendChild(linksButton);

        showBadge('pendingRequestsBadge', pendingRequestCount);
        watchClubDoc();
    } else {
        linksButton.textContent = 'LINKS';
        if (linksButton.parentElement !== overviewRow) overviewRow.appendChild(linksButton);

        unwatchClubDoc();
    }
}

async function copyToClipboard(originalCode, buttonElement) {
    try {
        await navigator.clipboard.writeText(originalCode);

        const originalButtonText = buttonElement.textContent;
        buttonElement.textContent = ' Copied! ';
        buttonElement.disabled = true;

        setTimeout(() => {
            buttonElement.textContent = originalButtonText;
            buttonElement.disabled = false;
        }, 850);

    } catch (err) {
        console.error('Failed to copy text:', err);
        await showAppAlert('Failed to copy Join Code. Please copy it manually: ' + originalCode);
    }
}


function formatTime(timeString) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes);
        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.error("Error formatting time:", e);
        return timeString;
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    try {
        return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, options);
    } catch (e) {
        console.error("Error formatting date:", e);
        return dateString;
    }
}

function createNoEventsCardHtml(message = "No upcoming events scheduled.") {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card animate-in';
    cardDiv.innerHTML = `
        <p class="fancy-black-label">${message}</p>
    `;
    return cardDiv;
}


async function loadNextEvent(currentClubId) {
    const eventsRef = collection(db, "clubs", currentClubId, "events");

    try {
        const today = localDateString(new Date());

        const [oneTimeSnapshot, weeklySnapshot] = await Promise.all([
            getDocs(query(eventsRef, where("isWeekly", "==", false), where("eventDate", ">=", today))),
            getDocs(query(eventsRef, where("isWeekly", "==", true), where("weeklyEndDate", ">=", today)))
        ]);

        const now = Date.now();
        const hasNotEnded = (dateString, eventData) =>
            new Date(`${dateString}T${eventData.endTime}`).getTime() > now;

        let occurrences = [];

        oneTimeSnapshot.forEach(docSnap => {
            const eventData = docSnap.data();
            const exceptions = eventData.exceptions || [];
            if (!exceptions.includes(eventData.eventDate)) {
                occurrences.push({
                    eventData,
                    date: eventData.eventDate,
                    originalEventId: docSnap.id
                });
            }
        });

        weeklySnapshot.forEach(docSnap => {
            const eventData = docSnap.data();
            const exceptions = eventData.exceptions || [];
            const daysToMatch = (eventData.daysOfWeek || []).map(day => dayNamesMap.indexOf(day));

            // No point walking the calendar from the series start date if that was months ago, nothing before today can win.
            const startMs = Date.parse(eventData.weeklyStartDate + 'T00:00:00Z');
            const todayMs = Date.parse(today + 'T00:00:00Z');
            const endMs = Date.parse(eventData.weeklyEndDate + 'T00:00:00Z');

            const cursor = new Date(Math.max(startMs, todayMs));
            while (cursor.getTime() <= endMs) {
                const dateString = cursor.toISOString().split('T')[0];

                if (daysToMatch.includes(cursor.getUTCDay()) && !exceptions.includes(dateString)) {
                    occurrences.push({ eventData, date: dateString, originalEventId: docSnap.id });
                    if (hasNotEnded(dateString, eventData)) break;
                }
                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
        });

        occurrences = occurrences.filter(o => hasNotEnded(o.date, o.eventData));

        occurrences.sort((a, b) => {
            const startA = new Date(`${a.date}T${a.eventData.startTime}`).getTime();
            const startB = new Date(`${b.date}T${b.eventData.startTime}`).getTime();
            return startA - startB;
        });

        return { occurrence: occurrences[0] || null };

    } catch (error) {
        console.error("Error fetching event:", error);
        return { failed: true };
    }
}

function renderNextEvent(result, animateCard) {
    if (!closestEventDisplay) return;

    closestEventDisplay.innerHTML = '';

    if (result.failed) {
        closestEventDisplay.style.display = '';
        const errorCard = createNoEventsCardHtml("Error loading event. Please try again.");
        closestEventDisplay.appendChild(errorCard);
        revealEventCard(errorCard, animateCard);
        return;
    }

    const nextEvent = result.occurrence;

    if (!nextEvent) {
        console.log("No events found at all.");
        closestEventDisplay.style.display = 'none';
        return;
    }

    console.log("There is an event scheduled:", nextEvent.eventData.eventName, "on", nextEvent.date, "at", nextEvent.eventData.startTime);

    const card = document.createElement('div');
    card.className = 'event-card';
    if (animateCard) card.classList.add('animate-in');

    const formattedDate = formatDate(nextEvent.date);
    const formattedStartTime = formatTime(nextEvent.eventData.startTime);
    const formattedEndTime = formatTime(nextEvent.eventData.endTime);

    card.innerHTML = `
        <div class="event-card-header">
            <h3 class="event-card-title">${escapeHtml(nextEvent.eventData.eventName)}</h3>
        </div>

        <div class="event-date-strip">
            <i class="fa-regular fa-calendar"></i>
            ${formattedDate}
        </div>

        <div class="event-date-strip-divider"></div>

        <div class="event-card-body">
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-regular fa-clock"></i></span>
                <span class="einfo-text">${formattedStartTime} – ${formattedEndTime}</span>
            </div>

            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-solid fa-location-dot"></i></span>
                <span class="einfo-text">${escapeHtml(nextEvent.eventData.address)}</span>
            </div>

            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-solid fa-thumbtack"></i></span>
                <span class="einfo-text">${escapeHtml(nextEvent.eventData.location)}</span>
            </div>

            ${nextEvent.eventData.notes ? `
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-regular fa-pen-to-square"></i></span>
                <span class="einfo-text">${escapeHtml(nextEvent.eventData.notes)}</span>
            </div>` : ''}
        </div>
    `;

    closestEventDisplay.style.display = '';
    closestEventDisplay.appendChild(card);
    revealEventCard(card, animateCard);
}

function revealEventCard(card, animateCard) {
    if (animateCard) {
        setTimeout(() => card.classList.add('is-visible'), 10);
    } else {
        card.classList.add('is-visible');
    }
}


function showBadge(badgeId, count) {
    const badgeElement = document.getElementById(badgeId);
    if (!badgeElement) return;

    if (count > 0) {
        badgeElement.textContent = count;
        badgeElement.style.display = 'flex';
        requestAnimationFrame(() => badgeElement.classList.add('badge-visible'));
    } else {
        badgeElement.style.display = 'none';
        badgeElement.classList.remove('badge-visible');
    }
}


// Managers/admins only: the club doc carries the join request count, and a fresh member list for filtering DM notifications.
function watchClubDoc() {
    if (stopClubListener) return;
    stopClubListener = onSnapshot(doc(db, "clubs", clubId), (docSnap) => {
        if (!docSnap.exists()) return;
        const clubData = docSnap.data();
        clubMemberUIDsSet = new Set(clubData.memberUIDs || []);
        pendingRequestCount = (clubData.pendingMemberUIDs || []).length;
        showBadge('pendingRequestsBadge', pendingRequestCount);
    }, (error) => console.error("Error listening to club document:", error));
}

function unwatchClubDoc() {
    if (!stopClubListener) return;
    stopClubListener();
    stopClubListener = null;
    pendingRequestCount = 0;
    showBadge('pendingRequestsBadge', 0);
}


function stampMillis(memberData, cutoffField) {
    if (!memberData) return 0;
    const stamp = memberData[cutoffField] || memberData.joinedAt;
    return stamp && stamp.toMillis ? stamp.toMillis() : 0;
}

function listenToOwnMemberDoc() {
    onSnapshot(doc(db, "clubs", clubId, "members", myUid), async (memberSnap) => {
        if (!memberSnap.exists()) {
            cacheRole(clubId, myUid, null);
            hideLoadingScreen();
            showContainerError("You're no longer a member of this club.");
            return;
        }

        const previous = cachedMemberData;
        const data = memberSnap.data();
        cachedMemberData = data;

        unreadTrackers.forEach(tracker => {
            if (stampMillis(previous, tracker.cutoffField) !== stampMillis(data, tracker.cutoffField)) {
                tracker.resync();
            }
        });

        const role = data.role || 'member';
        if (role === myRole) return;

        console.log("Own role changed:", myRole, "->", role);
        await showAppAlert(`Your role for this club has been updated to ${getRoleLabel(role)}!`);
        applyRole(role);
    }, (error) => console.error("Error listening to own member doc:", error));
}


function listenToDirectMessages() {
    const q = query(
        collection(db, 'directMessages'),
        where('participants', 'array-contains', myUid)
    );

    onSnapshot(q, (snapshot) => {
        let totalUnread = 0;
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.lastMessageText) return;
            const otherUid = data.participants.find(uid => uid !== myUid);
            if (clubMemberUIDsSet && !clubMemberUIDsSet.has(otherUid)) return;
            totalUnread += data.unreadCounts?.[myUid] || 0;
        });
        showBadge('unreadDirectMessagesBadge', totalUnread);
    }, (error) => console.error("Error listening to direct messages:", error));
}


const unreadTrackers = [];

function createUnreadTracker({ collectionPath, cutoffField, render }) {
    const ref = collection(db, ...collectionPath);
    let count = 0;
    let primed = false;
    let newestSeenMs = 0;

    function cutoff() {
        if (!cachedMemberData) return null;
        return cachedMemberData[cutoffField] || cachedMemberData.joinedAt || null;
    }

    async function resync() {
        const at = cutoff();
        if (!at) { count = 0; render(0); return; }
        try {
            const snap = await getCountFromServer(query(
                ref,
                where("createdAt", ">", at),
                where("createdByUid", "!=", myUid)
            ));
            count = snap.data().count;
            render(count);
        } catch (error) {
            console.error(`Error counting ${collectionPath.join('/')}:`, error);
        }
    }

    function listen() {
        onSnapshot(query(ref, orderBy("createdAt", "desc"), limit(1)), (snap) => {
            const at = cutoff();
            let sawRemoval = false;

            snap.docChanges().forEach(change => {
                if (change.type === 'removed') { sawRemoval = true; return; }
                if (change.type !== 'added') return;

                const d = change.doc.data();
                if (!d.createdAt) return;

                const ms = d.createdAt.toMillis();
                if (ms <= newestSeenMs) return;
                newestSeenMs = ms;

                if (!primed) return;
                if (d.createdByUid === myUid) return;
                if (at && ms <= at.toMillis()) return;
                count += 1;
            });

            if (!primed) { primed = true; return; }
            if (sawRemoval) { resync(); return; }
            render(count);
        }, (error) => console.error(`Listener error on ${collectionPath.join('/')}:`, error));
    }

    const tracker = { resync, listen, cutoffField, setCount: (n) => { count = n; render(n); } };
    unreadTrackers.push(tracker);
    return tracker;
}

function setupUnreadTrackers(clubId) {
    createUnreadTracker({
        collectionPath: ["clubs", clubId, "announcements"],
        cutoffField: "lastSeenAnnouncements",
        render: (n) => showBadge('unreadAnnouncementsBadge', n)
    });
    createUnreadTracker({
        collectionPath: ["clubs", clubId, "messages"],
        cutoffField: "lastSeenMessages",
        render: (n) => showBadge('unreadMessagesBadge', n)
    });
    createUnreadTracker({
        collectionPath: ["clubs", clubId, "polls"],
        cutoffField: "lastSeenPolls",
        render: (n) => showBadge('unreadPollsBadge', n)
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    unreadTrackers.forEach(t => t.resync());
});

window.addEventListener('pageshow', (e) => {
    if (e.persisted) unreadTrackers.forEach(t => t.resync());
});
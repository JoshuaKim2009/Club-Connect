//club_page_member.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// Only import necessary Firestore functions for reading data
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection, query, orderBy, where, getDocs, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';
import { handleUserSwitch } from './auth-guard.js';


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
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let currentUser = null; 

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

const clubId = getUrlParameter('id');
document.body.classList.add('no-scroll');
let loadingScreenHidden = false;

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');



var myName = "";
var myUid = "";
var myCurrentRoleInClub = "";
let lastKnownCurrentUserRole = null;
let clubMemberUIDsSet = null;


function hideLoadingScreen(delay = 0) {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;

    const doHide = () => {
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
    };

    if (delay > 0) {
        setTimeout(doHide, delay);
    } else {
        doHide();
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    myUid = user.uid;
    myName = user.displayName || user.email;

    if (clubId) {
        clubPageTitle.textContent = '';

        const [memberData, clubSnap] = await Promise.all([
            fetchMemberData(clubId, currentUser.uid),
            getDoc(doc(db, 'clubs', clubId))
        ]);

        if (!clubSnap.exists()) {
            hideLoadingScreen();
            showContainerError("This club doesn't exist.");
            return;
        }

        clubMemberUIDsSet = new Set(clubSnap.data().memberUIDs || []);

        const memberRole = await getMemberRoleForClub(clubId, currentUser.uid);
        if (memberRole === null) {
            hideLoadingScreen();
            showContainerError("You're not a member of this club.");
            return;
        }

        setupClubMemberPageListeners(clubId, myUid, myName);

        const [unreadCount, unreadMessagesCount, unreadPollsCount] = await Promise.all([
            getUnreadAnnouncementCount(clubId, myUid, memberData),
            getUnreadMessageCount(clubId, myUid, memberData),
            getUnreadPollCount(clubId, myUid, memberData)
        ]);

        updateUnreadBadge(unreadCount);
        updateUnreadMessagesBadge(unreadMessagesCount);
        updateUnreadPollsBadge(unreadPollsCount);
        setupAnnouncementListeners(clubId, myUid);
        setupMessageListeners(clubId, myUid);
        setupPollListeners(clubId, myUid);
        setupDirectMessageListeners(currentUser.uid);
    } else {
        hideLoadingScreen();
        showContainerError("No club ID provided.");
    }
});

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchClubDetails(id, currentUserId, currentUserName, animateCardEntry = true) {
    try {
        const clubRef = doc(db, "clubs", id);
        const [clubSnap, currentUserRole] = await Promise.all([
            getDoc(clubRef),
            getMemberRoleForClub(id, currentUserId)
        ]);
        myCurrentRoleInClub = currentUserRole;

        if (lastKnownCurrentUserRole !== null && lastKnownCurrentUserRole !== myCurrentRoleInClub) {
            await showAppAlert(`Your role for this club has been updated to ${getRoleLabel(myCurrentRoleInClub)}!`);
        }
        lastKnownCurrentUserRole = myCurrentRoleInClub;

        if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin') {
            window.location.href = `club_page_manager.html?id=${id}`;
            return; 
        }

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            clubMemberUIDsSet = new Set(clubData.memberUIDs || []);

            if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin' || myCurrentRoleInClub === 'member') {

                clubPageTitle.textContent = (clubData.clubName || 'Unnamed Club');
                clubDetailsDiv.innerHTML = `
                    <div class="club-info-container">
                        <p>Join Code <button id="copyJoinCodeButton" class="copy-button">${clubData.joinCode || 'N/A'}</button></p>
                    </div>
                `;
                const copyButton = document.getElementById('copyJoinCodeButton');
                if (copyButton && clubData.joinCode) {
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton);
                    });
                }

                await fetchAndDisplayUpcomingEvent(id, animateCardEntry);

            } else {
                hideLoadingScreen();
                showContainerError("You don't have permission to view this club.");
                return;
            }

        } else {
            hideLoadingScreen();
            showContainerError("This club doesn't exist.");
        }
    } catch (error) {
        hideLoadingScreen();
        console.error("Error fetching club details:", error);
        showContainerError("Oops! Something went wrong.", true);
    }
}



async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;

    const cacheKey = `role_${clubId}_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        const memberRoleSnap = await getDoc(memberRoleRef);

        let role;
        if (memberRoleSnap.exists()) {
            role = memberRoleSnap.data().role || 'member';
        } else {
            const clubRef = doc(db, "clubs", clubId);
            const clubSnap = await getDoc(clubRef);
            role = (clubSnap.exists() && clubSnap.data().managerUid === uid) ? 'manager' : null;
        }

        if (role !== null) sessionStorage.setItem(cacheKey, role);
        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
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

function calculateActiveOccurrences(eventData, exceptions) {
    
    if (!eventData.isWeekly) {
        return (exceptions && exceptions.includes(eventData.eventDate)) ? 0 : 1;
    }

    let activeCount = 0;
    const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
    const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
    const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

    let currentDate = new Date(startDate);
    while (currentDate.getTime() <= endDate.getTime()) {
        const currentOccDateString = currentDate.toISOString().split('T')[0];
        if (daysToMatch.includes(currentDate.getUTCDay()) && !(exceptions && exceptions.includes(currentOccDateString))) {
            activeCount++;
        }
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    return activeCount;
}


function createLoadingEventCardHtml() {
    return `
        <div class="event-card-loading">
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
        </div>
    `;
}

function createNoEventsCardHtml(message = "No upcoming events scheduled.") {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card animate-in'; 
    cardDiv.innerHTML = `
        <p class="fancy-black-label">${message}</p>
    `;
    return cardDiv;
}



async function fetchAndDisplayUpcomingEvent(currentClubId, animateCardEntry = true) {
    const closestEventDisplay = document.getElementById('closestEventDisplay');
    closestEventDisplay.innerHTML = '';
    closestEventDisplay.style.display = 'none';

    const eventsRef = collection(db, "clubs", currentClubId, "events");

    try {
        const todayString = new Date().toISOString().split('T')[0];
        
        // Query one-time events happening today or later
        const oneTimeQuery = query(
            eventsRef,
            where("isWeekly", "==", false),
            where("eventDate", ">=", todayString)
        );
        
        // Query weekly events that haven't ended yet
        const weeklyQuery = query(
            eventsRef,
            where("isWeekly", "==", true),
            where("weeklyEndDate", ">=", todayString)
        );
        
        const [oneTimeSnapshot, weeklySnapshot] = await Promise.all([
            getDocs(oneTimeQuery),
            getDocs(weeklyQuery)
        ]);
        let allPossibleOccurrences = [];


        oneTimeSnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id;
            const exceptions = eventData.exceptions || [];

            // Process one-time events
            const eventDateString = new Date(eventData.eventDate + 'T00:00:00Z').toISOString().split('T')[0];
            if (!exceptions.includes(eventDateString)) {
                allPossibleOccurrences.push({
                    eventData: eventData,
                    occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'),
                    originalEventId: eventId
                });
            }
        });

        weeklySnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id;
            const exceptions = eventData.exceptions || [];

            // Process weekly events
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

            let currentDate = new Date(startDate);
            while (currentDate.getTime() <= endDate.getTime()) {
                const currentOccDateString = currentDate.toISOString().split('T')[0];

                if (daysToMatch.includes(currentDate.getUTCDay()) && !exceptions.includes(currentOccDateString)) {
                    allPossibleOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(currentDate),
                        originalEventId: eventId
                    });
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        });


        const now = new Date();

        allPossibleOccurrences = allPossibleOccurrences.filter(occurrence => {
            const eventDateStr = occurrence.occurrenceDate.toISOString().split('T')[0];
            const eventEndTimeStr = occurrence.eventData.endTime;

            const eventEndMomentLocal = new Date(`${eventDateStr}T${eventEndTimeStr}`);

            return eventEndMomentLocal.getTime() > now.getTime();
        });

        allPossibleOccurrences.sort((a, b) => {
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0]  + 'T' + a.eventData.startTime).getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime).getTime();
            return dateTimeA - dateTimeB;
        });

        let nextEvent = allPossibleOccurrences.length > 0 ? allPossibleOccurrences[0] : null;

        let finalCardElement;

        closestEventDisplay.innerHTML = '';

        if (nextEvent) {
            console.log("There is an event scheduled:", nextEvent.eventData.eventName, "on", nextEvent.occurrenceDate.toISOString().split('T')[0], "at", nextEvent.eventData.startTime);

            finalCardElement = document.createElement('div');
            finalCardElement.className = 'event-card'; 
            if (animateCardEntry) { 
                finalCardElement.classList.add('animate-in');
            }

            const formattedDate = formatDate(nextEvent.occurrenceDate.toISOString().split('T')[0]);
            const formattedStartTime = formatTime(nextEvent.eventData.startTime);
            const formattedEndTime = formatTime(nextEvent.eventData.endTime);

            finalCardElement.innerHTML = `
                <div class="event-card-header">
                    <h3 class="event-card-title">${nextEvent.eventData.eventName}</h3>
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
                        <span class="einfo-text">${nextEvent.eventData.address}</span>
                    </div>

                    <div class="einfo-row">
                        <span class="einfo-icon"><i class="fa-solid fa-thumbtack"></i></span>
                        <span class="einfo-text">${nextEvent.eventData.location}</span>
                    </div>

                    ${nextEvent.eventData.notes ? `
                    <div class="einfo-row">
                        <span class="einfo-icon"><i class="fa-regular fa-pen-to-square"></i></span>
                        <span class="einfo-text">${nextEvent.eventData.notes}</span>
                    </div>` : ''}
                </div>
            `;

            closestEventDisplay.style.display = '';
            closestEventDisplay.appendChild(finalCardElement);
            hideLoadingScreen();

        } else {
            console.log("No events found at all.");
            closestEventDisplay.style.display = 'none';
            hideLoadingScreen();
            return;
        }

        if (animateCardEntry) { 
            setTimeout(() => {
                if (finalCardElement) {
                  finalCardElement.classList.add('is-visible');
                }
            }, 10);
        } else { 
            if (finalCardElement) {
                finalCardElement.classList.add('is-visible');
            }
        }

    } catch (error) {
        console.error("Error fetching event:", error);
        closestEventDisplay.innerHTML = ''; 
        closestEventDisplay.style.display = 'none';
        hideLoadingScreen();
        const errorCard = createNoEventsCardHtml("Error loading event. Please try again.");
        closestEventDisplay.appendChild(errorCard);
        if (animateCardEntry) { 
            setTimeout(() => {
                errorCard.classList.add('is-visible');
            }, 10);
        } else { 
            errorCard.classList.add('is-visible');
        }
    }
}


document.addEventListener('DOMContentLoaded', () => {
    const viewScheduleButton = document.getElementById('viewScheduleButton');
    const announcementsButton = document.getElementById('announcementsButton');
    const pollsButton = document.getElementById('pollsButton');
    const chatButton = document.getElementById('chatButton');
    const directMessagesButton = document.getElementById('directMessagesButton');
    const linksButton = document.getElementById('links-button');
    if (viewScheduleButton) {
        viewScheduleButton.addEventListener('click', () => {
            window.location.href = `schedule.html?clubId=${clubId}&returnTo=member`;
        });
    }

    if (announcementsButton) {
        announcementsButton.addEventListener('click', () => {
            window.location.href = `announcements.html?clubId=${clubId}&returnTo=member`;
        });
    }

    if (chatButton) {
        chatButton.addEventListener('click', () => {
            window.location.href = `chat.html?clubId=${clubId}&returnTo=member`;
        });
    }

    if (pollsButton) {
        pollsButton.addEventListener('click', () => {
            window.location.href = `polls.html?clubId=${clubId}&returnTo=member`;
        });
    }

    if (linksButton) {
        linksButton.addEventListener('click', () => {
            window.location.href = `links.html?clubId=${clubId}&returnTo=member`;
        });
    }

    if (directMessagesButton) {
        directMessagesButton.addEventListener('click', () => {
            window.location.href = `dm_menu.html?clubId=${clubId}&returnTo=member`;
        });
    }

});



let isInitialSnapshot = true;

const docRef = doc(db, "clubs", clubId);
const membersRef = collection(db, "clubs", clubId, "members");



async function setupClubMemberPageListeners(id, currentUserId, currentUserName) {
    onSnapshot(docRef, async (docSnap) => {
        if (isInitialSnapshot) {
            console.log("Initial club doc snapshot for member page.");
        } else {
            console.log("Club document changed in real-time for member page, refreshing UI.");
        }
        
        if (!docSnap.exists()) {
            console.warn(`Club document with ID ${id} not found.`);
            hideLoadingScreen();
            showContainerError("This club doesn't exist.");
            return;
        }

        
        await fetchClubDetails(id, currentUserId, currentUserName, isInitialSnapshot);

        if (isInitialSnapshot) {
            isInitialSnapshot = false; 
        }
    }, (error) => {
        console.error("Error listening to club document on member page:", error);
        hideLoadingScreen();
        showContainerError("Oops! Something went wrong.", true);
    });

    
    onSnapshot(membersRef, async (snapshot) => {
        if (isInitialSnapshot) {
            return; 
        }
        sessionStorage.removeItem(`role_${id}_${currentUserId}`);
        console.log("Members subcollection changed in real-time, refreshing member list.");
        await fetchClubDetails(id, currentUserId, currentUserName, false);
    }, (error) => {
        console.error("Error listening to members subcollection on member page:", error);
    });
}



function updateUnreadBadge(count) {
    const badgeElement = document.getElementById('unreadAnnouncementsBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex';
            requestAnimationFrame(() => badgeElement.classList.add('badge-visible'));
        } else {
            badgeElement.style.display = 'none';
            badgeElement.classList.remove('badge-visible');
        }
    }
}

async function getUnreadAnnouncementCount(clubId, userId, memberData = null) {
    if (!clubId || !userId) {
        console.warn("Cannot get unread count: clubId or userId missing.");
        return 0;
    }

    try {
        if (!memberData) {
            memberData = await fetchMemberData(clubId, userId);
        }

        if (!memberData) {
            return 0;
        }
        // Use lastSeenAnnouncements if it exists, otherwise use joinedAt
        const cutoffTimestamp = memberData.lastSeenAnnouncements || memberData.joinedAt;
        
        // If neither exists, return 0 (safe default - shouldn't happen)
        if (!cutoffTimestamp) {
            console.warn(`No timestamp (lastSeenAnnouncements or joinedAt) found for user ${userId} in club ${clubId}. Returning 0.`);
            return 0;
        }
        
        // Count announcements created AFTER the cutoff timestamp, excluding user's own
        const announcementsRef = collection(db, "clubs", clubId, "announcements");
        const q = query(
            announcementsRef,
            where("createdAt", ">", cutoffTimestamp),
            where("createdByUid", "!=", userId)
        );
        
        const countSnapshot = await getCountFromServer(q);
        const unreadCount = countSnapshot.data().count;
        
        console.log(`User ${userId} has ${unreadCount} unread announcements in club ${clubId}.`);
        return unreadCount;
    } catch (error) {
        console.error("Error getting unread announcement count:", error);
        return 0;
    }
}


function setupAnnouncementListeners(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("Cannot setup announcement listeners: clubId or userId missing.");
        return;
    }

    const announcementsRef = collection(db, "clubs", clubId, "announcements");

    
    onSnapshot(announcementsRef, async (announcementsSnapshot) => {
        console.log("Announcements collection activity detected, re-calculating unread count.");
        const unreadCount = await getUnreadAnnouncementCount(clubId, userId);
        updateUnreadBadge(unreadCount);
    }, (error) => {
        console.error("Error listening to announcements collection:", error);
    });

    
}




function updateUnreadMessagesBadge(count) {
    const badgeElement = document.getElementById('unreadMessagesBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex';
            requestAnimationFrame(() => badgeElement.classList.add('badge-visible'));
        } else {
            badgeElement.style.display = 'none';
            badgeElement.classList.remove('badge-visible');
        }
    }
}

async function getUnreadMessageCount(clubId, userId, memberData = null) {
    if (!clubId || !userId) {
        console.warn("Cannot get unread message count: clubId or userId missing.");
        return 0;
    }

    try {
        if (!memberData) {
            memberData = await fetchMemberData(clubId, userId);
        }

        if (!memberData) {
            return 0;
        }
        // Use lastSeenMessages if it exists, otherwise use joinedAt
        const cutoffTimestamp = memberData.lastSeenMessages || memberData.joinedAt;
        
        // If neither exists, return 0 (safe default - shouldn't happen)
        if (!cutoffTimestamp) {
            console.warn(`No timestamp (lastSeenMessages or joinedAt) found for user ${userId} in club ${clubId}. Returning 0.`);
            return 0;
        }
        
        // Count messages created AFTER the cutoff timestamp, excluding user's own messages
        const messagesRef = collection(db, "clubs", clubId, "messages");
        const q = query(
            messagesRef,
            where("createdAt", ">", cutoffTimestamp),
            where("createdByUid", "!=", userId)
        );
        
        const countSnapshot = await getCountFromServer(q);
        const unreadCount = countSnapshot.data().count;
        
        console.log(`User ${userId} has ${unreadCount} unread messages in club ${clubId}.`);
        return unreadCount;
    } catch (error) {
        console.error("Error getting unread message count:", error);
        return 0;
    }
}

function setupMessageListeners(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("Cannot setup message listeners: clubId or userId missing.");
        return;
    }

    const messagesRef = collection(db, "clubs", clubId, "messages");

    onSnapshot(messagesRef, async (messagesSnapshot) => {
        console.log("Messages collection changed, recalculating unread count.");
        const unreadCount = await getUnreadMessageCount(clubId, userId);
        updateUnreadMessagesBadge(unreadCount);
    }, (error) => {
        console.error("Error listening to messages collection:", error);
    });
}


const membersButton = document.getElementById("view-members-button");

membersButton.addEventListener('click', async () => {
    window.location.href = `members.html?clubId=${clubId}`;
});


function updateUnreadPollsBadge(count) {
    const badgeElement = document.getElementById('unreadPollsBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex';
            requestAnimationFrame(() => badgeElement.classList.add('badge-visible'));
        } else {
            badgeElement.style.display = 'none';
            badgeElement.classList.remove('badge-visible');
        }
    }
}

async function getUnreadPollCount(clubId, userId, memberData = null) {
    if (!clubId || !userId) {
        console.warn("Cannot get unread poll count: clubId or userId missing.");
        return 0;
    }

    try {
        if (!memberData) {
            memberData = await fetchMemberData(clubId, userId);
        }

        if (!memberData) {
            return 0;
        }
        const cutoffTimestamp = memberData.lastSeenPolls || memberData.joinedAt;
        
        if (!cutoffTimestamp) {
            console.warn(`No timestamp (lastSeenPolls or joinedAt) found for user ${userId} in club ${clubId}. Returning 0.`);
            return 0;
        }
        
        const pollsRef = collection(db, "clubs", clubId, "polls");
        const q = query(
            pollsRef,
            where("createdAt", ">", cutoffTimestamp),
            where("createdByUid", "!=", userId)
        );
        
        const countSnapshot = await getCountFromServer(q);
        const unreadCount = countSnapshot.data().count;
        
        console.log(`User ${userId} has ${unreadCount} unread polls in club ${clubId}.`);
        return unreadCount;
    } catch (error) {
        console.error("Error getting unread poll count:", error);
        return 0;
    }
}

function setupPollListeners(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("Cannot setup poll listeners: clubId or userId missing.");
        return;
    }

    const pollsRef = collection(db, "clubs", clubId, "polls");

    onSnapshot(pollsRef, async (pollsSnapshot) => {
        console.log("Polls collection activity detected, re-calculating unread count.");
        const unreadCount = await getUnreadPollCount(clubId, userId);
        updateUnreadPollsBadge(unreadCount);
    }, (error) => {
        console.error("Error listening to polls collection:", error);
    });
}

async function fetchMemberData(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("fetchMemberData: clubId or userId missing.");
        return null;
    }
    try {
        const memberDocRef = doc(db, "clubs", clubId, "members", userId);
        const memberDocSnap = await getDoc(memberDocRef);
        
        if (!memberDocSnap.exists()) {
            console.warn(`Member document not found for user ${userId} in club ${clubId}`);
            return null;
        }
        
        const data = memberDocSnap.data();
        if (data.role) {
            sessionStorage.setItem(`role_${clubId}_${userId}`, data.role);
        }
        return data;
    } catch (error) {
        console.error("Error fetching member data:", error);
        return null;
    }
}


function updateUnreadDirectMessagesBadge(count) {
    const badgeElement = document.getElementById('unreadDirectMessagesBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex';
            requestAnimationFrame(() => badgeElement.classList.add('badge-visible'));
        } else {
            badgeElement.style.display = 'none';
            badgeElement.classList.remove('badge-visible');
        }
    }
}

function setupDirectMessageListeners(userId) {
    const q = query(
        collection(db, 'directMessages'),
        where('participants', 'array-contains', userId)
    );

    onSnapshot(q, (snapshot) => {
        let totalUnread = 0;
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.lastMessageText) return;
            const otherUid = data.participants.find(uid => uid !== userId);
            if (clubMemberUIDsSet && !clubMemberUIDsSet.has(otherUid)) return;
            totalUnread += data.unreadCounts?.[userId] || 0;
        });
        updateUnreadDirectMessagesBadge(totalUnread);
    });
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
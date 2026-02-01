//club_page_manager.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, setDoc, deleteDoc, serverTimestamp, runTransaction, query, orderBy, where, getDocs, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";


import { showAppAlert, showAppConfirm } from './dialog.js';


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

let currentUser = null; 

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

const clubId = getUrlParameter('id');

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');
var myName = "";
var myUid = "";
let lastKnownCurrentUserRole = null;

onAuthStateChanged(auth, async (user) => {
    currentUser = user; 
    if (user) {
        console.log("User is authenticated on club manager page:", user.uid);
        if (clubId) {
            clubPageTitle.textContent = "";
            myName = user.displayName;
            myUid = user.uid;
            await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, true);

            const memberData = await fetchMemberData(clubId, currentUser.uid);

            const unreadCount = await getUnreadAnnouncementCount(clubId, currentUser.uid, memberData);
            updateUnreadBadge(unreadCount);

            setupAnnouncementListeners(clubId, currentUser.uid);

            const unreadMessagesCount = await getUnreadMessageCount(clubId, currentUser.uid, memberData);
            updateUnreadMessagesBadge(unreadMessagesCount);

            setupMessageListeners(clubId, currentUser.uid);

            const unreadPollsCount = await getUnreadPollCount(clubId, currentUser.uid, memberData);
            updateUnreadPollsBadge(unreadPollsCount);

            setupPollListeners(clubId, currentUser.uid);

            const pendingCount = await getPendingRequestsCount(clubId);
            updatePendingRequestsBadge(pendingCount);
            setupPendingRequestsListeners(clubId);

        } else {
            clubPageTitle.textContent = "Error: No Club ID provided";
            clubDetailsDiv.innerHTML = "<p>Please return to your clubs page and select a club.</p>";
        }
    } else {
        console.log("No user authenticated on club manager page. Redirecting to login.");
        clubPageTitle.textContent = "Not Authenticated";
        clubDetailsDiv.innerHTML = "<p>You must be logged in to view club details. Redirecting...</p>";
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    }
});

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
async function fetchClubDetails(id, currentUserId, currentUserName, animateCardEntry, skipEvents = false) {
    try {
        const clubRef = doc(db, "clubs", id);
        
        const clubSnap = await getDoc(clubRef, { source: 'server' });

        const currentUserRole = await getMemberRoleForClub(id, currentUserId);
        lastKnownCurrentUserRole = currentUserRole;

        if (currentUserRole !== 'manager' && currentUserRole !== 'admin') {
            console.log(`User ${currentUserId} is a ${currentUserRole} for club ${id}. Redirecting to member page.`);
            window.location.href = `club_page_member.html?id=${id}`;
            return; 
        }

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            console.log("Fetched club data:", clubData);

            if (clubData.managerUid === currentUserId || currentUserRole === 'manager' || currentUserRole === 'admin') {
                clubPageTitle.textContent = (clubData.clubName || 'Unnamed Club');

                const actualManagerUid = clubData.managerUid;
                let actualManagerName = 'Unknown Manager';

                if (actualManagerUid) {
                    const managerUserRef = doc(db, "users", actualManagerUid);
                    const managerUserSnap = await getDoc(managerUserRef, { source: 'server' });
                    if (managerUserSnap.exists() && managerUserSnap.data().name) {
                        actualManagerName = managerUserSnap.data().name;
                    }
                }

                clubDetailsDiv.innerHTML = `
                    <div class="club-info-container">
                        <p>Manager | ${actualManagerName}</p>
                        <p>Your Role | ${capitalizeFirstLetter(currentUserRole)}</p>
                        <p>Join Code | <button id="copyJoinCodeButton" class="copy-button">${clubData.joinCode || 'N/A'}</button></p>
                    </div>
                `;

                const copyButton = document.getElementById('copyJoinCodeButton');
                if (copyButton && clubData.joinCode) {
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton);
                    });
                }
            } else {
                clubPageTitle.textContent = "Access Denied";
                clubDetailsDiv.innerHTML = "<p>You do not have permission to view details for this club.</p>";
                console.warn(`User ${currentUserId} attempted to view club ${id} but is not the manager (${clubData.managerUid}).`);
            }

            if (!skipEvents) {
                await fetchAndDisplayUpcomingEvent(id, animateCardEntry);
            }

        } else {
            clubPageTitle.textContent = "Club Not Found";
            clubDetailsDiv.innerHTML = "<p>Sorry, this club does not exist or you do not have permission to view it.</p>";
        }
    } catch (error) {
        console.error("Error fetching club details:", error);
        clubPageTitle.textContent = "Error Loading Club";
        clubDetailsDiv.innerHTML = "<p>An error occurred while loading club details. Please try again.</p>";
    }
}


async function getMemberRoleForClub(clubID, memberUid) {
  if (!clubID || !memberUid) {
    console.warn("getMemberRoleForClub: clubID or memberUid is missing.");
    return null;
  }
  try {
    const memberRoleRef = doc(db, "clubs", clubID, "members", memberUid);
    const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef, { source: 'server' });
      if (clubSnap.exists() && clubSnap.data().managerUid === memberUid) {
          return 'manager'; 
      }
      console.warn(`Role document not found for user ${memberUid} in club ${clubID}. Defaulting to 'member'.`);
      return 'member'; 
    }
  } catch (error) {
    console.error(`Error fetching role for user ${memberUid} in club ${clubID}:`, error);
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




const editClubButton = document.getElementById("edit-club-button");

editClubButton.addEventListener('click', async () => {
    window.location.href = `club_edit_page.html?clubId=${clubId}`;
});

const membersButton = document.getElementById("view-members-button");

membersButton.addEventListener('click', async () => {
    window.location.href = `members.html?clubId=${clubId}`;
});




document.addEventListener('DOMContentLoaded', () => {
    const viewScheduleButton = document.getElementById('viewScheduleButton');
    const announcementsButton = document.getElementById('announcementsButton');
    const pollsButton = document.getElementById('pollsButton');
    const chatButton = document.getElementById('chatButton');
    if (viewScheduleButton) {
        viewScheduleButton.addEventListener('click', () => {
            window.location.href = `schedule.html?clubId=${clubId}&returnTo=manager`;
        });
    }

    if (announcementsButton) {
        announcementsButton.addEventListener('click', () => {
            window.location.href = `announcements.html?clubId=${clubId}&returnTo=manager`;
        });
    }

    if (chatButton) {
        chatButton.addEventListener('click', () => {
            window.location.href = `chat.html?clubId=${clubId}&returnTo=manager`;
        });
    }

    if (pollsButton) {
        pollsButton.addEventListener('click', () => {
            window.location.href = `polls.html?clubId=${clubId}&returnTo=manager`;
        });
    }


});



const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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



async function fetchAndDisplayUpcomingEvent(currentClubId, animateCard) {
    const closestEventDisplay = document.getElementById('closestEventDisplay');
    if (!closestEventDisplay) {
        console.warn("Element with ID 'closestEventDisplay' not found in HTML.");
        return;
    }



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
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
            return dateTimeA - dateTimeB;
        });

        let nextEvent = allPossibleOccurrences.length > 0 ? allPossibleOccurrences[0] : null;

        let finalCardElement;

        closestEventDisplay.innerHTML = '';

        if (nextEvent) {
            console.log("There is an event scheduled:", nextEvent.eventData.eventName, "on", nextEvent.occurrenceDate.toISOString().split('T')[0], "at", nextEvent.eventData.startTime);

            finalCardElement = document.createElement('div');
            finalCardElement.className = 'event-card'; 
            if (animateCard) { 
                finalCardElement.classList.add('animate-in');
            }

            const formattedDate = formatDate(nextEvent.occurrenceDate.toISOString().split('T')[0]);
            const formattedStartTime = formatTime(nextEvent.eventData.startTime);
            const formattedEndTime = formatTime(nextEvent.eventData.endTime);

            finalCardElement.innerHTML = `
                <h3>${nextEvent.eventData.eventName}</h3>
                <p>•  Date: ${formattedDate}</p>
                <p>•  Time: ${formattedStartTime} - ${formattedEndTime}</p>
                <p>•  Address: ${nextEvent.eventData.address}</p>
                <p>•  Location: ${nextEvent.eventData.location}</p>
                ${nextEvent.eventData.notes ? `<p>•  Notes: ${nextEvent.eventData.notes}</p>` : ''}
            `;
            closestEventDisplay.appendChild(finalCardElement);

        } else {
            console.log("No events found at all.");
           finalCardElement = createNoEventsCardHtml();
            if (!animateCard) {
                finalCardElement.classList.remove('animate-in');
            }
            closestEventDisplay.appendChild(finalCardElement);
        }

        if (animateCard) { 
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
        const errorCard = createNoEventsCardHtml("Error loading event. Please try again.");
        closestEventDisplay.appendChild(errorCard);
        if (animateCard) {
            setTimeout(() => {
                errorCard.classList.add('is-visible');
            }, 10);
        } else { 
            errorCard.classList.add('is-visible');
        }
    }
}


const docRef = doc(db, "clubs", clubId);
const membersRef = collection(db, "clubs", clubId, "members");


let isInitialSnapshot = true;


onSnapshot(docRef, async (docSnap) => {
    if (isInitialSnapshot) return; 
    
    if (docSnap.exists() && currentUser) {
        console.log("Main doc changed, full UI sync...");
        await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false, true);
    }
});


onSnapshot(membersRef, async (snapshot) => {
    if (isInitialSnapshot) {
        isInitialSnapshot = false; 
        return;
    }


    console.log("Role update detected! Updating the Member List UI...");
    
    if (currentUser && clubId) {
        
        await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false, true);
    }
});



function updateUnreadBadge(count) {
    const badgeElement = document.getElementById('unreadAnnouncementsBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex'; 
        } else {
            badgeElement.style.display = 'none'; 
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
        } else {
            badgeElement.style.display = 'none'; 
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


async function getPendingRequestsCount(clubId) {
    if (!clubId) {
        console.warn("Cannot get pending requests count: clubId missing.");
        return 0;
    }

    try {
        const clubRef = doc(db, "clubs", clubId);
        const clubSnap = await getDoc(clubRef);
        
        if (!clubSnap.exists()) {
            console.warn(`Club document not found for club ${clubId}`);
            return 0;
        }
        
        const clubData = clubSnap.data();
        const pendingMemberUIDs = clubData.pendingMemberUIDs || [];
        
        console.log(`Club ${clubId} has ${pendingMemberUIDs.length} pending requests.`);
        return pendingMemberUIDs.length;
    } catch (error) {
        console.error("Error getting pending requests count:", error);
        return 0;
    }
}

function updatePendingRequestsBadge(count) {
    const badgeElement = document.getElementById('pendingRequestsBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex'; 
        } else {
            badgeElement.style.display = 'none'; 
        }
    }
}

function setupPendingRequestsListeners(clubId) {
    if (!clubId) {
        console.warn("Cannot setup pending requests listeners: clubId missing.");
        return;
    }

    const clubRef = doc(db, "clubs", clubId);

    onSnapshot(clubRef, async (docSnap) => {
        if (docSnap.exists()) {
            console.log("Club document changed, recalculating pending requests count.");
            const pendingCount = await getPendingRequestsCount(clubId);
            updatePendingRequestsBadge(pendingCount);
        }
    }, (error) => {
        console.error("Error listening to club document for pending requests:", error);
    });
}

function updateUnreadPollsBadge(count) {
    const badgeElement = document.getElementById('unreadPollsBadge');
    if (badgeElement) {
        if (count > 0) {
            badgeElement.textContent = count;
            badgeElement.style.display = 'flex';
        } else {
            badgeElement.style.display = 'none';
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
        
        return memberDocSnap.data();
    } catch (error) {
        console.error("Error fetching member data:", error);
        return null;
    }
}
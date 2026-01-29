//club_page_member.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// Only import necessary Firestore functions for reading data
import { getFirestore, doc, getDoc, collection, query, orderBy, where, getDocs, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let currentUser = null; 

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

const clubId = getUrlParameter('id');

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');
const membersContainer = document.getElementById('membersContainer'); 

var managerName = "";
var managerUid = "";
var myName = "";
var myUid = "";
var myCurrentRoleInClub = "";
let lastKnownCurrentUserRole = null;

onAuthStateChanged(auth, async (user) => {
    currentUser = user; 
    if (user) {
        myUid = user.uid;
        myName = user.displayName || user.email; 

        console.log("User is authenticated on club member page. UID:", myUid, "Name:", myName);
        if (clubId) {
            clubPageTitle.textContent = ""; 
            
            const unreadCount = await getUnreadAnnouncementCount(clubId, myUid);
            updateUnreadBadge(unreadCount);
            setupAnnouncementListeners(clubId, myUid);

            setupClubMemberPageListeners(clubId, myUid, myName);

            const unreadMessagesCount = await getUnreadMessageCount(clubId, currentUser.uid);
            updateUnreadMessagesBadge(unreadMessagesCount);

            setupMessageListeners(clubId, currentUser.uid);

        } else {
            clubPageTitle.textContent = "Error: No Club ID provided";
            clubDetailsDiv.innerHTML = "<p>Please return to your clubs page and select a club.</p>";
        }
    } else {
        console.log("No user authenticated on club member page. Redirecting to login.");
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

async function fetchClubDetails(id, currentUserId, currentUserName, animateCardEntry = true) {
    try {
        const clubRef = doc(db, "clubs", id);
        const clubSnap = await getDoc(clubRef, { source: 'server' });

        myCurrentRoleInClub = await getMemberRoleForClub(id, currentUserId);
        if (lastKnownCurrentUserRole !== null && lastKnownCurrentUserRole !== myCurrentRoleInClub) {
            await showAppAlert(`Your role for this club has been updated to ${capitalizeFirstLetter(myCurrentRoleInClub)}!`);
        }
        lastKnownCurrentUserRole = myCurrentRoleInClub; 

        if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin') {
            console.log(`User ${currentUserId} is a ${myCurrentRoleInClub} for club ${id}. Redirecting to manager page.`);
            window.location.href = `club_page_manager.html?id=${id}`;
            return; 
        }

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            console.log("Fetched club data:", clubData);

            if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin' || myCurrentRoleInClub === 'member') {
                
                const actualManagerUid = clubData.managerUid;
                let actualManagerName = 'Unknown Manager';

                if (actualManagerUid) {
                    const managerUserRef = doc(db, "users", actualManagerUid);
                    const managerUserSnap = await getDoc(managerUserRef, { source: 'server' });
                    if (managerUserSnap.exists() && managerUserSnap.data().name) {
                        actualManagerName = managerUserSnap.data().name;
                    }
                }

                managerName = actualManagerName; 
                managerUid = actualManagerUid;   

                clubPageTitle.textContent = (clubData.clubName || 'Unnamed Club');

                clubDetailsDiv.innerHTML = `
                    <div class="club-info-container">
                        <p>Manager | ${actualManagerName}</p>
                        <p>Your Role | ${capitalizeFirstLetter(myCurrentRoleInClub)}</p> <!-- Display user's role -->
                        <p>Join Code | <button id="copyJoinCodeButton" class="copy-button">${clubData.joinCode || 'N/A'}</button></p>
                    </div>
                `;

                const copyButton = document.getElementById('copyJoinCodeButton');
                if (copyButton && clubData.joinCode) {
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton);
                    });
                }

                
                const approvedMemberUids = clubData.memberUIDs || [];
                const approvedMemberNames = [];
                const approvedMemberIds = [];
                const approvedMemberRoles = [];

                
                const memberRolePromises = approvedMemberUids.map(memberUid => getMemberRoleForClub(id, memberUid));
                const memberRoles = await Promise.all(memberRolePromises);

                for (let i = 0; i < approvedMemberUids.length; i++) {
                    const memberUid = approvedMemberUids[i];
                    const userRef = doc(db, "users", memberUid);
                    const userSnap = await getDoc(userRef, { source: 'server' });

                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        approvedMemberNames.push(userData.name || `User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member');
                    } else {
                        console.warn(`User document not found for approved member UID: ${memberUid}`);
                        approvedMemberNames.push(`Unknown User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member');
                    }
                }
                
                
                await fetchAndDisplayUpcomingEvent(id, animateCardEntry); 
                const sortedApproved = sortMembersAlphabetically(approvedMemberNames, approvedMemberIds, approvedMemberRoles);
                displayMembersForMemberPage(sortedApproved.names, sortedApproved.uids, sortedApproved.roles);


            } else {
                clubPageTitle.textContent = "Access Denied";
                clubDetailsDiv.innerHTML = "<p>You do not have permission to view this club.</p>";
                console.warn(`User ${currentUserId} attempted to view club ${id} but is not a member.`);
                setTimeout(() => {
                    window.location.href = 'your_clubs.html';
                }, 2000);
            }


        } else {
            clubPageTitle.textContent = "Club Not Found";
            clubDetailsDiv.innerHTML = "<p>Sorry, this club does not exist.</p>";
            console.warn(`Club document with ID ${id} not found.`);
            setTimeout(() => {
                window.location.href = 'your_clubs.html';
            }, 2000);
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



function displayMembersForMemberPage(memberNames, memberUids, memberRoles) {
    if (!membersContainer) {
        console.error("HTML element with id 'membersContainer' not found. Please add it to your HTML.");
        return;
    }

    membersContainer.innerHTML = ""; 
   
    const title = document.createElement("h3");
    title.textContent = `CLUB MEMBERS (${memberNames.length})`; 
    membersContainer.appendChild(title);

    if (memberNames.length === 0) {
        const noMembers = document.createElement("p");
        noMembers.className = 'fancy-label'; 
        noMembers.textContent = "No members in this club yet.";
        membersContainer.appendChild(noMembers);
        return;
    }

    memberNames.forEach((name, index) => {
        const memberUid = memberUids[index];
        const memberRole = memberRoles[index];

        const memberCardDiv = document.createElement("div");
        memberCardDiv.className = "member-card"; 

        const nameDisplayDiv = document.createElement("div");
        let displayName = name;
        displayName = `${name}`;

        nameDisplayDiv.innerHTML = `${displayName} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
        nameDisplayDiv.className = "member-name-display";
        memberCardDiv.appendChild(nameDisplayDiv);
        
        // NO ACTION BUTTONS FOR REGULAR MEMBERS CUZ THEY CAN"T 

        membersContainer.appendChild(memberCardDiv);
    });
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

function sortMembersAlphabetically(names, uids, roles = null) {
    const combinedMembers = names.map((name, index) => ({
        name: name,
        uid: uids[index],
        role: roles ? roles[index] : undefined 
    }));

    combinedMembers.sort((a, b) => a.name.localeCompare(b.name));

    const sortedNames = combinedMembers.map(member => member.name);
    const sortedUids = combinedMembers.map(member => member.uid);
    const sortedRoles = roles ? combinedMembers.map(member => member.role) : null;

    return { names: sortedNames, uids: sortedUids, roles: sortedRoles };
}

async function fetchAndDisplayUpcomingEvent(currentClubId, animateCardEntry = true) {
    const closestEventDisplay = document.getElementById('closestEventDisplay');
    if (!closestEventDisplay) {
        console.warn("Element with ID 'closestEventDisplay' not found in HTML.");
        return;
    }

    const eventsRef = collection(db, "clubs", currentClubId, "events");

    try {
        const querySnapshot = await getDocs(eventsRef);
        let allPossibleOccurrences = [];


        querySnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id;
            const exceptions = eventData.exceptions || [];

            if (eventData.isWeekly) {
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
            } else { 
                const eventDateString = new Date(eventData.eventDate + 'T00:00:00Z').toISOString().split('T')[0];
                if (!exceptions.includes(eventDateString)) {
                    allPossibleOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'),
                        originalEventId: eventId
                    });
                }
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
            if (animateCardEntry) { 
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
            if (!animateCardEntry) { 
                finalCardElement.classList.remove('animate-in');
            }
            closestEventDisplay.appendChild(finalCardElement);
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
    const chatButton = document.getElementById('chatButton');
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
            clubPageTitle.textContent = "Club Not Found";
            clubDetailsDiv.innerHTML = "<p>Sorry, this club does not exist.</p>";
            console.warn(`Club document with ID ${id} not found.`);
            setTimeout(() => {
                window.location.href = 'your_clubs.html';
            }, 2000);
            return;
        }

        
        await fetchClubDetails(id, currentUserId, currentUserName, isInitialSnapshot);

        if (isInitialSnapshot) {
            isInitialSnapshot = false; 
        }
    }, (error) => {
        console.error("Error listening to club document on member page:", error);
        clubPageTitle.textContent = "Error Loading Club";
        clubDetailsDiv.innerHTML = "<p>An error occurred while loading club details. Please try again.</p>";
    });

    
    onSnapshot(membersRef, async (snapshot) => {
        if (isInitialSnapshot) {
            return; 
        }

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
        } else {
            badgeElement.style.display = 'none'; 
        }
    }
}

async function getUnreadAnnouncementCount(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("Cannot get unread count: clubId or userId missing.");
        return 0;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubId, "members", userId);
        const memberDocSnap = await getDoc(memberDocRef);
        
        if (!memberDocSnap.exists()) {
            console.warn(`Member document not found for user ${userId} in club ${clubId}`);
            return 0;
        }
        
        const memberData = memberDocSnap.data();
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

async function getUnreadMessageCount(clubId, userId) {
    if (!clubId || !userId) {
        console.warn("Cannot get unread message count: clubId or userId missing.");
        return 0;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubId, "members", userId);
        const memberDocSnap = await getDoc(memberDocRef);
        
        if (!memberDocSnap.exists()) {
            console.warn(`Member document not found for user ${userId} in club ${clubId}`);
            return 0;
        }
        
        const memberData = memberDocSnap.data();
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
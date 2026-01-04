import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// Only import necessary Firestore functions for reading data
import { getFirestore, doc, getDoc, collection, query, orderBy, where, getDocs  } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';


// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
  authDomain: "club-connect-data.firebaseapp.com",
  projectId: "club-connect-data",
  storageBucket: "club-connect-data.firebasestorage.app",
  messagingSenderId: "903230180616",
  appId: "1:903230180616:web:a13856c505770bcc0b30bd",
  measurementId: "G-B8DR377JX6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Map Date.getUTCDay() (0 for Sunday, 1 for Monday, etc.) to day names
const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let currentUser = null; // To store the current Firebase Auth user object

// Function to get a query parameter from the URL
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Get the clubId from the URL
const clubId = getUrlParameter('id');

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');
const membersContainer = document.getElementById('membersContainer'); 

// Variables specific to THIS club and THIS user's view
var managerName = "";
var managerUid = "";
var myName = "";
var myUid = "";
var myCurrentRoleInClub = ""; // To store the current user's role for this specific club

// --- NEW AUTHENTICATION LOGIC ---
onAuthStateChanged(auth, async (user) => {
    currentUser = user; 
    if (user) {
        myUid = user.uid;
        myName = user.displayName || user.email; // Use display name or email as fallback

        console.log("User is authenticated on club member page. UID:", myUid, "Name:", myName);
        if (clubId) {
            clubPageTitle.textContent = ""; // Clear initial title
            await fetchClubDetails(clubId, myUid, myName); 
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
// --- END NEW AUTHENTICATION LOGIC ---

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchClubDetails(id, currentUserId, currentUserName) {
    try {
        const clubRef = doc(db, "clubs", id);
        const clubSnap = await getDoc(clubRef);

        // Fetch the current user's role for this specific club
        myCurrentRoleInClub = await getMemberRoleForClub(id, currentUserId);

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            console.log("Fetched club data:", clubData);

            // Access check: User must be an manager, admin, or member to view this page
            if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin' || myCurrentRoleInClub === 'member') {
                // Fetch the actual manager's name using their UID from clubData
                const actualManagerUid = clubData.managerUid;
                let actualManagerName = 'Unknown Manager';

                if (actualManagerUid) {
                    const managerUserRef = doc(db, "users", actualManagerUid);
                    const managerUserSnap = await getDoc(managerUserRef);
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
                if (copyButton && clubData.joinCode) { // Ensure button exists and there's a code to copy
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton); // Pass the button element itself
                    });
                }

                // --- Collect data for ALL APPROVED members (including manager/admin if they are in memberUIDs) ---
                const approvedMemberUids = clubData.memberUIDs || [];
                const approvedMemberNames = [];
                const approvedMemberIds = [];
                const approvedMemberRoles = [];

                // Fetch roles for all approved members concurrently
                // This ensures each member's role is known for display
                const memberRolePromises = approvedMemberUids.map(memberUid => getMemberRoleForClub(id, memberUid));
                const memberRoles = await Promise.all(memberRolePromises);

                for (let i = 0; i < approvedMemberUids.length; i++) {
                    const memberUid = approvedMemberUids[i];
                    const userRef = doc(db, "users", memberUid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        approvedMemberNames.push(userData.name || `User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member'); // Use fetched role or default
                    } else {
                        console.warn(`User document not found for approved member UID: ${memberUid}`);
                        approvedMemberNames.push(`Unknown User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member');
                    }
                }
                
                await fetchAndDisplayUpcomingEvent(id); 
                // Call the simplified display function for members
                displayMembersForMemberPage(approvedMemberNames, approvedMemberIds, approvedMemberRoles);


            } else { // User is neither manager, admin, nor member
                clubPageTitle.textContent = "Access Denied";
                clubDetailsDiv.innerHTML = "<p>You do not have permission to view this club.</p>";
                console.warn(`User ${currentUserId} attempted to view club ${id} but is not a member.`);
                // Redirect user back to their clubs page after a delay
                setTimeout(() => {
                    window.location.href = 'your_clubs.html';
                }, 2000);
            }


        } else { // Club document does not exist
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
    const memberRoleSnap = await getDoc(memberRoleRef);
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      // Fallback: Check if they are the manager from the main club document
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef);
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

        // Store original button text and then change it
        const originalButtonText = buttonElement.textContent;
        buttonElement.textContent = ' Copied! ';
        buttonElement.disabled = true; // Disable the button to prevent re-clicks

        // Revert text and re-enable button after a short delay
        setTimeout(() => {
            buttonElement.textContent = originalButtonText; // Restore original text
            buttonElement.disabled = false; // Re-enable the button
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

    membersContainer.innerHTML = ""; // Clear any previous content
   
    const title = document.createElement("h3");
    title.textContent = "CLUB MEMBERS"; // A more general title for the member list
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
        memberCardDiv.className = "member-card"; // Re-use styling if defined in your CSS

        const nameDisplayDiv = document.createElement("div");
        let displayName = name;
        displayName = `${name}`;

        nameDisplayDiv.innerHTML = `${displayName} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
        nameDisplayDiv.className = "member-name-display";
        memberCardDiv.appendChild(nameDisplayDiv);
        
        // NO ACTION BUTTONS FOR REGULAR MEMBERS ON THIS PAGE
        // If you need "leave club" functionality, that would be a separate button outside this list.

        membersContainer.appendChild(memberCardDiv);
    });
}



function formatTime(timeString) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(); // Use a dummy date to leverage Date object for formatting
        date.setHours(hours, minutes);
        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.error("Error formatting time:", e);
        return timeString; // Return original if invalid time string
    }
}

// Helper to format a date string for display (ensuring UTC consistency)
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    try {
        // Ensure the date is parsed in UTC for consistent formatting
        return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, options);
    } catch (e) {
        console.error("Error formatting date:", e);
        return dateString; // Return original if invalid date string
    }
}

// Helper function to calculate active occurrences (needed by fetchAndDisplayUpcomingEvent for its internal logic)
function calculateActiveOccurrences(eventData, exceptions) {
    // This helper is not directly used for filtering in this upcoming event function,
    // but its presence is useful if you later want to use the same event data processing.
    // For now, it serves as a placeholder for consistency if you eventually extend this.
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



async function fetchAndDisplayUpcomingEvent(currentClubId) {
    const upcomingEventDisplay = document.getElementById('closestEventDisplay'); // ID matches your HTML
    if (!upcomingEventDisplay) {
        console.warn("Element with ID 'closestEventDisplay' not found in HTML.");
        return;
    }
    upcomingEventDisplay.innerHTML = '<p class="fancy-black-label">Loading earliest event...</p>'; // Adjusted loading message

    const eventsRef = collection(db, "clubs", currentClubId, "events");
    // REMOVED: const now = new Date(); // Current date and time in local timezone
    // REMOVED: const todayUTCString = now.toISOString().split('T')[0]; // Current date as YYYY-MM-DD UTC

    try {
        const querySnapshot = await getDocs(eventsRef);
        let allPossibleOccurrences = [];

        querySnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id; // The Firestore Document ID
            const exceptions = eventData.exceptions || [];

            if (eventData.isWeekly) {
                // Ensure dates are parsed as UTC midnight for consistent iteration
                const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
                const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
                const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

                let currentDate = new Date(startDate);
                while (currentDate.getTime() <= endDate.getTime()) {
                    const currentOccDateString = currentDate.toISOString().split('T')[0];

                    // MODIFIED CODE: Removed filtering based on `todayUTCString`
                    if (daysToMatch.includes(currentDate.getUTCDay()) && !exceptions.includes(currentOccDateString)) {
                        allPossibleOccurrences.push({
                            eventData: eventData,
                            occurrenceDate: new Date(currentDate), // Keep as Date object for sorting
                            originalEventId: eventId
                        });
                    }
                    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                }
            } else { // One-time event
                const eventDateString = new Date(eventData.eventDate + 'T00:00:00Z').toISOString().split('T')[0];
                // MODIFIED CODE: Removed filtering based on `todayUTCString`
                if (!exceptions.includes(eventDateString)) {
                    allPossibleOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'),
                        originalEventId: eventId
                    });
                }
            }
        });

        // Sort all possible occurrences by date and then by time (this remains the same and is crucial)
        allPossibleOccurrences.sort((a, b) => {
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
            return dateTimeA - dateTimeB;
        });

        // MODIFIED CODE: Find the very first event in the sorted list (which will be the earliest)
        let nextEvent = allPossibleOccurrences.length > 0 ? allPossibleOccurrences[0] : null;

        if (nextEvent) {
            console.log("Found earliest event:", nextEvent.eventData.eventName, "on", nextEvent.occurrenceDate.toISOString().split('T')[0], "at", nextEvent.eventData.startTime);
            const cardDiv = document.createElement('div');
            cardDiv.className = 'event-card display-event-card'; // Use the same classes as schedule.js cards

            const formattedDate = formatDate(nextEvent.occurrenceDate.toISOString().split('T')[0]);
            const formattedStartTime = formatTime(nextEvent.eventData.startTime);
            const formattedEndTime = formatTime(nextEvent.eventData.endTime);

            // Re-fetch the eventData from Firestore to ensure we have the most up-to-date data for the card
            // This part is generally fine, though if 'nextEvent.eventData' already contains all needed fields,
            // this extra fetch might not be strictly necessary unless there's a specific reason.
            const eventDocRef = doc(db, "clubs", currentClubId, "events", nextEvent.originalEventId);
            const eventSnap = await getDoc(eventDocRef);
            let eventDataToDisplay = nextEvent.eventData; // Fallback to what we have
            if (eventSnap.exists()) {
                eventDataToDisplay = eventSnap.data();
            }


            cardDiv.innerHTML = `
                <h3>${eventDataToDisplay.eventName}</h3>
                <p>Date: ${formattedDate}</p>
                <p>Time: ${formattedStartTime} - ${formattedEndTime}</p>
                <p>Address: ${eventDataToDisplay.address}</p>
                <p>Location: ${eventDataToDisplay.location}</p>
                ${eventDataToDisplay.notes ? `<p>Notes: ${eventDataToDisplay.notes}</p>` : ''}
            `;

            // Clear previous content and append the new card
            upcomingEventDisplay.innerHTML = '';
            upcomingEventDisplay.appendChild(cardDiv);

        } else {
            console.log("No events found at all."); // Adjusted message
            upcomingEventDisplay.innerHTML = '<p class="fancy-black-label">No events scheduled.</p>'; // Adjusted message
        }

    } catch (error) {
        console.error("Error fetching event:", error); // Adjusted error message
        upcomingEventDisplay.innerHTML = '<p class="fancy-black-label">Error loading event.</p>'; // Adjusted error message
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const viewScheduleButton = document.getElementById('viewScheduleButton');

    if (viewScheduleButton) {
        viewScheduleButton.addEventListener('click', () => {
            // clubId is a global constant in club_page_member.js
            window.location.href = `schedule.html?clubId=${clubId}&returnTo=member`;
        });
    } else {
        console.warn("Element with ID 'viewScheduleButton' not found. Schedule button functionality may be impacted.");
    }
});
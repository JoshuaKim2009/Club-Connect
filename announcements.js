import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js'; // Assuming dialog.js is present and correct

// Your web app's Firebase configuration (copied from your club_page_manager.js)
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

// Global variables to store authentication and club information
let currentUser = null;     // Will store the authenticated Firebase user object (Firebase User object)
let clubId = null;          // Will store the club ID from the URL (string)
let currentUserRole = null; // Will store the user's role for THIS club ('manager', 'admin', 'member', 'guest')

// Get references to key DOM elements for the Announcements page
const clubAnnouncementsTitle = document.getElementById('clubAnnouncementsTitle');
const addAnnouncementButton = document.getElementById('add-announcement-button');
const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');


// --- Helper Functions ---

// Function to get a query parameter from the URL
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Function to get the current user's role for the specific club
async function getMemberRoleForClub(clubID, memberUid) {
  if (!clubID || !memberUid) return null; // No role if club or user is missing
  try {
    const memberRoleRef = doc(db, "clubs", clubID, "members", memberUid);
    const memberRoleSnap = await getDoc(memberRoleRef);
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      // Fallback: Check if user is the manager directly in the club document
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef);
      if (clubSnap.exists() && clubSnap.data().managerUid === memberUid) {
          return 'manager';
      }
      return 'member'; // Default to 'member' if no specific role document and not the direct manager
    }
  } catch (error) {
    console.error(`Error fetching role for user ${memberUid} in club ${clubID}:`, error);
    return null; // Return null on error
  }
}

// Function to go back to the club manager/member page
window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo');

    console.log("goToClubPage: clubId = ", currentClubId);
    console.log("goToClubPage: returnToPage = ", returnToPage);

    if (currentClubId) {
        let redirectUrl = 'your_clubs.html'; // Default fallback

        if (returnToPage === 'manager') {
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        } else if (returnToPage === 'member') {
            redirectUrl = `club_page_member.html?id=${currentClubId}`;
        } else {
            console.warn("Invalid or missing 'returnTo' parameter, defaulting to manager page.");
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        }
        window.location.href = redirectUrl;
    } else {
        window.location.href = 'your_clubs.html';
    }
}

// --- Authentication State Listener ---
// This runs whenever the user's authentication state changes
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user) {
        // User is signed in
        if (clubId) {
            const clubRef = doc(db, "clubs", clubId);
            try {
                const clubSnap = await getDoc(clubRef);
                if (clubSnap.exists()) {

                    // Fetch current user's role for this club
                    currentUserRole = await getMemberRoleForClub(clubId, currentUser.uid);
                    console.log(`User ${currentUser.uid} role for club ${clubId}: ${currentUserRole}`);

                    // Show/hide the "Add Announcement" button based on role
                    if (addAnnouncementButton) {
                        if (currentUserRole === 'manager' || currentUserRole === 'admin') {
                            addAnnouncementButton.style.display = 'block'; // Show button
                        } else {
                            addAnnouncementButton.style.display = 'none'; // Hide button
                        }
                    }

                    // Placeholder to fetch and display announcements
                    fetchAndDisplayAnnouncements();

                } else {
                    // Club document not found
                    if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Announcements (Club Not Found)";
                    if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
                }
            } catch (error) {
                console.error("Error fetching club details or user role:", error);
                if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Error Loading Announcements";
                if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">An error occurred while loading club details.</p>`;
                if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
            }
        } else {
            // No clubId found in the URL
            if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Error: No Club ID Provided";
            if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">Please return to your clubs page and select a club to view its announcements.</p>`;
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
        }
    } else {
        // No user is signed in, redirect to the login page
        console.log("No user authenticated on announcements page. Redirecting to login.");
        if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Not Authenticated";
        if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">You must be logged in to view club announcements. Redirecting...</p>`;
        if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000); // Redirect after a short delay
    }
});

// --- "Add Announcement" button handler ---
if (addAnnouncementButton) {
    addAnnouncementButton.addEventListener('click', () => {
        console.log('Add Announcement button clicked');
        // In a real application, this would open a form or modal to create a new announcement.
        showAppAlert("You clicked the 'Add Announcement' button! This is where you'd open a form to create a new announcement.");
    });
}

// --- Placeholder for fetching and displaying announcements (to be expanded later) ---
async function fetchAndDisplayAnnouncements() {
    if (!clubId) {
        console.warn("fetchAndDisplayAnnouncements called without a clubId.");
        if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">No club selected.</p>';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
        return;
    }

    // Clear existing announcements
    if (announcementsContainer) {
        announcementsContainer.innerHTML = ''; // Clear previous content
    }

    console.log(`Fetching announcements for club ID: ${clubId}`);
    const announcementsRef = collection(db, "clubs", clubId, "announcements");
    // Example query: order by creation date (you'll need to add a 'createdAt' field to announcements)
    const q = query(announcementsRef, orderBy("createdAt", "desc")); 

    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
            console.log("No announcements found for this club.");
            return;
        }

        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none'; // Hide "no announcements" message

        querySnapshot.forEach((doc) => {
            const announcementData = doc.data();
            const announcementId = doc.id;
            
            // Create a simple display card for each announcement
            const announcementCard = document.createElement('div');
            announcementCard.className = 'announcement-card';
            announcementCard.innerHTML = `
                <h3>${announcementData.title || 'No Title'}</h3>
                <p>${announcementData.content || 'No content provided.'}</p>
                ${announcementData.createdAt ? `<small>Posted: ${new Date(announcementData.createdAt.toDate()).toLocaleString()}</small>` : ''}
                ${announcementData.createdBy ? `<small> by ${announcementData.createdBy}</small>` : ''}
            `;
            announcementsContainer.appendChild(announcementCard);
        });
        console.log(`Displayed ${querySnapshot.size} announcements.`);

    } catch (error) {
        console.error("Error fetching announcements:", error);
        if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">Error loading announcements. Please try again later.</p>';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
    }
}

// You will likely add more functions here for:
// - Creating new announcements (e.g., saveAnnouncement)
// - Editing announcements (e.g., editAnnouncement)
// - Deleting announcements (e.g., deleteAnnouncement)
// - Displaying individual announcement details

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let isEditingAnnouncement = false; // Flag to prevent multiple editing cards

// Get references to key DOM elements for the announcements page
const clubAnnouncementsTitle = document.getElementById('clubAnnouncementsTitle');
const announcementsContainer = document.getElementById('announcementsContainer'); // This will hold announcement cards
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage'); // Message for when no announcements are found
const addAnnouncementButton = document.getElementById('add-announcement-button'); // Button to add new announcements

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
onAuthStateChanged(auth, async (user) => {
    currentUser = user; // Update the global currentUser variable
    clubId = getUrlParameter('clubId'); // Get the clubId from the current page's URL

    if (user) {
        // User is signed in
        if (clubId) {
            // Club ID is present in the URL, try to fetch club details to set the title
            const clubRef = doc(db, "clubs", clubId);
            try {
                const clubSnap = await getDoc(clubRef);
                if (clubSnap.exists()) {

                    // Fetch current user's role for this club
                    currentUserRole = await getMemberRoleForClub(clubId, currentUser.uid);
                    console.log(`User ${currentUser.uid} role for club ${clubId}: ${currentUserRole}`);

                    await fetchAndDisplayAnnouncements();
                    
                    if (addAnnouncementButton) {
                        if (currentUserRole === 'manager' || currentUserRole === 'admin') {
                            addAnnouncementButton.style.display = 'block'; // Show button
                            // Attach the event listener for adding a new announcement
                            addAnnouncementButton.removeEventListener('click', addNewAnnouncementEditingCard); // Prevent duplicates
                            addAnnouncementButton.addEventListener('click', addNewAnnouncementEditingCard);
                        } else {
                            addAnnouncementButton.style.display = 'none'; // Hide button if not manager/admin
                        }
                    }

                } else {
                    // Club document not found in Firestore
                    if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Club Announcements (Club Not Found)";
                    if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
                }
            } catch (error) {
                // Error fetching club details or role
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


// Helper to format date for display
function formatTimestamp(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'N/A';
    const date = timestamp.toDate();
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };
    return date.toLocaleDateString(undefined, options);
}

/**
 * Creates an editing card element for adding or modifying announcements.
 * @param {object} initialData - The initial data to populate the form (e.g., existing announcement).
 * @param {boolean} isNewAnnouncement - True if creating a new announcement, false if editing an existing one.
 * @param {string|null} announcementIdToUpdate - The ID of the announcement being updated, or null for new.
 * @returns {HTMLElement} The created editing card DOM element.
 */
function _createEditingCardElement(initialData = {}, isNewAnnouncement = true, announcementIdToUpdate = null) {
    isEditingAnnouncement = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card editing-announcement-card';
    cardDiv.dataset.editId = announcementIdToUpdate || `new-${Date.now()}`; // Use actual ID or temporary for new
    cardDiv.dataset.isNewAnnouncement = isNewAnnouncement;

    cardDiv.innerHTML = `
        <div>
            <label for="edit-title-${cardDiv.dataset.editId}">Title:</label>
            <input type="text" id="edit-title-${cardDiv.dataset.editId}" value="${initialData.title || ''}" required>
        </div>
        <div>
            <label for="edit-content-${cardDiv.dataset.editId}">Content:</label>
            <textarea id="edit-content-${cardDiv.dataset.editId}" rows="5" required>${initialData.content || ''}</textarea>
        </div>

        <div class="announcement-card-actions">
            <button class="save-btn">SAVE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        console.log('SAVE button clicked for editing card:', cardDiv.dataset.editId);
        await saveAnnouncement(cardDiv, announcementIdToUpdate);
        isEditingAnnouncement = false;
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        console.log('CANCEL button clicked for editing card:', cardDiv.dataset.editId);
        cardDiv.remove();
        isEditingAnnouncement = false;
        if (!isNewAnnouncement) {
            await fetchAndDisplayAnnouncements(); // Re-render if canceling an edit
        } else if (announcementsContainer && announcementsContainer.querySelectorAll('.announcement-card').length === 0 && noAnnouncementsMessage) {
            noAnnouncementsMessage.style.display = 'block';
        }
    });

    return cardDiv;
}

/**
 * Adds a new, empty editing card to the top of the announcements list.
 */
async function addNewAnnouncementEditingCard() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to add announcements.");
        return;
    }
    if (isEditingAnnouncement) {
        await showAppAlert("Please finish editing the current announcement before adding a new one.");
        return;
    }

    const newCardElement = _createEditingCardElement({}, true); // true indicates it's a new announcement

    if (announcementsContainer) {
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';
        announcementsContainer.prepend(newCardElement);
    }
}

/**
 * Saves a new or updated announcement to Firestore.
 * @param {HTMLElement} cardDiv - The editing announcement card element.
 * @param {string|null} existingAnnouncementId - The ID of an existing announcement if updating.
 */
async function saveAnnouncement(cardDiv, existingAnnouncementId = null) {
    const tempDomId = cardDiv.dataset.editId;
    const isNewAnnouncement = cardDiv.dataset.isNewAnnouncement === 'true';

    // --- Collect Data from Input Fields ---
    const title = cardDiv.querySelector(`#edit-title-${tempDomId}`).value.trim();
    const content = cardDiv.querySelector(`#edit-content-${tempDomId}`).value.trim();

    // --- Basic Validation ---
    if (!title) { await showAppAlert("Announcement Title is required!"); return; }
    if (!content) { await showAppAlert("Announcement Content is required!"); return; }
    // As per Firestore rules, title and content size must be > 0
    if (title.length === 0) { await showAppAlert("Announcement Title cannot be empty!"); return; }
    if (content.length === 0) { await showAppAlert("Announcement Content cannot be empty!"); return; }

    // --- Prepare Announcement Data Object ---
    const announcementDataToSave = {
        title,
        content,
        createdByUid: currentUser.uid,
        createdByName: currentUser.displayName || "Anonymous",
        clubId: clubId // Ensure clubId is correctly set based on the path
    };

    try {
        const announcementsRef = collection(db, "clubs", clubId, "announcements");

        if (existingAnnouncementId) {
            // Updating an existing announcement
            const announcementDocRef = doc(announcementsRef, existingAnnouncementId);
            await updateDoc(announcementDocRef, announcementDataToSave); // Do not update createdAt
            await showAppAlert("Announcement updated successfully!");
        } else {
            // Adding a brand new announcement
            announcementDataToSave.createdAt = serverTimestamp(); // Only set on creation
            const newDocRef = await addDoc(announcementsRef, announcementDataToSave); // Capture the new document reference
            const newAnnouncementId = newDocRef.id; // Get the ID of the newly created announcement

            // NEW: Mark the creator as having read their own announcement
            // This ensures the readBy subcollection is initialized and the creator isn't counted as 'unread' for their own post
            await setDoc(doc(db, "clubs", clubId, "announcements", newAnnouncementId, "readBy", currentUser.uid), {
                userId: currentUser.uid,
                userName: currentUser.displayName || "Anonymous",
                readAt: serverTimestamp()
            });
            console.log(`Creator ${currentUser.displayName} (${currentUser.uid}) marked announcement ${newAnnouncementId} as read upon creation.`);

            await showAppAlert("New announcement added successfully!");
        }
        
        cardDiv.remove(); // Remove the editing card after saving
        isEditingAnnouncement = false;
        await fetchAndDisplayAnnouncements(); // Re-fetch and display all announcements to update UI

    } catch (error) {
        console.error("Error saving announcement:", error);
        isEditingAnnouncement = false;
        await showAppAlert("Failed to save announcement: " + error.message);
    }
}

/**
 * Fetches and displays all announcements for the current club.
 */
async function fetchAndDisplayAnnouncements() {
    if (!clubId) {
        console.warn("fetchAndDisplayAnnouncements called without a clubId.");
        if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">No club selected.</p>';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
        return;
    }

    // Clear existing announcements before fetching new ones
    if (announcementsContainer) {
        announcementsContainer.innerHTML = '';
    }

    console.log(`Fetching announcements for club ID: ${clubId}`);
    const announcementsRef = collection(db, "clubs", clubId, "announcements");
    // Order announcements by creation time, newest first
    const q = query(announcementsRef, orderBy("createdAt", "desc"));

    try {
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.log("No announcements found for this club.");
            if (currentUserRole === 'member') {
                if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">NO ANNOUNCEMENTS YET</p>';
                if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
            } else {
                // If manager/admin and no announcements, don't show a "no announcements" message.
                // The add button is already visible for them to create one.
                if (announcementsContainer) announcementsContainer.innerHTML = '';
                if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';
            }
            return;
        }

        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none'; // Hide "no announcements" message

        querySnapshot.forEach((doc) => {
            const announcementData = doc.data();
            const announcementId = doc.id;
            const announcementDisplayCard = _createAnnouncementDisplayCard(announcementData, announcementId);
            if (announcementsContainer) {
                announcementsContainer.appendChild(announcementDisplayCard);
            }
        });
        console.log(`Displayed ${querySnapshot.size} announcements.`);

    } catch (error) {
        console.error("Error fetching announcements:", error);
        if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">Error loading announcements. Please try again later.</p>';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
    }
}

/**
 * Creates a display card element for a single announcement.
 * @param {object} announcementData - The data of the announcement.
 * @param {string} announcementId - The ID of the announcement document.
 * @returns {HTMLElement} The created announcement display card DOM element.
 */
function _createAnnouncementDisplayCard(announcementData, announcementId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card display-announcement-card';
    cardDiv.dataset.announcementId = announcementId;

    const canEditDelete = (currentUserRole === 'manager' || currentUserRole === 'admin');
    let actionButtonsHtml = '';

    if (canEditDelete) {
        actionButtonsHtml = `
            <div class="announcement-card-actions">
                <button class="edit-btn" data-announcement-id="${announcementId}">EDIT</button>
                <button class="delete-btn" data-announcement-id="${announcementId}">DELETE</button>
            </div>
        `;
    }

    cardDiv.innerHTML = `
        <h3>${announcementData.title}</h3>
        <p>${announcementData.content}</p>
        <p class="announcement-meta">Posted by: ${announcementData.createdByName} on ${formatTimestamp(announcementData.createdAt)}</p>
        ${actionButtonsHtml}
    `;

    // Attach event listeners for edit/delete buttons
    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => editAnnouncement(announcementId));
        }

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => deleteAnnouncement(announcementId, announcementData.title));
        }
    }

    markAnnouncementAsRead(announcementId);

    return cardDiv;
}

/**
 * Initiates the editing process for an existing announcement.
 * @param {string} announcementId - The ID of the announcement to edit.
 */
async function editAnnouncement(announcementId) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to edit announcements.");
        return;
    }
    if (isEditingAnnouncement) {
        await showAppAlert("Please finish editing the current announcement before starting another edit.");
        return;
    }

    try {
        const announcementDocRef = doc(db, "clubs", clubId, "announcements", announcementId);
        const announcementSnap = await getDoc(announcementDocRef);

        if (!announcementSnap.exists()) {
            await showAppAlert("Error: Announcement not found.");
            return;
        }

        const announcementData = announcementSnap.data();

        // Find the display card in the DOM that corresponds to this edit action
        const targetDisplayCard = announcementsContainer.querySelector(`.announcement-card[data-announcement-id="${announcementId}"]`);
        if (!targetDisplayCard) {
            console.error("Could not find the target display card in the DOM for editing.");
            await showAppAlert("Could not find the announcement card to edit. Please refresh.");
            return;
        }

        // Create the editing card, populated with existing data
        const editingCard = _createEditingCardElement(announcementData, false, announcementId); // false for not new
        targetDisplayCard.replaceWith(editingCard); // Replace display card with editing card

    } catch (error) {
        console.error("Error initiating announcement edit:", error);
        await showAppAlert("Failed to start announcement edit: " + error.message);
    }
}

/**
 * Deletes an announcement from Firestore.
 * @param {string} announcementId - The ID of the announcement to delete.
 * @param {string} announcementTitle - The title of the announcement for confirmation message.
 */
async function deleteAnnouncement(announcementId, announcementTitle) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to delete announcements.");
        return;
    }

    const confirmed = await showAppConfirm(`Are you sure you want to delete the announcement "${announcementTitle}"? This action cannot be undone.`);
    if (!confirmed) {
        console.log("Announcement deletion cancelled by user.");
        return;
    }

    try {
        const announcementDocRef = doc(db, "clubs", clubId, "announcements", announcementId);
        await deleteDoc(announcementDocRef);
        await showAppAlert("Announcement deleted successfully!");
        await fetchAndDisplayAnnouncements(); // Re-fetch and display announcements to update the UI
    } catch (error) {
        console.error("Error deleting announcement:", error);
        await showAppAlert("Failed to delete announcement: " + error.message);
    }
}


// Function to mark an announcement as read by the current user
async function markAnnouncementAsRead(announcementId) {
    if (!currentUser || !clubId) {
        console.warn("Cannot mark announcement as read: user not logged in or clubId missing.");
        return;
    }

    const userUid = currentUser.uid;
    const userName = currentUser.displayName || "Anonymous User"; // Fallback if displayName is not set
    
    try {
        // Reference to the 'readBy' subcollection under the specific announcement
        const readByRef = collection(db, "clubs", clubId, "announcements", announcementId, "readBy");
        // Document reference for this specific user's read status
        const userReadDocRef = doc(readByRef, userUid); 

        const userReadSnap = await getDoc(userReadDocRef);

        if (!userReadSnap.exists()) {
            // If the user hasn't read it yet, record their read
            await setDoc(userReadDocRef, {
                userId: userUid,
                userName: userName,
                readAt: serverTimestamp() // Record the time it was read
            });
            console.log(`User ${userName} (${userUid}) marked announcement ${announcementId} as read.`);
        } else {
            console.log(`User ${userName} (${userUid}) has already read announcement ${announcementId}. No update needed.`);
        }
    } catch (error) {
        console.error("Error marking announcement as read:", error);
    }
}

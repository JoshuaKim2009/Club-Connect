import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

// Get references to key DOM elements you'll likely use
const clubScheduleTitle = document.getElementById('clubScheduleTitle');
const eventsContainer = document.getElementById('eventsContainer'); // This will eventually hold event cards
const noEventsMessage = document.getElementById('noEventsMessage'); // Message for when no events are found
const addEventButton = document.getElementById('add-event-button'); // Button to add new events


// --- Helper Functions ---

// Function to get a query parameter from the URL
// IMPORTANT: This assumes club_page_manager.js navigates to schedule.html with "?clubId=..."
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
      // Fallback: Check if user is the manager directly in the club document (legacy or direct manager)
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

// Function to go back to the club manager page
// This is made global so the onclick="goToClubPage()" in schedule.html can find it.
// IMPORTANT: This uses 'clubId' to retrieve the ID from schedule.html's URL,
//            and then passes it as 'id' to club_page_manager.html.
window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId'); // Get the clubId from *this* page's URL (schedule.html)
    if (currentClubId) {
        // Pass it back to club_page_manager.html using the 'id' parameter name
        window.location.href = `club_page_manager.html?id=${currentClubId}`;
    } else {
        window.location.href = 'your_clubs.html'; // Fallback to the general clubs list
    }
}


// --- Authentication State Listener ---
// This runs whenever the user's authentication state changes (on page load and sign in/out)
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
                    // Set the H1 title using the club's name from Firestore
                    if (clubScheduleTitle) { // Check if the element exists
                        clubScheduleTitle.textContent = `${clubSnap.data().clubName} Schedule`;
                    }

                    // Fetch current user's role for this club
                    currentUserRole = await getMemberRoleForClub(clubId, currentUser.uid);
                    console.log(`User ${currentUser.uid} role for club ${clubId}: ${currentUserRole}`);

                    
                    if (addEventButton) {
                        if (currentUserRole === 'manager' || currentUserRole === 'admin') {
                            addEventButton.style.display = 'block'; // Show button
                            // Attach the event listener for adding a new event
                            // Use remove/add to prevent multiple listeners if auth state changes multiple times
                            addEventButton.removeEventListener('click', addNewEventEditingCard);
                            addEventButton.addEventListener('click', addNewEventEditingCard);
                        } else {
                            addEventButton.style.display = 'none'; // Hide button if not manager/admin
                        }
                    }

                } else {
                    // Club document not found in Firestore
                    if (clubScheduleTitle) clubScheduleTitle.textContent = "Club Schedule (Club Not Found)";
                    if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addEventButton) addEventButton.style.display = 'none'; // Hide button if club not found
                }
            } catch (error) {
                // Error fetching club details or role
                console.error("Error fetching club details or user role:", error);
                if (clubScheduleTitle) clubScheduleTitle.textContent = "Error Loading Schedule";
                if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">An error occurred while loading club details.</p>`;
                if (addEventButton) addEventButton.style.display = 'none'; // Hide button on error
            }
        } else {
            // No clubId found in the URL
            if (clubScheduleTitle) clubScheduleTitle.textContent = "Error: No Club ID Provided";
            if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Please return to your clubs page and select a club to view its schedule.</p>`;
            if (addEventButton) addEventButton.style.display = 'none'; // Hide button if no clubId
        }
    } else {
        // No user is signed in, redirect to the login page
        console.log("No user authenticated on schedule page. Redirecting to login.");
        if (clubScheduleTitle) clubScheduleTitle.textContent = "Not Authenticated";
        if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">You must be logged in to view club schedule. Redirecting...</p>`;
        if (addEventButton) addEventButton.style.display = 'none'; // Hide button if not authenticated
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000); // Redirect after a short delay
    }
});



function _createEditingCardElement(initialData = {}, isNewEvent = true) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card editing-event-card'; // Add both classes
    const daysOfWeekOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    // Generate a temporary unique ID for this new card in the DOM
    // This is useful for linking labels to inputs if you have multiple editing cards.
    const tempDomId = `new-${Date.now()}`;
    cardDiv.dataset.tempId = tempDomId; // Store it as a data attribute

    const eventNameInputFieldHtml = `
        <div>
            <label for="edit-name-${tempDomId}">Event Name:</label>
            <input type="text" id="edit-name-${tempDomId}" value="${initialData.eventName || ''}" required>
        </div>
    `;

    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    const weeklyEventCheckboxHtml = `
        <div class="weekly-event-checkbox">
            <label>
                <input type="checkbox" id="edit-is-weekly-${tempDomId}" ${isWeeklyChecked}>
                Weekly Event
            </label>
        </div>
    `;

    const weeklyStartDateInputFieldHtml = `
        <div id="weekly-start-date-group-${tempDomId}" style="display: ${initialData.isWeekly ? 'block' : 'none'};">
            <label for="edit-weekly-start-date-${tempDomId}">Weekly Recurrence Start Date:</label>
            <input type="date" id="edit-weekly-start-date-${tempDomId}" value="${initialData.weeklyStartDate || ''}" ${!initialData.isWeekly ? 'disabled' : ''} required>
        </div>
    `;

    const weeklyEndDateInputFieldHtml = `
        <div id="weekly-end-date-group-${tempDomId}" style="display: ${initialData.isWeekly ? 'block' : 'none'};">
            <label for="edit-weekly-end-date-${tempDomId}">Weekly Recurrence End Date:</label>
            <input type="date" id="edit-weekly-end-date-${tempDomId}" value="${initialData.weeklyEndDate || ''}" ${!initialData.isWeekly ? 'disabled' : ''} required>
        </div>
    `;

    const eventDateInputFieldHtml = `
        <div id="date-input-group-${tempDomId}" style="display: ${initialData.isWeekly ? 'none' : 'block'};">
            <label for="edit-date-${tempDomId}">Event Date:</label>
            <input type="date" id="edit-date-${tempDomId}" value="${initialData.eventDate || ''}" ${initialData.isWeekly ? 'disabled' : ''} required>
        </div>
    `;

    const selectedDays = initialData.daysOfWeek || []; // Ensure this is defined
    const daysOfWeekCheckboxesHtml = `
        <div class="days-of-week-selection" id="days-of-week-group-${tempDomId}" style="display: ${initialData.isWeekly ? 'block' : 'none'};">
            <label>Days of Week:</label>
            <div class="checkbox-group">
                ${daysOfWeekOptions.map(day => `
                    <label>
                        <input type="checkbox" value="${day}" ${selectedDays.includes(day) ? 'checked' : ''} ${!initialData.isWeekly ? 'disabled' : ''}>
                        ${day}
                    </label>
                `).join('')}
            </div>
        </div>
    `;

    const startTimeInputFieldHtml = `
        <div>
            <label for="edit-start-time-${tempDomId}">Start Time:</label>
            <input type="time" id="edit-start-time-${tempDomId}" value="${initialData.startTime || ''}"required>
        </div>
    `;

    const endTimeInputFieldHtml = `
        <div>
            <label for="edit-end-time-${tempDomId}">End Time:</label>
            <input type="time" id="edit-end-time-${tempDomId}" value="${initialData.endTime || ''}"required>
        </div>
    `;

    const eventAddressInputFieldHtml = `
        <div>
            <label for="edit-address-${tempDomId}">Address:</label>
            <input type="text" id="edit-address-${tempDomId}" value="${initialData.address || ''}"required>
        </div>
    `;
    const eventLocationInputFieldHtml = `
        <div>
            <label for="edit-location-${tempDomId}">Location (e.g., Room 132):</label>
            <input type="text" id="edit-location-${tempDomId}" value="${initialData.location || ''}"required>
        </div>
    `;

    const eventNotesInputFieldHtml = `
        <div>
            <label for="edit-notes-${tempDomId}">Notes (Optional):</label>
            <input type="text" id="edit-notes-${tempDomId}" value="${initialData.notes || ''}">
        </div>
    `;

    

    cardDiv.innerHTML = `
        ${eventNameInputFieldHtml}
        ${weeklyEventCheckboxHtml}
        ${eventDateInputFieldHtml}
        ${daysOfWeekCheckboxesHtml}
        ${weeklyStartDateInputFieldHtml}
        ${weeklyEndDateInputFieldHtml}
        ${startTimeInputFieldHtml}
        ${endTimeInputFieldHtml}
        ${eventAddressInputFieldHtml}
        ${eventLocationInputFieldHtml}
        ${eventNotesInputFieldHtml}
        
        <!-- You will add more input fields here, following the same template pattern -->
        <!-- Example for a date field: -->
        <!--
        <div>
            <label for="edit-date-${tempDomId}">Date:</label>
            <input type="date" id="edit-date-${tempDomId}" value="${initialData.eventDate || ''}">
        </div>
        -->

        <div class="event-card-actions">
            <button class="save-btn">SAVE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    const isWeeklyCheckbox = cardDiv.querySelector(`#edit-is-weekly-${tempDomId}`);
    const dateInputGroup = cardDiv.querySelector(`#date-input-group-${tempDomId}`);
    const eventDateInput = cardDiv.querySelector(`#edit-date-${tempDomId}`); // The actual date input
    const daysOfWeekGroup = cardDiv.querySelector(`#days-of-week-group-${tempDomId}`);
    const weeklyStartDateGroup = cardDiv.querySelector(`#weekly-start-date-group-${tempDomId}`);
    const weeklyEndDateGroup = cardDiv.querySelector(`#weekly-end-date-group-${tempDomId}`);
    const weeklyStartDateInput = cardDiv.querySelector(`#edit-weekly-start-date-${tempDomId}`);
    const weeklyEndDateInput = cardDiv.querySelector(`#edit-weekly-end-date-${tempDomId}`);

    if (isWeeklyCheckbox && dateInputGroup && eventDateInput && daysOfWeekGroup && weeklyStartDateGroup && weeklyEndDateGroup && weeklyStartDateInput && weeklyEndDateInput) {
        // Function to toggle display and disabled states
        const toggleRecurringFields = () => {
            const isChecked = isWeeklyCheckbox.checked;

            // Toggle Date Input Group
            dateInputGroup.style.display = isChecked ? 'none' : 'block';
            eventDateInput.disabled = isChecked; // Disable actual date input when hidden

            // Toggle Days of Week Group
            daysOfWeekGroup.style.display = isChecked ? 'block' : 'none';
            daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                checkbox.disabled = !isChecked; // Disable checkboxes when hidden
            });

            // Toggle Weekly Start Date Group
            weeklyStartDateGroup.style.display = isChecked ? 'block' : 'none';
            weeklyStartDateInput.disabled = !isChecked;
            // Toggle Weekly End Date Group
            weeklyEndDateGroup.style.display = isChecked ? 'block' : 'none';
            weeklyEndDateInput.disabled = !isChecked;

            // Set required attributes based on weekly status
            if(isChecked) {
                weeklyStartDateInput.setAttribute('required', 'true');
                weeklyEndDateInput.setAttribute('required', 'true');
            } else {
                weeklyStartDateInput.removeAttribute('required');
                weeklyEndDateInput.removeAttribute('required');
            }

            // --- Clear relevant fields based on state change for data consistency ---
            if(isChecked) {
                eventDateInput.value = ''; // Clear date if becoming weekly
                eventDateInput.removeAttribute('required'); // Remove required if becoming weekly
            } else {
                daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false; // Uncheck all days if not weekly
                });
                weeklyStartDateInput.value = ''; // Clear weekly start date if not weekly
                weeklyEndDateInput.value = ''; // Clear weekly end date if not weekly
                eventDateInput.setAttribute('required', 'true'); // Add required back if not weekly
            }
        };

        // Attach event listener
        isWeeklyCheckbox.addEventListener('change', toggleRecurringFields);

        // Call once on creation to set initial state based on initialData
        // This ensures the fields are correctly shown/hidden when the card first appears
        toggleRecurringFields();
    }

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        console.log('SAVE button clicked for new event card:', tempDomId);
        // You'll add Firebase saving logic here later
        await showAppAlert("Save functionality not yet implemented!");
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        console.log('CANCEL button clicked for new event card:', tempDomId);
        // Remove the card from the DOM
        cardDiv.remove();
        // If no other event cards remain, show the "no events" message
        if (eventsContainer && eventsContainer.querySelectorAll('.event-card').length === 0 && noEventsMessage) {
            noEventsMessage.style.display = 'block';
        }
        await showAppAlert("Event creation cancelled.");
    });

    return cardDiv;
}


async function addNewEventEditingCard() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to add events.");
        return;
    }

    // Create the new editing card element
    const newCardElement = _createEditingCardElement({}, true); // true indicates it's a new event

    // Insert the new card into the DOM
    if (eventsContainer) {
        const header = eventsContainer.querySelector('h3.fancy-label');
        if (header) {
            header.after(newCardElement); 
            if (noEventsMessage) noEventsMessage.style.display = 'none'; // Hide "no events" message
        } else {
            eventsContainer.appendChild(newCardElement);
        }
    }
}
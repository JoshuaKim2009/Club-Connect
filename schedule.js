import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

                    await fetchAndDisplayEvents(); 
                    
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

async function cancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to cancel the event on ${occurrenceDateString}? It will no longer appear on the schedule.`);
    if (!confirmed) {
        console.log("Cancellation cancelled by user.");
        return;
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventId);
        const eventSnap = await getDoc(eventDocRef);

        if (!eventSnap.exists()) {
            await showAppAlert("Error: Event not found.");
            return;
        }

        const eventData = eventSnap.data();
        const existingExceptions = eventData.exceptions || [];

        // Temporarily add the current occurrence to check if it's the last one
        const hypotheticalExceptions = [...existingExceptions, occurrenceDateString];

        // --- Calculate active occurrences with hypothetical exceptions ---
        let activeOccurrencesCount = 0;
        if (eventData.isWeekly) {
            const startDate = new Date(eventData.weeklyStartDate);
            const endDate = new Date(eventData.weeklyEndDate);
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

            let currentDate = new Date(startDate);
            // Ensure currentDate doesn't go beyond the end date
            while (currentDate <= endDate) {
                const currentOccDateString = currentDate.toISOString().split('T')[0];
                if (daysToMatch.includes(currentDate.getDay()) && !hypotheticalExceptions.includes(currentOccDateString)) {
                    activeOccurrencesCount++;
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
        } else {
            // If this function is called for a one-time event, it means we are trying to delete it.
            // If it's a one-time event, and we're cancelling it, it *is* the last instance.
            activeOccurrencesCount = 0; // Force delete logic for one-time events
        }

        if (activeOccurrencesCount === 0) {
            // This is the last remaining active occurrence, so prompt to delete the entire event document
            const finalConfirm = await showAppConfirm("This is the last active instance of this event. Do you want to delete the entire event?");
            if (finalConfirm) {
                deleteEntireEvent(eventId, eventData.isWeekly); // Call the function to delete the entire document
                await showAppAlert("Last event instance canceled, entire event deleted.");
            } else {
                console.log("Deletion of entire event declined by user. Cancelling just this instance.");
                // User decided not to delete the series, so just add to exceptions
                await updateDoc(eventDocRef, {
                    exceptions: arrayUnion(occurrenceDateString)
                });
                await showAppAlert(`Event on ${occurrenceDateString} has been canceled.`);
            }
        } else {
            // Not the last instance, just add to exceptions
            await updateDoc(eventDocRef, {
                exceptions: arrayUnion(occurrenceDateString)
            });
            await showAppAlert(`Event on ${occurrenceDateString} has been canceled.`);
        }

        await fetchAndDisplayEvents(); // Re-fetch and display events to update the UI
    } catch (error) {
        console.error("Error canceling single event occurrence:", error);
        await showAppAlert("Failed to cancel event occurrence: " + error.message);
    }
}


async function uncancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to un-cancel the event on ${occurrenceDateString}? It will reappear on the schedule.`);
    if (!confirmed) {
        console.log("Un-cancellation cancelled by user.");
        return;
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventId);
        // Remove the date string from the 'exceptions' array
        await updateDoc(eventDocRef, {
            exceptions: arrayRemove(occurrenceDateString)
        });
        await showAppAlert(`Event on ${occurrenceDateString} has been un-canceled.`);
        await fetchAndDisplayEvents(); // Re-fetch and display events to update the UI
    } catch (error) {
        console.error("Error un-canceling single event occurrence:", error);
        await showAppAlert("Failed to un-cancel event occurrence: " + error.message);
    }
}

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
        await saveEvent(cardDiv);
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
        // Ensure noEventsMessage is hidden if an editing card is present
        if (noEventsMessage) noEventsMessage.style.display = 'none';

        // Prepend the new card to the eventsContainer, placing it at the very beginning
        eventsContainer.prepend(newCardElement);
    }
}



function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    try {
        return new Date(dateString).toLocaleDateString(undefined, options);
    } catch (e) {
        return dateString; // Return original if invalid date string
    }
}

// Helper to format days of week for display (assuming you have this, if not, add it)
function formatDaysOfWeek(daysArray) {
    if (!daysArray || daysArray.length === 0) return 'N/A';
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // Define order
    return daysArray.sort((a, b) => daysOrder.indexOf(a) - daysOrder.indexOf(b)).join(', ');
}


/**
 * Saves a new event to Firestore.
 * This function is designed to be called when the "SAVE" button on an editing card is clicked.
 * It currently only handles NEW events.
 * @param {HTMLElement} cardDiv - The editing event card element.
 */
async function saveEvent(cardDiv) {
    // For now, we only handle new events, so eventId will be the temporary DOM ID
    const eventId = cardDiv.dataset.tempId; // This is a temporary DOM ID, not a Firestore Doc ID yet
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true'; // This should always be true for now

    // --- Collect Data from Input Fields ---
    const eventName = cardDiv.querySelector(`#edit-name-${eventId}`).value.trim();
    const isWeekly = cardDiv.querySelector(`#edit-is-weekly-${eventId}`).checked;

    let eventDate = '';
    let weeklyStartDate = '';
    let weeklyEndDate = '';
    let daysOfWeek = [];

    if (isWeekly) {
        // For weekly events, collect start/end dates for recurrence and selected days
        weeklyStartDate = cardDiv.querySelector(`#edit-weekly-start-date-${eventId}`).value;
        weeklyEndDate = cardDiv.querySelector(`#edit-weekly-end-date-${eventId}`).value;
        const selectedDaysCheckboxes = cardDiv.querySelectorAll(`#days-of-week-group-${eventId} input[type="checkbox"]:checked`);
        daysOfWeek = Array.from(selectedDaysCheckboxes).map(cb => cb.value);
    } else {
        // For one-time events, collect the single event date
        eventDate = cardDiv.querySelector(`#edit-date-${eventId}`).value;
    }

    const startTime = cardDiv.querySelector(`#edit-start-time-${eventId}`).value;
    const endTime = cardDiv.querySelector(`#edit-end-time-${eventId}`).value;
    const address = cardDiv.querySelector(`#edit-address-${eventId}`).value.trim();
    const location = cardDiv.querySelector(`#edit-location-${eventId}`).value.trim();
    const notes = cardDiv.querySelector(`#edit-notes-${eventId}`).value.trim();


    // --- Basic Validation ---
    if (!eventName) {
        await showAppAlert("Event Name is required!");
        return;
    }
    if (!isWeekly && !eventDate) {
        await showAppAlert("Please provide an Event Date for one-time events.");
        return;
    }
    if (isWeekly && (!weeklyStartDate || !weeklyEndDate)) {
        await showAppAlert("Weekly events require both a start and end date for recurrence.");
        return;
    }
    if (isWeekly && daysOfWeek.length === 0) {
        await showAppAlert("Please select at least one day of the week for weekly events.");
        return;
    }
    if (!startTime || !endTime) {
        await showAppAlert("Start Time and End Time are required.");
        return;
    }
    if (!address) {
        await showAppAlert("Address is required.");
        return;
    }
    if (!location) {
        await showAppAlert("Specific Location (e.g., Room 132) is required.");
        return;
    }
    // Add more validation as needed (e.g., end time after start time, end date after start date)


    // --- Prepare Event Data Object ---
    const eventDataToSave = {
        eventName,
        isWeekly,
        startTime,
        endTime,
        address,
        location,
        notes,
        // Conditionally add date/recurrence fields
        ...(isWeekly ? { weeklyStartDate, weeklyEndDate, daysOfWeek } : { eventDate }),
        // Add creator info and timestamp
        createdAt: serverTimestamp(),
        createdByUid: currentUser.uid,
        createdByName: currentUser.displayName || "Anonymous"
    };

    try {
        // --- Add New Event to Firestore ---
        const eventsRef = collection(db, "clubs", clubId, "events");
        await addDoc(eventsRef, eventDataToSave);
        
        await showAppAlert("New event added successfully!");
        cardDiv.remove(); // Remove the editing card after saving

        // Refresh the entire list of events to show the new event in display mode
        // This will be fully implemented later. For now, it just logs.
        await fetchAndDisplayEvents();

    } catch (error) {
        console.error("Error saving event:", error);
        await showAppAlert("Failed to save event: " + error.message);
    }
}



async function fetchAndDisplayEvents() {
    if (!clubId) {
        console.warn("fetchAndDisplayEvents called without a clubId.");
        if (eventsContainer) eventsContainer.innerHTML = '<p class="fancy-label">No club selected.</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
        return;
    }

    // Clear existing events before fetching new ones
    if (eventsContainer) {
        eventsContainer.innerHTML = '';
    }

    console.log(`Fetching events for club ID: ${clubId}`);
    const eventsRef = collection(db, "clubs", clubId, "events");
    // Query events, ordering them by creation time. You might change this to order by an actual event date later.
    const q = query(eventsRef, orderBy("createdAt", "desc"));

    try {
        const querySnapshot = await getDocs(q);
        const allEventOccurrences = []; // To store all individual event occurrences, including weekly ones

        querySnapshot.forEach((doc) => {
            const eventData = doc.data();
            const eventId = doc.id;

            // Get exceptions if they exist, default to empty array
            const exceptions = eventData.exceptions || [];

            if (eventData.isWeekly) {
                // Generate occurrences for weekly events
                const startDate = new Date(eventData.weeklyStartDate);
                const endDate = new Date(eventData.weeklyEndDate);
                const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

                let currentDate = new Date(startDate);
                while (currentDate <= endDate) {
                    const currentOccDateString = currentDate.toISOString().split('T')[0];

                    if (daysToMatch.includes(currentDate.getDay())) {
                        // ONLY ADD TO DISPLAY IF NOT IN EXCEPTIONS
                        if (!exceptions.includes(currentOccDateString)) {
                            allEventOccurrences.push({
                                eventData: eventData,
                                occurrenceDate: new Date(currentDate),
                                originalEventId: eventId
                            });
                        }
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            } else {
                // For one-time events, add directly
                // One-time events don't typically have 'exceptions' but this ensures consistency
                const eventDateString = new Date(eventData.eventDate).toISOString().split('T')[0];
                if (!exceptions.includes(eventDateString)) { // This check is mostly for robustness, should rarely be true for one-time
                    allEventOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate),
                        originalEventId: eventId
                    });
                }
            }
        });

        // Sort all occurrences chronologically for display
        allEventOccurrences.sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime());

        if (allEventOccurrences.length === 0) {
            console.log("No events found for this club.");
            if (noEventsMessage) noEventsMessage.style.display = 'block';
            return;
        }

        if (noEventsMessage) noEventsMessage.style.display = 'none'; // Hide "no events" message

        // Render all sorted occurrences
        allEventOccurrences.forEach(occurrence => {
            const eventDisplayCard = _createSingleOccurrenceDisplayCard(occurrence.eventData, occurrence.occurrenceDate, occurrence.originalEventId);
            if (eventsContainer) {
                eventsContainer.appendChild(eventDisplayCard);
            }
        });
        console.log(`Displayed ${allEventOccurrences.length} event occurrences.`);

    } catch (error) {
        console.error("Error fetching events:", error);
        if (eventsContainer) eventsContainer.innerHTML = '<p class="fancy-label">Error loading events. Please try again later.</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
    }
}


function _createSingleOccurrenceDisplayCard(eventData, occurrenceDate, originalEventId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card display-event-card';
    cardDiv.dataset.originalEventId = originalEventId;
    const occurrenceDateString = occurrenceDate.toISOString().split('T')[0]; // Use for comparison and for cancellation function
    cardDiv.dataset.occurrenceDate = occurrenceDateString;

    const formattedDate = occurrenceDate.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
    });

    // Check if this specific occurrence date is in the 'exceptions' array
    const isExcepted = eventData.exceptions && eventData.exceptions.includes(occurrenceDateString);

    const canEditDelete = (currentUserRole === 'manager' || currentUserRole === 'admin');
    let actionButtonsHtml = '';

    if (canEditDelete) {
        if (eventData.isWeekly) {
            // For weekly events, offer "Cancel Instance" or "Uncancel"
            if (isExcepted) {
                actionButtonsHtml = `
                    <div class="event-card-actions">
                        <button class="uncancel-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">UN-CANCEL INSTANCE</button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">DELETE SERIES</button>
                    </div>
                `;
            } else {
                actionButtonsHtml = `
                    <div class="event-card-actions">
                        <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">EDIT INSTANCE</button>
                        <button class="cancel-instance-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">CANCEL INSTANCE</button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">DELETE SERIES</button>
                    </div>
                `;
            }
        } else {
            // For one-time events, offer standard Edit/Delete
            actionButtonsHtml = `
                <div class="event-card-actions">
                    <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">EDIT</button>
                    <button class="delete-btn" data-event-id="${originalEventId}">DELETE</button>
                </div>
            `;
        }
    }


    cardDiv.innerHTML = `
        <h3>${eventData.eventName} ${isExcepted ? '<span class="canceled-tag">(CANCELED)</span>' : ''}</h3>
        <p><strong>Date:</strong> ${formattedDate}</p>
        <p><strong>Time:</strong> ${eventData.startTime} - ${eventData.endTime}</p>
        <p><strong>Address:</strong> ${eventData.address}</p>
        <p><strong>Location:</strong> ${eventData.location}</p>
        ${eventData.notes ? `<p><strong>Notes:</strong> ${eventData.notes}</p>` : ''}
        <p class="event-meta">Created by ${eventData.createdByName} on ${eventData.createdAt ? new Date(eventData.createdAt.toDate()).toLocaleDateString() : 'N/A'}</p>
        ${actionButtonsHtml}
    `;

    // Attach event listeners for edit/delete buttons
    if (canEditDelete) {
        // Edit button (for single instance edit - more complex, leave placeholder for now)
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                const eventId = e.target.dataset.eventId;
                const occDate = e.target.dataset.occurrenceDate;
                console.log(`Edit button clicked for event ID: ${eventId}, Occurrence Date: ${occDate}`);
                showAppAlert(`Editing not yet implemented for event ID: ${eventId}, Date: ${occDate}`);
            });
        }

        // Delete One-Time Event / Delete Entire Series (calls deleteEntireEvent)
        const deleteEntireBtn = cardDiv.querySelector('.delete-btn') || cardDiv.querySelector('.delete-series-btn');
        if (deleteEntireBtn) {
            deleteEntireBtn.addEventListener('click', (e) => {
                const eventId = e.target.dataset.eventId;
                deleteEntireEvent(eventId, eventData.isWeekly); // Call the function to delete the entire document
            });
        }

        // Cancel Single Instance (for weekly events)
        const cancelInstanceBtn = cardDiv.querySelector('.cancel-instance-btn');
        if (cancelInstanceBtn) {
            cancelInstanceBtn.addEventListener('click', (e) => {
                const eventId = e.target.dataset.eventId;
                const occDateString = e.target.dataset.occurrenceDate;
                cancelSingleOccurrence(eventId, occDateString);
            });
        }

        // Uncancel Single Instance (for weekly events)
        const uncancelBtn = cardDiv.querySelector('.uncancel-btn');
        if (uncancelBtn) {
             uncancelBtn.addEventListener('click', async (e) => {
                const eventId = e.target.dataset.eventId;
                const occDateString = e.target.dataset.occurrenceDate;
                uncancelSingleOccurrence(eventId, occDateString);
             });
        }
    }

    return cardDiv;
}


async function deleteEntireEvent(eventIdToDelete, isWeeklyEvent = false) { // <--- ADDED isWeeklyEvent PARAMETER
    let confirmMessage;
    if (isWeeklyEvent) {
        confirmMessage = "Are you sure you want to delete this ENTIRE RECURRING EVENT SERIES? This action cannot be undone.";
    } else {
        confirmMessage = "Are you sure you want to delete this event? This action cannot be undone.";
    }

    const confirmed = await showAppConfirm(confirmMessage);
    if (!confirmed) {
        console.log("Event deletion cancelled by user.");
        return;
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
        await deleteDoc(eventDocRef);
        await showAppAlert("Event deleted successfully!");
        await fetchAndDisplayEvents(); // Re-fetch and display events to update the UI
    } catch (error) {
        console.error("Error deleting event:", error);
        await showAppAlert("Failed to delete event: " + error.message);
    }
}
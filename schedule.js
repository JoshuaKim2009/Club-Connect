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
            // Create Date objects in a timezone-safe way to ensure iteration starts/ends correctly in UTC context
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z'); // Force UTC midnight
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');     // Force UTC midnight
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

            let currentDate = new Date(startDate); // Start iteration from UTC midnight
            while (currentDate.getTime() <= endDate.getTime()) { // Compare timestamps for safety
                const currentOccDateString = currentDate.toISOString().split('T')[0];
                // Count this occurrence only if it's a valid day of the week AND it's NOT in the hypothetical exceptions list
                if (daysToMatch.includes(currentDate.getUTCDay()) && !hypotheticalExceptions.includes(currentOccDateString)) {
                    activeOccurrencesCount++;
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1); // <--- Use setUTCDate to increment UTC day
            }
        } else {
            // If this function is called for a one-time event, it means we are trying to delete it.
            // If it's a one-time event, and we're cancelling it, it *is* the last instance.
            activeOccurrencesCount = 0; // Force delete logic for one-time events
        }

        if (activeOccurrencesCount === 0) {
            // It IS the last active instance. Auto-delete the entire event without any further prompt.
            await deleteEntireEvent(eventId, eventData.isWeekly, true); // <--- Call deleteEntireEvent with skipConfirm = true
            //await showAppAlert("This was the last active instance. The event has been automatically deleted."); // Inform user
            // No need to update 'exceptions' or call fetchAndDisplayEvents here, as deleteEntireEvent handles that.
            return; // Exit the function here
        }

        // If not the last instance (or if the event is one-time), just add this specific occurrence to exceptions
        await updateDoc(eventDocRef, {
            exceptions: arrayUnion(occurrenceDateString)
        });
        await showAppAlert(`Event on ${occurrenceDateString} has been canceled.`);
        // fetchAndDisplayEvents is called at the end of cancelSingleOccurrence, which is correct for this branch.
        

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

function _createEditingCardElement(initialData = {}, isNewEvent = true, eventIdToUpdate = null, isEditingInstance = false, originalEventIdForInstance = null, originalOccurrenceDate = null) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card editing-event-card'; // Add both classes
    const daysOfWeekOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // If editing an existing event, its ID is known
    // If it's a new event, use a temporary DOM ID
    const currentEditId = eventIdToUpdate || `new-${Date.now()}`;
    cardDiv.dataset.editId = currentEditId; // Store actual event ID or temporary ID
    cardDiv.dataset.isNewEvent = isNewEvent;
    if (isEditingInstance) {
        cardDiv.dataset.isEditingInstance = 'true';
        cardDiv.dataset.originalEventIdForInstance = originalEventIdForInstance; // <--- CHANGED THIS LINE (using the new parameter)
        cardDiv.dataset.originalOccurrenceDate = originalOccurrenceDate; // The specific instance date
    }

    const eventNameInputFieldHtml = `
        <div>
            <label for="edit-name-${currentEditId}">Event Name:</label>
            <input type="text" id="edit-name-${currentEditId}" value="${initialData.eventName || ''}" required>
        </div>
    `;

    // isWeekly checkbox should be disabled if editing an instance
    const isWeeklyDisabled = isEditingInstance ? 'disabled' : '';
    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    const weeklyEventCheckboxHtml = `
        <div class="weekly-event-checkbox">
            <label>
                <input type="checkbox" id="edit-is-weekly-${currentEditId}" ${isWeeklyChecked} ${isWeeklyDisabled}>
                Weekly Event
            </label>
        </div>
    `;

    const weeklyStartDateInputFieldHtml = `
        <div id="weekly-start-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-start-date-${currentEditId}">Weekly Recurrence Start Date:</label>
            <input type="date" id="edit-weekly-start-date-${currentEditId}" value="${initialData.weeklyStartDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>
    `;

    const weeklyEndDateInputFieldHtml = `
        <div id="weekly-end-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-end-date-${currentEditId}">Weekly Recurrence End Date:</label>
            <input type="date" id="edit-weekly-end-date-${currentEditId}" value="${initialData.weeklyEndDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>
    `;

    // eventDate input field should be enabled/disabled based on isWeekly and isEditingInstance
    const eventDateInputDisabled = initialData.isWeekly && !isEditingInstance ? 'disabled' : '';
    const eventDateInputFieldHtml = `
        <div id="date-input-group-${currentEditId}" style="display: ${!initialData.isWeekly || isEditingInstance ? 'block' : 'none'};">
            <label for="edit-date-${currentEditId}">Event Date:</label>
            <input type="date" id="edit-date-${currentEditId}" value="${initialData.eventDate || originalOccurrenceDate || ''}" ${eventDateInputDisabled} required>
        </div>
    `;

    const selectedDays = initialData.daysOfWeek || [];
    const daysOfWeekInputDisabled = !initialData.isWeekly || isEditingInstance ? 'disabled' : '';
    const daysOfWeekCheckboxesHtml = `
        <div class="days-of-week-selection" id="days-of-week-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label>Days of Week:</label>
            <div class="checkbox-group">
                ${daysOfWeekOptions.map(day => `
                    <label>
                        <input type="checkbox" value="${day}" ${selectedDays.includes(day) ? 'checked' : ''} ${daysOfWeekInputDisabled}>
                        ${day}
                    </label>
                `).join('')}
            </div>
        </div>
    `;

    const startTimeInputFieldHtml = `
        <div>
            <label for="edit-start-time-${currentEditId}">Start Time:</label>
            <input type="time" id="edit-start-time-${currentEditId}" value="${initialData.startTime || ''}"required>
        </div>
    `;

    const endTimeInputFieldHtml = `
        <div>
            <label for="edit-end-time-${currentEditId}">End Time:</label>
            <input type="time" id="edit-end-time-${currentEditId}" value="${initialData.endTime || ''}"required>
        </div>
    `;

    const eventAddressInputFieldHtml = `
        <div>
            <label for="edit-address-${currentEditId}">Address:</label>
            <input type="text" id="edit-address-${currentEditId}" value="${initialData.address || ''}"required>
        </div>
    `;
    const eventLocationInputFieldHtml = `
        <div>
            <label for="edit-location-${currentEditId}">Location (e.g., Room 132):</label>
            <input type="text" id="edit-location-${currentEditId}" value="${initialData.location || ''}"required>
        </div>
    `;

    const eventNotesInputFieldHtml = `
        <div>
            <label for="edit-notes-${currentEditId}">Notes (Optional):</label>
            <input type="text" id="edit-notes-${currentEditId}" value="${initialData.notes || ''}">
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

        <div class="event-card-actions">
            <button class="save-btn">SAVE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    const isWeeklyCheckbox = cardDiv.querySelector(`#edit-is-weekly-${currentEditId}`);
    const dateInputGroup = cardDiv.querySelector(`#date-input-group-${currentEditId}`);
    const eventDateInput = cardDiv.querySelector(`#edit-date-${currentEditId}`);
    const daysOfWeekGroup = cardDiv.querySelector(`#days-of-week-group-${currentEditId}`);
    const weeklyStartDateGroup = cardDiv.querySelector(`#weekly-start-date-group-${currentEditId}`);
    const weeklyEndDateGroup = cardDiv.querySelector(`#weekly-end-date-group-${currentEditId}`);
    const weeklyStartDateInput = cardDiv.querySelector(`#edit-weekly-start-date-${currentEditId}`);
    const weeklyEndDateInput = cardDiv.querySelector(`#edit-weekly-end-date-${currentEditId}`);

    if (isWeeklyCheckbox && dateInputGroup && eventDateInput && daysOfWeekGroup && weeklyStartDateGroup && weeklyEndDateGroup && weeklyStartDateInput && weeklyEndDateInput) {
        const toggleRecurringFields = () => {
            if (isEditingInstance) return; // Logic only applies if not editing an instance

            const isChecked = isWeeklyCheckbox.checked;

            dateInputGroup.style.display = isChecked ? 'none' : 'block';
            eventDateInput.disabled = isChecked;

            daysOfWeekGroup.style.display = isChecked ? 'block' : 'none';
            daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                checkbox.disabled = !isChecked;
            });

            weeklyStartDateGroup.style.display = isChecked ? 'block' : 'none';
            weeklyStartDateInput.disabled = !isChecked;
            weeklyEndDateGroup.style.display = isChecked ? 'block' : 'none';
            weeklyEndDateInput.disabled = !isChecked;

            if (isChecked) {
                weeklyStartDateInput.setAttribute('required', 'true');
                weeklyEndDateInput.setAttribute('required', 'true');
                eventDateInput.removeAttribute('required');
            } else {
                weeklyStartDateInput.removeAttribute('required');
                weeklyEndDateInput.removeAttribute('required');
                eventDateInput.setAttribute('required', 'true');
            }

            if (isChecked) {
                eventDateInput.value = '';
            } else {
                daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false;
                });
                weeklyStartDateInput.value = '';
                weeklyEndDateInput.value = '';
            }
        };

        if (!isEditingInstance) { // Only attach listener if not editing an instance
            isWeeklyCheckbox.addEventListener('change', toggleRecurringFields);
        }

        // Call once on creation to set initial state based on initialData
        toggleRecurringFields();
    }

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        console.log('SAVE button clicked for editing card:', currentEditId);
        await saveEvent(cardDiv, eventIdToUpdate); // Pass eventIdToUpdate
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        console.log('CANCEL button clicked for editing card:', currentEditId);
        // Remove the editing card
        cardDiv.remove();
        // If it was an edit, re-fetch all to show the original display card again
        // If it was a new event, check if eventsContainer is now empty
        if (!isNewEvent) {
            await fetchAndDisplayEvents(); // Re-render if canceling an edit
        } else if (eventsContainer && eventsContainer.querySelectorAll('.event-card').length === 0 && noEventsMessage) {
            noEventsMessage.style.display = 'block';
        }
        //await showAppAlert("Event editing/creation cancelled.");
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

function formatTime(timeString) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(); // Use a dummy date to leverage Date object for formatting
        date.setHours(hours, minutes);
        // Use toLocaleTimeString to format, specifying 12-hour format and no seconds
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
async function saveEvent(cardDiv, existingEventId = null) {
    const tempDomId = cardDiv.dataset.editId; // This might be a temporary DOM ID or an actual Firestore ID
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true';
    const isEditingInstance = cardDiv.dataset.isEditingInstance === 'true';
    const originalEventIdForInstance = cardDiv.dataset.originalEventIdForInstance; // <--- CORRECTED KEY
    const originalOccurrenceDateForInstance = cardDiv.dataset.originalOccurrenceDate;

    // --- Collect Data from Input Fields ---
    const eventName = cardDiv.querySelector(`#edit-name-${tempDomId}`).value.trim();
    // For editing an instance, the isWeekly checkbox is disabled, so we rely on the original event's isWeekly status
    // or assume it's a one-time override.
    const isWeekly = isEditingInstance ? false : cardDiv.querySelector(`#edit-is-weekly-${tempDomId}`).checked;


    let eventDate = '';
    let weeklyStartDate = '';
    let weeklyEndDate = '';
    let daysOfWeek = [];

    if (isWeekly) {
        weeklyStartDate = cardDiv.querySelector(`#edit-weekly-start-date-${tempDomId}`).value;
        weeklyEndDate = cardDiv.querySelector(`#edit-weekly-end-date-${tempDomId}`).value;
        const selectedDaysCheckboxes = cardDiv.querySelectorAll(`#days-of-week-group-${tempDomId} input[type="checkbox"]:checked`);
        daysOfWeek = Array.from(selectedDaysCheckboxes).map(cb => cb.value);
    } else {
        eventDate = cardDiv.querySelector(`#edit-date-${tempDomId}`).value;
    }

    const startTime = cardDiv.querySelector(`#edit-start-time-${tempDomId}`).value;
    const endTime = cardDiv.querySelector(`#edit-end-time-${tempDomId}`).value;
    const address = cardDiv.querySelector(`#edit-address-${tempDomId}`).value.trim();
    const location = cardDiv.querySelector(`#edit-location-${tempDomId}`).value.trim();
    const notes = cardDiv.querySelector(`#edit-notes-${tempDomId}`).value.trim();


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
    // Add more validation as needed


    // --- Prepare Event Data Object ---
    const eventDataToSave = {
        eventName,
        isWeekly,
        startTime,
        endTime,
        address,
        location,
        notes,
        ...(isWeekly ? { weeklyStartDate, weeklyEndDate, daysOfWeek } : { eventDate }),
    };

    // Add/Update creator info and timestamp only for new events
    if (isNewEvent || isEditingInstance) { // An instance override is essentially a new event
        eventDataToSave.createdAt = serverTimestamp();
        eventDataToSave.createdByUid = currentUser.uid;
        eventDataToSave.createdByName = currentUser.displayName || "Anonymous";
    }

    try {
        const eventsRef = collection(db, "clubs", clubId, "events");

        if (isEditingInstance) {
            // Case 1: Editing a specific instance of a weekly event
            // This creates a new one-time event that overrides the weekly instance.
            // First, add the original occurrence date to the exceptions of the parent weekly event.
            if (originalEventIdForInstance && originalOccurrenceDateForInstance) {
                const parentEventDocRef = doc(db, "clubs", clubId, "events", originalEventIdForInstance);
                await updateDoc(parentEventDocRef, {
                    exceptions: arrayUnion(originalOccurrenceDateForInstance)
                });
                console.log(`Original instance ${originalOccurrenceDateForInstance} added to exceptions for event ${originalEventIdForInstance}`);
            }

            // Then, add the new one-time event (the override)
            await addDoc(eventsRef, eventDataToSave);
            await showAppAlert("Event instance override saved successfully!");

        } else if (existingEventId) {
            // Case 2: Updating an existing full event (one-time or weekly series)
            const eventDocRef = doc(eventsRef, existingEventId);
            await updateDoc(eventDocRef, eventDataToSave);
            await showAppAlert("Event updated successfully!");
        } else {
            // Case 3: Adding a brand new event
            await addDoc(eventsRef, eventDataToSave);
            await showAppAlert("New event added successfully!");
        }
        
        cardDiv.remove(); // Remove the editing card after saving
        await fetchAndDisplayEvents(); // Re-fetch and display all events

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
                // Create Date objects in a timezone-safe way to ensure iteration starts/ends correctly in UTC context
                const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z'); // Force UTC midnight
                const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');     // Force UTC midnight
                const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

                let currentDate = new Date(startDate); // Start iteration from UTC midnight
                while (currentDate.getTime() <= endDate.getTime()) { // Compare timestamps for safety
                    const currentOccDateString = currentDate.toISOString().split('T')[0];

                    if (daysToMatch.includes(currentDate.getUTCDay())) { // <--- Now getUTCDay() is correctly applied to a UTC-initialized date
                        // ONLY ADD TO DISPLAY IF NOT IN EXCEPTIONS
                        if (!exceptions.includes(currentOccDateString)) {
                            allEventOccurrences.push({
                                eventData: eventData,
                                occurrenceDate: new Date(currentDate), // Clone date to avoid reference issues
                                originalEventId: eventId
                            });
                        }
                    }
                    currentDate.setUTCDate(currentDate.getUTCDate() + 1); // <--- Use setUTCDate to increment UTC day
                }
            } else {
                // For one-time events, add directly
                // One-time events don't typically have 'exceptions' but this ensures consistency
                const eventDateString = new Date(eventData.eventDate).toISOString().split('T')[0];
                if (!exceptions.includes(eventDateString)) { // This check is mostly for robustness, should rarely be true for one-time
                    allEventOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'), // Force UTC midnight for one-time too
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
        <p>Date: ${formattedDate}</p>
        <p>Time: ${formatTime(eventData.startTime)} - ${formatTime(eventData.endTime)}</p>
        <p>Address: ${eventData.address}</p>
        <p>Location: ${eventData.location}</p>
        ${eventData.notes ? `<p>Notes: ${eventData.notes}</p>` : ''}
        ${actionButtonsHtml}
    `;

    // Attach event listeners for edit/delete buttons
    if (canEditDelete) {
        // Edit button (for single instance edit - more complex, leave placeholder for now)
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                const eventId = e.target.dataset.eventId;
                const occDate = e.target.dataset.occurrenceDate; // Will be null for full event edit
                console.log(`Edit button clicked for event ID: ${eventId}, Occurrence Date: ${occDate}`);
                await editEvent(eventId, occDate); // <--- Call the new editEvent function
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


async function deleteEntireEvent(eventIdToDelete, isWeeklyEvent = false, skipConfirm = false) { // <--- ADDED skipConfirm PARAMETER
    if (!skipConfirm) { // Only show confirm if skipConfirm is false
        let confirmMessage;
        if (isWeeklyEvent) {
            confirmMessage = "Are you sure you want to delete this ENTIRE RECURRING EVENT SERIES? All instances of this event type will be deleted. This action cannot be undone.";
        } else {
            confirmMessage = "Are you sure you want to delete this event? This action cannot be undone.";
        }

        const confirmed = await showAppConfirm(confirmMessage);
        if (!confirmed) {
            console.log("Event deletion cancelled by user.");
            return; // Exit if user cancels
        }
    }

    // The rest of the try/catch block remains the same, executing the deletion
    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
        await deleteDoc(eventDocRef);
        // We will show a more specific alert message in cancelSingleOccurrence if it's auto-deleted
        if (!skipConfirm) { // Only show this alert if it wasn't an auto-delete
            await showAppAlert("Event deleted successfully!");
        }
        await fetchAndDisplayEvents(); // Re-fetch and display events to update the UI
    } catch (error) {
        console.error("Error deleting event:", error);
        await showAppAlert("Failed to delete event: " + error.message);
    }
}


async function editEvent(eventId, occurrenceDateString = null) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to edit events.");
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

        // Find the display card in the DOM that corresponds to this edit action
        // This is the card that will be replaced by the editing card.
        // For weekly events, find the specific occurrence card if editing instance.
        // For one-time, or edit series, any card with this originalEventId will do.
        let targetDisplayCard;
        if (eventData.isWeekly && occurrenceDateString) { // Editing a specific instance of a weekly event
             targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`);
        } else { // Editing an entire one-time event or entire weekly series
             targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"]`);
        }

        if (!targetDisplayCard) {
            console.error("Could not find the target display card in the DOM for editing.");
            await showAppAlert("Could not find the event card to edit. Please refresh.");
            return;
        }

        // --- Handle 'Edit Entire Series' for weekly events ---
        if (eventData.isWeekly && !occurrenceDateString) { // This means "Edit entire event/series" was clicked for a weekly event
            // Create an editing card with the event's original data
            const editingCard = _createEditingCardElement(eventData, false, eventId); // false for not new, pass eventId
            targetDisplayCard.replaceWith(editingCard); // Replace display card with editing card
            // We need to fetch and re-render all events after saving or canceling,
            // so we don't handle partial DOM updates for weekly series edits.
            return; // Exit after replacing, fetchAndDisplayEvents will re-render later
        }

        // --- Handle 'Edit' for one-time events, and 'Edit Instance' for weekly events ---
        // For one-time events, `eventData` is already the specific event.
        // For editing an instance of a weekly event, we need to create a *new* one-time event based on the instance's data.
        let dataForEditingCard = {};
        let isEditingInstance = false;
        let tempOriginalEventId = eventId; // Store original event ID for saving

        if (eventData.isWeekly && occurrenceDateString) {
            isEditingInstance = true;
            // For editing an instance, create a new one-time event document in Firestore.
            // This new event will represent the *override* for this specific instance.
            // The original weekly event will then have this occurrence date added to its exceptions.
            dataForEditingCard = {
                eventName: eventData.eventName,
                isWeekly: false, // This will be a one-time override
                eventDate: occurrenceDateString, // The specific date of this instance
                startTime: eventData.startTime,
                endTime: eventData.endTime,
                address: eventData.address,
                location: eventData.location,
                notes: eventData.notes,
                createdByUid: eventData.createdByUid,
                createdByName: eventData.createdByName
                // We don't copy createdAt for overrides, as it will be newly created
            };
            // Note: The original eventId is still passed to save as `tempOriginalEventId`
            // and the `occurrenceDateString` is passed to mark as exception.
        } else {
            // This is for a one-time event being edited
            dataForEditingCard = eventData;
        }

        // Create the editing card using the appropriate data
        const editingCard = _createEditingCardElement(dataForEditingCard, false, tempOriginalEventId, isEditingInstance, eventId, occurrenceDateString);
        targetDisplayCard.replaceWith(editingCard);

    } catch (error) {
        console.error("Error initiating event edit:", error);
        await showAppAlert("Failed to start event edit: " + error.message);
    }
}
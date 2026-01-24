import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let isEditingEvent = false;

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
window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo'); // <--- NEW: Get the returnTo parameter from the URL

    console.log("goToClubPage: clubId = ", currentClubId);
    console.log("goToClubPage: returnToPage = ", returnToPage); // <--- Add this log to debug

    if (currentClubId) {
        let redirectUrl = 'your_clubs.html'; // Default fallback if something goes wrong

        if (returnToPage === 'manager') {
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        } else if (returnToPage === 'member') {
            redirectUrl = `club_page_member.html?id=${currentClubId}`;
        } else {
            // If returnTo is missing or an unexpected value, fall back to the manager page.
            // This is a safe default, assuming manager has more permissions.
            console.warn("Invalid or missing 'returnTo' parameter, defaulting to manager page.");
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        }
        window.location.href = redirectUrl;
    } else {
        // If no clubId is found in the URL, go to the general clubs list
        window.location.href = 'your_clubs.html';
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

                    await cleanUpEmptyRecurringEvents();

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
    isEditingEvent = true;
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
    // const isWeeklyDisabled = isEditingInstance ? 'disabled' : '';
    // const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    // const weeklyEventCheckboxHtml = `
    //     <div class="weekly-event-checkbox">
    //         <label>
    //             <input type="checkbox" id="edit-is-weekly-${currentEditId}" ${isWeeklyChecked} ${isWeeklyDisabled}>
    //             Weekly Event
    //         </label>
    //     </div>
    // `;
    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    // Only show the "Weekly Event" checkbox if it's a new event
    const weeklyEventCheckboxHtml = `
        <div class="weekly-event-checkbox" style="display: ${isNewEvent ? 'block' : 'none'};">
            <label>
                <input type="checkbox" id="edit-is-weekly-${currentEditId}" ${isWeeklyChecked} ${isNewEvent ? '' : 'disabled'}>
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

            // let isChecked;
            // if (isWeeklyCheckbox) {
            //     isChecked = isWeeklyCheckbox.checked;
            // } else {
            //     isChecked = initialData.isWeekly;
            // }
            const isChecked = isWeeklyCheckbox ? isWeeklyCheckbox.checked : initialData.isWeekly;

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
        isEditingEvent = false;
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        console.log('CANCEL button clicked for editing card:', currentEditId);
        // Remove the editing card
        cardDiv.remove();
        isEditingEvent = false; // <--- ADD THIS LINE
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
    if (isEditingEvent) { // NEW check
        await showAppAlert("Please finish editing the current event before adding a new one.");
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
        // NEW/MODIFIED CODE: Explicitly parse the date string as UTC midnight for consistency
        return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, options);
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
    const tempDomId = cardDiv.dataset.editId;
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true';
    const isEditingInstance = cardDiv.dataset.isEditingInstance === 'true';
    const originalEventIdForInstance = cardDiv.dataset.originalEventIdForInstance; // ID of the parent recurring event
    const originalOccurrenceDateForInstance = cardDiv.dataset.originalOccurrenceDate; // The specific date of the instance being overridden

    // --- Collect Data from Input Fields ---
    const eventName = cardDiv.querySelector(`#edit-name-${tempDomId}`).value.trim();
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

    let savedEventId = null;
    let savedOccurrenceDate = null;


    // --- Basic Validation ---
    if (!eventName) { await showAppAlert("Event Name is required!"); return; }
    if (!isWeekly && !eventDate) { await showAppAlert("Please provide an Event Date for one-time events."); return; }
    if (isWeekly && (!weeklyStartDate || !weeklyEndDate)) { await showAppAlert("Weekly events require both a start and end date for recurrence."); return; }
    if (isWeekly && daysOfWeek.length === 0) { await showAppAlert("Please select at least one day of the week for weekly events."); return; }
    if (!startTime || !endTime) { await showAppAlert("Start Time and End Time are required."); return; }
    if (!address) { await showAppAlert("Address is required."); return; }
    if (!location) { await showAppAlert("Specific Location (e.g., Room 132) is required."); return; }

    if (startTime >= endTime) {
        await showAppAlert("End time cannot be earlier than or the same as the start time!");
        return; 
    }

    if (isWeekly && !isEditingInstance) { // Only apply this check for new or updated weekly series (not single instance overrides)
        const futureOccurrences = calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, [], startTime, endTime);
        if (futureOccurrences === 0) {
            await showAppAlert("This weekly event configuration results in no events. Please adjust the dates or days of the week.");
            return; 
        }
    }

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

    // Add/Update creator info and timestamp
    eventDataToSave.createdAt = serverTimestamp(); // Always set on creation or override
    eventDataToSave.createdByUid = currentUser.uid;
    eventDataToSave.createdByName = currentUser.displayName || "Anonymous";

    try {
        const eventsRef = collection(db, "clubs", clubId, "events");

        if (isEditingInstance) {
            // Case 1: Editing a specific instance of a weekly event
            // This creates a new one-time event that overrides the weekly instance.

            // 1. Add the original occurrence date to the exceptions of the parent weekly event.
            if (originalEventIdForInstance && originalOccurrenceDateForInstance) {
                const parentEventDocRef = doc(db, "clubs", clubId, "events", originalEventIdForInstance);
                await updateDoc(parentEventDocRef, {
                    exceptions: arrayUnion(originalOccurrenceDateForInstance)
                });
                console.log(`Original instance ${originalOccurrenceDateForInstance} added to exceptions for event ${originalEventIdForInstance}`);
            }

            // 2. Add the new one-time event (the override)
            const overrideEventData = {
                ...eventDataToSave,
                parentRecurringEventId: originalEventIdForInstance // Link to the original recurring series
            };
            const newOverrideEventRef = await addDoc(eventsRef, overrideEventData); // Get ref to the new document
            savedEventId = newOverrideEventRef.id; // Capture the ID of the newly created override event
            savedOccurrenceDate = eventDataToSave.eventDate;
            const newOverrideEventId = newOverrideEventRef.id; // Get the ID of the newly created override event

            // 3. Transfer RSVPs from the original occurrence to the new override event
            if (originalEventIdForInstance && originalOccurrenceDateForInstance) {
                const rsvpsToTransferQuery = query(
                    collection(db, "clubs", clubId, "occurrenceRsvps"),
                    where("eventId", "==", originalEventIdForInstance),
                    where("occurrenceDate", "==", originalOccurrenceDateForInstance)
                );
                const rsvpsToTransferSnap = await getDocs(rsvpsToTransferQuery);

                if (!rsvpsToTransferSnap.empty) {
                    const rsvpBatch = writeBatch(db);
                    rsvpsToTransferSnap.forEach((rsvpDoc) => {
                        // Create a new RSVP doc ID for the new override event
                        const newRsvpDocId = `${newOverrideEventId}_${originalOccurrenceDateForInstance}_${rsvpDoc.data().userId}`;
                        const newRsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", newRsvpDocId);

                        // Copy existing RSVP data, updating eventId to the new override event's ID
                        const newRsvpData = { ...rsvpDoc.data(), eventId: newOverrideEventId };
                        rsvpBatch.set(newRsvpDocRef, newRsvpData); // Create the new RSVP document
                        rsvpBatch.delete(rsvpDoc.ref); // Delete the old RSVP document
                    });
                    await rsvpBatch.commit();
                    console.log(`Transferred ${rsvpsToTransferSnap.size} RSVPs to new override event ${newOverrideEventId}.`);
                }
            }
            await showAppAlert("Event updated successfully!");

        } else if (existingEventId) {
            // Case 2: Updating an existing full event (one-time or weekly series)
            const eventDocRef = doc(eventsRef, existingEventId);
            const existingDocSnap = await getDoc(eventDocRef);
            if (existingDocSnap.exists()) {
                const existingData = existingDocSnap.data();
                // Preserve existing exceptions and any RSVPs if they were on the event document (which they shouldn't be now)
                const updatedData = {
                    ...eventDataToSave,
                    exceptions: existingData.exceptions || [],
                    // Any other fields you want to preserve during update
                };
                await updateDoc(eventDocRef, updatedData);
                savedEventId = existingEventId; // Capture the ID of the updated event
                savedOccurrenceDate = eventDataToSave.isWeekly ? null : eventDataToSave.eventDate; 
                await showAppAlert("Event updated successfully!");
            } else {
                console.error("Error: Attempted to update non-existent event document:", existingEventId);
                await showAppAlert("Failed to update event: Original event not found.");
            }
        } else {
            // Case 3: Adding a brand new event
            const newDocRef = await addDoc(eventsRef, eventDataToSave);
            savedEventId = newDocRef.id; // Capture the ID of the newly added event
            savedOccurrenceDate = eventDataToSave.isWeekly ? null : eventDataToSave.eventDate;
            await showAppAlert("New event added successfully!");
        }
        
        cardDiv.remove(); // Remove the editing card after saving
        isEditingEvent = false;
        await fetchAndDisplayEvents(); // Re-fetch and display all events

        if (savedEventId) {
            scrollToEditedEvent(savedEventId, savedOccurrenceDate); // Add this line
        }

    } catch (error) {
        console.error("Error saving event:", error);
        isEditingEvent = false;
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
        //const allEventOccurrences = []; // To store all individual event occurrences, including weekly ones
        let allEventOccurrences = [];
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
                    // FIX: Changed allPossibleOccurrences.push to allEventOccurrences.push
                    allEventOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'), // Force UTC midnight for one-time too
                        originalEventId: eventId
                    });
                }
            }
        });

        const now = new Date(); // Get current local time once for efficiency

        allEventOccurrences = allEventOccurrences.filter(occurrence => {
            const eventDateStr = occurrence.occurrenceDate.toISOString().split('T')[0]; // e.g., "2025-01-01"
            const eventEndTimeStr = occurrence.eventData.endTime; // e.g., "18:30"

            // Construct event end time in local timezone for comparison
            // This combines the event's date (YYYY-MM-DD) and its end time (HH:mm)
            // The `new Date()` constructor will interpret this string in the local timezone.
            const eventEndMomentLocal = new Date(`${eventDateStr}T${eventEndTimeStr}`);

            return eventEndMomentLocal.getTime() > now.getTime(); // Keep only events that end in the future
        });

        // Sort all occurrences chronologically, first by date, then by time
        allEventOccurrences.sort((a, b) => {
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
            return dateTimeA - dateTimeB;
        });

        if (allEventOccurrences.length === 0) {
            console.log("No events found for this club.");
            if (currentUserRole === 'member') {
                eventsContainer.innerHTML = '<p class="fancy-label">NO EVENTS YET</p>';
            }
            
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
                        <button class="uncancel-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">UN-CANCEL EVENT</button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">DELETE SERIES</button>
                    </div>
                `;
            } else {
                actionButtonsHtml = `
                    <div class="event-card-actions">
                        <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">EDIT EVENT</button>
                        <button class="cancel-instance-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">DELETE EVENT</button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">DELETE SERIES</button>
                    </div>
                `;
            }
        } else {
            // For one-time events or instances that are overrides of a recurring event
            actionButtonsHtml = `
                <div class="event-card-actions">
                    <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">EDIT EVENT</button>
                    <button class="delete-btn" data-event-id="${originalEventId}">DELETE EVENT</button>
                    ${eventData.parentRecurringEventId ? `
                        <button class="delete-parent-series-btn" data-parent-event-id="${eventData.parentRecurringEventId}">DELETE SERIES</button>
                    ` : ''}
                </div>
            `;
        }
    }


    cardDiv.innerHTML = `
        <h3>${eventData.eventName} ${isExcepted ? '<span class="canceled-tag">(CANCELED)</span>' : ''}</h3>
        <p>•  Date: ${formattedDate}</p>
        <p>•  Time: ${formatTime(eventData.startTime)} - ${formatTime(eventData.endTime)}</p>
        <p>•  Address: ${eventData.address}</p>
        <p>•  Location: ${eventData.location}</p>
        ${eventData.notes ? `<p>•  Notes: ${eventData.notes}</p>` : ''}

        <div class="rsvp-section">
            <div class="rsvp-box">
                <h4>Your Availability</h4>
                <div class="rsvp-buttons">
                    <button class="rsvp-button" data-status="YES" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">YES</button>
                    <button class="rsvp-button" data-status="MAYBE" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">MAYBE</button>
                    <button class="rsvp-button" data-status="NO" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">NO</button>
                </div>
                <div class="availability-actions">
                    <button class="view-availability-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">CHECK RESPONSES</button>
                </div>
            </div>
        </div>


        <div class="event-card-actions">
            ${actionButtonsHtml}
        </div>
    `;

    const rsvpButtons = cardDiv.querySelectorAll('.rsvp-button');
    rsvpButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const eventId = e.target.dataset.eventId;
            const occurrenceDate = e.target.dataset.occurrenceDate; // <--- Get occurrenceDate from button
            const status = e.target.dataset.status;
            saveRsvpStatus(eventId, occurrenceDate, status); // <--- Pass occurrenceDate
        });
    });

    const viewAvailabilityBtn = cardDiv.querySelector('.view-availability-btn');
    if (viewAvailabilityBtn) {
        viewAvailabilityBtn.addEventListener('click', (e) => {
            const eventId = e.target.dataset.eventId;
            const occurrenceDate = e.target.dataset.occurrenceDate;
            showRsvpDetailsModal(eventId, occurrenceDate);
        });
    }

    // Call fetchAndSetUserRsvp for this event to highlight current status on load
    fetchAndSetUserRsvp(originalEventId, occurrenceDateString);

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

    const deleteParentSeriesBtn = cardDiv.querySelector('.delete-parent-series-btn');
    if (deleteParentSeriesBtn) {
        deleteParentSeriesBtn.addEventListener('click', (e) => {
            const parentEventId = e.target.dataset.parentEventId;
            deleteEntireSeriesAndOverrides(parentEventId);
        });
    }

    return cardDiv;
}

async function deleteEntireSeriesAndOverrides(parentEventIdToDelete) {
    if (!parentEventIdToDelete) {
        await showAppAlert("Error: No parent series ID provided for deletion.");
        return;
    }

    const mainEventRef = doc(db, "clubs", clubId, "events", parentEventIdToDelete);
    const mainEventSnap = await getDoc(mainEventRef);

    if (!mainEventSnap.exists()) {
        await showAppAlert("Error: The main event series to delete was not found.");
        return;
    }
    const mainEventData = mainEventSnap.data();
    const eventName = mainEventData.eventName || "Untitled Event Series"; // Declare eventName here

    const confirmed = await showAppConfirm(`Are you sure you want to delete this ENTIRE event series? All events of type "${eventName}" will be deleted. This action cannot be undone.`);

    if (!confirmed) {
        console.log("Series and overrides deletion cancelled by user.");
        return;
    }

    const batch = writeBatch(db);
    let deletedCount = 0;

    try {
        // 1. Delete the main recurring event document
        const mainEventRef = doc(db, "clubs", clubId, "events", parentEventIdToDelete);
        batch.delete(mainEventRef);
        deletedCount++;
        console.log(`Marked main recurring event ${parentEventIdToDelete} for deletion.`);

        // 2. Find and delete all override events linked to this parent series
        const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", parentEventIdToDelete));
        const overridesSnap = await getDocs(overridesQuery);
        overridesSnap.forEach((overrideDoc) => {
            batch.delete(overrideDoc.ref);
            deletedCount++;
            console.log(`Marked override event ${overrideDoc.id} for deletion.`);
        });

        // 3. Find and delete all RSVPs associated with the main series
        // (If RSVPs were stored with originalEventId as the parent series ID)
        // NOTE: Our current RSVP system uses `originalEventId` + `occurrenceDateString` + `userId` as the document ID for `occurrenceRsvps`.
        // So, we need to query based on the `eventId` field within `occurrenceRsvps`.

        const rsvpsQueryForMainSeries = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", parentEventIdToDelete));
        const rsvpsSnapForMainSeries = await getDocs(rsvpsQueryForMainSeries);
        rsvpsSnapForMainSeries.forEach((rsvpDoc) => {
            batch.delete(rsvpDoc.ref);
            console.log(`Marked RSVP ${rsvpDoc.id} for main series for deletion.`);
        });

        // 4. Find and delete all RSVPs associated with each override event
        // This requires getting the IDs of all override events first
        const overrideEventIds = overridesSnap.docs.map(doc => doc.id);
        if (overrideEventIds.length > 0) {
            // Firestore 'in' query limited to 10. If more, you'd need multiple queries or a different approach.
            const rsvpsQueryForOverrides = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideEventIds));
            const rsvpsSnapForOverrides = await getDocs(rsvpsQueryForOverrides);
            rsvpsSnapForOverrides.forEach((rsvpDoc) => {
                batch.delete(rsvpDoc.ref);
                console.log(`Marked RSVP ${rsvpDoc.id} for override event for deletion.`);
            });
        }


        await batch.commit();
        await showAppAlert("Event deleted successfully!");
        //await showAppAlert(`Successfully deleted the recurring series and ${deletedCount - 1} associated overrides and all their RSVPs!`);
        await fetchAndDisplayEvents(); // Re-fetch and display events to update the UI

    } catch (error) {
        console.error("Error deleting entire series and overrides:", error);
        await showAppAlert("Failed to delete the series and its overrides: " + error.message);
    }
}

async function deleteEntireEvent(eventIdToDelete, isWeeklyEvent = false, skipConfirm = false) { // <--- ADDED skipConfirm PARAMETER
    const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
    const eventSnap = await getDoc(eventDocRef);
    const eventData = eventSnap.exists() ? eventSnap.data() : null;
    const eventName = eventData ? eventData.eventName : "Untitled Event";

    if (!skipConfirm) { // Only show confirm if skipConfirm is false
        let confirmMessage;
        if (isWeeklyEvent) {
            confirmMessage = `Are you sure you want to delete this ENTIRE event series? All events of type "${eventName}" will be deleted. This action cannot be undone.`;
        } else {
            confirmMessage = `Are you sure you want to delete the event "${eventName}"? This action cannot be undone.`;
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
        const eventSnap = await getDoc(eventDocRef); // Fetch to check if it's weekly
        const eventData = eventSnap.exists() ? eventSnap.data() : null;

        const batch = writeBatch(db); // Use a batch for multiple deletes
        batch.delete(eventDocRef); // Mark the main event document for deletion

        // --- Delete RSVPs for the event itself ---
        const rsvpsQueryForEvent = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", eventIdToDelete));
        const rsvpsSnapForEvent = await getDocs(rsvpsQueryForEvent);
        rsvpsSnapForEvent.forEach((rsvpDoc) => {
            batch.delete(rsvpDoc.ref);
            console.log(`Marked RSVP ${rsvpDoc.id} for event ${eventIdToDelete} for deletion.`);
        });

        // --- If deleting a recurring series, also delete its instance overrides and their RSVPs ---
        if (eventData && eventData.isWeekly) {
            console.log(`Deleting all instance overrides for recurring event series: ${eventIdToDelete}`);
            const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", eventIdToDelete));
            const overridesSnap = await getDocs(overridesQuery);
            const overrideEventIds = overridesSnap.docs.map(doc => doc.id); // Collect override IDs

            overridesSnap.forEach((overrideDoc) => {
                batch.delete(overrideDoc.ref);
            });

            // Also delete RSVPs for these overrides
            if (overrideEventIds.length > 0) {
                const rsvpsQueryForOverrides = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideEventIds));
                const rsvpsSnapForOverrides = await getDocs(rsvpsQueryForOverrides);
                rsvpsSnapForOverrides.forEach((rsvpDoc) => {
                    batch.delete(rsvpDoc.ref);
                    console.log(`Marked RSVP ${rsvpDoc.id} for override event for deletion.`);
                });
            }
            console.log(`Deleted ${overridesSnap.size} instance overrides for event series ${eventIdToDelete}.`);
        }

        await batch.commit(); // Commit all deletions in a single batch

        if (!skipConfirm) {
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

    if (isEditingEvent) {
        await showAppAlert("Please finish editing the current event before starting another edit.");
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

function calculateActiveOccurrences(eventData, exceptions) {
    if (!eventData.isWeekly) {
        // One-time events are either active (if no exceptions) or not.
        // This function is primarily for calculating remaining instances of recurring events.
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


async function cleanUpEmptyRecurringEvents() {
    console.log("Running cleanup for empty recurring events and orphaned overrides...");
    if (!clubId) {
        console.warn("Cleanup function called without a clubId.");
        return;
    }

    const eventsRef = collection(db, "clubs", clubId, "events");
    const batch = writeBatch(db);
    let cleanedUpCount = 0;

    try {
        const querySnapshot = await getDocs(eventsRef);
        const recurringEventIds = new Set(); // Store IDs of actual recurring events

        // First pass: Identify all active recurring event IDs
        querySnapshot.forEach(doc => {
            const eventData = doc.data();
            if (eventData.isWeekly) {
                recurringEventIds.add(doc.id);
            }
        });

        // Second pass: Check for empty recurring events and orphaned overrides
        querySnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id;

            if (eventData.isWeekly) {
                // Check if this recurring event has zero active instances remaining
                const activeOccurrences = calculateActiveOccurrences(eventData, eventData.exceptions);
                if (activeOccurrences === 0) {
                    console.log(`Found empty recurring event: ${eventData.eventName} (ID: ${eventId}). Marking for deletion.`);
                    batch.delete(doc.ref);
                    cleanedUpCount++;
                }
            } else if (eventData.parentRecurringEventId) {
                // This is an instance override. Check if its parent recurring event still exists.
                if (!recurringEventIds.has(eventData.parentRecurringEventId)) {
                    console.log(`Found orphaned instance override: ${eventData.eventName} (ID: ${eventId}) with parent ${eventData.parentRecurringEventId}. Marking for deletion.`);
                    batch.delete(doc.ref);
                    cleanedUpCount++;
                }
            }
        });

        if (cleanedUpCount > 0) {
            await batch.commit();
            console.log(`Cleanup complete. Deleted ${cleanedUpCount} empty events/orphaned overrides.`);
            // No need to fetchAndDisplayEvents here, as it will be called by the main flow.
        } else {
            console.log("No empty events or orphaned overrides found for cleanup.");
        }

    } catch (error) {
        console.error("Error during empty event cleanup:", error);
    }
}


async function saveRsvpStatus(originalEventId, occurrenceDateString, status) { // Added occurrenceDateString
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to RSVP.");
        return;
    }

    try {
        const userUid = currentUser.uid;
        // Create a unique document ID for this specific user's RSVP for this specific occurrence
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);

        // Fetch the existing RSVP for this occurrence, if any
        const rsvpSnap = await getDoc(rsvpDocRef);
        let currentRsvpStatus = rsvpSnap.exists() ? rsvpSnap.data().status : null;

        let newRsvpStatus = null; // What the UI should show after the operation
        const rsvpDataToSave = {
            eventId: originalEventId,
            occurrenceDate: occurrenceDateString,
            userId: userUid,
            userName: currentUser.displayName || "Anonymous User",
            timestamp: serverTimestamp(),
            clubId: clubId,
        };

        if (currentRsvpStatus === status) {
            // User clicked on the status they are already selected for -> REMOVE RSVP
            await deleteDoc(rsvpDocRef);
            console.log(`User ${userUid} removed RSVP for event ${originalEventId} on ${occurrenceDateString}.`);
            //await showAppAlert(`Your RSVP has been removed for the event on ${formatDate(occurrenceDateString)}.`);
            newRsvpStatus = null; // No status selected
        } else {
            // User clicked a different status or was not RSVP'd -> SET/CHANGE RSVP
            rsvpDataToSave.status = status;
            await setDoc(rsvpDocRef, rsvpDataToSave); // Use setDoc to create or overwrite the RSVP document
            console.log(`User ${userUid} RSVP'd ${status} for event ${originalEventId} on ${occurrenceDateString}.`);
            //await showAppAlert(`Your RSVP (${status}) has been saved for the event on ${formatDate(occurrenceDateString)}.`);
            newRsvpStatus = status; // This status is now selected
        }

        // Update the UI for only the specific event occurrence card
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, newRsvpStatus);

    } catch (error) {
        console.error("Error saving RSVP status:", error);
        await showAppAlert("Failed to save your RSVP: " + error.message);
    }
}


function updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentStatus) { // Added occurrenceDateString
    // Find the specific event occurrence card in the DOM
    const card = document.querySelector(`.event-card[data-original-event-id="${originalEventId}"][data-occurrence-date="${occurrenceDateString}"]`);
    if (!card) {
        console.warn(`Could not find card for event ${originalEventId} on ${occurrenceDateString} to update RSVP UI.`);
        return;
    }

    const rsvpButtons = card.querySelectorAll('.rsvp-button');
    rsvpButtons.forEach(button => {
        if (button.dataset.status === currentStatus) {
            button.classList.add('selected-rsvp');
        } else {
            button.classList.remove('selected-rsvp');
        }
    });
}


async function fetchAndSetUserRsvp(originalEventId, occurrenceDateString) { // Added occurrenceDateString
    if (!currentUser || !clubId) {
        return;
    }

    try {
        const userUid = currentUser.uid;
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);
        const rsvpSnap = await getDoc(rsvpDocRef);

        let currentRsvpStatus = null; // Default to no status selected

        if (rsvpSnap.exists()) {
            currentRsvpStatus = rsvpSnap.data().status;
        }
        
        // Update the UI for only the specific event occurrence card
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentRsvpStatus);
        
    } catch (error) {
        console.error("Error fetching user RSVP status for occurrence:", error);
        // On error, ensure no buttons are selected for this specific occurrence
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, null);
    }
}

async function getAllClubMembers(clubID) {
    const members = [];
    try {
        // Fetch manager info first from the club document
        const clubDocRef = doc(db, "clubs", clubID);
        const clubDocSnap = await getDoc(clubDocRef);
        let managerUid = null;
        if (clubDocSnap.exists()) {
            const clubData = clubDocSnap.data();
            managerUid = clubData.managerUid;
            if (managerUid) {
                // Assuming manager's name can be fetched from 'users' collection
                const managerUserDoc = await getDoc(doc(db, "users", managerUid));
                const managerName = managerUserDoc.exists() ? managerUserDoc.data().displayName || managerUserDoc.data().name : "Unknown Manager";
                members.push({ uid: managerUid, name: managerName, role: 'manager' });
            }
        }

        // Fetch other members from the 'members' subcollection
        const membersCollectionRef = collection(db, "clubs", clubID, "members");
        const membersSnapshot = await getDocs(membersCollectionRef);
        for (const memberDoc of membersSnapshot.docs) {
            const memberData = memberDoc.data();
            // Ensure we don't duplicate the manager if they also have a member document
            if (memberDoc.id !== managerUid) {
                const memberUserDoc = await getDoc(doc(db, "users", memberDoc.id));
                const memberName = memberUserDoc.exists() ? memberUserDoc.data().displayName || memberUserDoc.data().name : "Unknown User";
                members.push({ uid: memberDoc.id, name: memberName, role: memberData.role || 'member' });
            }
        }
    } catch (error) {
        console.error("Error fetching all club members:", error);
    }
    return members;
}


// Function to display the RSVP details popup
async function showRsvpDetailsModal(eventId, occurrenceDateString) {
    if (!clubId) {
        await showAppAlert("Error: Club ID not found.");
        return;
    }

    // Create modal elements if they don't exist
    let overlay = document.getElementById('rsvp-details-overlay');
    let modal = document.getElementById('rsvp-details-modal');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rsvp-details-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5); /* Semi-transparent black */
            z-index: 999; /* Ensure it's above other content */
            display: flex; /* Use flexbox to center the popup */
            justify-content: center;
            align-items: center;
        `;
        document.body.appendChild(overlay);
    }
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rsvp-details-modal';
        modal.style.cssText = `
            margin-top: 20px;
            padding: 10px;
            border: 3px solid black;
            background: linear-gradient(#f0f0f0, #e0e0e0);
            box-shadow: 0px 6px 0px #000000;
            width: 85%; /* Adjust as needed */
            max-width: 500px; /* Max width for larger screens */
            border-radius: 10px;
            z-index: 1000; /* Ensure it's above the overlay */
            position: fixed; /* Fixed position relative to viewport */
            top: 50%; /* Center vertically */
            left: 50%; /* Center horizontally */
            transform: translate(-50%, -50%); /* Adjust for exact centering */
            display: none; /* Hidden by default */
            flex-direction: column;
            gap: 15px; /* Space between elements in the popup */
            font-family: var(--primary-font-family); /* Assuming this var is defined in your CSS */
            font-weight: normal;
            text-align: center;
            font-size: 20px; /* Adjusted slightly smaller for content */
            color: black;
            max-height: 80vh; /* Limit height for scrollable content */
            overflow-y: auto; /* Enable vertical scrolling */
        `;
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <h2>Responses for ${formatDate(occurrenceDateString)}</h2>
        <div id="rsvp-lists" style="text-align: left; padding: 0 15px;">
            <h3>Going (<span id="going-count">0</span>)</h3>
            <ul id="rsvp-going-list"></ul>
            <h3>Maybe (<span id="rsvp-maybe-count">0</span>)</h3>
            <ul id="rsvp-maybe-list"></ul>
            <h3>Not Going (<span id="not-going-count">0</span>)</h3>
            <ul id="rsvp-not-going-list"></ul>
            <h3>No Response (<span id="not-responded-count">0</span>)</h3>
            <ul id="rsvp-not-responded-list"></ul>
            <button id="close-rsvp-modal" class="fancy-button">Close</button>
        </div>
    `;

    document.body.classList.add('no-scroll');

    document.getElementById('close-rsvp-modal').addEventListener('click', () => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    });

    overlay.style.display = 'flex';
    modal.style.display = 'flex';

    try {
        // Fetch all RSVPs for this occurrence
        const rsvpsQuery = query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "==", eventId),
            where("occurrenceDate", "==", occurrenceDateString)
        );
        const rsvpsSnap = await getDocs(rsvpsQuery);
        const rsvpsMap = {}; // { userId: { status: "YES", userName: "..." } }
        rsvpsSnap.forEach(doc => {
            const data = doc.data();
            rsvpsMap[data.userId] = { status: data.status, userName: data.userName };
        });

        // Fetch all club members
        const allMembers = await getAllClubMembers(clubId);

        const goingList = document.getElementById('rsvp-going-list');
        const notGoingList = document.getElementById('rsvp-not-going-list');
        const maybeList = document.getElementById('rsvp-maybe-list');
        const notRespondedList = document.getElementById('rsvp-not-responded-list');

        goingList.innerHTML = '';
        notGoingList.innerHTML = '';
        maybeList.innerHTML = '';
        notRespondedList.innerHTML = '';

        let goingCount = 0;
        let notGoingCount = 0;
        let maybeCount = 0;
        let notRespondedCount = 0;

        // Categorize members based on RSVPs
        allMembers.forEach(member => {
            const rsvp = rsvpsMap[member.uid];
            if (rsvp) {
                if (rsvp.status === 'YES') {
                    goingList.innerHTML += `<li>${rsvp.userName}</li>`;
                    goingCount++;
                } else if (rsvp.status === 'NO') {
                    notGoingList.innerHTML += `<li>${rsvp.userName}</li>`;
                    notGoingCount++;
                } else if (rsvp.status === 'MAYBE') {
                    maybeList.innerHTML += `<li>${rsvp.userName}</li>`;
                    maybeCount++;
                }
            } else {
                notRespondedList.innerHTML += `<li>${member.name}</li>`; // Use member.name if no RSVP
                notRespondedCount++;
            }
        });

        document.getElementById('going-count').textContent = goingCount;
        document.getElementById('not-going-count').textContent = notGoingCount;
        document.getElementById('rsvp-maybe-count').textContent = maybeCount;
        document.getElementById('not-responded-count').textContent = notRespondedCount;

    } catch (error) {
        console.error("Error fetching RSVP details:", error);
        await showAppAlert("Failed to load RSVP details: " + error.message);
        overlay.style.display = 'none';
        modal.style.display = 'none';
    }
}



function scrollToEditedEvent(eventId, occurrenceDateString = null) {
    let selector;
    if (occurrenceDateString) {
        // For a specific instance (e.g., an override or a one-time event)
        selector = `.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`;
    } else {
        // For a general event or series, find the first displayed card for that event ID
        selector = `.event-card[data-original-event-id="${eventId}"]`;
    }

    const targetElement = document.querySelector(selector);

    if (targetElement) {
        const topPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
            top: topPosition - 10, // 10px margin
            behavior: 'smooth'
        });
        console.log(`Scrolled to event card with ID: ${eventId}, Date: ${occurrenceDateString || 'N/A'}`);
    } else {
        console.warn(`Could not find event card to scroll to for ID: ${eventId}, Date: ${occurrenceDateString || 'N/A'}`);
    }
}




function calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, exceptions = [], startTime = '00:00', endTime = '23:59') {
    let futureCount = 0;
    const now = new Date(); // Current time for "future" comparison
    
    // Create Date objects in a timezone-safe way to ensure iteration starts/ends correctly in UTC context
    const startIterDate = new Date(weeklyStartDate + 'T00:00:00Z'); // Force UTC midnight
    const endIterDate = new Date(weeklyEndDate + 'T00:00:00Z');     // Force UTC midnight
    const daysToMatch = daysOfWeek.map(day => dayNamesMap.indexOf(day));

    let currentDate = new Date(startIterDate); // Start iteration from UTC midnight
    while (currentDate.getTime() <= endIterDate.getTime()) { // Compare timestamps for safety
        const currentOccDateString = currentDate.toISOString().split('T')[0];
        
        if (daysToMatch.includes(currentDate.getUTCDay())) {
            // Check if this specific occurrence date is an exception
            if (!exceptions.includes(currentOccDateString)) {
                // Construct event end time in local timezone for comparison
                // This combines the event's date (YYYY-MM-DD) and its end time (HH:mm)
                // The `new Date()` constructor will interpret this string in the local timezone.
                const eventEndMomentLocal = new Date(`${currentOccDateString}T${endTime}`);

                // Only count if the event ends in the future
                if (eventEndMomentLocal.getTime() > now.getTime()) {
                    futureCount++;
                }
            }
        }
        currentDate.setUTCDate(currentDate.getUTCDate() + 1); // Increment by one day (UTC)
    }
    return futureCount;
}
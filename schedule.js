import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, where, writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let clubId = null;
let role = null;
let isEditingEvent = false;
let eventListenerUnsubscribe = null;
let rsvpListenerUnsubscribe = null;

const userCache = new Map();
const memberListCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

// const clubScheduleTitle = document.getElementById('clubScheduleTitle');
const eventsContainer = document.getElementById('eventsContainer');
const noEventsMessage = document.getElementById('noEventsMessage');
const addEventButton = document.getElementById('add-event-button');

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];


function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}


async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    
    const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberDoc.exists()) return memberDoc.data().role || 'member';
    
    const clubDoc = await getDoc(doc(db, "clubs", clubId));
    return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
}

window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo');

    if (currentClubId) {
        let redirectUrl = 'your_clubs.html';

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

onAuthStateChanged(auth, async (user) => {
    currentUser = user; 
    clubId = getUrlParameter('clubId');

    if (user) {
        if (clubId) {
            const clubRef = doc(db, "clubs", clubId);
            try {
                const clubSnap = await getDoc(clubRef);
                if (clubSnap.exists()) {
                    // if (clubScheduleTitle) {
                    //     clubScheduleTitle.textContent = `${clubSnap.data().clubName} Schedule`;
                    // }

                    role = await getMemberRoleForClub(clubId, currentUser.uid);
                    console.log(role);

                    // await cleanUpEmptyRecurringEvents();

                    //await fetchAndDisplayEvents(); 
                    setupRealtimeUpdates();
                    setupRealtimeUserRsvps()
                    
                    if (addEventButton) {
                        if (role === 'manager' || role === 'admin') {
                            addEventButton.style.display = 'block'; 
                            addEventButton.removeEventListener('click', addNewEventEditingCard);
                            addEventButton.addEventListener('click', addNewEventEditingCard);
                        } else {
                            addEventButton.style.display = 'none'; 
                        }
                    }

                } else {
                    // if (clubScheduleTitle) clubScheduleTitle.textContent = "Club Schedule (Club Not Found)";
                    if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addEventButton) addEventButton.style.display = 'none';
                }
            } catch (error) {
                console.error("Error fetching club details or user role:", error);
                // if (clubScheduleTitle) clubScheduleTitle.textContent = "Error Loading Schedule";
                if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">An error occurred while loading club details.</p>`;
                if (addEventButton) addEventButton.style.display = 'none'; 
            }
        } else {
            // if (clubScheduleTitle) clubScheduleTitle.textContent = "Error: No Club ID Provided";
            if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Please return to your clubs page and select a club to view its schedule.</p>`;
            if (addEventButton) addEventButton.style.display = 'none'; 
            if (eventListenerUnsubscribe) {
                eventListenerUnsubscribe();
                eventListenerUnsubscribe = null;
            }
            if (rsvpListenerUnsubscribe) {
                rsvpListenerUnsubscribe();
                rsvpListenerUnsubscribe = null;
            }
        }
    } else {
        // if (clubScheduleTitle) clubScheduleTitle.textContent = "Not Authenticated";
        if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">You must be logged in to view club schedule. Redirecting...</p>`;
        if (addEventButton) addEventButton.style.display = 'none'; 
        if (eventListenerUnsubscribe) {
            eventListenerUnsubscribe();
            eventListenerUnsubscribe = null;
        }
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000); 
    }
});

async function cancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to cancel the event on ${occurrenceDateString}? It will no longer appear on the schedule.`);
    if (!confirmed) {
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

        const hypotheticalExceptions = [...existingExceptions, occurrenceDateString];

        let activeOccurrencesCount = 0;
        if (eventData.isWeekly) {
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

            let currentDate = new Date(startDate);
            while (currentDate.getTime() <= endDate.getTime()) {
                const currentOccDateString = currentDate.toISOString().split('T')[0];
                if (daysToMatch.includes(currentDate.getUTCDay()) && !hypotheticalExceptions.includes(currentOccDateString)) {
                    activeOccurrencesCount++;
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        } else {
            activeOccurrencesCount = 0;
        }

        let finalAlertMessage = '';

        if (activeOccurrencesCount === 0) {
            await deleteEntireEvent(eventId, eventData.isWeekly, true);
            finalAlertMessage = "This was the last active instance. The event has been automatically deleted.";

            const makeAnnouncementConfirm = await showAppConfirm(`The event on ${occurrenceDateString} has been canceled. Would you like to make an announcement about this cancellation?`);
            if (makeAnnouncementConfirm) {
                const formattedDate = new Date(occurrenceDateString + 'T00:00:00Z').toLocaleDateString(undefined, {
                    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
                });
                const formattedTime = `${formatTime(eventData.startTime)} - ${formatTime(eventData.endTime)}`;
                const defaultTitle = `Canceled ${eventData.eventName}`;
                const defaultContent = `The event "${eventData.eventName}" scheduled for ${formattedDate} (${formattedTime}) has been canceled.`;
                await createAnnouncementPopup({ title: defaultTitle, content: defaultContent });
            }

        } else {
            await updateDoc(eventDocRef, {
                exceptions: arrayUnion(occurrenceDateString)
            });
            finalAlertMessage = `The event on ${occurrenceDateString} has been canceled.`;

            const makeAnnouncementConfirm = await showAppConfirm(`The event on ${occurrenceDateString} has been canceled. Would you like to make an announcement about this cancellation?`);
            if (makeAnnouncementConfirm) {
                const formattedDate = new Date(occurrenceDateString + 'T00:00:00Z').toLocaleDateString(undefined, {
                    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
                });
                const formattedTime = `${formatTime(eventData.startTime)} - ${formatTime(eventData.endTime)}`;
                const defaultTitle = `Canceled ${eventData.eventName}`;
                const defaultContent = `The event "${eventData.eventName}" scheduled for ${formattedDate} (${formattedTime}) has been canceled.`;
                await createAnnouncementPopup({ title: defaultTitle, content: defaultContent });
            }
        }
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        //await fetchAndDisplayEvents(); 
    } catch (error) {
        console.error("Error canceling single event occurrence:", error);
        await showAppAlert("Failed to cancel event occurrence: " + error.message);
    }
}

//Don't need to use this anymore since it is too complicated to keep, but keeping in case I need it later for some reason (but it is not actually used for anything)
async function uncancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to un-cancel the event on ${occurrenceDateString}? It will reappear on the schedule.`);
    if (!confirmed) {
        return;
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventId);
        await updateDoc(eventDocRef, {
            exceptions: arrayRemove(occurrenceDateString)
        });
        await showAppAlert(`The event on ${occurrenceDateString} has been un-canceled.`);
    } catch (error) {
        console.error("Error un-canceling single event occurrence:", error);
        await showAppAlert("Failed to un-cancel event occurrence: " + error.message);
    }
}

function createEditingCardElement(initialData = {}, isNewEvent = true, eventIdToUpdate = null, isEditingInstance = false, originalEventIdForInstance = null, originalOccurrenceDate = null) {
    isEditingEvent = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card editing-event-card';
    const daysOfWeekOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const currentEditId = eventIdToUpdate || `new-${Date.now()}`;
    cardDiv.dataset.editId = currentEditId;
    cardDiv.dataset.isNewEvent = isNewEvent;
    if (isEditingInstance) {
        cardDiv.dataset.isEditingInstance = 'true';
        cardDiv.dataset.originalEventIdForInstance = originalEventIdForInstance;
        cardDiv.dataset.originalOccurrenceDate = originalOccurrenceDate;
    }

    const eventNameInputFieldHtml = `
        <div>
            <label for="edit-name-${currentEditId}">Event Name:</label>
            <input type="text" id="edit-name-${currentEditId}" value="${initialData.eventName || ''}" required>
        </div>
    `;

    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
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
            if (isEditingInstance) return;

            
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

        if (!isEditingInstance) { 
            isWeeklyCheckbox.addEventListener('change', toggleRecurringFields);
        }

        toggleRecurringFields();
    }

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        await saveEvent(cardDiv, eventIdToUpdate); 
        isEditingEvent = false;
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        cardDiv.remove();
        isEditingEvent = false; 
        if (!isNewEvent) {
            //await fetchAndDisplayEvents();
        } else if (eventsContainer && eventsContainer.querySelectorAll('.event-card').length === 0 && noEventsMessage) {
            noEventsMessage.style.display = 'block';
        }
        //await showAppAlert("Event editing/creation canceled.");
    });

    return cardDiv;
}

async function addNewEventEditingCard() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to add events.");
        return;
    }
    if (isEditingEvent) { 
        await showAppAlert("Please finish editing the current event before adding a new one.");
        return;
    }

    const newCardElement = createEditingCardElement({}, true); 

    if (eventsContainer) {
        if (noEventsMessage) noEventsMessage.style.display = 'none';

        eventsContainer.prepend(newCardElement);
    }
}

function formatTime(timeString) {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date(); 
    date.setHours(hours, minutes);
    return date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, options);
}

async function saveEvent(cardDiv, existingEventId = null) {
    const tempDomId = cardDiv.dataset.editId;
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true';
    const isEditingInstance = cardDiv.dataset.isEditingInstance === 'true';
    const originalEventIdForInstance = cardDiv.dataset.originalEventIdForInstance; 
    const originalOccurrenceDateForInstance = cardDiv.dataset.originalOccurrenceDate; 

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

    if (isWeekly && !isEditingInstance) { 
        const futureOccurrences = calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, [], startTime, endTime);
        if (futureOccurrences === 0) {
            await showAppAlert("This weekly event configuration results in no events. Please adjust the dates or days of the week.");
            return; 
        }
    }

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

    eventDataToSave.createdAt = serverTimestamp(); 
    eventDataToSave.createdByUid = currentUser.uid;
    eventDataToSave.createdByName = currentUser.displayName || "Anonymous";

    try {
        const eventsRef = collection(db, "clubs", clubId, "events");

        if (isEditingInstance) {
            if (originalEventIdForInstance && originalOccurrenceDateForInstance) {
                const parentEventDocRef = doc(db, "clubs", clubId, "events", originalEventIdForInstance);
                await updateDoc(parentEventDocRef, {
                    exceptions: arrayUnion(originalOccurrenceDateForInstance)
                });
            }

            const overrideEventData = {
                ...eventDataToSave,
                parentRecurringEventId: originalEventIdForInstance 
            };
            const newOverrideEventRef = await addDoc(eventsRef, overrideEventData); 
            savedEventId = newOverrideEventRef.id; 
            savedOccurrenceDate = eventDataToSave.eventDate;
            const newOverrideEventId = newOverrideEventRef.id; 

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
                        const newRsvpDocId = `${newOverrideEventId}_${originalOccurrenceDateForInstance}_${rsvpDoc.data().userId}`;
                        const newRsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", newRsvpDocId);

                        const newRsvpData = { ...rsvpDoc.data(), eventId: newOverrideEventId };
                        rsvpBatch.set(newRsvpDocRef, newRsvpData); 
                        rsvpBatch.delete(rsvpDoc.ref);
                    });
                    await rsvpBatch.commit();
                }
            }
            await showAppAlert("Event updated successfully!");

        } else if (existingEventId) {
            const eventDocRef = doc(eventsRef, existingEventId);
            const existingDocSnap = await getDoc(eventDocRef);
            if (existingDocSnap.exists()) {
                const existingData = existingDocSnap.data();
                const updatedData = {
                    ...eventDataToSave,
                    exceptions: existingData.exceptions || [],
                };
                await updateDoc(eventDocRef, updatedData);
                savedEventId = existingEventId;
                savedOccurrenceDate = eventDataToSave.isWeekly ? null : eventDataToSave.eventDate; 
                await showAppAlert("Event updated successfully!");
            } else {
                console.error("Error: Attempted to update non-existent event document:", existingEventId);
                await showAppAlert("Failed to update event: Original event not found.");
            }
        } else {
            const newDocRef = await addDoc(eventsRef, eventDataToSave);
            savedEventId = newDocRef.id; 
            savedOccurrenceDate = eventDataToSave.isWeekly ? null : eventDataToSave.eventDate;
            await showAppAlert("New event added successfully!");
        }
        
        cardDiv.remove();
        isEditingEvent = false;
        //await fetchAndDisplayEvents(); 

        if (savedEventId) {
            scrollToEditedEvent(savedEventId, savedOccurrenceDate); 
        }

    } catch (error) {
        console.error("Error saving event:", error);
        isEditingEvent = false;
        await showAppAlert("Failed to save event: " + error.message);
    }
}

function setupRealtimeUpdates() {
    if (!clubId) {
        console.warn("setupRealtimeUpdates called without a clubId.");
        if (eventsContainer) eventsContainer.innerHTML = '<p class="fancy-label">No club selected.</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
        return;
    }

    const eventsRef = collection(db, "clubs", clubId, "events");
    const q = query(eventsRef, orderBy("createdAt", "desc"));

    if (eventListenerUnsubscribe) {
        eventListenerUnsubscribe();
        eventListenerUnsubscribe = null;
    }

    eventListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
        if (eventsContainer) {
            eventsContainer.innerHTML = '';
        }

        let allEventOccurrences = [];
        querySnapshot.forEach((doc) => {
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

                    if (daysToMatch.includes(currentDate.getUTCDay())) {
                        if (!exceptions.includes(currentOccDateString)) {
                            allEventOccurrences.push({
                                eventData: eventData,
                                occurrenceDate: new Date(currentDate),
                                originalEventId: eventId
                            });
                        }
                    }
                    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                }
            } else {
                const eventDateString = new Date(eventData.eventDate).toISOString().split('T')[0];
                if (!exceptions.includes(eventDateString)) {
                    allEventOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'),
                        originalEventId: eventId
                    });
                }
            }
        });

        const now = new Date();

        allEventOccurrences = allEventOccurrences.filter(occurrence => {
            const eventDateStr = occurrence.occurrenceDate.toISOString().split('T')[0];
            const eventEndTimeStr = occurrence.eventData.endTime;
            const eventEndMomentLocal = new Date(`${eventDateStr}T${eventEndTimeStr}`);
            return eventEndMomentLocal.getTime() > now.getTime();
        });

        allEventOccurrences.sort((a, b) => {
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
            return dateTimeA - dateTimeB;
        });

        if (allEventOccurrences.length === 0) {
            if (role === 'member') {
                eventsContainer.innerHTML = '<p class="fancy-label">NO UPCOMING EVENTS</p>';
            }
            if (noEventsMessage) noEventsMessage.style.display = 'block';
            return;
        }

        if (noEventsMessage) noEventsMessage.style.display = 'none';

        allEventOccurrences.forEach(occurrence => {
            const eventDisplayCard = createSingleOccurrenceDisplayCard(occurrence.eventData, occurrence.occurrenceDate, occurrence.originalEventId);
            if (eventsContainer) {
                eventsContainer.appendChild(eventDisplayCard);
            }
        });
    }, (error) => {
        console.error("Error fetching realtime events:", error);
        if (eventsContainer) eventsContainer.innerHTML = '<p class="fancy-label">Error loading events. Please try again later.</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
    });
}

function createSingleOccurrenceDisplayCard(eventData, occurrenceDate, originalEventId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card display-event-card';
    cardDiv.dataset.originalEventId = originalEventId;
    const occurrenceDateString = occurrenceDate.toISOString().split('T')[0]; 
    cardDiv.dataset.occurrenceDate = occurrenceDateString;

    const formattedDate = occurrenceDate.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
    });

    const isExcepted = eventData.exceptions && eventData.exceptions.includes(occurrenceDateString);

    const canEditDelete = (role === 'manager' || role === 'admin');
    let actionButtonsHtml = '';

    if (canEditDelete) {
        if (eventData.isWeekly) {
            
            if (isExcepted) {
                actionButtonsHtml = `
                    <div class="event-card-actions">
                        <button class="uncancel-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">UN-CANCEL EVENT</button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">
                            <span class="button-text">DELETE SERIES</span><span class="button-icon"><i class="fa-regular fa-calendar"></i></span>
                        </button>
                    </div>
                `;
            } else {
                actionButtonsHtml = `
                    <div class="event-card-actions">
                        <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">
                            <span class="button-text">EDIT EVENT</span><span class="button-icon"><i class="fa-solid fa-pencil"></i></span>
                        </button>
                        <button class="cancel-instance-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">
                            <span class="button-text">DELETE EVENT</span><span class="button-icon"><i class="fa-solid fa-trash"></i></span>
                        </button>
                        <button class="delete-series-btn" data-event-id="${originalEventId}">
                            <span class="button-text">DELETE SERIES</span><span class="button-icon"><i class="fa-regular fa-calendar"></i></span>
                        </button>
                    </div>
                `;
            }
        } else {
            
            actionButtonsHtml = `
                <div class="event-card-actions">
                    <button class="edit-btn" data-event-id="${originalEventId}" data-occurrence-date="${occurrenceDateString}">
                        <span class="button-text">EDIT EVENT</span><span class="button-icon"><i class="fa-solid fa-pencil"></i></span>
                    </button>
                    <button class="delete-btn" data-event-id="${originalEventId}">
                        <span class="button-text">DELETE EVENT</span><span class="button-icon"><i class="fa-solid fa-trash"></i></span>
                    </button>
                    ${eventData.parentRecurringEventId ? `
                        <button class="delete-parent-series-btn" data-parent-event-id="${eventData.parentRecurringEventId}">
                            <span class="button-text">DELETE SERIES</span><span class="button-icon"><i class="fa-regular fa-calendar"></i></span>
                        </button>
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
            const occurrenceDate = e.target.dataset.occurrenceDate; 
            const status = e.target.dataset.status;
            saveRsvpStatus(eventId, occurrenceDate, status); 
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

    
    fetchAndSetUserRsvp(originalEventId, occurrenceDateString);

    
    if (canEditDelete) {
        
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                const clickedButton = e.currentTarget; 
                const eventId = clickedButton.dataset.eventId;
                const occDate = clickedButton.dataset.occurrenceDate;
                await editEvent(eventId, occDate);
            });
        }

        const deleteEntireBtn = cardDiv.querySelector('.delete-btn') || cardDiv.querySelector('.delete-series-btn');
        if (deleteEntireBtn) {
            deleteEntireBtn.addEventListener('click', (e) => {
                const clickedButton = e.currentTarget; 
                const eventId = clickedButton.dataset.eventId;
                deleteEntireEvent(eventId, eventData.isWeekly);
            });
        }

        
        const cancelInstanceBtn = cardDiv.querySelector('.cancel-instance-btn');
        if (cancelInstanceBtn) {
            cancelInstanceBtn.addEventListener('click', (e) => {
                const clickedButton = e.currentTarget; 
                const eventId = clickedButton.dataset.eventId;
                const occDateString = clickedButton.dataset.occurrenceDate;
                cancelSingleOccurrence(eventId, occDateString);
            });
        }

        const uncancelBtn = cardDiv.querySelector('.uncancel-btn');
        if (uncancelBtn) {
            uncancelBtn.addEventListener('click', async (e) => {
                const clickedButton = e.currentTarget; 
                const eventId = clickedButton.dataset.eventId;
                const occDateString = clickedButton.dataset.occurrenceDate;
                uncancelSingleOccurrence(eventId, occDateString);
            });
        }
    }

    const deleteParentSeriesBtn = cardDiv.querySelector('.delete-parent-series-btn');
    if (deleteParentSeriesBtn) {
        deleteParentSeriesBtn.addEventListener('click', (e) => {
            const clickedButton = e.currentTarget; 
            const parentEventId = clickedButton.dataset.parentEventId;
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
    const eventName = mainEventData.eventName || "Untitled Event Series"; 

    const confirmed = await showAppConfirm(`Are you sure you want to delete this ENTIRE event series? All events of type "${eventName}" will be deleted. This action cannot be undone.`);

    if (!confirmed) {
        return;
    }

    const batch = writeBatch(db);
    let deletedCount = 0;

    try {
        const mainEventRef = doc(db, "clubs", clubId, "events", parentEventIdToDelete);
        batch.delete(mainEventRef);
        deletedCount++;

        const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", parentEventIdToDelete));
        const overridesSnap = await getDocs(overridesQuery);
        overridesSnap.forEach((overrideDoc) => {
            batch.delete(overrideDoc.ref);
            deletedCount++;
        });

        const rsvpsQueryForMainSeries = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", parentEventIdToDelete));
        const rsvpsSnapForMainSeries = await getDocs(rsvpsQueryForMainSeries);
        rsvpsSnapForMainSeries.forEach((rsvpDoc) => {
            batch.delete(rsvpDoc.ref);
        });

        const overrideEventIds = overridesSnap.docs.map(doc => doc.id);
        if (overrideEventIds.length > 0) {
            const rsvpsQueryForOverrides = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideEventIds));
            const rsvpsSnapForOverrides = await getDocs(rsvpsQueryForOverrides);
            rsvpsSnapForOverrides.forEach((rsvpDoc) => {
                batch.delete(rsvpDoc.ref);
            });
        }


        await batch.commit();
        await showAppAlert("Event deleted successfully!");
        //await showAppAlert(`Successfully deleted the recurring series and ${deletedCount - 1} associated overrides and all their RSVPs!`);
        //await fetchAndDisplayEvents();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error("Error deleting entire series and overrides:", error);
        await showAppAlert("Failed to delete the series and its overrides: " + error.message);
    }
}

async function deleteEntireEvent(eventIdToDelete, isWeeklyEvent = false, skipConfirm = false) {
    const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
    const eventSnap = await getDoc(eventDocRef);
    const eventData = eventSnap.exists() ? eventSnap.data() : null;
    const eventName = eventData ? eventData.eventName : "Untitled Event";

    if (!skipConfirm) { 
        let confirmMessage;
        if (isWeeklyEvent) {
            confirmMessage = `Are you sure you want to delete this ENTIRE event series? All events of type "${eventName}" will be deleted. This action cannot be undone.`;
        } else {
            confirmMessage = `Are you sure you want to cancel the event "${eventName}"? This action cannot be undone.`;
        }

        const confirmed = await showAppConfirm(confirmMessage);
        if (!confirmed) {
            return; 
        }
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
        const eventSnap = await getDoc(eventDocRef); 
        const eventData = eventSnap.exists() ? eventSnap.data() : null;

        const batch = writeBatch(db); 
        batch.delete(eventDocRef);

        const rsvpsQueryForEvent = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", eventIdToDelete));
        const rsvpsSnapForEvent = await getDocs(rsvpsQueryForEvent);
        rsvpsSnapForEvent.forEach((rsvpDoc) => {
            batch.delete(rsvpDoc.ref);
        });

        if (eventData && eventData.isWeekly) {
            const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", eventIdToDelete));
            const overridesSnap = await getDocs(overridesQuery);
            const overrideEventIds = overridesSnap.docs.map(doc => doc.id); 

            overridesSnap.forEach((overrideDoc) => {
                batch.delete(overrideDoc.ref);
            });

            if (overrideEventIds.length > 0) {
                const rsvpsQueryForOverrides = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideEventIds));
                const rsvpsSnapForOverrides = await getDocs(rsvpsQueryForOverrides);
                rsvpsSnapForOverrides.forEach((rsvpDoc) => {
                    batch.delete(rsvpDoc.ref);
                });
            }
        }

        if (!skipConfirm && eventData && !isWeeklyEvent) { 
            let announcementPromptMessage = "";
            let defaultTitle = "";
            let defaultContent = "";

                
            const eventDateString = eventData.eventDate; 
            const formattedDate = new Date(eventDateString + 'T00:00:00Z').toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
            });
            const formattedTime = `${formatTime(eventData.startTime)} - ${formatTime(eventData.endTime)}`;
            announcementPromptMessage = `The event "${eventName}" has been canceled. Would you like to make an announcement about this cancellation?`;
            defaultTitle = `Canceled ${eventName}`;
            defaultContent = `The event "${eventName}" scheduled for ${formattedDate} (${formattedTime}) has been canceled.`;

            const makeAnnouncementConfirm = await showAppConfirm(announcementPromptMessage);
            if (makeAnnouncementConfirm) {
                await createAnnouncementPopup({ title: defaultTitle, content: defaultContent });
            }
        }

        await batch.commit();

        if (!skipConfirm) {
            await showAppAlert("Event deleted successfully!");
        }
        //await fetchAndDisplayEvents(); 
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

    const eventDocRef = doc(db, "clubs", clubId, "events", eventId);
    const eventSnap = await getDoc(eventDocRef);

    if (!eventSnap.exists()) {
        await showAppAlert("Error: Event not found.");
        return;
    }

    const eventData = eventSnap.data();

    
    let targetDisplayCard;
    if (eventData.isWeekly && occurrenceDateString) { 
            targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`);
    } else { 
            targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"]`);
    }

    if (!targetDisplayCard) {
        console.error("Could not find the target display card in the DOM for editing.");
        await showAppAlert("Could not find the event card to edit. Please refresh.");
        return;
    }

    if (eventData.isWeekly && !occurrenceDateString) {
        const editingCard = createEditingCardElement(eventData, false, eventId); 
        targetDisplayCard.replaceWith(editingCard); 
        
        
        return; 
    }

    
    let dataForEditingCard = {};
    let isEditingInstance = false;
    let tempOriginalEventId = eventId; 

    if (eventData.isWeekly && occurrenceDateString) {
        isEditingInstance = true;
        
        dataForEditingCard = {
            eventName: eventData.eventName,
            isWeekly: false, 
            eventDate: occurrenceDateString, 
            startTime: eventData.startTime,
            endTime: eventData.endTime,
            address: eventData.address,
            location: eventData.location,
            notes: eventData.notes,
            createdByUid: eventData.createdByUid,
            createdByName: eventData.createdByName
            
        };
    } else {
        dataForEditingCard = eventData;
    }

    const editingCard = createEditingCardElement(dataForEditingCard, false, tempOriginalEventId, isEditingInstance, eventId, occurrenceDateString);
    targetDisplayCard.replaceWith(editingCard);
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


async function saveRsvpStatus(originalEventId, occurrenceDateString, status) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to RSVP.");
        return;
    }

    try {
        const userUid = currentUser.uid;
        
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);

        
        const rsvpSnap = await getDoc(rsvpDocRef);
        let currentRsvpStatus = rsvpSnap.exists() ? rsvpSnap.data().status : null;

        let newRsvpStatus = null; 
        const rsvpDataToSave = {
            eventId: originalEventId,
            occurrenceDate: occurrenceDateString,
            userId: userUid,
            userName: currentUser.displayName || "Anonymous User",
            timestamp: serverTimestamp(),
            clubId: clubId,
        };

        if (currentRsvpStatus === status) {
            
            await deleteDoc(rsvpDocRef);
            //await showAppAlert(`Your RSVP has been removed for the event on ${formatDate(occurrenceDateString)}.`);
            newRsvpStatus = null;
        } else {
            rsvpDataToSave.status = status;
            await setDoc(rsvpDocRef, rsvpDataToSave); 
            //await showAppAlert(`Your RSVP (${status}) has been saved for the event on ${formatDate(occurrenceDateString)}.`);
            newRsvpStatus = status;
        }

        updateRsvpButtonsUI(originalEventId, occurrenceDateString, newRsvpStatus);

    } catch (error) {
        console.error("Error saving RSVP status:", error);
        await showAppAlert("Failed to save your RSVP: " + error.message);
    }
}

function updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentStatus) { 
    
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

async function fetchAndSetUserRsvp(originalEventId, occurrenceDateString) { 
    if (!currentUser || !clubId) {
        return;
    }

    try {
        const userUid = currentUser.uid;
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);
        const rsvpSnap = await getDoc(rsvpDocRef);

        let currentRsvpStatus = null;

        if (rsvpSnap.exists()) {
            currentRsvpStatus = rsvpSnap.data().status;
        }
        

        updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentRsvpStatus);
        
    } catch (error) {
        console.error("Error fetching user RSVP status for occurrence:", error);
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, null);
    }
}

function setupRealtimeUserRsvps() {
    if (!clubId || !currentUser) {
        console.warn("setupRealtimeUserRsvps called without clubId or currentUser. Skipping setup.");
        if (rsvpListenerUnsubscribe) {
            rsvpListenerUnsubscribe();
            rsvpListenerUnsubscribe = null;
        }
        return;
    }


    if (rsvpListenerUnsubscribe) {
        rsvpListenerUnsubscribe();
        rsvpListenerUnsubscribe = null;
    }

    const rsvpsRef = collection(db, "clubs", clubId, "occurrenceRsvps");
    const q = query(rsvpsRef, where("userId", "==", currentUser.uid));

    rsvpListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
        querySnapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const originalEventId = data.eventId;
            const occurrenceDateString = data.occurrenceDate;
            let newStatus = null; 

            if (change.type === "added" || change.type === "modified") {
                newStatus = data.status;
            }
            // } else if (change.type === "removed") {
            //     console.log(`RSVP removed`);
            // }
            
            updateRsvpButtonsUI(originalEventId, occurrenceDateString, newStatus);
        });
    }, (error) => {
        console.error("Error fetching realtime user RSVPs:", error);
    });
}

async function getAllClubMembers(clubID, useCache = true) {
    if (useCache && memberListCache.has(clubID)) {
        const cached = memberListCache.get(clubID);
        const age = Date.now() - cached.timestamp;
        
        if (age < CACHE_DURATION) {
            console.log("Using cached list");
            return cached.members;
        }
    }

    const members = [];
    try {
        const clubDocRef = doc(db, "clubs", clubID);
        const clubDocSnap = await getDoc(clubDocRef);
        let managerUid = null;
        
        if (clubDocSnap.exists()) {
            const clubData = clubDocSnap.data();
            managerUid = clubData.managerUid;
            
            if (managerUid) {
                let managerName;
                if (userCache.has(managerUid)) {
                    console.log("Using cached manager data");
                    managerName = userCache.get(managerUid).displayName;
                } else {
                    const managerUserDoc = await getDoc(doc(db, "users", managerUid));
                    managerName = managerUserDoc.exists() ? 
                        (managerUserDoc.data().displayName || managerUserDoc.data().name) : 
                        "Unknown Manager";
                    if (managerUserDoc.exists()) {
                        userCache.set(managerUid, managerUserDoc.data());
                    }
                }
                members.push({ uid: managerUid, name: managerName, role: 'manager' });
            }
        }

        const membersCollectionRef = collection(db, "clubs", clubID, "members");
        const membersSnapshot = await getDocs(membersCollectionRef);
        
        const uidsToFetch = [];
        for (const memberDoc of membersSnapshot.docs) {
            if (memberDoc.id !== managerUid && !userCache.has(memberDoc.id)) {
                uidsToFetch.push(memberDoc.id);
            }
        }

        console.log(`Fetching ${uidsToFetch.length} uncached user documents`);
        for (const uid of uidsToFetch) {
            const memberUserDoc = await getDoc(doc(db, "users", uid));
            if (memberUserDoc.exists()) {
                userCache.set(uid, memberUserDoc.data());
            }
        }

        for (const memberDoc of membersSnapshot.docs) {
            const memberData = memberDoc.data();
            if (memberDoc.id !== managerUid) {
                const userData = userCache.get(memberDoc.id);
                const memberName = userData ? 
                    (userData.displayName || userData.name) : 
                    "Unknown User";
                members.push({ 
                    uid: memberDoc.id, 
                    name: memberName, 
                    role: memberData.role || 'member' 
                });
            }
        }

        memberListCache.set(clubID, {
            members,
            timestamp: Date.now()
        });
        
        console.log("Member list cached");

    } catch (error) {
        console.error("Error fetching all club members:", error);
    }
    return members;
}

async function showRsvpDetailsModal(eventId, occurrenceDateString) {
    if (!clubId) {
        await showAppAlert("Error: Club ID not found.");
        return;
    }

    document.body.classList.add('no-interaction');

    let overlay = document.getElementById('rsvp-details-overlay');
    let modal = document.getElementById('rsvp-details-modal');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rsvp-details-overlay';
        overlay.className = 'rsvp-details-overlay';
        document.body.appendChild(overlay);
    }
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rsvp-details-modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <h2>Responses for ${formatDate(occurrenceDateString)}</h2>
        <div id="rsvp-lists-container"> 
            <div id="rsvp-lists" style="display: none; text-align: left; padding: 0 15px;">
                <h3>Going (<span id="going-count">0</span>)</h3>
                <ul id="rsvp-going-list"></ul>
                <h3>Maybe (<span id="rsvp-maybe-count">0</span>)</h3>
                <ul id="rsvp-maybe-list"></ul>
                <h3>Not Going (<span id="not-going-count">0</span>)</h3>
                <ul id="rsvp-not-going-list"></ul>
                <h3>No Response (<span id="not-responded-count">0</span>)</h3>
                <ul id="rsvp-not-responded-list"></ul>
                <button id="close-rsvp-modal" class="fancy-button" disabled>Close</button>
            </div>
        </div>
    `;
    modal.classList.add('rsvp-loading-collapsed');
    modal.classList.remove('rsvp-scroll-active');
    document.body.classList.add('no-scroll');

    document.getElementById('close-rsvp-modal').addEventListener('click', () => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
        modal.classList.add('rsvp-loading-collapsed');
        modal.classList.remove('rsvp-scroll-active');
        document.body.classList.remove('no-interaction');
        //if (loadingIndicator) loadingIndicator.style.display = 'block';
        const contentDiv = document.getElementById('rsvp-lists');
        if (contentDiv) contentDiv.style.display = 'none';
    });

    overlay.style.display = 'flex';
    modal.style.display = 'flex';

    try {
        const rsvpsQuery = query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "==", eventId),
            where("occurrenceDate", "==", occurrenceDateString)
        );
        const rsvpsSnap = await getDocs(rsvpsQuery);
        const rsvpsMap = {};
        rsvpsSnap.forEach(doc => {
            const data = doc.data();
            rsvpsMap[data.userId] = { status: data.status, userName: data.userName };
        });

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
                notRespondedList.innerHTML += `<li>${member.name}</li>`; 
                notRespondedCount++;
            }
        });
        document.getElementById('rsvp-lists').style.display = 'block';

        modal.classList.remove('rsvp-loading-collapsed');
        modal.addEventListener('transitionend', function handler(event) {
            if (event.propertyName === 'max-height') {
                modal.classList.add('rsvp-scroll-active'); 
                const contentDiv = document.getElementById('rsvp-lists');
                if (contentDiv) {
                    contentDiv.style.display = 'block'; 
                    document.getElementById('close-rsvp-modal').disabled = false;
                }
                document.body.classList.remove('no-interaction');
                modal.removeEventListener('transitionend', handler); 
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
        document.body.classList.remove('no-interaction');
        //if (loadingIndicator) loadingIndicator.style.display = 'none';
        const contentDiv = document.getElementById('rsvp-lists');
        if (contentDiv) contentDiv.style.display = 'none';
        modal.classList.add('rsvp-loading-collapsed');
        modal.classList.remove('rsvp-scroll-active');
    }
}

function scrollToEditedEvent(eventId, occurrenceDateString = null) {
    let selector;
    if (occurrenceDateString) {
        selector = `.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`;
    } else {
        selector = `.event-card[data-original-event-id="${eventId}"]`;
    }

    const targetElement = document.querySelector(selector);

    if (targetElement) {
        const topPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
            top: topPosition - 110, 
            behavior: 'smooth'
        });
    } else {
        console.warn(`Could not find event card to scroll to for ID: ${eventId}, Date: ${occurrenceDateString || 'N/A'}`);
    }
}

function calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, exceptions = [], startTime = '00:00', endTime = '23:59') {
    let futureCount = 0;
    const now = new Date(); 
    
    const startIterDate = new Date(weeklyStartDate + 'T00:00:00Z');
    const endIterDate = new Date(weeklyEndDate + 'T00:00:00Z');
    const daysToMatch = daysOfWeek.map(day => dayNamesMap.indexOf(day));

    let currentDate = new Date(startIterDate);
    while (currentDate.getTime() <= endIterDate.getTime()) {
        const currentOccDateString = currentDate.toISOString().split('T')[0];
        
        if (daysToMatch.includes(currentDate.getUTCDay())) {
            if (!exceptions.includes(currentOccDateString)) {
                
                const eventEndMomentLocal = new Date(`${currentOccDateString}T${endTime}`);

                
                if (eventEndMomentLocal.getTime() > now.getTime()) {
                    futureCount++;
                }
            }
        }
        currentDate.setUTCDate(currentDate.getUTCDate() + 1); 
    }
    return futureCount;
}

async function createAnnouncementPopup(initialData = {}) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('announcement-popup-overlay');
        let modal = document.getElementById('announcement-popup-modal');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'announcement-popup-overlay';
            overlay.className = 'announcement-popup-overlay';
            document.body.appendChild(overlay);
        }

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'announcement-popup-modal';
            modal.className = 'announcement-card editing-announcement-card announcement-popup-modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <h3>Create Announcement</h3>
            <div>
                <label for="announcement-popup-title" style="margin-bottom: 5px;">Title:</label>
                <input type="text" id="announcement-popup-title" value="${initialData.title || ''}" required style="width: calc(100% - 16px);">
            </div>
            <div>
                <label for="announcement-popup-content" style="margin-bottom: 5px;">Content:</label>
                <textarea id="announcement-popup-content" rows="5" required style="width: calc(100% - 16px);">${initialData.content || ''}</textarea>
            </div>
            <div class="announcement-card-actions">
                <button id="announcement-popup-save-btn" class="fancy-button">SAVE</button>
                <button id="announcement-popup-cancel-btn" class="fancy-button">CANCEL</button>
            </div>
        `;

        document.body.classList.add('no-scroll');
        overlay.style.display = 'flex';
        modal.style.display = 'flex';

        document.getElementById('announcement-popup-save-btn').addEventListener('click', async () => {
            const title = document.getElementById('announcement-popup-title').value.trim();
            const content = document.getElementById('announcement-popup-content').value.trim();

            if (!title || !content || title.length === 0 || content.length === 0) {
                await showAppAlert("Title and Content are required for the announcement.");
                return; 
            }

            const saveSuccessful = await saveAnnouncement(title, content);
            if (saveSuccessful) {
                overlay.style.display = 'none';
                modal.style.display = 'none';
                document.body.classList.remove('no-scroll');
                resolve(true); 
            } else {
                resolve(false);
            }
        });

        document.getElementById('announcement-popup-cancel-btn').addEventListener('click', () => {
            overlay.style.display = 'none';
            modal.style.display = 'none';
            document.body.classList.remove('no-scroll');
            resolve(false); 
        });
    });
}


async function saveAnnouncement(title, content) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to create announcements.");
        return false;
    }

    try {
        const announcementsRef = collection(db, "clubs", clubId, "announcements");
        const announcementDataToSave = {
            title,
            content,
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId: clubId,
            createdAt: serverTimestamp()
        };
        const newDocRef = await addDoc(announcementsRef, announcementDataToSave);
        const newAnnouncementId = newDocRef.id;

        await showAppAlert("Announcement saved!");
        return true;
    } catch (error) {
        console.error("Error saving announcement from popup:", error);
        await showAppAlert("Failed to save announcement: " + error.message);
        return false;
    }
}
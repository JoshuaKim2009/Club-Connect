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
let rsvpListenerUnsubscribe = null;

// { eventId: { id, ...firestoreData } }
let eventDocsMap = new Map();

const userCache = new Map();
const memberListCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

const eventsContainer = document.getElementById('eventsContainer');
const noEventsMessage = document.getElementById('noEventsMessage');
const addEventButton = document.getElementById('add-event-button');

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];


//URL Auth helpers

function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberDoc.exists()) return memberDoc.data().role || 'member';
    const clubDoc = await getDoc(doc(db, "clubs", clubId));
    return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
}

window.goToClubPage = function () {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo');
    if (currentClubId) {
        let redirectUrl = 'your_clubs.html';
        if (returnToPage === 'manager') redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        else if (returnToPage === 'member') redirectUrl = `club_page_member.html?id=${currentClubId}`;
        else redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        window.location.href = redirectUrl;
    } else {
        window.location.href = 'your_clubs.html';
    }
};


//Auth state

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user) {
        if (clubId) {
            try {
                const clubSnap = await getDoc(doc(db, "clubs", clubId));
                if (clubSnap.exists()) {
                    role = await getMemberRoleForClub(clubId, currentUser.uid);

                    await fetchAndDisplayEvents();
                    setupRealtimeUserRsvps();

                    if (addEventButton) {
                        if (role === 'manager' || role === 'admin') {
                            addEventButton.style.display = 'block';
                            addEventButton.addEventListener('click', addNewEventEditingCard);
                        } else {
                            addEventButton.style.display = 'none';
                        }
                    }
                } else {
                    if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addEventButton) addEventButton.style.display = 'none';
                }
            } catch (error) {
                console.error("Error during auth init:", error);
                if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">An error occurred while loading club details.</p>`;
                if (addEventButton) addEventButton.style.display = 'none';
            }
        } else {
            if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Please return to your clubs page and select a club to view its schedule.</p>`;
            if (addEventButton) addEventButton.style.display = 'none';
        }
    } else {
        if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">You must be logged in to view club schedule. Redirecting...</p>`;
        if (addEventButton) addEventButton.style.display = 'none';
        if (rsvpListenerUnsubscribe) { rsvpListenerUnsubscribe(); rsvpListenerUnsubscribe = null; }
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    }
});


//Fetch and render all events

async function fetchAndDisplayEvents() {
    if (!clubId) return;

    try {
        const eventsRef = collection(db, "clubs", clubId, "events");
        const q = query(eventsRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);

        eventDocsMap.clear();
        querySnapshot.forEach(docSnap => {
            eventDocsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });

        renderAllEvents();
    } catch (error) {
        console.error("Error fetching events:", error);
        if (eventsContainer) eventsContainer.innerHTML = `<p class="fancy-label">Error loading events. Please try again later.</p>`;
    }
}

function renderAllEvents() {
    if (!eventsContainer) return;
    eventsContainer.innerHTML = '';

    const allOccurrences = buildOccurrenceList();

    if (allOccurrences.length === 0) {
        if (role === 'member') eventsContainer.innerHTML = '<p class="fancy-label">NO UPCOMING EVENTS</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
        return;
    }

    if (noEventsMessage) noEventsMessage.style.display = 'none';

    allOccurrences.forEach((occurrence, index) => {
        const card = createSingleOccurrenceDisplayCard(occurrence.eventData, occurrence.occurrenceDate, occurrence.originalEventId);
        eventsContainer.appendChild(card);
        animateCardIn(card, index);
    });
}

function buildOccurrenceList() {
    const now = new Date();
    const allOccurrences = [];

    eventDocsMap.forEach((eventData, eventId) => {
        const exceptions = eventData.exceptions || [];

        if (eventData.isWeekly) {
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));
            let currentDate = new Date(startDate);

            while (currentDate.getTime() <= endDate.getTime()) {
                const dateStr = currentDate.toISOString().split('T')[0];
                if (daysToMatch.includes(currentDate.getUTCDay()) && !exceptions.includes(dateStr)) {
                    const endMoment = new Date(`${dateStr}T${eventData.endTime}`);
                    if (endMoment.getTime() > now.getTime()) {
                        allOccurrences.push({ eventData, occurrenceDate: new Date(currentDate), originalEventId: eventId });
                    }
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        } else {
            const dateStr = eventData.eventDate;
            if (!exceptions.includes(dateStr)) {
                const endMoment = new Date(`${dateStr}T${eventData.endTime}`);
                if (endMoment.getTime() > now.getTime()) {
                    allOccurrences.push({ eventData, occurrenceDate: new Date(dateStr + 'T00:00:00Z'), originalEventId: eventId });
                }
            }
        }
    });

    allOccurrences.sort((a, b) => {
        const dtA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
        const dtB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
        return dtA - dtB;
    });

    return allOccurrences;
}



// After saving/updating an event doc, refresh only the cards that belong to that eventId
function refreshCardsForEvent(eventId) {
    if (!eventsContainer) return;

    // Remove all existing display cards for this event
    eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${eventId}"]`).forEach(c => c.remove());

    const eventData = eventDocsMap.get(eventId);
    if (!eventData) return; 

    const now = new Date();
    const exceptions = eventData.exceptions || [];
    const newOccurrences = [];

    if (eventData.isWeekly) {
        const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
        const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
        const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));
        let currentDate = new Date(startDate);

        while (currentDate.getTime() <= endDate.getTime()) {
            const dateStr = currentDate.toISOString().split('T')[0];
            if (daysToMatch.includes(currentDate.getUTCDay()) && !exceptions.includes(dateStr)) {
                const endMoment = new Date(`${dateStr}T${eventData.endTime}`);
                if (endMoment.getTime() > now.getTime()) {
                    newOccurrences.push({ eventData, occurrenceDate: new Date(currentDate), originalEventId: eventId });
                }
            }
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
    } else {
        const dateStr = eventData.eventDate;
        if (!exceptions.includes(dateStr)) {
            const endMoment = new Date(`${dateStr}T${eventData.endTime}`);
            if (endMoment.getTime() > now.getTime()) {
                newOccurrences.push({ eventData, occurrenceDate: new Date(dateStr + 'T00:00:00Z'), originalEventId: eventId });
            }
        }
    }

    if (newOccurrences.length === 0) {
        checkIfEmpty();
        return;
    }

    // Insert the new cards in the correct sorted position
    const allCurrentCards = Array.from(eventsContainer.querySelectorAll('.display-event-card'));

    newOccurrences.forEach(occ => {
        const newCard = createSingleOccurrenceDisplayCard(occ.eventData, occ.occurrenceDate, occ.originalEventId);
        const occDateTime = new Date(occ.occurrenceDate.toISOString().split('T')[0] + 'T' + occ.eventData.startTime + ':00Z').getTime();

        // Find insertion point
        let inserted = false;
        for (const existingCard of allCurrentCards) {
            const existingDate = existingCard.dataset.occurrenceDate;
            const existingEventId = existingCard.dataset.originalEventId;
            const existingEventData = eventDocsMap.get(existingEventId);
            if (!existingEventData) continue;
            const existingDateTime = new Date(existingDate + 'T' + existingEventData.startTime + ':00Z').getTime();
            if (occDateTime <= existingDateTime) {
                eventsContainer.insertBefore(newCard, existingCard);
                inserted = true;
                break;
            }
        }
        if (!inserted) eventsContainer.appendChild(newCard);
    });

    if (noEventsMessage) noEventsMessage.style.display = 'none';
}

// Remove all cards for a given eventId and clean up the map
function removeCardsForEvent(eventId) {
    eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${eventId}"]`).forEach(c => c.remove());
    eventDocsMap.delete(eventId);
    checkIfEmpty();
}

function checkIfEmpty() {
    if (!eventsContainer) return;
    const remaining = eventsContainer.querySelectorAll('.display-event-card');
    if (remaining.length === 0) {
        if (role === 'member') eventsContainer.innerHTML = '<p class="fancy-label">NO UPCOMING EVENTS</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
    }
}


//Add new event

async function addNewEventEditingCard() {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in and viewing a club to add events."); return; }
    if (isEditingEvent) { await showAppAlert("Please finish editing the current event before adding a new one."); return; }

    const newCard = createEditingCardElement({}, true);
    if (eventsContainer) {
        if (noEventsMessage) noEventsMessage.style.display = 'none';
        eventsContainer.prepend(newCard);
    }
}


// Editing card 

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

    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    const selectedDays = initialData.daysOfWeek || [];

    cardDiv.innerHTML = `
        <div>
            <label for="edit-name-${currentEditId}">Event Name:</label>
            <input type="text" id="edit-name-${currentEditId}" value="${initialData.eventName || ''}" required>
        </div>

        <div class="weekly-event-checkbox" style="display: ${isNewEvent ? 'block' : 'none'};">
            <label>
                <input type="checkbox" id="edit-is-weekly-${currentEditId}" ${isWeeklyChecked} ${isNewEvent ? '' : 'disabled'}>
                Repeating Event
            </label>
        </div>

        <div id="date-input-group-${currentEditId}" style="display: ${!initialData.isWeekly || isEditingInstance ? 'block' : 'none'};">
            <label for="edit-date-${currentEditId}">Event Date:</label>
            <input type="date" id="edit-date-${currentEditId}" value="${initialData.eventDate || originalOccurrenceDate || ''}" ${initialData.isWeekly && !isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div class="days-of-week-selection" id="days-of-week-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label>Days of Week:</label>
            <div class="checkbox-group">
                ${daysOfWeekOptions.map(day => `
                    <label>
                        <input type="checkbox" value="${day}" ${selectedDays.includes(day) ? 'checked' : ''} ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''}>
                        ${day}
                    </label>
                `).join('')}
            </div>
        </div>

        <div id="weekly-start-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-start-date-${currentEditId}">Start Date:</label>
            <input type="date" id="edit-weekly-start-date-${currentEditId}" value="${initialData.weeklyStartDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div id="weekly-end-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-end-date-${currentEditId}">End Date:</label>
            <input type="date" id="edit-weekly-end-date-${currentEditId}" value="${initialData.weeklyEndDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div>
            <label for="edit-start-time-${currentEditId}">Start Time:</label>
            <input type="time" id="edit-start-time-${currentEditId}" value="${initialData.startTime || ''}" required>
        </div>

        <div>
            <label for="edit-end-time-${currentEditId}">End Time:</label>
            <input type="time" id="edit-end-time-${currentEditId}" value="${initialData.endTime || ''}" required>
        </div>

        <div>
            <label for="edit-address-${currentEditId}">Address:</label>
            <input type="text" id="edit-address-${currentEditId}" value="${initialData.address || ''}" required>
        </div>

        <div>
            <label for="edit-location-${currentEditId}">Location (e.g., Room 132):</label>
            <input type="text" id="edit-location-${currentEditId}" value="${initialData.location || ''}" required>
        </div>

        <div>
            <label for="edit-notes-${currentEditId}">Notes (Optional):</label>
            <input type="text" id="edit-notes-${currentEditId}" value="${initialData.notes || ''}">
        </div>

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

    const toggleRecurringFields = () => {
        if (isEditingInstance) return;
        const isChecked = isWeeklyCheckbox ? isWeeklyCheckbox.checked : initialData.isWeekly;

        dateInputGroup.style.display = isChecked ? 'none' : 'block';
        eventDateInput.disabled = isChecked;
        daysOfWeekGroup.style.display = isChecked ? 'block' : 'none';
        daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = !isChecked; });
        weeklyStartDateGroup.style.display = isChecked ? 'block' : 'none';
        weeklyStartDateInput.disabled = !isChecked;
        weeklyEndDateGroup.style.display = isChecked ? 'block' : 'none';
        weeklyEndDateInput.disabled = !isChecked;

        if (isChecked) {
            weeklyStartDateInput.setAttribute('required', 'true');
            weeklyEndDateInput.setAttribute('required', 'true');
            eventDateInput.removeAttribute('required');
            eventDateInput.value = '';
        } else {
            weeklyStartDateInput.removeAttribute('required');
            weeklyEndDateInput.removeAttribute('required');
            eventDateInput.setAttribute('required', 'true');
            daysOfWeekGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
            weeklyStartDateInput.value = '';
            weeklyEndDateInput.value = '';
        }
    };

    if (!isEditingInstance && isWeeklyCheckbox) {
        isWeeklyCheckbox.addEventListener('change', toggleRecurringFields);
    }
    toggleRecurringFields();

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        await saveEvent(cardDiv, eventIdToUpdate);
    });

    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        isEditingEvent = false;
        if (!isNewEvent) {
            const fetchId = isEditingInstance ? originalEventIdForInstance : eventIdToUpdate;
            const eventData = eventDocsMap.get(fetchId);
            if (eventData) {
                const occDateStr = isEditingInstance ? originalOccurrenceDate : (eventData.eventDate || originalOccurrenceDate);
                const displayCard = createSingleOccurrenceDisplayCard(eventData, new Date(occDateStr + 'T00:00:00Z'), fetchId);
                cardDiv.replaceWith(displayCard);
            } else {
                cardDiv.remove();
            }
        } else {
            cardDiv.remove();
            checkIfEmpty();
            if (addEventButton) addEventButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    return cardDiv;
}


//Save event 

async function saveEvent(cardDiv, existingEventId = null) {
    const tempDomId = cardDiv.dataset.editId;
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true';
    const isEditingInstance = cardDiv.dataset.isEditingInstance === 'true';
    const originalEventIdForInstance = cardDiv.dataset.originalEventIdForInstance;
    const originalOccurrenceDateForInstance = cardDiv.dataset.originalOccurrenceDate;

    const eventName = cardDiv.querySelector(`#edit-name-${tempDomId}`).value.trim();
    const isWeekly = isEditingInstance ? false : cardDiv.querySelector(`#edit-is-weekly-${tempDomId}`).checked;

    let eventDate = '', weeklyStartDate = '', weeklyEndDate = '', daysOfWeek = [];

    if (isWeekly) {
        weeklyStartDate = cardDiv.querySelector(`#edit-weekly-start-date-${tempDomId}`).value;
        weeklyEndDate = cardDiv.querySelector(`#edit-weekly-end-date-${tempDomId}`).value;
        daysOfWeek = Array.from(cardDiv.querySelectorAll(`#days-of-week-group-${tempDomId} input[type="checkbox"]:checked`)).map(cb => cb.value);
    } else {
        eventDate = cardDiv.querySelector(`#edit-date-${tempDomId}`).value;
    }

    const startTime = cardDiv.querySelector(`#edit-start-time-${tempDomId}`).value;
    const endTime = cardDiv.querySelector(`#edit-end-time-${tempDomId}`).value;
    const address = cardDiv.querySelector(`#edit-address-${tempDomId}`).value.trim();
    const location = cardDiv.querySelector(`#edit-location-${tempDomId}`).value.trim();
    const notes = cardDiv.querySelector(`#edit-notes-${tempDomId}`).value.trim();

    if (!eventName) { await showAppAlert("Event Name is required!"); return; }
    if (!isWeekly && !eventDate) { await showAppAlert("Please provide an Event Date for one-time events."); return; }
    if (isWeekly && (!weeklyStartDate || !weeklyEndDate)) { await showAppAlert("Repeating events require both a start and end date."); return; }
    if (isWeekly && daysOfWeek.length === 0) { await showAppAlert("Please select at least one day of the week for repeating events."); return; }
    if (!startTime || !endTime) { await showAppAlert("Start Time and End Time are required."); return; }
    if (!address) { await showAppAlert("Address is required."); return; }
    if (!location) { await showAppAlert("Specific Location (e.g., Room 132) is required."); return; }
    if (startTime >= endTime) { await showAppAlert("End time cannot be earlier than or the same as the start time!"); return; }
    if (isWeekly && !isEditingInstance) {
        if (calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, [], startTime, endTime) === 0) {
            await showAppAlert("This setup doesn't include any upcoming events. Try adjusting the dates or days of the week.");
            return;
        }
    }

    const eventDataToSave = {
        eventName, isWeekly, startTime, endTime, address, location, notes,
        ...(isWeekly ? { weeklyStartDate, weeklyEndDate, daysOfWeek } : { eventDate }),
        createdAt: serverTimestamp(),
        createdByUid: currentUser.uid,
        createdByName: currentUser.displayName || "Anonymous",
    };

    try {
        const eventsRef = collection(db, "clubs", clubId, "events");
        let savedEventId = null;
        let savedOccurrenceDate = null;

        if (isEditingInstance) {
            const parentRef = doc(db, "clubs", clubId, "events", originalEventIdForInstance);
            await updateDoc(parentRef, { exceptions: arrayUnion(originalOccurrenceDateForInstance) });

            const parentData = eventDocsMap.get(originalEventIdForInstance);
            if (parentData) {
                const exceptions = parentData.exceptions || [];
                if (!exceptions.includes(originalOccurrenceDateForInstance)) {
                    parentData.exceptions = [...exceptions, originalOccurrenceDateForInstance];
                }
            }

            const overrideData = { ...eventDataToSave, parentRecurringEventId: originalEventIdForInstance };
            const newRef = await addDoc(eventsRef, overrideData);
            savedEventId = newRef.id;
            savedOccurrenceDate = eventDate;

            eventDocsMap.set(savedEventId, { id: savedEventId, ...overrideData });

            const rsvpsToTransferQuery = query(
                collection(db, "clubs", clubId, "occurrenceRsvps"),
                where("eventId", "==", originalEventIdForInstance),
                where("occurrenceDate", "==", originalOccurrenceDateForInstance)
            );
            const rsvpsSnap = await getDocs(rsvpsToTransferQuery);
            if (!rsvpsSnap.empty) {
                const batch = writeBatch(db);
                rsvpsSnap.forEach(rsvpDoc => {
                    const newId = `${savedEventId}_${originalOccurrenceDateForInstance}_${rsvpDoc.data().userId}`;
                    const newRef = doc(db, "clubs", clubId, "occurrenceRsvps", newId);
                    batch.set(newRef, { ...rsvpDoc.data(), eventId: savedEventId });
                    batch.delete(rsvpDoc.ref);
                });
                await batch.commit();
            }

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(originalEventIdForInstance);
            refreshCardsForEvent(savedEventId);

        } else if (existingEventId) {
            const eventDocRef = doc(eventsRef, existingEventId);
            const existingData = eventDocsMap.get(existingEventId) || {};
            const updatedData = { ...eventDataToSave, exceptions: existingData.exceptions || [] };
            await updateDoc(eventDocRef, updatedData);
            savedEventId = existingEventId;
            savedOccurrenceDate = isWeekly ? null : eventDate;

            eventDocsMap.set(existingEventId, { id: existingEventId, ...updatedData });

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(existingEventId);

        } else {
            const newRef = await addDoc(eventsRef, eventDataToSave);
            savedEventId = newRef.id;
            savedOccurrenceDate = isWeekly ? null : eventDate;

            eventDocsMap.set(savedEventId, { id: savedEventId, ...eventDataToSave });

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(savedEventId);
        }

        scrollToEditedEvent(savedEventId, savedOccurrenceDate);
        await showAppAlert("Event saved successfully!");

    } catch (error) {
        console.error("Error saving event:", error);
        isEditingEvent = false;
        await showAppAlert("Failed to save event: " + error.message);
    }
}


//Edit event

async function editEvent(eventId, occurrenceDateString = null) {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in and viewing a club to edit events."); return; }
    if (isEditingEvent) { await showAppAlert("Please finish editing the current event before starting another edit."); return; }

    const eventData = eventDocsMap.get(eventId);
    if (!eventData) { await showAppAlert("Error: Event not found."); return; }

    let targetDisplayCard;
    if (eventData.isWeekly && occurrenceDateString) {
        targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`);
    } else {
        targetDisplayCard = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"]`);
    }

    if (!targetDisplayCard) {
        await showAppAlert("Could not find the event card to edit. Please refresh.");
        return;
    }

    if (eventData.isWeekly && occurrenceDateString) {
        // Editing a single instance of a recurring event
        const dataForCard = {
            eventName: eventData.eventName,
            isWeekly: false,
            eventDate: occurrenceDateString,
            startTime: eventData.startTime,
            endTime: eventData.endTime,
            address: eventData.address,
            location: eventData.location,
            notes: eventData.notes,
        };
        const editingCard = createEditingCardElement(dataForCard, false, eventId, true, eventId, occurrenceDateString);
        targetDisplayCard.replaceWith(editingCard);
    } else {
        // Editing the whole event 
        const editingCard = createEditingCardElement(eventData, false, eventId);
        targetDisplayCard.replaceWith(editingCard);
    }
}


//Delete /cancel occurrences

async function cancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to cancel the event on ${formatDate(occurrenceDateString)}? It will no longer appear on the schedule.`);
    if (!confirmed) return;

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventId);
        const eventData = eventDocsMap.get(eventId);
        if (!eventData) { await showAppAlert("Error: Event not found."); return; }

        const existingExceptions = eventData.exceptions || [];
        const hypotheticalExceptions = [...existingExceptions, occurrenceDateString];

        // Count remaining occurrences after this exception
        let remaining = 0;
        if (eventData.isWeekly) {
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));
            let cur = new Date(startDate);
            while (cur.getTime() <= endDate.getTime()) {
                const ds = cur.toISOString().split('T')[0];
                if (daysToMatch.includes(cur.getUTCDay()) && !hypotheticalExceptions.includes(ds)) remaining++;
                cur.setUTCDate(cur.getUTCDate() + 1);
            }
        }

        if (remaining === 0) {
            await deleteEntireEvent(eventId, eventData.isWeekly, true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await showAppAlert("That was the last occurrence of this event, so it's been fully removed.");
        } else {
            await updateDoc(eventDocRef, { exceptions: arrayUnion(occurrenceDateString) });
            eventData.exceptions = [...existingExceptions, occurrenceDateString];

            const card = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`);
            if (card) card.remove();
            checkIfEmpty();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await showAppAlert(`The event on ${formatDate(occurrenceDateString)} has been canceled.`);
        }
    } catch (error) {
        console.error("Error canceling occurrence:", error);
        await showAppAlert("Failed to cancel event occurrence: " + error.message);
    }
}

async function deleteEntireEvent(eventIdToDelete, isWeeklyEvent = false, skipConfirm = false) {
    const eventData = eventDocsMap.get(eventIdToDelete);
    const eventName = eventData ? eventData.eventName : "Untitled Event";

    if (!skipConfirm) {
        const msg = isWeeklyEvent
            ? `Are you sure you want to delete the entire "${eventName}" series? All upcoming events in this series will be removed. This can't be undone.`
            : `Are you sure you want to cancel "${eventName}"? This action cannot be undone.`;
        const confirmed = await showAppConfirm(msg);
        if (!confirmed) return;
    }

    try {
        const eventDocRef = doc(db, "clubs", clubId, "events", eventIdToDelete);
        const batch = writeBatch(db);
        batch.delete(eventDocRef);

        const rsvpsQuery = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", eventIdToDelete));
        const rsvpsSnap = await getDocs(rsvpsQuery);
        rsvpsSnap.forEach(d => batch.delete(d.ref));

        if (isWeeklyEvent) {
            const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", eventIdToDelete));
            const overridesSnap = await getDocs(overridesQuery);
            const overrideIds = overridesSnap.docs.map(d => d.id);
            overridesSnap.forEach(d => batch.delete(d.ref));

            if (overrideIds.length > 0) {
                const rsvpOverridesQuery = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideIds));
                const rsvpOverridesSnap = await getDocs(rsvpOverridesQuery);
                rsvpOverridesSnap.forEach(d => batch.delete(d.ref));
                overrideIds.forEach(id => eventDocsMap.delete(id));
            }
        }

        await batch.commit();

        removeCardsForEvent(eventIdToDelete);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (!skipConfirm) await showAppAlert("Event deleted successfully!");

    } catch (error) {
        console.error("Error deleting event:", error);
        await showAppAlert("Failed to delete event: " + error.message);
    }
}

async function deleteEntireSeriesAndOverrides(parentEventIdToDelete) {
    if (!parentEventIdToDelete) { await showAppAlert("Error: No parent series ID provided for deletion."); return; }

    const eventData = eventDocsMap.get(parentEventIdToDelete);
    if (!eventData) { await showAppAlert("Error: The main event series to delete was not found."); return; }

    const eventName = eventData.eventName || "Untitled Event Series";
    const confirmed = await showAppConfirm(`Are you sure you want to delete the entire "${eventName}" series? All upcoming events in this series will be removed. This can't be undone.`);
    if (!confirmed) return;

    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "clubs", clubId, "events", parentEventIdToDelete));

        const overridesQuery = query(collection(db, "clubs", clubId, "events"), where("parentRecurringEventId", "==", parentEventIdToDelete));
        const overridesSnap = await getDocs(overridesQuery);
        const overrideIds = overridesSnap.docs.map(d => d.id);
        overridesSnap.forEach(d => batch.delete(d.ref));

        const rsvpsMain = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "==", parentEventIdToDelete));
        (await getDocs(rsvpsMain)).forEach(d => batch.delete(d.ref));

        if (overrideIds.length > 0) {
            const rsvpsOverrides = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("eventId", "in", overrideIds));
            (await getDocs(rsvpsOverrides)).forEach(d => batch.delete(d.ref));
            overrideIds.forEach(id => {
                eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${id}"]`).forEach(c => c.remove());
                eventDocsMap.delete(id);
            });
        }

        await batch.commit();

        removeCardsForEvent(parentEventIdToDelete);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await showAppAlert("Event deleted successfully!");

    } catch (error) {
        console.error("Error deleting series:", error);
        await showAppAlert("Failed to delete the series: " + error.message);
    }
}

// Not actively used in UI but kept for potential future use
async function uncancelSingleOccurrence(eventId, occurrenceDateString) {
    const confirmed = await showAppConfirm(`Are you sure you want to un-cancel the event on ${formatDate(occurrenceDateString)}? It will reappear on the schedule.`);
    if (!confirmed) return;
    try {
        await updateDoc(doc(db, "clubs", clubId, "events", eventId), { exceptions: arrayRemove(occurrenceDateString) });
        const eventData = eventDocsMap.get(eventId);
        if (eventData && eventData.exceptions) {
            eventData.exceptions = eventData.exceptions.filter(e => e !== occurrenceDateString);
        }
        refreshCardsForEvent(eventId);
        await showAppAlert(`The event on ${formatDate(occurrenceDateString)} has been un-canceled.`);
    } catch (error) {
        console.error("Error un-canceling occurrence:", error);
        await showAppAlert("Failed to un-cancel event occurrence: " + error.message);
    }
}


//Display card

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
        <div class="event-card-header">
            <h3 class="event-card-title">${eventData.eventName} ${isExcepted ? '<span class="canceled-tag">(CANCELED)</span>' : ''}</h3>
        </div>
        <div class="event-date-strip">
            <i class="fa-regular fa-calendar"></i>
            ${formattedDate}
        </div>
        <div class="event-date-strip-divider"></div>
        <div class="event-card-body">
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-regular fa-clock"></i></span>
                <span class="einfo-text">${formatTime(eventData.startTime)} – ${formatTime(eventData.endTime)}</span>
            </div>
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-solid fa-location-dot"></i></span>
                <span class="einfo-text">${eventData.address}</span>
            </div>
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-solid fa-thumbtack"></i></span>
                <span class="einfo-text">${eventData.location}</span>
            </div>
            ${eventData.notes ? `
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-regular fa-pen-to-square"></i></span>
                <span class="einfo-text">${eventData.notes}</span>
            </div>` : ''}
        </div>

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

    // RSVP buttons
    cardDiv.querySelectorAll('.rsvp-button').forEach(button => {
        button.addEventListener('click', e => {
            saveRsvpStatus(e.target.dataset.eventId, e.target.dataset.occurrenceDate, e.target.dataset.status);
        });
    });

    const viewBtn = cardDiv.querySelector('.view-availability-btn');
    if (viewBtn) {
        viewBtn.addEventListener('click', e => {
            document.body.classList.add('no-scroll');
            showRsvpDetailsModal(e.target.dataset.eventId, e.target.dataset.occurrenceDate);
        });
    }

    fetchAndSetUserRsvp(originalEventId, occurrenceDateString);

    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) editBtn.addEventListener('click', e => editEvent(e.currentTarget.dataset.eventId, e.currentTarget.dataset.occurrenceDate));

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', e => deleteEntireEvent(e.currentTarget.dataset.eventId, false));

        const deleteSeriesBtn = cardDiv.querySelector('.delete-series-btn');
        if (deleteSeriesBtn) deleteSeriesBtn.addEventListener('click', e => deleteEntireEvent(e.currentTarget.dataset.eventId, true));

        const cancelInstanceBtn = cardDiv.querySelector('.cancel-instance-btn');
        if (cancelInstanceBtn) cancelInstanceBtn.addEventListener('click', e => cancelSingleOccurrence(e.currentTarget.dataset.eventId, e.currentTarget.dataset.occurrenceDate));

        const uncancelBtn = cardDiv.querySelector('.uncancel-btn');
        if (uncancelBtn) uncancelBtn.addEventListener('click', e => uncancelSingleOccurrence(e.currentTarget.dataset.eventId, e.currentTarget.dataset.occurrenceDate));
    }

    const deleteParentSeriesBtn = cardDiv.querySelector('.delete-parent-series-btn');
    if (deleteParentSeriesBtn) deleteParentSeriesBtn.addEventListener('click', e => deleteEntireSeriesAndOverrides(e.currentTarget.dataset.parentEventId));

    return cardDiv;
}


//RSVP

async function saveRsvpStatus(originalEventId, occurrenceDateString, status) {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in to RSVP."); return; }

    try {
        const userUid = currentUser.uid;
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);
        const rsvpSnap = await getDoc(rsvpDocRef);
        const currentStatus = rsvpSnap.exists() ? rsvpSnap.data().status : null;

        let newStatus = null;
        if (currentStatus === status) {
            await deleteDoc(rsvpDocRef);
        } else {
            await setDoc(rsvpDocRef, {
                eventId: originalEventId,
                occurrenceDate: occurrenceDateString,
                userId: userUid,
                userName: currentUser.displayName || "Anonymous User",
                timestamp: serverTimestamp(),
                clubId,
                status,
            });
            newStatus = status;
        }
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, newStatus);
    } catch (error) {
        console.error("Error saving RSVP:", error);
        await showAppAlert("Failed to save your RSVP: " + error.message);
    }
}

function updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentStatus) {
    const card = document.querySelector(`.event-card[data-original-event-id="${originalEventId}"][data-occurrence-date="${occurrenceDateString}"]`);
    if (!card) return;
    card.querySelectorAll('.rsvp-button').forEach(btn => {
        btn.classList.toggle('selected-rsvp', btn.dataset.status === currentStatus);
    });
}

async function fetchAndSetUserRsvp(originalEventId, occurrenceDateString) {
    if (!currentUser || !clubId) return;
    try {
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", `${originalEventId}_${occurrenceDateString}_${currentUser.uid}`);
        const rsvpSnap = await getDoc(rsvpDocRef);
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, rsvpSnap.exists() ? rsvpSnap.data().status : null);
    } catch (error) {
        updateRsvpButtonsUI(originalEventId, occurrenceDateString, null);
    }
}

function setupRealtimeUserRsvps() {
    if (!clubId || !currentUser) return;
    if (rsvpListenerUnsubscribe) { rsvpListenerUnsubscribe(); rsvpListenerUnsubscribe = null; }

    const q = query(collection(db, "clubs", clubId, "occurrenceRsvps"), where("userId", "==", currentUser.uid));
    rsvpListenerUnsubscribe = onSnapshot(q, snapshot => {
        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            const newStatus = (change.type === "added" || change.type === "modified") ? data.status : null;
            updateRsvpButtonsUI(data.eventId, data.occurrenceDate, newStatus);
        });
    }, error => {
        console.error("Error fetching realtime user RSVPs:", error);
    });
}


//RSVP details modal

async function getAllClubMembers(clubID, useCache = true) {
    if (useCache && memberListCache.has(clubID)) {
        const cached = memberListCache.get(clubID);
        if (Date.now() - cached.timestamp < CACHE_DURATION) return cached.members;
    }

    const members = [];
    try {
        const clubSnap = await getDoc(doc(db, "clubs", clubID));
        let managerUid = null;

        if (clubSnap.exists()) {
            managerUid = clubSnap.data().managerUid;
            if (managerUid) {
                let managerName;
                if (userCache.has(managerUid)) {
                    managerName = userCache.get(managerUid).displayName;
                } else {
                    const managerDoc = await getDoc(doc(db, "users", managerUid));
                    managerName = managerDoc.exists() ? (managerDoc.data().displayName || managerDoc.data().name) : "Unknown Manager";
                    if (managerDoc.exists()) userCache.set(managerUid, managerDoc.data());
                }
                members.push({ uid: managerUid, name: managerName, role: 'manager' });
            }
        }

        const membersSnap = await getDocs(collection(db, "clubs", clubID, "members"));
        const uidsToFetch = membersSnap.docs.filter(d => d.id !== managerUid && !userCache.has(d.id)).map(d => d.id);

        for (const uid of uidsToFetch) {
            const userDoc = await getDoc(doc(db, "users", uid));
            if (userDoc.exists()) userCache.set(uid, userDoc.data());
        }

        for (const memberDoc of membersSnap.docs) {
            if (memberDoc.id !== managerUid) {
                const userData = userCache.get(memberDoc.id);
                members.push({ uid: memberDoc.id, name: userData ? (userData.displayName || userData.name) : "Unknown User", role: memberDoc.data().role || 'member' });
            }
        }

        memberListCache.set(clubID, { members, timestamp: Date.now() });
    } catch (error) {
        console.error("Error fetching club members:", error);
    }
    return members;
}

async function showRsvpDetailsModal(eventId, occurrenceDateString) {
    if (!clubId) { await showAppAlert("Error: Club ID not found."); return; }
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
                <div id="rsvp-sections-content"></div>
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
        const contentDiv = document.getElementById('rsvp-lists');
        if (contentDiv) contentDiv.style.display = 'none';
    });

    overlay.style.display = 'flex';
    modal.style.display = 'flex';

    try {
        const rsvpsSnap = await getDocs(query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "==", eventId),
            where("occurrenceDate", "==", occurrenceDateString)
        ));
        const rsvpsMap = {};
        rsvpsSnap.forEach(d => { rsvpsMap[d.data().userId] = { status: d.data().status, userName: d.data().userName }; });

        const allMembers = await getAllClubMembers(clubId);
        const going = [], maybe = [], notGoing = [], noResponse = [];

        allMembers.forEach(member => {
            const rsvp = rsvpsMap[member.uid];
            if (rsvp) {
                if (rsvp.status === 'YES') going.push(rsvp.userName);
                else if (rsvp.status === 'NO') notGoing.push(rsvp.userName);
                else if (rsvp.status === 'MAYBE') maybe.push(rsvp.userName);
            } else {
                noResponse.push(member.name);
            }
        });

        const buildSection = (label, names) => names.length === 0 ? '' : `
            <h3>${label} (${names.length})</h3>
            <ul>${names.map(n => `<li>${n}</li>`).join('')}</ul>
        `;

        document.getElementById('rsvp-sections-content').innerHTML =
            buildSection('Going', going) +
            buildSection('Maybe', maybe) +
            buildSection('Not Going', notGoing) +
            buildSection('No Response', noResponse);

        document.getElementById('rsvp-lists').style.display = 'block';
        modal.classList.remove('rsvp-loading-collapsed');

        modal.addEventListener('transitionend', function handler(e) {
            if (e.propertyName === 'max-height') {
                modal.classList.add('rsvp-scroll-active');
                document.getElementById('rsvp-lists').style.display = 'block';
                document.getElementById('close-rsvp-modal').disabled = false;
                document.body.classList.remove('no-interaction');
                modal.removeEventListener('transitionend', handler);
            }
        });
    } catch (error) {
        console.error("Error fetching RSVP details:", error);
        await showAppAlert("Failed to load RSVP details: " + error.message);
        overlay.style.display = 'none';
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll', 'no-interaction');
        modal.classList.add('rsvp-loading-collapsed');
        modal.classList.remove('rsvp-scroll-active');
    }
}


//Announcements

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
            if (!title || !content) { await showAppAlert("Title and Content are required for the announcement."); return; }
            const success = await saveAnnouncement(title, content);
            if (success) {
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
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in and viewing a club to create announcements."); return false; }
    try {
        await addDoc(collection(db, "clubs", clubId, "announcements"), {
            title, content,
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId,
            createdAt: serverTimestamp()
        });
        await showAppAlert("Announcement saved!");
        return true;
    } catch (error) {
        console.error("Error saving announcement:", error);
        await showAppAlert("Failed to save announcement: " + error.message);
        return false;
    }
}


// Utilities 

function formatTime(timeString) {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes);
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function scrollToEditedEvent(eventId, occurrenceDateString = null) {
    const selector = occurrenceDateString
        ? `.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`
        : `.event-card[data-original-event-id="${eventId}"]`;
    const target = document.querySelector(selector);
    if (target) {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 90, behavior: 'smooth' });
    }
}

function calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, exceptions = [], startTime = '00:00', endTime = '23:59') {
    let count = 0;
    const now = new Date();
    const startDate = new Date(weeklyStartDate + 'T00:00:00Z');
    const endDate = new Date(weeklyEndDate + 'T00:00:00Z');
    const daysToMatch = daysOfWeek.map(day => dayNamesMap.indexOf(day));
    let cur = new Date(startDate);

    while (cur.getTime() <= endDate.getTime()) {
        const ds = cur.toISOString().split('T')[0];
        if (daysToMatch.includes(cur.getUTCDay()) && !exceptions.includes(ds)) {
            if (new Date(`${ds}T${endTime}`).getTime() > now.getTime()) count++;
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
}

function animateCardIn(card, index = 0) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    card.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }, index * 80);
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, where, writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { ROLE_LABELS } from './roleLabels.js';
import { handleUserSwitch } from './auth-guard.js';
import { getRole, peekRole } from './roleCache.js';

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

let eventDocsMap = new Map();
let memberNames = {};
const userCache = new Map();
let clubSchoolName = '';
const userRsvpMap = new Map(); 

let eventsPrimed = false;
let eventsListenerFailed = false;

const eventsContainer = document.getElementById('eventsContainer');
const addEventButton = document.getElementById('add-event-button');
const noEventsMessageAdmin = document.getElementById('noEventsMessageAdmin');

document.getElementById('empty-state-event-btn').addEventListener('click', addNewEventEditingCard);

document.body.classList.add('no-scroll');

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];



function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

// Checks if this date still one the event actually happens on?
function isScheduledOn(eventData, dateString) {
    if (!eventData.isWeekly) {
        return eventData.eventDate === dateString;
    }

    if (dateString < eventData.weeklyStartDate || dateString > eventData.weeklyEndDate) {
        return false;
    }

    const dayName = dayNamesMap[new Date(dateString + 'T00:00:00').getDay()];
    return (eventData.daysOfWeek || []).includes(dayName);
}

// Reads the map the events listener keeps current, so this costs nothing and can be called on every tap.
function checkEventFreshness(eventId, occurrenceDateString = null) {
    if (eventsListenerFailed) {
        return { live: true, unverified: true };
    }

    const freshData = eventDocsMap.get(eventId);

    if (!freshData) {
        return { live: false, reason: 'deleted' };
    }

    if (occurrenceDateString) {
        if (freshData.isWeekly) {
            const exceptions = freshData.exceptions || [];
            if (exceptions.includes(occurrenceDateString)) {
                return { live: false, reason: 'canceled', freshData };
            }
        }

        if (!isScheduledOn(freshData, occurrenceDateString)) {
            return { live: false, reason: 'moved', freshData };
        }
    }

    return {
        live: true, 
        freshData
    };
}

function staleEventMessage(actionPhrase, reason, deletedPhrase = "it was recently deleted") {
    let cause;
    if (reason === 'canceled') {
        cause = 'it was recently canceled';
    } else if (reason === 'moved') {
        cause = 'it was recently rescheduled';
    } else {
        cause = deletedPhrase;
    }
    return `You cannot ${actionPhrase}, because ${cause}. Please reload for the most up-to-date schedule.`;
}

window.goToClubPage = function () {
    const currentClubId = getUrlParameter('clubId');
    window.location.href = currentClubId
        ? `club_page.html?clubId=${currentClubId}`
        : 'your_clubs.html';
};



onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user) {
        if (!clubId) {
            window.location.href = 'your_clubs.html';
            return;
        }

        try {
            const clubSnap = await getDoc(doc(db, "clubs", clubId));

            if (!clubSnap.exists()) {
                hideLoadingScreen();
                showContainerError(eventsContainer, "This club doesn't exist.");
                if (addEventButton) addEventButton.style.display = 'none';
                return;
            }

            memberNames = { ...(clubSnap.data().memberNames || {}) };
            clubSchoolName = clubSnap.data().schoolName || '';
            role = await getRole(db, clubId, currentUser.uid, clubSnap);

            if (role === null) {
                hideLoadingScreen();
                showContainerError(eventsContainer, "You're not a member of this club.");
                if (addEventButton) addEventButton.style.display = 'none';
                return;
            }

            await Promise.all([
                watchEvents(),
                prefetchUserRsvps()
            ]);
            hideLoadingScreen();
            requestAnimationFrame(() => requestAnimationFrame(() => renderAllEvents()));

            if (addEventButton && (role === 'manager' || role === 'admin')) {
                addEventButton.addEventListener('click', addNewEventEditingCard);
            }

        } catch (error) {
            hideLoadingScreen();
            console.error("Error during auth init:", error);
            showContainerError(eventsContainer, "Oops! Something went wrong.", true);
            if (addEventButton) addEventButton.style.display = 'none';
        }
    } else {
        window.location.href = 'login.html';
    }
});


// Keeps eventDocsMap in step with the server for the life of the page. This only ever touches the map, never the DOM
function watchEvents() {
    return new Promise((resolve, reject) => {
        const eventsRef = collection(db, "clubs", clubId, "events");
        const q = query(eventsRef, orderBy("createdAt", "desc"));

        onSnapshot(q, (snapshot) => {
            eventsListenerFailed = false;

            
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') {
                    eventDocsMap.delete(change.doc.id);
                } else {
                    eventDocsMap.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
                }
            });

            if (!eventsPrimed) {
                eventsPrimed = true;
                resolve();
            }
        }, (error) => {
            console.error("Error listening to events:", error);
            eventsListenerFailed = true;
            if (!eventsPrimed) {
                eventsPrimed = true;
                reject(error);
            }
        });
    });
}

function renderAllEvents() {
    if (!eventsContainer) return;
    eventsContainer.innerHTML = '';

    const allOccurrences = buildOccurrenceList();
    const isAdmin = role === 'manager' || role === 'admin';

    if (allOccurrences.length === 0) {
        if (isAdmin) {
            noEventsMessageAdmin.style.display = 'block';
            if (addEventButton) addEventButton.style.display = 'none';
        } else {
            eventsContainer.innerHTML = '';
            const noEventsMessage = document.getElementById('no-events-message');
            if (noEventsMessage) {
                noEventsMessage.textContent = 'NO UPCOMING EVENTS';
                noEventsMessage.style.display = 'block';
            }
            noEventsMessageAdmin.style.display = 'none';
        }
        eventsContainer.style.marginTop = '0px';
        return;
    }

    noEventsMessageAdmin.style.display = 'none';
    const noEventsMessage = document.getElementById('no-events-message');
    if (noEventsMessage) noEventsMessage.style.display = 'none';
    if (addEventButton) addEventButton.style.display = isAdmin ? 'block' : 'none';
    eventsContainer.style.marginTop = isAdmin ? '0px' : '-45px';

    allOccurrences.forEach((occurrence, index) => {
        const card = createSingleOccurrenceDisplayCard(occurrence.eventData, occurrence.occurrenceDate, occurrence.originalEventId);
        eventsContainer.appendChild(card);
        animateCardIn(card, index);
    });
}

function getOccurrencesForEvent(eventId, eventData, now) {
    const occurrences = [];
    const exceptions = eventData.exceptions || [];

    if (eventData.isWeekly) {
        const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00');
        const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00');
        const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));
        let currentDate = new Date(startDate);

        while (currentDate.getTime() <= endDate.getTime()) {
            const dateStr = formatLocalDate(currentDate);
            if (daysToMatch.includes(currentDate.getDay()) && !exceptions.includes(dateStr)) {
                const endMoment = new Date(`${dateStr}T${eventData.endTime}:00`);
                if (endMoment.getTime() > now.getTime()) {
                    occurrences.push({ eventData, occurrenceDate: new Date(currentDate), originalEventId: eventId });
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        const dateStr = eventData.eventDate;
        if (!exceptions.includes(dateStr)) {
            const endMoment = new Date(`${dateStr}T${eventData.endTime}:00`);
            if (endMoment.getTime() > now.getTime()) {
                occurrences.push({ eventData, occurrenceDate: new Date(dateStr + 'T00:00:00'), originalEventId: eventId });
            }
        }
    }

    return occurrences;
}

function buildOccurrenceList() {
    const now = new Date();
    let allOccurrences = [];

    eventDocsMap.forEach((eventData, eventId) => {
        allOccurrences = allOccurrences.concat(getOccurrencesForEvent(eventId, eventData, now));
    });

    allOccurrences.sort((a, b) => {
        const dtA = new Date(formatLocalDate(a.occurrenceDate) + 'T' + a.eventData.startTime + ':00').getTime();
        const dtB = new Date(formatLocalDate(b.occurrenceDate) + 'T' + b.eventData.startTime + ':00').getTime();
        return dtA - dtB;
    });

    return allOccurrences;
}

function refreshCardsForEvent(eventId) {
    if (!eventsContainer) return;

    eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${eventId}"]`).forEach(c => c.remove());

    const eventData = eventDocsMap.get(eventId);
    if (!eventData) return;

    const now = new Date();
    const newOccurrences = getOccurrencesForEvent(eventId, eventData, now);

    if (newOccurrences.length === 0) {
        checkIfEmpty();
        return;
    }

    const isAdmin = role === 'manager' || role === 'admin';
    const stillShowingEmptyState = eventsContainer.querySelectorAll('.display-event-card').length === 0;

    if (stillShowingEmptyState) {
        eventsContainer.innerHTML = '';
        eventsContainer.style.marginTop = isAdmin ? '0px' : '-45px';
        noEventsMessageAdmin.style.display = 'none';
        const noEventsMessage = document.getElementById('no-events-message');
        if (noEventsMessage) noEventsMessage.style.display = 'none';
        if (isAdmin && addEventButton) addEventButton.style.display = 'block';
    }

    newOccurrences.forEach(occ => {
        const allCurrentCards = Array.from(eventsContainer.querySelectorAll('.display-event-card'));
        const newCard = createSingleOccurrenceDisplayCard(occ.eventData, occ.occurrenceDate, occ.originalEventId);
        const occDateTime = new Date(formatLocalDate(occ.occurrenceDate) + 'T' + occ.eventData.startTime + ':00').getTime();

        let inserted = false;
        for (const existingCard of allCurrentCards) {
            const existingDate = existingCard.dataset.occurrenceDate;
            const existingEventId = existingCard.dataset.originalEventId;
            const existingEventData = eventDocsMap.get(existingEventId);
            if (!existingEventData) continue;
            const existingDateTime = new Date(existingDate + 'T' + existingEventData.startTime + ':00').getTime();
            if (occDateTime <= existingDateTime) {
                eventsContainer.insertBefore(newCard, existingCard);
                inserted = true;
                break;
            }
        }
        if (!inserted) eventsContainer.appendChild(newCard);
    });

    noEventsMessageAdmin.style.display = 'none';
}

function removeCardsForEvent(eventId) {
    const cards = eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${eventId}"]`);
    cards.forEach(c => {
        if (c.classList.contains('editing-event-card')) {
            isEditingEvent = false;
        }
        c.remove();
    });
    eventDocsMap.delete(eventId);
    checkIfEmpty();
}

function checkIfEmpty() {
    if (!eventsContainer) return;
    
    const remaining = eventsContainer.querySelectorAll('.display-event-card');
    
    if (remaining.length === 0) {
        const isAdmin = role === 'manager' || role === 'admin';
        if (isAdmin) {
            eventsContainer.innerHTML = '';
            noEventsMessageAdmin.style.display = 'block';
            if (addEventButton) addEventButton.style.display = 'none';
        } else {
            eventsContainer.innerHTML = '';
            const noEventsMessage = document.getElementById('no-events-message');
            if (noEventsMessage) {
                noEventsMessage.textContent = 'NO UPCOMING EVENTS';
                noEventsMessage.style.display = 'block';
            }
            noEventsMessageAdmin.style.display = 'none';
        }
        eventsContainer.style.marginTop = '0px';

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
}


async function addNewEventEditingCard() {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in and viewing a club to add events."); return; }
    if (isEditingEvent) { await showAppAlert("Please finish editing the current event before adding a new one."); return; }

    const isFirstCard = eventsContainer.querySelectorAll('.display-event-card').length === 0;
    const newCard = createEditingCardElement({ address: clubSchoolName }, true, null, false, null, null, isFirstCard);
    if (eventsContainer) {
        noEventsMessageAdmin.style.display = 'none';
        eventsContainer.prepend(newCard);
    }
}



function createEditingCardElement(initialData = {}, isNewEvent = true, eventIdToUpdate = null, isEditingInstance = false, originalEventIdForInstance = null, originalOccurrenceDate = null, isFirstCard = false) {
    isEditingEvent = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = (isNewEvent && isFirstCard) ? 'event-card editing-event-card editing-event-card-first' : 'event-card editing-event-card';
    const daysOfWeekOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const currentEditId = eventIdToUpdate || `new-${Date.now()}`;

    cardDiv.dataset.editId = currentEditId;
    cardDiv.dataset.isNewEvent = isNewEvent;
    cardDiv.dataset.isFirstCard = isFirstCard;
    if (isEditingInstance) {
        cardDiv.dataset.isEditingInstance = 'true';
        cardDiv.dataset.originalEventIdForInstance = originalEventIdForInstance;
        cardDiv.dataset.originalOccurrenceDate = originalOccurrenceDate;
        cardDiv.dataset.originalEventId = originalEventIdForInstance;
    } else if (eventIdToUpdate) {
        cardDiv.dataset.originalEventId = eventIdToUpdate;
    }

    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    const selectedDays = initialData.daysOfWeek || [];

    cardDiv.innerHTML = `
        <h3>${isNewEvent ? 'ADD EVENT' : 'EDIT EVENT'}</h3>

        <div class="field-section">
            <label for="edit-name-${currentEditId}">Event Name:</label>
            <input type="text" id="edit-name-${currentEditId}" value="${escapeHtml(initialData.eventName || '')}" required>
        </div>

        <div class="field-section event-type-toggle" style="display: ${isNewEvent ? 'block' : 'none'};">
            <label>Event Type:</label>
            <div class="event-type-strip-group">
                <div class="club-vis-strip event-type-strip ${!initialData.isWeekly ? 'club-vis-strip-selected' : ''}" id="toggle-once-${currentEditId}">
                    <span class="club-vis-strip-title">One Time</span>
                </div>
                <div class="club-vis-strip event-type-strip ${initialData.isWeekly ? 'club-vis-strip-selected' : ''}" id="toggle-repeating-${currentEditId}">
                    <span class="club-vis-strip-title">Repeating</span>
                </div>
            </div>
            <input type="checkbox" id="edit-is-weekly-${currentEditId}" ${isWeeklyChecked} style="display: none;">
        </div>

        <div class="field-section" id="date-input-group-${currentEditId}" style="display: ${!initialData.isWeekly || isEditingInstance ? 'block' : 'none'};">
            <label for="edit-date-${currentEditId}">Event Date:</label>
            <input type="date" id="edit-date-${currentEditId}" min="${formatLocalDate(new Date())}" value="${initialData.eventDate || originalOccurrenceDate || ''}" ${initialData.isWeekly && !isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div class="field-section" id="days-of-week-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <div class="days-of-week-selection">
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
        </div>

        <div class="field-section" id="weekly-start-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-start-date-${currentEditId}">Start Date:</label>
            <input type="date" id="edit-weekly-start-date-${currentEditId}" value="${initialData.weeklyStartDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div class="field-section" id="weekly-end-date-group-${currentEditId}" style="display: ${initialData.isWeekly && !isEditingInstance ? 'block' : 'none'};">
            <label for="edit-weekly-end-date-${currentEditId}">End Date:</label>
            <input type="date" id="edit-weekly-end-date-${currentEditId}" min="${formatLocalDate(new Date())}" value="${initialData.weeklyEndDate || ''}" ${!initialData.isWeekly || isEditingInstance ? 'disabled' : ''} required>
        </div>

        <div class="field-section">
            <label for="edit-start-time-${currentEditId}">Start Time:</label>
            <input type="time" id="edit-start-time-${currentEditId}" value="${initialData.startTime || ''}" required>
        </div>

        <div class="field-section">
            <label for="edit-end-time-${currentEditId}">End Time:</label>
            <input type="time" id="edit-end-time-${currentEditId}" value="${initialData.endTime || ''}" required>
        </div>

        <div class="field-section">
            <label for="edit-address-${currentEditId}">Location:</label>
            <input type="text" id="edit-address-${currentEditId}" value="${escapeHtml(initialData.address || '')}" required>
        </div>

        <div class="field-section">
            <label for="edit-location-${currentEditId}">Meeting Spot:</label>
            <input type="text" id="edit-location-${currentEditId}" value="${escapeHtml(initialData.location || '')}" required>
        </div>

        <div class="field-section">
            <label for="edit-notes-${currentEditId}">Notes (Optional):</label>
            <input type="text" id="edit-notes-${currentEditId}" value="${escapeHtml(initialData.notes || '')}">
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


    const onceStrip = cardDiv.querySelector(`#toggle-once-${currentEditId}`);
    const repeatingStrip = cardDiv.querySelector(`#toggle-repeating-${currentEditId}`);

    if (onceStrip && repeatingStrip && isWeeklyCheckbox && !isEditingInstance) {
        onceStrip.addEventListener('click', () => {
            onceStrip.classList.add('club-vis-strip-selected');
            repeatingStrip.classList.remove('club-vis-strip-selected');
            isWeeklyCheckbox.checked = false;
            isWeeklyCheckbox.dispatchEvent(new Event('change'));
        });
        repeatingStrip.addEventListener('click', () => {
            repeatingStrip.classList.add('club-vis-strip-selected');
            onceStrip.classList.remove('club-vis-strip-selected');
            isWeeklyCheckbox.checked = true;
            isWeeklyCheckbox.dispatchEvent(new Event('change'));
        });
    }

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        await saveEvent(cardDiv, eventIdToUpdate);
    });

    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        isEditingEvent = false;
        if (!isNewEvent) {
            const fetchId = isEditingInstance ? originalEventIdForInstance : eventIdToUpdate;
            const eventData = eventDocsMap.get(fetchId);
            if (eventData) {
                const occDateStr = isEditingInstance ? originalOccurrenceDate : (eventData.eventDate || null);
                const displayCard = createSingleOccurrenceDisplayCard(eventData, new Date((occDateStr || eventData.weeklyStartDate) + 'T00:00:00'), fetchId);
                cardDiv.replaceWith(displayCard);
                requestAnimationFrame(() => {
                    scrollToEditedEvent(fetchId, occDateStr);
                });
            } else {
                cardDiv.remove();
            }
        } else {
            cardDiv.remove();
            checkIfEmpty();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    return cardDiv;
}


async function createEvent(clubId, eventFields, user) {
   	const eventData = {
        ...eventFields,
        createdAt: serverTimestamp(),
        createdByUid: user.uid
    };

    const eventsRef = collection(db, "clubs", clubId, "events");
   	const eventDocRef = await addDoc(eventsRef, eventData);

    return { id: eventDocRef.id, ...eventData };
}



async function updateEvent(clubId, eventId, eventFields, existingExceptions = []) {
    const eventRef = doc(db, "clubs", clubId, "events", eventId);

    const eventData = {
        ...eventFields,
        exceptions: existingExceptions,
    };

    await updateDoc(eventRef, eventData);
    return { id: eventId, ...eventData };
}


async function saveEvent(cardDiv, existingEventId = null) {
    const tempDomId = cardDiv.dataset.editId;
    const isNewEvent = cardDiv.dataset.isNewEvent === 'true';
    const isFirstCard = cardDiv.dataset.isFirstCard === 'true';
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
    const today = formatLocalDate(new Date());

    if (!isWeekly && eventDate < today) {
        await showAppAlert("Event date cannot be in the past.");
        return;
    }

    if (isWeekly && weeklyEndDate < today) {
        await showAppAlert("The end date of a repeating event cannot be in the past.");
        return;
    }

    if (isWeekly && !isEditingInstance) {
        if (calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, [], startTime, endTime) === 0) {
            await showAppAlert("This setup doesn't include any upcoming events. Try adjusting the dates or days of the week.");
            return;
        }
    }

    if (!isWeekly && eventDate === today) {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        if (endTime <= currentTime) {
            await showAppAlert("The event end time has already passed today.");
            return;
        }
    }

    const eventDataToSave = {
        eventName, isWeekly, startTime, endTime, address, location, notes,
        ...(isWeekly ? { weeklyStartDate, weeklyEndDate, daysOfWeek } : { eventDate }),
    };

    try {
        if (isEditingInstance) {
            const freshness = checkEventFreshness(originalEventIdForInstance, originalOccurrenceDateForInstance);
            if (!freshness.live) {
                isEditingEvent = false;
                await showAppAlert(staleEventMessage("edit this event", freshness.reason));
                return;
            }
        } else if (existingEventId) {
            const freshness = checkEventFreshness(existingEventId);
            if (!freshness.live) {
                isEditingEvent = false;
                await showAppAlert(staleEventMessage("edit this event", freshness.reason));
                return;
            }
        }

        let savedEventId = null;
        let savedOccurrenceDate = null;

        if (isEditingInstance) {
            await addExceptionDate(clubId, originalEventIdForInstance, originalOccurrenceDateForInstance);

            const parentData = eventDocsMap.get(originalEventIdForInstance);
            if (parentData) {
                const exceptions = parentData.exceptions || [];
                if (!exceptions.includes(originalOccurrenceDateForInstance)) {
                    parentData.exceptions = [...exceptions, originalOccurrenceDateForInstance];
                }
            }

            const overrideFields = { ...eventDataToSave, parentRecurringEventId: originalEventIdForInstance };
            const newEventData = await createEvent(clubId, overrideFields, currentUser);
            savedEventId = newEventData.id;
            savedOccurrenceDate = eventDate;

            eventDocsMap.set(savedEventId, newEventData);

            const rsvpsToTransferQuery = query(
                collection(db, "clubs", clubId, "occurrenceRsvps"),
                where("eventId", "==", originalEventIdForInstance),
                where("occurrenceDate", "==", originalOccurrenceDateForInstance)
            );
            const rsvpsSnap = await getDocs(rsvpsToTransferQuery);
            if (!rsvpsSnap.empty) {
                const batch = writeBatch(db);
                rsvpsSnap.forEach(rsvpDoc => {
                    const newId = `${savedEventId}_${eventDate}_${rsvpDoc.data().userId}`;
                    const newRef = doc(db, "clubs", clubId, "occurrenceRsvps", newId);
                    batch.set(newRef, { ...rsvpDoc.data(), eventId: savedEventId, occurrenceDate: eventDate });
                    batch.delete(rsvpDoc.ref);
                });
                await batch.commit();
                userRsvpMap.forEach((status, key) => {
                    if (key === `${originalEventIdForInstance}_${originalOccurrenceDateForInstance}`) {
                        userRsvpMap.delete(key);
                        userRsvpMap.set(`${savedEventId}_${eventDate}`, status);
                    }
                });
            }

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(originalEventIdForInstance);
            refreshCardsForEvent(savedEventId);

        } else if (existingEventId) {
            const existingData = eventDocsMap.get(existingEventId) || {};
            const updatedData = await updateEvent(clubId, existingEventId, eventDataToSave, existingData.exceptions || []);
            savedEventId = existingEventId;
            savedOccurrenceDate = isWeekly ? null : eventDate;

            eventDocsMap.set(existingEventId, updatedData);

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(existingEventId);
        } else {
            const newEventData = await createEvent(clubId, eventDataToSave, currentUser);
            savedEventId = newEventData.id;
            savedOccurrenceDate = isWeekly ? null : eventDate;

            eventDocsMap.set(savedEventId, newEventData);

            cardDiv.remove();
            isEditingEvent = false;
            refreshCardsForEvent(savedEventId);
        }

        if (isNewEvent && !isEditingInstance && !existingEventId && isFirstCard) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            scrollToEditedEvent(savedEventId, savedOccurrenceDate);
        }
        await showAppAlert("Event saved successfully!");

    } catch (error) {
        console.error("Error saving event:", error);
        isEditingEvent = false;
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("edit events"));
        } else {
            await showAppAlert("Something went wrong while saving this event.");
        }
    }
}



async function editEvent(eventId, occurrenceDateString = null) {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in and viewing a club to edit events."); return; }
    if (isEditingEvent) { await showAppAlert("Please finish editing the current event before starting another edit."); return; }

    const freshness = checkEventFreshness(eventId, occurrenceDateString);
    if (!freshness.live) {
        await showAppAlert(staleEventMessage("edit this event", freshness.reason));
        return;
    }

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
        const editingCard = createEditingCardElement(eventData, false, eventId);
        targetDisplayCard.replaceWith(editingCard);
    }
}



async function cancelSingleOccurrence(eventId, occurrenceDateString) {
    const freshness = checkEventFreshness(eventId, occurrenceDateString);
    if (!freshness.live) {
        await showAppAlert(staleEventMessage("delete this event", freshness.reason, "it was already deleted"));
        return;
    }

    const confirmed = await showAppConfirm(`Are you sure you want to cancel the event on ${formatDate(occurrenceDateString)}? It will no longer appear on the schedule.`);
    if (!confirmed) return;


    try {
        const eventData = eventDocsMap.get(eventId);
        if (!eventData) { await showAppAlert("Error: Event not found."); return; }

        const existingExceptions = eventData.exceptions || [];
        const hypotheticalExceptions = [...existingExceptions, occurrenceDateString];

        let remaining = 0;
        if (eventData.isWeekly) {
            const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00');
            const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00');
            const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));
            let cur = new Date(startDate);
            while (cur.getTime() <= endDate.getTime()) {
                const ds = formatLocalDate(cur);
                if (daysToMatch.includes(cur.getDay()) && !hypotheticalExceptions.includes(ds)) remaining++;
                cur.setDate(cur.getDate() + 1);
            }
        }

        if (remaining === 0) {
            const deleted = await handleDeleteEvent(eventId, eventData.isWeekly, true);
            if (deleted) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                await showAppAlert("That was the last occurrence of this event, so it's been fully removed.");
            }
        } else {
            await addExceptionDate(clubId, eventId, occurrenceDateString);
            eventData.exceptions = [...existingExceptions, occurrenceDateString];

            const card = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateString}"]`);
            if (card) card.remove();
            checkIfEmpty();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await showAppAlert(`The event on ${formatDate(occurrenceDateString)} has been canceled.`);
        }
    } catch (error) {
        console.error("Error canceling occurrence:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("cancel events"));
        } else {
            await showAppAlert("Something went wrong while canceling this event.");
        }
    }
}

async function deleteEvent(clubId, eventId) {
    const batch = writeBatch(db);

    const eventRef = doc(db, "clubs", clubId, "events", eventId);
    batch.delete(eventRef);

    const rsvpsQuery = query(
        collection(db, "clubs", clubId, "occurrenceRsvps"),
        where("eventId", "==", eventId)
    );
    const rsvpsSnap = await getDocs(rsvpsQuery);
    rsvpsSnap.forEach(rsvpDoc => batch.delete(rsvpDoc.ref));

    await batch.commit();
    return [eventId];
}


async function deleteEventSeries(clubId, eventId) {
    // Gather every doc that has to go, then delete in batches
    const refsToDelete = [];

    const eventRef = doc(db, "clubs", clubId, "events", eventId);
    refsToDelete.push(eventRef);

    const rsvpsSnap = await getDocs(query(
        collection(db, "clubs", clubId, "occurrenceRsvps"),
        where("eventId", "==", eventId)
    ));
    rsvpsSnap.forEach(d => refsToDelete.push(d.ref));

    const overridesSnap = await getDocs(query(
        collection(db, "clubs", clubId, "events"),
        where("parentRecurringEventId", "==", eventId)
    ));
    const overrideIDs = overridesSnap.docs.map(d => d.id);
    overridesSnap.forEach(d => refsToDelete.push(d.ref));

    for (let i = 0; i < overrideIDs.length; i += 30) {
        const chunk = overrideIDs.slice(i, i + 30);
        const snap = await getDocs(query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "in", chunk)
        ));
        snap.forEach(d => refsToDelete.push(d.ref));
    }

    for (let i = 0; i < refsToDelete.length; i += 450) {
        const batch = writeBatch(db);
        refsToDelete.slice(i, i + 450).forEach(ref => batch.delete(ref));
        await batch.commit();
    }

    // The main event plus every override, so the caller can pull the right cards
    return [eventId, ...overrideIDs];
}

async function addExceptionDate(clubId, eventId, dateString) {
    const eventRef = doc(db, "clubs", clubId, "events", eventId);
    await updateDoc(eventRef, { exceptions: arrayUnion(dateString) });
}


async function handleDeleteEvent(eventId, isWeekly, skipConfirm = false) {
    const freshness = checkEventFreshness(eventId);
    if (!freshness.live) {
        if (!skipConfirm) {
            await showAppAlert(staleEventMessage(isWeekly ? "delete this event series" : "delete this event", freshness.reason, "it was already deleted"));
        }
        return false;
    }

    const eventData = eventDocsMap.get(eventId);
    let eventName = "Untitled Event";
    if (eventData) {
        eventName = eventData.eventName;
    }

    if (!skipConfirm) {
        let msg;
        if (isWeekly) {
            msg = `Are you sure you want to delete the entire "${eventName}" repeating event series? All upcoming events in this series will be removed. This can't be undone.`;
        } else {
            msg = `Are you sure you want to cancel "${eventName}"? This action cannot be undone.`;
        }
        const confirmed = await showAppConfirm(msg);
        if (!confirmed) {
            return false;
        }
    }

    try {
        let deletedIds;
        if (isWeekly) {
            deletedIds = await deleteEventSeries(clubId, eventId);
        } else {
            deletedIds = await deleteEvent(clubId, eventId);
        }

        deletedIds.forEach(id => {
            if (id !== eventId) {
                const cards = eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${id}"]`);
                cards.forEach(c => {
                    if (c.classList.contains('editing-event-card')) {
                        isEditingEvent = false;
                    }
                    c.remove();
                });
                eventDocsMap.delete(id);
            }
        });

        removeCardsForEvent(eventId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (!skipConfirm) await showAppAlert("Event deleted successfully!");
        return true;

    } catch (error) {
        console.error("Error deleting event:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("delete events"));
        } else {
            await showAppAlert("Something went wrong while deleting this event.");
        }
        return false;
    }
}

function createSingleOccurrenceDisplayCard(eventData, occurrenceDate, originalEventId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card display-event-card';
    cardDiv.dataset.originalEventId = originalEventId;
    const occurrenceDateString = formatLocalDate(occurrenceDate);
    cardDiv.dataset.occurrenceDate = occurrenceDateString;

    const formattedDate = occurrenceDate.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });

    const canEditDelete = (role === 'manager' || role === 'admin');
    let actionButtonsHtml = '';

    if (canEditDelete) {
        if (eventData.isWeekly) {
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
            <h3 class="event-card-title">${escapeHtml(eventData.eventName)}</h3>
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
                <span class="einfo-text">${escapeHtml(eventData.address)}</span>
            </div>
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-solid fa-thumbtack"></i></span>
                <span class="einfo-text">${escapeHtml(eventData.location)}</span>
            </div>
            ${eventData.notes ? `
            <div class="einfo-row">
                <span class="einfo-icon"><i class="fa-regular fa-pen-to-square"></i></span>
                <span class="einfo-text">${escapeHtml(eventData.notes)}</span>
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

        ${actionButtonsHtml}
    `;

    const cachedStatus = userRsvpMap.get(`${originalEventId}_${occurrenceDateString}`) || null;
    cardDiv.querySelectorAll('.rsvp-button').forEach(btn => {
        btn.classList.toggle('selected-rsvp', btn.dataset.status === cachedStatus);
    });

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

    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) editBtn.addEventListener('click', e => editEvent(e.currentTarget.dataset.eventId, e.currentTarget.dataset.occurrenceDate));

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', e => handleDeleteEvent(e.currentTarget.dataset.eventId, false));

        const deleteSeriesBtn = cardDiv.querySelector('.delete-series-btn');
        if (deleteSeriesBtn) deleteSeriesBtn.addEventListener('click', e => handleDeleteEvent(e.currentTarget.dataset.eventId, true));

        const cancelInstanceBtn = cardDiv.querySelector('.cancel-instance-btn');
        if (cancelInstanceBtn) cancelInstanceBtn.addEventListener('click', e => cancelSingleOccurrence(e.currentTarget.dataset.eventId, e.currentTarget.dataset.occurrenceDate));
    }

    const deleteParentSeriesBtn = cardDiv.querySelector('.delete-parent-series-btn');
    if (deleteParentSeriesBtn) deleteParentSeriesBtn.addEventListener('click', e => handleDeleteEvent(e.currentTarget.dataset.parentEventId, true));

    return cardDiv;
}


//RSVP

async function prefetchUserRsvps() {
    if (!currentUser || !clubId) return;
    try {
        const snap = await getDocs(query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("userId", "==", currentUser.uid)
        ));
        userRsvpMap.clear();
        snap.forEach(d => {
            const data = d.data();
            userRsvpMap.set(`${data.eventId}_${data.occurrenceDate}`, data.status);
        });
    } catch (error) {
        console.error("Error prefetching RSVPs:", error);
    }
}

async function saveRsvpStatus(originalEventId, occurrenceDateString, status) {
    if (!currentUser || !clubId) { await showAppAlert("You must be logged in to RSVP."); return; }

    const key = `${originalEventId}_${occurrenceDateString}`;
    const previousStatus = userRsvpMap.get(key) || null;
    const newStatus = (previousStatus === status) ? null : status;

    if (newStatus === null) userRsvpMap.delete(key);
    else userRsvpMap.set(key, newStatus);
    updateRsvpButtonsUI(originalEventId, occurrenceDateString, newStatus);

    try {
        const freshness = checkEventFreshness(originalEventId, occurrenceDateString);
        if (!freshness.live) {
            revertRsvpUI(key, previousStatus, originalEventId, occurrenceDateString);
            await showAppAlert(staleEventMessage("provide an RSVP for this event", freshness.reason));
            return;
        }

        const userUid = currentUser.uid;
        const rsvpDocId = `${originalEventId}_${occurrenceDateString}_${userUid}`;
        const rsvpDocRef = doc(db, "clubs", clubId, "occurrenceRsvps", rsvpDocId);

        if (newStatus === null) {
            await deleteDoc(rsvpDocRef);
        } else {
            await setDoc(rsvpDocRef, {
                eventId: originalEventId,
                occurrenceDate: occurrenceDateString,
                userId: userUid,
                timestamp: serverTimestamp(),
                clubId,
                status: newStatus,
            });
        }
    } catch (error) {
        console.error("Error saving RSVP:", error);
        revertRsvpUI(key, previousStatus, originalEventId, occurrenceDateString);

        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("provide an RSVP for this event"));
        } else {
            await showAppAlert("Something went wrong while saving your RSVP.");
        }
    }
}

function revertRsvpUI(key, previousStatus, eventId, occurrenceDateString) {
    if (previousStatus === null) userRsvpMap.delete(key);
    else userRsvpMap.set(key, previousStatus);
    updateRsvpButtonsUI(eventId, occurrenceDateString, previousStatus);
}


function updateRsvpButtonsUI(originalEventId, occurrenceDateString, currentStatus) {
    const card = document.querySelector(`.event-card[data-original-event-id="${originalEventId}"][data-occurrence-date="${occurrenceDateString}"]`);
    if (!card) return;
    card.querySelectorAll('.rsvp-button').forEach(btn => {
        btn.classList.toggle('selected-rsvp', btn.dataset.status === currentStatus);
    });
}

async function showRsvpDetailsModal(eventId, occurrenceDateString) {
    if (!clubId) { await showAppAlert("Error: Club ID not found."); return; }

    const freshness = checkEventFreshness(eventId, occurrenceDateString);
    if (!freshness.live) {
        await showAppAlert(staleEventMessage("view responses for this event", freshness.reason));
        return;
    }

    document.body.classList.add('no-interaction');

    let overlay = document.getElementById('rsvp-details-overlay');
    let modal = document.getElementById('rsvp-details-modal');
    let spinner = document.getElementById('rsvp-modal-spinner');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rsvp-details-overlay';
        document.body.appendChild(overlay);
    }
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rsvp-details-modal';
        document.body.appendChild(modal);
    }
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'rsvp-modal-spinner';
        spinner.className = 'loading-spinner';
        document.body.appendChild(spinner);
    }

    modal.classList.remove('rsvp-modal-show');
    modal.style.display = 'none';
    modal.innerHTML = '';
    spinner.style.display = 'block';

    overlay.style.display = 'flex';
    document.body.classList.add('no-scroll');

    function closeRsvpModal() {
        overlay.style.display = 'none';
        spinner.style.display = 'none';
        modal.classList.remove('rsvp-modal-show');
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll', 'no-interaction');
    }

    overlay.onclick = (e) => {
        if (e.target === overlay) closeRsvpModal();
    };

    try {
        const rsvpsSnap = await getDocs(query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "==", eventId),
            where("occurrenceDate", "==", occurrenceDateString)
        ));

        const rsvpDocs = rsvpsSnap.docs.map(d => d.data());

        await Promise.all(
            [...new Set(rsvpDocs.map(d => d.userId))].map(uid => resolveName(uid))
        );
        const names = rsvpDocs.map(data => ({
            status: data.status,
            name: memberNames[data.userId] || "Unknown User"
        }));

        const going = [], maybe = [], notGoing = [];
        names.forEach(({ status, name }) => {
            if (status === 'YES') going.push(name);
            else if (status === 'MAYBE') maybe.push(name);
            else if (status === 'NO') notGoing.push(name);
        });

        const buildSection = (label, names, modifierClass, iconClass) => names.length === 0 ? '' : `
            <div class="rsvp-status-section ${modifierClass}">
                <div class="rsvp-section-head">
                    <span class="rsvp-section-label"><i class="${iconClass}" aria-hidden="true"></i>${label}</span>
                    <span class="rsvp-count">${names.length}</span>
                </div>
                <div class="rsvp-namelist">
                    ${names.map(n => `<div class="rsvp-name-row">${escapeHtml(n)}</div>`).join('')}
                </div>
            </div>
        `;

        const sectionsHtml =
            buildSection('Going', going, 'rsvp-status-going', 'fa-solid fa-check') +
            buildSection('Maybe', maybe, 'rsvp-status-maybe', 'fa-solid fa-question') +
            buildSection('Not Going', notGoing, 'rsvp-status-no', 'fa-solid fa-xmark');

        if (overlay.style.display === 'none') return;

        modal.innerHTML = `
            <button class="rsvp-close-btn" aria-label="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="rsvp-title-row">
                <h3>Responses</h3>
                <p>${formatDate(occurrenceDateString)}</p>
            </div>
            <div id="rsvp-scroll-content">
                ${sectionsHtml || '<p class="rsvp-empty-message">No responses yet</p>'}
            </div>
        `;

        modal.querySelector('.rsvp-close-btn').addEventListener('click', closeRsvpModal);

        spinner.style.display = 'none';
        modal.style.display = 'flex';
        document.body.classList.remove('no-interaction');
        requestAnimationFrame(() => {
            modal.classList.add('rsvp-modal-show');
        });

    } catch (error) {
        console.error("Error fetching RSVP details:", error);
        closeRsvpModal();
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("provide an RSVP for this event"));
        } else {
            await showAppAlert("Something went wrong while loading RSVP details.");
        }
    }
}

async function resolveName(uid) {
    if (!uid) return "Unknown User";
    if (memberNames[uid]) return memberNames[uid];
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        memberNames[uid] = (userSnap.exists() && userSnap.data().name) ? userSnap.data().name : "Unknown User";
        return memberNames[uid];
    } catch (error) {
        console.error(`Failed to resolve name for ${uid}:`, error);
        return "Unknown User";
    }
}

async function getUserNameCached(uid) {
    if (userCache.has(uid)) {
        const d = userCache.get(uid);
        return d.displayName || d.name || "Unknown User";
    }
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const d = snap.data();
            userCache.set(uid, d);
            return d.displayName || d.name || "Unknown User";
        }
    } catch (e) {
        console.error(`Error fetching user ${uid}:`, e);
    }
    return "Unknown User";
}

function formatTime(timeString) {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes);
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function scrollToEditedEvent(eventId, occurrenceDateStr = null) {
    if (!eventsContainer) return;

    let card;
    if (occurrenceDateStr) {
        card = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"][data-occurrence-date="${occurrenceDateStr}"]`);
    } else {
        card = eventsContainer.querySelector(`.event-card[data-original-event-id="${eventId}"]`);
    }

    if (!card) return;

    const headerHeight = document.querySelector('.chat-header').offsetHeight;
    const rect = card.getBoundingClientRect();
    const isFullyVisible = (rect.top >= headerHeight && rect.bottom <= window.innerHeight);

    if (!isFullyVisible) {
        const targetY = rect.top + window.scrollY - 95;
        window.scrollTo({
            top: targetY,
            behavior: 'smooth'
        });
    }
}

function calculateFutureOccurrences(weeklyStartDate, weeklyEndDate, daysOfWeek, exceptions = [], startTime = '00:00', endTime = '23:59') {
    let count = 0;
    const now = new Date();
    const startDate = new Date(weeklyStartDate + 'T00:00:00');
    const endDate = new Date(weeklyEndDate + 'T00:00:00');
    const daysToMatch = daysOfWeek.map(day => dayNamesMap.indexOf(day));
    let cur = new Date(startDate);

    while (cur.getTime() <= endDate.getTime()) {
        const ds = formatLocalDate(cur);
        if (daysToMatch.includes(cur.getDay()) && !exceptions.includes(ds)) {
            if (new Date(`${ds}T${endTime}`).getTime() > now.getTime()) count++;
        }
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function hideLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');

    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    } else {
        document.body.classList.remove('no-scroll');
    }

    if (content) {
        content.style.display = 'block';
        Array.from(content.querySelectorAll(':scope > *')).forEach((item, i) => {
            if (item === eventsContainer || item === addEventButton) {
                item.classList.add('revealed-child');
            } else {
                setTimeout(() => item.classList.add('revealed-child'), i * 200);
            }
        });
    }
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



function showContainerError(container, message, showRetry = false) {
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}


function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club ${ROLE_LABELS.manager.toLowerCase()} if you think this is a mistake.`;
}
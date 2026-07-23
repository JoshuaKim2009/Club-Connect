import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocFromServer, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { ROLE_LABELS } from './roleLabels.js';


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
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

let currentUser = null;
let clubId = null;
let role = null;
let isEditingEvent = false;

let eventDocsMap = new Map();
const userCache = new Map();
const memberListCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;
const userRsvpMap = new Map(); 

const eventsContainer = document.getElementById('eventsContainer');
const noEventsMessage = document.getElementById('noEventsMessage');
const addEventButton = document.getElementById('add-event-button');

document.body.classList.add('no-scroll');

const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];



function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

async function getClubRole(clubId, uid, clubSnap = null) {
    if (!clubId || !uid) return null;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        let memberRoleSnap;
        try {
            memberRoleSnap = await getDocFromServer(memberRoleRef);
        } catch (error) {
            console.warn("Could not verify role from server, falling back to cache:", error);
            memberRoleSnap = await getDoc(memberRoleRef);
        }

        let role;
        if (memberRoleSnap.exists()) {
            role = memberRoleSnap.data().role || 'member';
        } else {
            const snap = clubSnap || await getDoc(doc(db, "clubs", clubId));
            role = (snap.exists() && snap.data().managerUid === uid) ? 'manager' : null;
        }

        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
}


async function checkEventFreshness(eventId, occurrenceDateString = null) {
    let eventSnap;
    try {
        eventSnap = await getDocFromServer(doc(db, "clubs", clubId, "events", eventId));
    } catch (error) {
        console.warn("Could not verify event freshness from server, falling back to cache:", error);
        try {
            eventSnap = await getDoc(doc(db, "clubs", clubId, "events", eventId));
        } catch (fallbackError) {
            console.error("Cache fallback for event freshness check failed too:", fallbackError);
            return { live: true, unverified: true };
        }
    }

    if (!eventSnap.exists()) {
        return { live: false, reason: 'deleted' };
    }

    const freshData = eventSnap.data();
    eventDocsMap.set(eventId, { id: eventId, ...freshData });

    if (occurrenceDateString && freshData.isWeekly) {
        const exceptions = freshData.exceptions || [];
        if (exceptions.includes(occurrenceDateString)) {
            return { live: false, reason: 'canceled', freshData };
        }
    }

    return {
        live: true, 
        freshData
    };
}

function staleEventMessage(actionPhrase, reason, deletedPhrase = "it was recently deleted") {
    const cause = reason === 'canceled' ? 'it was recently canceled' : deletedPhrase;
    return `You cannot ${actionPhrase}, because ${cause}. Please reload for the most up-to-date schedule.`;
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



onAuthStateChanged(auth, async (user) => {
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

            role = await getClubRole(clubId, currentUser.uid, clubSnap);

            if (role === null) {
                hideLoadingScreen();
                showContainerError(eventsContainer, "You're not a member of this club.");
                if (addEventButton) addEventButton.style.display = 'none';
                return;
            }

            await Promise.all([
                fetchAndDisplayEvents(),
                prefetchUserRsvps()
            ]);
            hideLoadingScreen();
            requestAnimationFrame(() => requestAnimationFrame(() => renderAllEvents()));

            if (addEventButton) {
                if (role === 'manager' || role === 'admin') {
                    addEventButton.style.display = 'block';
                    addEventButton.addEventListener('click', addNewEventEditingCard);
                } else {
                    addEventButton.style.display = 'none';
                }
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

    } catch (error) {
        console.error("Error fetching events:", error);
        throw error;
    }
}

function renderAllEvents() {
    if (!eventsContainer) return;
    eventsContainer.innerHTML = '';

    const allOccurrences = buildOccurrenceList();
    const isAdmin = role === 'manager' || role === 'admin';

    if (allOccurrences.length === 0) {
        if (role === 'member') eventsContainer.innerHTML = '<p class="fancy-label">NO UPCOMING EVENTS</p>';
        if (noEventsMessage) noEventsMessage.style.display = 'block';
        eventsContainer.style.marginTop = '0px';
        return;
    }

    if (noEventsMessage) noEventsMessage.style.display = 'none';
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
            const existingDateTime = new Date(formatLocalDate(new Date(existingDate)) + 'T' + existingEventData.startTime + ':00').getTime();
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

function removeCardsForEvent(eventId) {
    eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${eventId}"]`).forEach(c => c.remove());
    eventDocsMap.delete(eventId);
    checkIfEmpty();
}

function checkIfEmpty() {
    if (!eventsContainer) return;
    
    const remaining = eventsContainer.querySelectorAll('.display-event-card');
    
    if (remaining.length === 0) {
        if (role === 'member') {
            eventsContainer.innerHTML = '<p class="fancy-label">NO UPCOMING EVENTS</p>';
        }
        if (noEventsMessage) {
            noEventsMessage.style.display = 'block';
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

    const newCard = createEditingCardElement({}, true);
    if (eventsContainer) {
        if (noEventsMessage) noEventsMessage.style.display = 'none';
        eventsContainer.prepend(newCard);
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

    const isWeeklyChecked = initialData.isWeekly ? 'checked' : '';
    const selectedDays = initialData.daysOfWeek || [];

    cardDiv.innerHTML = `
        <h3>${isNewEvent ? 'ADD EVENT' : 'EDIT EVENT'}</h3>

        <div class="field-section">
            <label for="edit-name-${currentEditId}">Event Name:</label>
            <input type="text" id="edit-name-${currentEditId}" value="${initialData.eventName || ''}" required>
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
            <label for="edit-address-${currentEditId}">Address:</label>
            <input type="text" id="edit-address-${currentEditId}" value="${initialData.address || ''}" required>
        </div>

        <div class="field-section">
            <label for="edit-location-${currentEditId}">Specific Location:</label>
            <input type="text" id="edit-location-${currentEditId}" value="${initialData.location || ''}" required>
        </div>

        <div class="field-section">
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
        createdByUid: user.uid,
        createdByName: user.displayName || "Unknown"
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
            const freshness = await checkEventFreshness(originalEventIdForInstance, originalOccurrenceDateForInstance);
            if (!freshness.live) {
                isEditingEvent = false;
                await showAppAlert(staleEventMessage("edit this event", freshness.reason));
                return;
            }
        } else if (existingEventId) {
            const freshness = await checkEventFreshness(existingEventId);
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

        scrollToEditedEvent(savedEventId, savedOccurrenceDate);
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

    const freshness = await checkEventFreshness(eventId, occurrenceDateString);
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
    const freshness = await checkEventFreshness(eventId, occurrenceDateString);
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
    const batch = writeBatch(db);

    const eventRef = doc(db, "clubs", clubId, "events", eventId);
    batch.delete(eventRef);
    const rsvpsQuery = query(
    collection(db, "clubs", clubId, "occurrenceRsvps"),
        where("eventId", "==", eventId)
    );
    const rsvpsSnap = await getDocs(rsvpsQuery);

    rsvpsSnap.forEach(rsvpDoc => {
        batch.delete(rsvpDoc.ref);
    });

    const overridesQuery = query(
    collection(db, "clubs", clubId, "events"),
        where("parentRecurringEventId", "==", eventId)
    );
    const overridesSnap = await getDocs(overridesQuery);
    const overrideIDs = overridesSnap.docs.map(doc => doc.id);

    overridesSnap.forEach(overrideDoc => {
        batch.delete(overrideDoc.ref);
    });

    if (overrideIDs.length > 0){
        const overridesRsvpsQuery = query(
            collection(db, "clubs", clubId, "occurrenceRsvps"),
            where("eventId", "in", overrideIDs)
        );
        const overridesRsvpsSnap = await getDocs(overridesRsvpsQuery);
        overridesRsvpsSnap.forEach(rsvpDoc => {
            batch.delete(rsvpDoc.ref);
        });
    }
	await batch.commit();

	// returns list of deleted event IDs which includes the main event and all the override IDs. Used to remove the right cards from DOM quickly without having to get them again from Firestore.
	return [eventId,...overrideIDs];
}

async function addExceptionDate(clubId, eventId, dateString) {
    const eventRef = doc(db, "clubs", clubId, "events", eventId);
    await updateDoc(eventRef, { exceptions: arrayUnion(dateString) });
}


async function handleDeleteEvent(eventId, isWeekly, skipConfirm = false) {
    const freshness = await checkEventFreshness(eventId);
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
                eventsContainer.querySelectorAll(`.event-card[data-original-event-id="${id}"]`).forEach(c => c.remove());
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
            <h3 class="event-card-title">${eventData.eventName}</h3>
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

    // --- Optimistic update: happens instantly, before any network call ---
    if (newStatus === null) userRsvpMap.delete(key);
    else userRsvpMap.set(key, newStatus);
    updateRsvpButtonsUI(originalEventId, occurrenceDateString, newStatus);

    try {
        const freshness = await checkEventFreshness(originalEventId, occurrenceDateString);
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
                userName: currentUser.displayName || "Anonymous User",
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

async function getAllClubMembers(clubID, useCache = true) {
    if (useCache && memberListCache.has(clubID)) {
        const cached = memberListCache.get(clubID);
        if (Date.now() - cached.timestamp < CACHE_DURATION) return cached.members;
    }

    const members = [];
    try {
        const [clubSnap, membersSnap] = await Promise.all([
            getDoc(doc(db, "clubs", clubID)),
            getDocs(collection(db, "clubs", clubID, "members"))
        ]);

        const managerUid = clubSnap.exists() ? clubSnap.data().managerUid : null;

        const uidsToFetch = [];
        if (managerUid && !userCache.has(managerUid)) uidsToFetch.push(managerUid);
        membersSnap.docs.forEach(d => {
            if (d.id !== managerUid && !userCache.has(d.id)) uidsToFetch.push(d.id);
        });

        if (uidsToFetch.length > 0) {
            const userSnaps = await Promise.all(
                uidsToFetch.map(uid => getDoc(doc(db, "users", uid)))
            );
            userSnaps.forEach((snap, i) => {
                if (snap.exists()) userCache.set(uidsToFetch[i], snap.data());
            });
        }

        if (managerUid) {
            const d = userCache.get(managerUid);
            const name = d ? (d.displayName || d.name || `Unknown ${ROLE_LABELS.manager}`) : `Unknown ${ROLE_LABELS.manager}`;
            members.push({ uid: managerUid, name, role: 'manager' });
        }

        membersSnap.docs.forEach(memberDoc => {
            if (memberDoc.id === managerUid) return;
            const d = userCache.get(memberDoc.id);
            members.push({
                uid: memberDoc.id,
                name: d ? (d.displayName || d.name) : "Unknown User",
                role: memberDoc.data().role || 'member'
            });
        });

        memberListCache.set(clubID, { members, timestamp: Date.now() });
    } catch (error) {
        console.error("Error fetching club members:", error);
    }
    return members;
}

async function showRsvpDetailsModal(eventId, occurrenceDateString) {
    if (!clubId) { await showAppAlert("Error: Club ID not found."); return; }

    const freshness = await checkEventFreshness(eventId, occurrenceDateString);
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
        const [rsvpsSnap, allMembers] = await Promise.all([
            getDocs(query(
                collection(db, "clubs", clubId, "occurrenceRsvps"),
                where("eventId", "==", eventId),
                where("occurrenceDate", "==", occurrenceDateString)
            )),
            getAllClubMembers(clubId)
        ]);

        const rsvpsMap = {};
        rsvpsSnap.forEach(d => { rsvpsMap[d.data().userId] = { status: d.data().status, userName: d.data().userName }; });
        const going = [], maybe = [], notGoing = [], noResponse = [];

        allMembers.forEach(member => {
            const rsvp = rsvpsMap[member.uid];
            if (rsvp) {
                if (rsvp.status === 'YES') going.push(rsvp.userName);
                else if (rsvp.status === 'NO') notGoing.push(rsvp.userName);
                else if (rsvp.status === 'MAYBE') maybe.push(rsvp.userName);
            }
        });

        // TEST ONLY
        // for (let i = 1; i <= 30; i++) going.push(`Test Member ${i}`);
        // for (let i = 1; i <= 10; i++) maybe.push(`Test Maybe ${i}`);
        // for (let i = 1; i <= 10; i++) notGoing.push(`Test No ${i}`);

        const buildSection = (label, names, modifierClass, iconClass) => names.length === 0 ? '' : `
            <div class="rsvp-status-section ${modifierClass}">
                <div class="rsvp-section-head">
                    <span class="rsvp-section-label"><i class="${iconClass}" aria-hidden="true"></i>${label}</span>
                    <span class="rsvp-count">${names.length}</span>
                </div>
                <div class="rsvp-namelist">
                    ${names.map(n => `<div class="rsvp-name-row">${n}</div>`).join('')}
                </div>
            </div>
        `;

        const sectionsHtml =
            buildSection('Going', going, 'rsvp-status-going', 'fa-solid fa-check') +
            buildSection('Maybe', maybe, 'rsvp-status-maybe', 'fa-solid fa-question') +
            buildSection('Not Going', notGoing, 'rsvp-status-no', 'fa-solid fa-xmark');
            // buildSection('No Response', noResponse, 'rsvp-status-none', 'fa-regular fa-clock');

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

    const rect = card.getBoundingClientRect();
    const isFullyVisible = (rect.top >= 0 && rect.bottom <= window.innerHeight);

    if (!isFullyVisible) {
        const targetY = rect.top + window.scrollY - 90;
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


function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club manager if you think this is a mistake.`;
}
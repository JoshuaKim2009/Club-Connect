import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection, query, orderBy, limit, startAfter, getDocs, getCountFromServer, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { ROLE_LABELS } from './roleLabels.js';
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

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let memberNames = {};

async function resolveName(uid) {
    if (!uid) return "Unknown";
    if (memberNames[uid]) return memberNames[uid];
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        memberNames[uid] = (userSnap.exists() && userSnap.data().name) ? userSnap.data().name : "Unknown";
        return memberNames[uid];
    } catch (error) {
        console.error(`Failed to resolve name for ${uid}:`, error);
        return "Unknown";
    }
}

let currentUser = null;
let clubId = null;
let currentUserRole = null;
let isEditingAnnouncement = false;

let currentPage = 1;
const PAGE_SIZE = 5;

let totalCount = 0;
let totalPages = 1;
let cursors = [null];
let currentPageAnnouncements = [];


// const clubAnnouncementsTitle = document.getElementById('clubAnnouncementsTitle');
const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');
const addAnnouncementButton = document.getElementById('add-announcement-button');
const noAnnouncementsMessageAdmin = document.getElementById('noAnnouncementsMessageAdmin');

document.getElementById('empty-state-announcement-btn').addEventListener('click', addNewAnnouncementEditingCard);

document.body.classList.add('no-scroll');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
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

    if (!clubId) {
        window.location.href = 'your_clubs.html';
        return;
    }

    try {
        const clubSnap = await getDoc(doc(db, "clubs", clubId));

        if (!clubSnap.exists()) {
            hideLoadingScreen();
            showContainerError(announcementsContainer, "This club doesn't exist.");
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
            return;
        }

        memberNames = { ...(clubSnap.data().memberNames || {}) };
        currentUserRole = await getRole(db, clubId, currentUser.uid, clubSnap);

        if (currentUserRole === null) {
            hideLoadingScreen();
            showContainerError(announcementsContainer, "You're not a member of this club.");
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
            return;
        }

        await refreshCount();
        updateLastSeenAnnouncements();

        if (addAnnouncementButton) {
            addAnnouncementButton.onclick = addNewAnnouncementEditingCard;
            addAnnouncementButton.style.display = (currentUserRole === 'manager' || currentUserRole === 'admin') ? 'block' : 'none';
        }

        await renderAnnouncementPage();
        hideLoadingScreen();

    } catch (error) {
        hideLoadingScreen();
        console.error("Error fetching club details or user role:", error);
        showContainerError(announcementsContainer, "Oops! Something went wrong.", true);
        if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
    }
});

function formatTimestamp(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'N/A';
    const date = timestamp.toDate();
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return date.toLocaleDateString(undefined, options);
}

function scrollToAnnouncement(announcementId) {
    const card = announcementsContainer.querySelector(`.announcement-card[data-announcement-id="${announcementId}"]`);
    if (!card) return;

    const headerHeight = document.querySelector('.chat-header').offsetHeight;
    const top = documentTopOf(card);
    const bottom = top + card.offsetHeight;

    const viewTop = window.pageYOffset + headerHeight;
    const viewBottom = window.pageYOffset + window.innerHeight;
    const isFullyVisible = top >= viewTop && bottom <= viewBottom;

    if (!isFullyVisible) {
        window.scrollTo({ top: top - 52, behavior: 'smooth' });
    }
}

function documentTopOf(el) {
    let y = 0;
    for (let node = el; node; node = node.offsetParent) y += node.offsetTop;
    return y;
}

function createEditingCardElement(initialData = {}, isNewAnnouncement = true, announcementIdToUpdate = null, isFirstCard = false) {
    isEditingAnnouncement = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = (isNewAnnouncement && isFirstCard) ? 'announcement-card editing-announcement-card editing-announcement-card-first' : 'announcement-card editing-announcement-card';
    cardDiv.dataset.editId = announcementIdToUpdate || `new-${Date.now()}`;
    cardDiv.dataset.isNewAnnouncement = isNewAnnouncement;

    const id = cardDiv.dataset.editId;

    cardDiv.innerHTML = `
        <h3>${isNewAnnouncement ? 'POST ANNOUNCEMENT' : 'EDIT ANNOUNCEMENT'}</h3>
        <div class="field-section">
            <label for="edit-title-${id}">Title</label>
            <input type="text" id="edit-title-${id}" value="${escapeHtml(initialData.title || '')}" required>
        </div>
        <div class="field-section">
            <label for="edit-content-${id}">Content</label>
            <textarea id="edit-content-${id}" rows="5" required>${escapeHtml(initialData.content || '')}</textarea>
        </div>
        <div class="announcement-card-actions">
            <button class="save-btn">SAVE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    cardDiv.querySelector('.save-btn').addEventListener('click', () => saveAnnouncement(cardDiv, announcementIdToUpdate));

    cardDiv.querySelector('.cancel-btn').addEventListener('click', () => {
        isEditingAnnouncement = false;
        if (!isNewAnnouncement) {
            const cached = currentPageAnnouncements.find(a => a.id === announcementIdToUpdate);
            if (cached) {
                const restoredCard = createAnnouncementDisplayCard(cached, cached.id);
                cardDiv.replaceWith(restoredCard);
                requestAnimationFrame(() => scrollToAnnouncement(announcementIdToUpdate));
            } else {
                cardDiv.remove();
            }
        } else {
            cardDiv.remove();
            if (announcementsContainer.querySelectorAll('.announcement-card').length === 0) {
                noAnnouncementsMessageAdmin.style.display = 'block';
            }
            if (addAnnouncementButton) addAnnouncementButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    return cardDiv;
}

async function addNewAnnouncementEditingCard() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to add announcements.");
        return;
    }
    if (isEditingAnnouncement) {
        await showAppAlert("Please finish editing the current announcement before adding a new one.");
        return;
    }

    const isFirstCard = announcementsContainer.querySelectorAll('.announcement-card').length === 0;
    const newCardElement = createEditingCardElement({}, true, null, isFirstCard);

    if (announcementsContainer) {
        noAnnouncementsMessageAdmin.style.display = 'none';
        announcementsContainer.prepend(newCardElement);
    }
}

async function createAnnouncement(clubId, title, content, user) {
    const announcementData = {
        title,
        content,
        createdByUid: user.uid,
        clubId,
        createdAt: serverTimestamp()
 	};
  	const collectionRef = collection(db, "clubs", clubId, "announcements");
  	const announcementRef = await addDoc(collectionRef, announcementData);
	// returns all the doc data and the firestore doc ID. This is used to display the new announcement to the user without having to do another database read 
    return {
        ...announcementData,
        createdAt: Timestamp.now(),
        authorName: await resolveName(user.uid),
        id: announcementRef.id
    };
}


async function updateAnnouncement(clubId, announcementId, title, content) {
    const announcementRef = doc(db, "clubs", clubId, "announcements", announcementId);
  	await updateDoc(announcementRef, { 
        title, 
        content 
 	});   
  	const cached = currentPageAnnouncements.find(a => a.id === announcementId) || {};
    // returns object with the newly updated document fields and its firestore doc ID to display the updated announcement without having to do another read
    return { 
        ...cached,
        title,
        content,
        id: announcementId
  	};
}


async function saveAnnouncement(cardDiv, existingAnnouncementId = null) {
    const tempDomId = cardDiv.dataset.editId;

    const title = cardDiv.querySelector(`#edit-title-${tempDomId}`).value.trim();
    const content = cardDiv.querySelector(`#edit-content-${tempDomId}`).value.trim();

    if (!title) { await showAppAlert("Announcement Title is required!"); return; }
    if (!content) { await showAppAlert("Announcement Content is required!"); return; }

    try {
        if (existingAnnouncementId) {
            isEditingAnnouncement = false;
            noAnnouncementsMessageAdmin.style.display = 'none';
            const updatedData = await updateAnnouncement(clubId, existingAnnouncementId, title, content);

            const index = currentPageAnnouncements.findIndex(a => a.id === existingAnnouncementId);
            if (index !== -1) {
                currentPageAnnouncements[index] = updatedData;
            }

            isEditingAnnouncement = false;
            const restoredCard = createAnnouncementDisplayCard(updatedData, existingAnnouncementId);
            cardDiv.replaceWith(restoredCard);
            // showAppAlert("Announcement updated successfully!");
            requestAnimationFrame(() => scrollToAnnouncement(existingAnnouncementId));

        } else {
            const newData = await createAnnouncement(clubId, title, content, currentUser);

            isEditingAnnouncement = false;
            noAnnouncementsMessageAdmin.style.display = 'none';
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'block';

            const newCard = createAnnouncementDisplayCard(newData, newData.id);
            cardDiv.replaceWith(newCard);
            animateCardIn(newCard, 0);

            currentPageAnnouncements.unshift(newData);

            if (currentPageAnnouncements.length > PAGE_SIZE) {
                currentPageAnnouncements.pop();
                const allCards = announcementsContainer.querySelectorAll('.announcement-card');
                const lastCard = allCards[allCards.length - 1];
                if (lastCard) lastCard.remove();
            }

            requestAnimationFrame(() => scrollToAnnouncement(newData.id));
            updateLastSeenAnnouncements();

            cursors = [null];
            hidePagination();
            refreshCount().then(async () => {
                await fetchPage(1);
                if (totalPages > 1) {
                    renderPaginationButtons(currentPage, totalPages);
                } else {
                    hidePagination();
                }
            });
        }
    } catch (error) {
        console.error("Error saving announcement:", error);
        isEditingAnnouncement = false;
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage(existingAnnouncementId ? "edit announcements" : "post announcements"));
        } else {
            await showAppAlert("Something went wrong while saving this announcement. Please try again.");
        }
    }
}


function announcementsQueryBase() {
    return query(collection(db, "clubs", clubId, "announcements"), orderBy("createdAt", "desc"));
}

async function refreshCount() {
    const snap = await getCountFromServer(announcementsQueryBase());
    totalCount = snap.data().count;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

async function fetchPage(page) {
    const afterCursor = cursors[page - 1];
    const pageQuery = afterCursor
        ? query(announcementsQueryBase(), startAfter(afterCursor), limit(PAGE_SIZE))
        : query(announcementsQueryBase(), limit(PAGE_SIZE));

    const snap = await getDocs(pageQuery);
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    if (snap.docs.length > 0) cursors[page] = snap.docs[snap.docs.length - 1];
    await Promise.all([...new Set(docs.map(d => d.createdByUid))].map(uid => resolveName(uid)));
    docs.forEach(d => { d.authorName = memberNames[d.createdByUid] || "Unknown"; });
    return docs;
}

async function renderAnnouncementPage() {
    announcementsContainer.innerHTML = '';
    cursors = [null];
    currentPage = 1;

    if (totalCount === 0) {
        if (currentUserRole === 'member') {
            noAnnouncementsMessage.style.display = 'block';
            announcementsContainer.style.marginTop = '0px';
            noAnnouncementsMessageAdmin.style.display = 'none';
        } else {
            noAnnouncementsMessage.style.display = 'none';
            noAnnouncementsMessageAdmin.style.display = 'block';
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
        }
        hidePagination();
        return;
    }
    noAnnouncementsMessage.style.display = 'none';
    noAnnouncementsMessageAdmin.style.display = 'none';
    await renderPage(1, false);
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
            if (item === announcementsContainer || item === addAnnouncementButton) {
                item.classList.add('revealed-child');
            } else {
                setTimeout(() => item.classList.add('revealed-child'), i * 200);
            }
        });
    }
}

async function renderPage(page, skipAnimation = false) {
    page = Math.max(1, Math.min(page, totalPages));
    currentPage = page;

    const pageItems = await fetchPage(currentPage);
    currentPageAnnouncements = pageItems;

    announcementsContainer.innerHTML = '';

    if (addAnnouncementButton) {
        const isAdmin = currentUserRole === 'manager' || currentUserRole === 'admin';
        if (!isAdmin) {
            addAnnouncementButton.style.display = 'none';
            announcementsContainer.style.marginTop = '-45px';
        } else if (currentPage === 1) {
            addAnnouncementButton.style.display = 'block';
            announcementsContainer.style.marginTop = '0px';
        } else {
            addAnnouncementButton.style.display = 'none';
            announcementsContainer.style.marginTop = '-45px';
        }
    }

    pageItems.forEach((announcement, index) => {
        const card = createAnnouncementDisplayCard(announcement, announcement.id);
        announcementsContainer.appendChild(card);
        if (!skipAnimation) animateCardIn(card, index);
    });

    if (totalPages > 1) {
        renderPaginationButtons(currentPage, totalPages);
    } else {
        hidePagination();
    }
}

function renderPaginationButtons(page, totalPages) {
    const controls = document.getElementById('pagination-controls');
    const inner = document.getElementById('pagination-inner');
    controls.style.display = 'flex';
    inner.innerHTML = '';

    let pagesToShow = [];
    if (totalPages === 2) {
        pagesToShow = [1, 2];
    } else if (page === 1) {
        pagesToShow = [1, 2, 3];
    } else if (page === totalPages) {
        pagesToShow = [totalPages - 2, totalPages - 1, totalPages];
    } else {
        pagesToShow = [page - 1, page, page + 1];
    }

    pagesToShow.forEach(p => {
        const btn = document.createElement('button');
        btn.textContent = p;
        btn.className = 'pagination-btn' + (p === page ? ' active-page' : '');
        if (p !== page) {
            btn.addEventListener('click', async () => {
                try {
                    await renderPage(p);
                    window.scrollTo({ top: 0, behavior: 'instant' });
                } catch (error) {
                    console.error("Error loading page:", error);
                    await showAppAlert("Couldn't load that page. Please try again.");
                }
            });
        }
        inner.appendChild(btn);
    });
}

function hidePagination() {
    const paginationControls = document.getElementById('pagination-controls');
    if (paginationControls) paginationControls.style.display = 'none';
    const inner = document.getElementById('pagination-inner');
    if (inner) inner.innerHTML = '';
}


function createAnnouncementDisplayCard(announcementData, announcementId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card display-announcement-card';
    cardDiv.dataset.announcementId = announcementId;

    const canEditDelete = (currentUserRole === 'manager' || currentUserRole === 'admin') && announcementData.createdByUid === currentUser.uid;
    let actionButtonsHtml = '';

    if (canEditDelete) {
        actionButtonsHtml = `
            <div class="announcement-meta-row">
                <span class="announcement-meta-text">${escapeHtml(announcementData.authorName)} · ${formatTimestamp(announcementData.createdAt)}</span>
                <div class="announcement-meta-btns">
                    <button class="edit-btn" data-announcement-id="${announcementId}">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                    <button class="delete-btn" data-announcement-id="${announcementId}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    } else {
        actionButtonsHtml = `<p class="announcement-meta">${escapeHtml(announcementData.authorName)} · ${formatTimestamp(announcementData.createdAt)}</p>`;
    }

    cardDiv.innerHTML = `
        <h3>${escapeHtml(announcementData.title)}</h3>
        <p>${linkifyText(announcementData.content)}</p>
        ${actionButtonsHtml}
    `;

    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) editBtn.addEventListener('click', () => editAnnouncement(announcementId));

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => deleteAnnouncement(announcementId));
    }

    return cardDiv;
}

async function editAnnouncement(announcementId) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to edit announcements.");
        return;
    }
    if (isEditingAnnouncement) {
        await showAppAlert("Please finish editing the current announcement before starting another edit.");
        return;
    }

    const announcementData = currentPageAnnouncements.find(a => a.id === announcementId);
    if (!announcementData) { await showAppAlert("Error: Announcement not found."); return; }

    const targetDisplayCard = announcementsContainer.querySelector(`.announcement-card[data-announcement-id="${announcementId}"]`);
    if (!targetDisplayCard) {
        await showAppAlert("Could not find the announcement card to edit. Please refresh.");
        return;
    }

    const editingCard = createEditingCardElement(announcementData, false, announcementId);
    targetDisplayCard.replaceWith(editingCard);
}

async function deleteAnnouncement(announcementId) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to delete announcements.");
        return;
    }

    const confirmed = await showAppConfirm(`Are you sure you want to delete this announcement? This action cannot be undone.`);
    if (!confirmed) {
        return;
    }

    try {
        await deleteDoc(doc(db, "clubs", clubId, "announcements", announcementId));

        cursors = [null];
        await refreshCount();

        if (totalCount === 0) {
            announcementsContainer.innerHTML = '';
            if (currentUserRole === 'member') {
                noAnnouncementsMessage.style.display = 'block';
            } else {
                noAnnouncementsMessageAdmin.style.display = 'block';
                if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
            }
            hidePagination();
        } else {
            const pageToShow = Math.min(currentPage, totalPages);
            for (let p = 1; p < pageToShow; p++) {
                await fetchPage(p);
            }
            await renderPage(pageToShow, true);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
        // showAppAlert("Announcement deleted successfully!");
    } catch (error) {
        console.error("Error deleting announcement:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("delete announcements"));
        } else {
            await showAppAlert("Something went wrong while deleting this announcement.");
        }
    }
}

async function updateLastSeenAnnouncements() {
    if (!currentUser || !clubId) return;

    const memberDocRef = doc(db, "clubs", clubId, "members", currentUser.uid);

    try {
        await updateDoc(memberDocRef, {
            lastSeenAnnouncements: serverTimestamp()
        });
        console.log("Updated lastSeenAnnouncements timestamp");
    } catch (error) {
        console.error("Failed to update lastSeenAnnouncements:", error);
    }
}

function linkifyText(text) {
    const escaped = escapeHtml(text);
    const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
    return escaped.replace(urlPattern, (url) => {
        let href = url.startsWith('http') ? url : 'https://' + url;
        return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
    });
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


function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club ${ROLE_LABELS.manager.toLowerCase()} if you think this is a mistake.`;
}
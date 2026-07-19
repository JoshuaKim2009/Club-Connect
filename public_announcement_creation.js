import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection, query, orderBy, limit, startAfter, getDocs, getCountFromServer, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';


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
let currentUserRole = null;
let isEditingAnnouncement = false;

let currentClubName = null;
let currentSchoolId = null;

let currentPage = 1;
const PAGE_SIZE = 5;

let totalCount = 0;
let totalPages = 1;
let cursors = [null];
let currentPageAnnouncements = [];

const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');
const addAnnouncementButton = document.getElementById('add-announcement-button');

document.body.classList.add('no-scroll');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;

    const cacheKey = `role_${clubId}_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        const memberRoleSnap = await getDoc(memberRoleRef);

        let role;
        if (memberRoleSnap.exists()) {
            role = memberRoleSnap.data().role || 'member';
        } else {
            const clubRef = doc(db, "clubs", clubId);
            const clubSnap = await getDoc(clubRef);
            role = (clubSnap.exists() && clubSnap.data().managerUid === uid) ? 'manager' : null;
        }

        if (role !== null) sessionStorage.setItem(cacheKey, role);
        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
}

window.goToClubPage = function () {
    if (clubId) {
        window.location.href = `club_page_manager.html?id=${clubId}`;
    } else {
        window.location.href = 'your_clubs.html';
    }
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
            addAnnouncementButton.style.display = 'none';
            return;
        }

        const clubData = clubSnap.data();
        currentClubName = clubData.clubName || 'Unnamed Club';
        currentSchoolId = clubData.schoolId || null;

        currentUserRole = await getMemberRoleForClub(clubId, currentUser.uid);

        if (currentUserRole !== 'manager' && currentUserRole !== 'admin') {
            hideLoadingScreen();
            showContainerError(announcementsContainer, "You don't have permission to view this page.");
            addAnnouncementButton.style.display = 'none';
            return;
        }

        if (addAnnouncementButton) {
            addAnnouncementButton.onclick = addNewAnnouncementEditingCard;
        }

        await renderAnnouncementPage();

        hideLoadingScreen();

    } catch (error) {
        hideLoadingScreen();
        console.error("Error fetching club details or user role:", error);
        showContainerError(announcementsContainer, "Oops! Something went wrong.", true);
        addAnnouncementButton.style.display = 'none';
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

    const rect = card.getBoundingClientRect();
    const isFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (!isFullyVisible) {
        window.scrollTo({ top: rect.top + window.pageYOffset - 90, behavior: 'smooth' });
    }
}

function createEditingCardElement(initialData = {}, isNewAnnouncement = true, announcementIdToUpdate = null) {
    isEditingAnnouncement = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card editing-announcement-card';
    cardDiv.dataset.editId = announcementIdToUpdate || `new-${Date.now()}`;
    cardDiv.dataset.isNewAnnouncement = isNewAnnouncement;

    const id = cardDiv.dataset.editId;

    cardDiv.innerHTML = `
        <h3>${isNewAnnouncement ? 'SHARE WITH SCHOOL' : 'EDIT POST'}</h3>
        <div class="field-section">
            <label for="edit-title-${id}">Title</label>
            <input type="text" id="edit-title-${id}" value="${initialData.title || ''}" required>
        </div>
        <div class="field-section">
            <label for="edit-content-${id}">Content</label>
            <textarea id="edit-content-${id}" rows="5" required>${initialData.content || ''}</textarea>
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
            if (announcementsContainer && announcementsContainer.querySelectorAll('.announcement-card').length === 0 && noAnnouncementsMessage) {
                noAnnouncementsMessage.style.display = 'block';
            }
            addAnnouncementButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    const newCardElement = createEditingCardElement({}, true);

    noAnnouncementsMessage.style.display = 'none';
    announcementsContainer.prepend(newCardElement);
}

async function createAnnouncement(clubId, title, content, user, schoolId, clubName) {
    const announcementData = {
        title,
        content,
        createdByUid: user.uid,
        createdByName: user.displayName || "Anonymous",
        clubId,
        clubName,
        schoolId,
        createdAt: serverTimestamp()
    };
    const annCollection = collection(db, "clubs", clubId, "publicAnnouncements");
    const annRef = await addDoc(annCollection, announcementData);
    const newSnap = await getDoc(annRef);
    return {
        ...newSnap.data(),
        id: annRef.id
    };
}

async function updateAnnouncement(clubId, announcementId, title, content) {
    const annRef = doc(db, "clubs", clubId, "publicAnnouncements", announcementId);
    await updateDoc(annRef, { title, content });
    const annSnap = await getDoc(annRef);
    return {
        ...annSnap.data(),
        id: annSnap.id
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
            const updatedData = await updateAnnouncement(clubId, existingAnnouncementId, title, content);

            const index = currentPageAnnouncements.findIndex(a => a.id === existingAnnouncementId);
            if (index !== -1) currentPageAnnouncements[index] = updatedData;

            isEditingAnnouncement = false;
            const restoredCard = createAnnouncementDisplayCard(updatedData, existingAnnouncementId);
            cardDiv.replaceWith(restoredCard);
            showAppAlert("Announcement updated successfully!");
            requestAnimationFrame(() => scrollToAnnouncement(existingAnnouncementId));

        } else {
            await createAnnouncement(clubId, title, content, currentUser, currentSchoolId, currentClubName);

            isEditingAnnouncement = false;
            cardDiv.remove();
            if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

            cursors = [null];
            await refreshCount();
            await renderPage(1, true);

            showAppAlert("New announcement added successfully!");
            requestAnimationFrame(() => scrollToAnnouncement(currentPageAnnouncements[0]?.id));
        }
    } catch (error) {
        console.error("Error saving announcement:", error);
        isEditingAnnouncement = false;
        await showAppAlert("Failed to save announcement: " + error.message);
    }
}

function announcementsQueryBase() {
    const annCollection = collection(db, "clubs", clubId, "publicAnnouncements");
    return query(annCollection, orderBy("createdAt", "desc"));
}

async function refreshCount() {
    const snap = await getCountFromServer(announcementsQueryBase());
    totalCount = snap.data().count;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

async function fetchPage(page) {
    const base = announcementsQueryBase();
    const afterCursor = cursors[page - 1]; 
    const pageQuery = afterCursor
        ? query(base, startAfter(afterCursor), limit(PAGE_SIZE))
        : query(base, limit(PAGE_SIZE));

    const snap = await getDocs(pageQuery);
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));

    if (snap.docs.length > 0) {
        cursors[page] = snap.docs[snap.docs.length - 1];
    }

    return docs;
}

async function renderAnnouncementPage() {
    announcementsContainer.innerHTML = '';
    cursors = [null];
    currentPage = 1;

    await refreshCount();

    if (totalCount === 0) {
        noAnnouncementsMessage.style.display = 'block';
        addAnnouncementButton.style.display = 'block';
        hidePagination();
        return;
    }

    noAnnouncementsMessage.style.display = 'none';
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
    content.style.display = 'block';
    Array.from(content.querySelectorAll(':scope > *')).forEach((item, i) => {
        if (item === announcementsContainer || item === addAnnouncementButton) {
            item.classList.add('revealed-child');
        } else {
            setTimeout(() => item.classList.add('revealed-child'), i * 200);
        }
    });
}

async function renderPage(page, skipAnimation = false) {
    page = Math.max(1, Math.min(page, totalPages));
    currentPage = page;

    const pageItems = await fetchPage(page);
    currentPageAnnouncements = pageItems;

    announcementsContainer.innerHTML = '';

    if (currentPage === 1) {
        addAnnouncementButton.style.display = 'block';
        announcementsContainer.style.marginTop = '0px';
    } else {
        addAnnouncementButton.style.display = 'none';
        announcementsContainer.style.marginTop = '-45px';
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
    pagesToShow = pagesToShow.filter(p => p >= 1 && p <= totalPages);

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
    paginationControls.style.display = 'none';
    const inner = document.getElementById('pagination-inner');
    inner.innerHTML = '';
}

function createAnnouncementDisplayCard(announcementData, announcementId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card display-announcement-card';
    cardDiv.dataset.announcementId = announcementId;

    const canEditDelete = announcementData.createdByUid === currentUser.uid;
    let actionButtonsHtml = '';

    if (canEditDelete) {
        actionButtonsHtml = `
            <div class="announcement-meta-row">
                <span class="announcement-meta-text">${announcementData.createdByName} · ${formatTimestamp(announcementData.createdAt)}</span>
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
        actionButtonsHtml = `<p class="announcement-meta">${announcementData.createdByName} · ${formatTimestamp(announcementData.createdAt)}</p>`;
    }

    cardDiv.innerHTML = `
        <h3>${announcementData.title}</h3>
        <p>${linkifyText(announcementData.content)}</p>
        ${actionButtonsHtml}
    `;

    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) editBtn.addEventListener('click', () => editAnnouncement(announcementId));

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => deleteAnnouncement(announcementId, announcementData.title));
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

async function deleteAnnouncement(announcementId, announcementTitle) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to delete announcements.");
        return;
    }

    const confirmed = await showAppConfirm(`Are you sure you want to delete the announcement "${announcementTitle}"? This action cannot be undone.`);
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "clubs", clubId, "publicAnnouncements", announcementId));

        cursors = [null];
        await refreshCount();

        if (totalCount === 0) {
            announcementsContainer.innerHTML = '';
            noAnnouncementsMessage.style.display = 'block';
            hidePagination();
        } else {
            const pageToShow = Math.min(currentPage, totalPages);
            await renderPage(pageToShow, true);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
        showAppAlert("Announcement deleted successfully!");
    } catch (error) {
        console.error("Error deleting announcement:", error);
        await showAppAlert("Failed to delete announcement: " + error.message);
    }
}

function linkifyText(text) {
    const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
    return text.replace(urlPattern, (url) => {
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
//announcements.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, where, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let currentUserRole = null; 
let isEditingAnnouncement = false; 

let currentPage = 1;
const PAGE_SIZE = 5;

// const clubAnnouncementsTitle = document.getElementById('clubAnnouncementsTitle');
const announcementsContainer = document.getElementById('announcementsContainer'); 
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage'); 
const addAnnouncementButton = document.getElementById('add-announcement-button'); 


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

    console.log("goToClubPage: clubId = ", currentClubId);
    console.log("goToClubPage: returnToPage = ", returnToPage);

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

                    currentUserRole = await getMemberRoleForClub(clubId, currentUser.uid);
                    console.log(`User ${currentUser.uid} role for club ${clubId}: ${currentUserRole}`);

                    await fetchAndDisplayAnnouncements();
                    
                    if (addAnnouncementButton) {
                        if (currentUserRole === 'manager' || currentUserRole === 'admin') {
                            addAnnouncementButton.style.display = 'block'; 
                            addAnnouncementButton.removeEventListener('click', addNewAnnouncementEditingCard); 
                            addAnnouncementButton.addEventListener('click', addNewAnnouncementEditingCard);
                        } else {
                            addAnnouncementButton.style.display = 'none'; 
                        }
                    }

                } else {
                    // if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Club Announcements (Club Not Found)";
                    if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">Sorry, this club does not exist or you do not have access.</p>`;
                    if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
                }
            } catch (error) {
                console.error("Error fetching club details or user role:", error);
                // if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Error Loading Announcements";
                if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">An error occurred while loading club details.</p>`;
                if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
            }
        } else {
            // if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Error: No Club ID Provided";
            if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">Please return to your clubs page and select a club to view its announcements.</p>`;
            if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
        }
    } else {
        console.log("No user authenticated on announcements page. Redirecting to login.");
        // if (clubAnnouncementsTitle) clubAnnouncementsTitle.textContent = "Not Authenticated";
        if (announcementsContainer) announcementsContainer.innerHTML = `<p class="fancy-label">You must be logged in to view club announcements. Redirecting...</p>`;
        if (addAnnouncementButton) addAnnouncementButton.style.display = 'none';
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000); 
    }
});


function formatTimestamp(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'N/A';
    const date = timestamp.toDate();
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return date.toLocaleDateString(undefined, options);
}


function _createEditingCardElement(initialData = {}, isNewAnnouncement = true, announcementIdToUpdate = null) {
    isEditingAnnouncement = true;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card editing-announcement-card';
    cardDiv.dataset.editId = announcementIdToUpdate || `new-${Date.now()}`; 
    cardDiv.dataset.isNewAnnouncement = isNewAnnouncement;

    cardDiv.innerHTML = `
        <div>
            <label for="edit-title-${cardDiv.dataset.editId}">Title:</label>
            <input type="text" id="edit-title-${cardDiv.dataset.editId}" value="${initialData.title || ''}" required>
        </div>
        <div>
            <label for="edit-content-${cardDiv.dataset.editId}">Content:</label>
            <textarea id="edit-content-${cardDiv.dataset.editId}" rows="5" required>${initialData.content || ''}</textarea>
        </div>

        <div class="announcement-card-actions">
            <button class="save-btn">SAVE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    cardDiv.querySelector('.save-btn').addEventListener('click', async () => {
        console.log('SAVE button clicked for editing card:', cardDiv.dataset.editId);
        await saveAnnouncement(cardDiv, announcementIdToUpdate);
        isEditingAnnouncement = false;
    });
    cardDiv.querySelector('.cancel-btn').addEventListener('click', async () => {
        console.log('CANCEL button clicked for editing card:', cardDiv.dataset.editId);
        cardDiv.remove();
        isEditingAnnouncement = false;
        if (!isNewAnnouncement) {
            await fetchAndDisplayAnnouncements(); 
        } else if (announcementsContainer && announcementsContainer.querySelectorAll('.announcement-card').length === 0 && noAnnouncementsMessage) {
            noAnnouncementsMessage.style.display = 'block';
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

    const newCardElement = _createEditingCardElement({}, true); 

    if (announcementsContainer) {
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';
        announcementsContainer.prepend(newCardElement);
    }
}


async function saveAnnouncement(cardDiv, existingAnnouncementId = null) {
    const tempDomId = cardDiv.dataset.editId;
    const isNewAnnouncement = cardDiv.dataset.isNewAnnouncement === 'true';

    const title = cardDiv.querySelector(`#edit-title-${tempDomId}`).value.trim();
    const content = cardDiv.querySelector(`#edit-content-${tempDomId}`).value.trim();

    if (!title) { await showAppAlert("Announcement Title is required!"); return; }
    if (!content) { await showAppAlert("Announcement Content is required!"); return; }
    if (title.length === 0) { await showAppAlert("Announcement Title cannot be empty!"); return; }
    if (content.length === 0) { await showAppAlert("Announcement Content cannot be empty!"); return; }

    const announcementDataToSave = {
        title,
        content,
        createdByUid: currentUser.uid,
        createdByName: currentUser.displayName || "Anonymous",
        clubId: clubId 
    };

    try {
        const announcementsRef = collection(db, "clubs", clubId, "announcements");

        if (existingAnnouncementId) {
            const announcementDocRef = doc(announcementsRef, existingAnnouncementId);
            await updateDoc(announcementDocRef, announcementDataToSave); 
            await showAppAlert("Announcement updated successfully!");
        } else {
            announcementDataToSave.createdAt = serverTimestamp(); 
            const newDocRef = await addDoc(announcementsRef, announcementDataToSave); 
            const newAnnouncementId = newDocRef.id; 

            await updateLastSeenAnnouncements();
            console.log(`Creator ${currentUser.displayName} (${currentUser.uid}) updated lastSeenAnnouncements after creating announcement ${newAnnouncementId}.`);

            await showAppAlert("New announcement added successfully!");
        }
        
        cardDiv.remove(); 
        isEditingAnnouncement = false;
        await fetchAndDisplayAnnouncements(); 

    } catch (error) {
        console.error("Error saving announcement:", error);
        isEditingAnnouncement = false;
        await showAppAlert("Failed to save announcement: " + error.message);
    }
}


let allAnnouncements = [];

async function fetchAndDisplayAnnouncements() {
  if (!clubId) {
    if (announcementsContainer) announcementsContainer.innerHTML = '<p class="fancy-label">No club selected.</p>';
    return;
  }

  announcementsContainer.innerHTML = '';
  currentPage = 1;

  const announcementsRef = collection(db, "clubs", clubId, "announcements");
  const q = query(announcementsRef, orderBy("createdAt", "desc"));

  try {
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      if (currentUserRole === 'member') {
        announcementsContainer.innerHTML = '<p class="fancy-label">NO ANNOUNCEMENTS YET</p>';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'block';
      } else {
        announcementsContainer.innerHTML = '';
        if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';
      }
      hidePagination();
      return;
    }

    if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

    allAnnouncements = [];
    querySnapshot.forEach((doc) => {
      allAnnouncements.push({ id: doc.id, ...doc.data() });
    });

    renderPage(currentPage);

  } catch (error) {
    console.error("Error fetching announcements:", error);
    announcementsContainer.innerHTML = '<p class="fancy-label">Error loading announcements.</p>';
  }
}

function renderPage(page) {
  announcementsContainer.innerHTML = '';

  const totalPages = Math.ceil(allAnnouncements.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(page, totalPages));

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageItems = allAnnouncements.slice(start, end);

  pageItems.forEach((announcement) => {
    announcementsContainer.appendChild(_createAnnouncementDisplayCard(announcement, announcement.id));
  });

  if (totalPages > 1) {
    const paginationControls = document.getElementById('pagination-controls');
    const pageIndicator = document.getElementById('page-indicator');
    const prevButton = document.getElementById('prev-page-button');
    const nextButton = document.getElementById('next-page-button');

    paginationControls.style.display = 'flex';
    pageIndicator.textContent = `${currentPage} / ${totalPages}`;
    prevButton.disabled = currentPage === 1;
    nextButton.disabled = currentPage === totalPages;
  } else {
    hidePagination();
  }
}

function hidePagination() {
  const paginationControls = document.getElementById('pagination-controls');
  if (paginationControls) paginationControls.style.display = 'none';
}

document.getElementById('prev-page-button').addEventListener('click', () => {
  if (currentPage > 1) renderPage(currentPage - 1);
});

document.getElementById('next-page-button').addEventListener('click', () => {
  const totalPages = Math.ceil(allAnnouncements.length / PAGE_SIZE);
  if (currentPage < totalPages) renderPage(currentPage + 1);
});


function _createAnnouncementDisplayCard(announcementData, announcementId) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'announcement-card display-announcement-card';
    cardDiv.dataset.announcementId = announcementId;

    const canEditDelete = ((currentUserRole === 'manager' || currentUserRole === 'admin') && announcementData.createdByUid === currentUser.uid);
    let actionButtonsHtml = '';

    if (canEditDelete) {
        actionButtonsHtml = `
            <div class="announcement-card-actions">
                <button class="edit-btn" data-announcement-id="${announcementId}">
                    <span class="button-text">EDIT</span><span class="button-icon"><i class="fa-solid fa-pencil"></i></span>
                </button>
                <button class="delete-btn" data-announcement-id="${announcementId}">
                    <span class="button-text">DELETE</span><span class="button-icon"><i class="fa-solid fa-trash"></i></span>
                </button>
            </div>
        `;
    }

    cardDiv.innerHTML = `
        <h3>${announcementData.title}</h3>
        <p>${linkifyText(announcementData.content)}</p>
        <p class="announcement-meta">Posted by: ${announcementData.createdByName} on ${formatTimestamp(announcementData.createdAt)}</p>
        ${actionButtonsHtml}
    `;

    if (canEditDelete) {
        const editBtn = cardDiv.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => editAnnouncement(announcementId));
        }

        const deleteBtn = cardDiv.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => deleteAnnouncement(announcementId, announcementData.title));
        }
    }

    updateLastSeenAnnouncements();

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

    try {
        const announcementDocRef = doc(db, "clubs", clubId, "announcements", announcementId);
        const announcementSnap = await getDoc(announcementDocRef);

        if (!announcementSnap.exists()) {
            await showAppAlert("Error: Announcement not found.");
            return;
        }

        const announcementData = announcementSnap.data();

        const targetDisplayCard = announcementsContainer.querySelector(`.announcement-card[data-announcement-id="${announcementId}"]`);
        if (!targetDisplayCard) {
            console.error("Could not find the target display card in the DOM for editing.");
            await showAppAlert("Could not find the announcement card to edit. Please refresh.");
            return;
        }

        const editingCard = _createEditingCardElement(announcementData, false, announcementId);
        targetDisplayCard.replaceWith(editingCard);

    } catch (error) {
        console.error("Error initiating announcement edit:", error);
        await showAppAlert("Failed to start announcement edit: " + error.message);
    }
}


async function deleteAnnouncement(announcementId, announcementTitle) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in and viewing a club to delete announcements.");
        return;
    }

    const confirmed = await showAppConfirm(`Are you sure you want to delete the announcement "${announcementTitle}"? This action cannot be undone.`);
    if (!confirmed) {
        console.log("Announcement deletion cancelled by user.");
        return;
    }

    try {
        const announcementDocRef = doc(db, "clubs", clubId, "announcements", announcementId);
        await deleteDoc(announcementDocRef);
        await showAppAlert("Announcement deleted successfully!");
        await fetchAndDisplayAnnouncements(); 
    } catch (error) {
        console.error("Error deleting announcement:", error);
        await showAppAlert("Failed to delete announcement: " + error.message);
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
    const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
    return text.replace(urlPattern, (url) => {
        let href = url.startsWith('http') ? url : 'https://' + url;
        return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
    });
}
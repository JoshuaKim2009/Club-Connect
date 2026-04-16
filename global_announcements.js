import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { 
  getFirestore, doc, getDoc, updateDoc, collection, 
  query, orderBy, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert } from './dialog.js';

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

const PAGE_SIZE = 5;

let currentUser = null;
let allAnnouncements = []; // full sorted list
let currentPage = 1;

const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');
const paginationControls = document.getElementById('pagination-controls');
const prevButton = document.getElementById('prev-page-button');
const nextButton = document.getElementById('next-page-button');
const pageIndicator = document.getElementById('page-indicator');


onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  currentUser = user;

  const clubIds = await getUserClubIds(user.uid);

  await fetchAllAnnouncements(clubIds, user.uid);

  if (allAnnouncements.length === 0) {
    showEmpty("NO ANNOUNCEMENTS YET");
    hidePagination();
    return;
  }

renderPage(currentPage);
  await markAllSeen(clubIds, user.uid);
});

function hidePagination() {
  if (paginationControls) {
    paginationControls.style.display = 'none';
  }
}



async function getUserClubIds(uid) {
  try {
    const clubsSnap = await getDocs(collection(db, "clubs"));
    const ids = [];
    
    await Promise.all(clubsSnap.docs.map(async (clubDoc) => {
      const memberRef = doc(db, "clubs", clubDoc.id, "members", uid);
      const memberSnap = await getDoc(memberRef);
      if (memberSnap.exists()) {
        ids.push(clubDoc.id);
      }
    }));
    
    return ids;
  } catch (e) {
    console.error("Error fetching user club list:", e);
    return [];
  }
}


async function fetchAllAnnouncements(clubIds, userId) {
  const [clubNames, announcementsByClub] = await Promise.all([
    fetchClubNames(clubIds),
    fetchAnnouncementsForClubs(clubIds)
  ]);

  allAnnouncements = announcementsByClub.map((a) => ({
    ...a,
    clubName: clubNames[a.clubId] || 'Unknown Club'
  }));

  allAnnouncements.sort((a, b) => {
    const tA = a.createdAt?.toMillis?.() ?? 0;
    const tB = b.createdAt?.toMillis?.() ?? 0;
    return tB - tA;
  });

  console.log(`Total announcements across all clubs: ${allAnnouncements.length}`);
}

async function fetchClubNames(clubIds) {
  const names = {};
  await Promise.all(clubIds.map(async (clubId) => {
    try {
      const snap = await getDoc(doc(db, "clubs", clubId));
      names[clubId] = snap.exists() ? (snap.data().clubName || 'Unknown Club') : 'Unknown Club';
    } catch (e) {
      names[clubId] = 'Unknown Club';
    }
  }));
  return names;
}

async function fetchAnnouncementsForClubs(clubIds) {
  const results = [];
  await Promise.all(clubIds.map(async (clubId) => {
    try {
      const q = query(
        collection(db, "clubs", clubId, "announcements"),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      snap.forEach((d) => {
        results.push({ id: d.id, clubId, ...d.data() });
      });
    } catch (e) {
      console.warn(`Could not load announcements for club ${clubId}:`, e);
    }
  }));
  return results;
}


function renderPage(page) {
  announcementsContainer.innerHTML = '';

  if (allAnnouncements.length === 0) {
    showEmpty("NO ANNOUNCEMENTS YET");
    return;
  }

  if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

  const totalPages = Math.ceil(allAnnouncements.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(page, totalPages));

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageItems = allAnnouncements.slice(start, end);

  pageItems.forEach((announcement) => {
    announcementsContainer.appendChild(createAnnouncementCard(announcement));
  });

  if (totalPages > 1) {
    paginationControls.style.display = 'flex';
    pageIndicator.textContent = `${currentPage} / ${totalPages}`;
    prevButton.disabled = currentPage === 1;
    nextButton.disabled = currentPage === totalPages;
  } else {
    paginationControls.style.display = 'none';
  }
}

prevButton.addEventListener('click', () => {
  if (currentPage > 1) renderPage(currentPage - 1);
});

nextButton.addEventListener('click', () => {
  const totalPages = Math.ceil(allAnnouncements.length / PAGE_SIZE);
  if (currentPage < totalPages) renderPage(currentPage + 1);
});


function createAnnouncementCard(data) {
  const cardDiv = document.createElement('div');
  cardDiv.className = 'announcement-card display-announcement-card';
  cardDiv.dataset.announcementId = data.id;

  cardDiv.innerHTML = `
    <h3>
      <span class="club-label">${data.clubName}</span><br>
      ${data.title}
    </h3>
    <p>${linkifyText(data.content)}</p>
    <p class="announcement-meta">
      Posted by: ${data.createdByName} on ${formatTimestamp(data.createdAt)}
    </p>
  `;

  return cardDiv;
}


async function markAllSeen(clubIds, userId) {
  await Promise.all(clubIds.map(async (clubId) => {
    try {
      await updateDoc(doc(db, "clubs", clubId, "members", userId), {
        lastSeenAnnouncements: serverTimestamp()
      });
    } catch (e) {
      console.warn(`Could not mark seen for club ${clubId}:`, e);
    }
  }));
}


function showEmpty(msg) {
  announcementsContainer.innerHTML = `<p class="fancy-label">${msg}</p>`;
}

function formatTimestamp(timestamp) {
  if (!timestamp || !timestamp.toDate) return 'N/A';
  const date = timestamp.toDate();
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function linkifyText(text) {
  const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
  return text.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : 'https://' + url;
    return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
  });
}
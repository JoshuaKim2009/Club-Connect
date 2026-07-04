import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { 
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, updateDoc, collection, 
  query, orderBy, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert } from './dialog.js';
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

const PAGE_SIZE = 5;

let currentUser = null;
let allAnnouncements = []; 
let currentPage = 1;

const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');

document.body.classList.add('no-scroll');
let loadingScreenHidden = false;

function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;
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
      Array.from(content.querySelectorAll(':scope > *')).forEach(item => {
        item.classList.add('revealed-child');
      });
    }
}

function showContainerError(message, showRetry = false, topMargin = '165px') {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
      <div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
        <p class="fancy-label">${message}</p>
        <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
          ${showRetry
            ? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
            : `<button type="button" class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
          }
        </div>
      </div>
    `;
}

onAuthStateChanged(auth, async (user) => {
  if (!handleUserSwitch(user)) {
    if (!user) window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  try {
    const clubIds = await getUserClubIds(user.uid);
    await fetchAllAnnouncements(clubIds, user.uid);

    if (allAnnouncements.length === 0) {
      showEmpty("NO UPDATES YET");
      hidePagination();
      hideLoadingScreen();
      return;
    }

    renderPage(currentPage);
    hideLoadingScreen();
    await markAllSeen(clubIds, user.uid);
  } catch (error) {
    console.error("Error loading announcements:", error);
    showContainerError("Oops! Something went wrong.", true);
    hideLoadingScreen();
  }
});

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
      btn.addEventListener('click', () => {
        renderPage(p);
        window.scrollTo({ top: 0, behavior: 'instant' });
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



async function getUserClubIds(uid) {
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return [];
    const data = userSnap.data();
    const managed = data.managed_clubs || [];
    const member = data.member_clubs || [];
    return [...new Set([...managed, ...member])];
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
    showEmpty("NO UPDATES YET");
    return;
  }

  if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

  const totalPages = Math.ceil(allAnnouncements.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(page, totalPages));

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageItems = allAnnouncements.slice(start, end);

  pageItems.forEach((announcement, index) => {
    const card = createAnnouncementCard(announcement);
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    card.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    announcementsContainer.appendChild(card);

    setTimeout(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, index * 80);
  });

  if (totalPages > 1) {
    renderPaginationButtons(currentPage, totalPages);
  } else {
    hidePagination();
  }
}


function createAnnouncementCard(data) {
  const cardDiv = document.createElement('div');
  cardDiv.className = 'announcement-card display-announcement-card';
  cardDiv.dataset.announcementId = data.id;

  cardDiv.innerHTML = `
    <h3>
      <span class="club-label club-label--link" data-club-id="${data.clubId}">${data.clubName}</span><br>
      ${data.title}
    </h3>
    <p>${linkifyText(data.content)}</p>
    <p class="announcement-meta">
      ${data.createdByName} · ${formatTimestamp(data.createdAt)}
    </p>
  `;

  const label = cardDiv.querySelector('.club-label--link');
  label.addEventListener('click', async () => {
    const role = await getMemberRoleForClub(data.clubId, currentUser.uid);
    if (role === 'manager' || role === 'admin') {
      window.location.href = `club_page_manager.html?id=${data.clubId}`;
    } else {
      window.location.href = `club_page_member.html?id=${data.clubId}`;
    }
  });

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
    year: 'numeric', month: 'short', day: 'numeric',
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


async function getMemberRoleForClub(clubId, uid) {
  try {
    const memberSnap = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberSnap.exists() && memberSnap.data().role) {
      return memberSnap.data().role;
    }
    const clubSnap = await getDoc(doc(db, "clubs", clubId));
    if (clubSnap.exists() && clubSnap.data().managerUid === uid) {
      return 'manager';
    }
    return 'member';
  } catch (e) {
    console.error("Error fetching role:", e);
    return 'member';
  }
}
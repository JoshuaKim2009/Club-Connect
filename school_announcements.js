import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc,
  collectionGroup, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { getRole } from './roleCache.js';

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
let currentSchoolId = null;
let currentPage = 1;

let totalCount = 0;
let totalPages = 1;
let cursors = [null];
let currentPageAnnouncements = [];

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

const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');

document.body.classList.add('no-scroll');
let loadingScreenHidden = false;

function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    overlay.classList.add('hidden');
    document.body.classList.remove('no-scroll');
    overlay.addEventListener('transitionend', () => {
        if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
    }, { once: true });

    content.style.display = 'block';
    Array.from(content.querySelectorAll(':scope > *')).forEach(item => {
        item.classList.add('revealed-child');
    });
}

function showContainerError(message, showRetry = false, topMargin = '61px', redirectUrl = 'index.html', buttonText = 'GO HOME') {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
        <p class="fancy-label">${message}</p>
        <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
          ${showRetry
            ? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
            : `<button type="button" class="fancy-button" onclick="window.location.href='${redirectUrl}'" style="font-size: 24px;">${buttonText}</button>`
          }
        </div>
      </div>
    `;
}

async function getUserSchoolId(uid) {
    if (!uid) return null;

    const cacheKey = `schoolId_${uid}`;
    const cachedSchoolId = sessionStorage.getItem(cacheKey);
    if (cachedSchoolId) return cachedSchoolId;

    try {
        const docSnap = await getDoc(doc(db, "users", uid));

        if (!docSnap.exists() || !docSnap.data().schoolId) {
            return null;
        }

        const schoolId = docSnap.data().schoolId;
        sessionStorage.setItem(cacheKey, schoolId);
        return schoolId;
    } catch (error) {
        console.error("Error getting user school ID:", error);
        return null;
    }
}

function schoolAnnouncementsQueryBase(schoolId) {
    return query(
        collectionGroup(db, "publicAnnouncements"),
        where("schoolId", "==", schoolId),
        orderBy("createdAt", "desc")
    );
}

async function refreshCount(schoolId) {
    const snap = await getCountFromServer(schoolAnnouncementsQueryBase(schoolId));
    totalCount = snap.data().count;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

async function fetchSchoolAnnouncementsPage(schoolId, page) {
    const base = schoolAnnouncementsQueryBase(schoolId);
    const afterCursor = cursors[page - 1]; 
    const pageQuery = afterCursor
        ? query(base, startAfter(afterCursor), limit(PAGE_SIZE))
        : query(base, limit(PAGE_SIZE));

    const snap = await getDocs(pageQuery);
    const announcementsList = [];
    snap.forEach((docSnap) => {
        announcementsList.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (snap.docs.length > 0) {
        cursors[page] = snap.docs[snap.docs.length - 1];
    }

    return announcementsList;
}

onAuthStateChanged(auth, async (user) => {
  if (!handleUserSwitch(user)) {
    if (!user) window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  try {
    const schoolId = await getUserSchoolId(user.uid);
    currentSchoolId = schoolId;

    if (!schoolId) {
        showContainerError("You haven't added a school yet.", false, '61px', 'edit_account.html', 'ADD SCHOOL');
        hidePagination();
        hideLoadingScreen();
        return;
    }

    cursors = [null];
    currentPage = 1;
    await refreshCount(schoolId);

    if (totalCount === 0) {
      showEmpty("NOTHING HERE YET!");
      hidePagination();
      hideLoadingScreen();
      return;
    }

    await renderPage(1);
    hideLoadingScreen();
  } catch (error) {
    console.error("Error loading school announcements:", error);
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
  if (paginationControls) paginationControls.style.display = 'none';
  const inner = document.getElementById('pagination-inner');
  if (inner) inner.innerHTML = '';
}

async function renderPage(page) {
  page = Math.max(1, Math.min(page, totalPages));
  currentPage = page;

  const pageItems = await fetchSchoolAnnouncementsPage(currentSchoolId, currentPage);

  if (pageItems.length === 0) {
    showEmpty("NOTHING HERE YET!");
    hidePagination();
    return;
  }

  await attachClubInfo(pageItems, currentUser.uid);
  currentPageAnnouncements = pageItems;

  announcementsContainer.innerHTML = '';
  if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

  const cards = pageItems.map(announcement => createAnnouncementCard(announcement));

  cards.forEach((card, index) => {
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

  const canNavigate = data.role === 'manager' || data.role === 'admin' || data.role === 'member';

  cardDiv.innerHTML = `
    <h3>
      <span class="club-label ${canNavigate ? 'club-label--link' : ''}" data-club-id="${escapeHtml(data.clubId)}">${escapeHtml(data.clubName)}</span><br>
      ${escapeHtml(data.title)}
    </h3>
    <p>${linkifyText(data.content)}</p>
    <p class="announcement-meta">
      ${escapeHtml(data.authorName)} · ${formatTimestamp(data.createdAt)}
    </p>
  `;

  if (canNavigate) {
    const label = cardDiv.querySelector('.club-label--link');
    label.addEventListener('click', () => {
      window.location.href = `club_page.html?clubId=${data.clubId}`;
    });
  }

  return cardDiv;
}

async function attachClubInfo(announcements, uid) {
  const uniqueClubIds = [...new Set(announcements.map(a => a.clubId))];

  const infoByClub = {};
  await Promise.all(uniqueClubIds.map(async (clubId) => {
    const clubSnap = await getDoc(doc(db, "clubs", clubId));
    const clubName = clubSnap.exists() ? (clubSnap.data().clubName || 'Unknown Club') : 'Unknown Club';
    if (clubSnap.exists()) {
      Object.assign(memberNames, clubSnap.data().memberNames || {});
    }
    const role = await getRole(db, clubId, uid, clubSnap.exists() ? clubSnap : undefined);
    infoByClub[clubId] = { clubName, role };
  }));

  await Promise.all(
    [...new Set(announcements.map(a => a.createdByUid))].map(uid => resolveName(uid))
  );

  announcements.forEach(a => {
    a.clubName = a.clubName || infoByClub[a.clubId].clubName;
    a.role = infoByClub[a.clubId].role;
    a.authorName = memberNames[a.createdByUid] || "Unknown";
  });
}


function showEmpty(msg) {
  announcementsContainer.innerHTML = `<p class="fancy-label empty-state-label">${msg}</p>`;
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
  const escaped = escapeHtml(text);
  const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
  return escaped.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : 'https://' + url;
    return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
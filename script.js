import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getCountFromServer, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const auth = getAuth(app);
const db = getFirestore(app);


const logoutButton = document.getElementById("logoutButton");
const welcomeMessage = document.getElementById("welcomeMessage");

function setLoggedInUI(displayName) {
  welcomeMessage.innerHTML = `Welcome, ${displayName}`;
  logoutButton.innerHTML = '<i class="fa-solid fa-user"></i> PROFILE';
  document.getElementById('dropdown-logout').innerHTML = 'LOGOUT <i class="fa-solid fa-arrow-right-from-bracket"></i>';
}

function setLoggedOutUI() {
  welcomeMessage.innerHTML = "Welcome, please <a href='login.html' class='goldLink'>login</a>";
  logoutButton.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> LOGIN';
  document.getElementById('dropdown-logout').innerHTML = 'LOGIN <i class="fa-solid fa-arrow-right-to-bracket"></i>';
}

// Paint correct UI immediately on first frame using cached data
const cached = JSON.parse(sessionStorage.getItem('cc-user') || localStorage.getItem('cc-user') || 'null');
if (cached) {
  setLoggedInUI(cached.displayName);
} else {
  setLoggedOutUI();
}

// Firebase confirms truth — updates UI if cache was wrong
let resolveAuth;
const authReady = new Promise(resolve => resolveAuth = resolve);

onAuthStateChanged(auth, (user) => {
  resolveAuth(user);
  if (user) {
    const data = { displayName: user.displayName, email: user.email, uid: user.uid };
    localStorage.setItem('cc-user', JSON.stringify(data));
    sessionStorage.setItem('cc-user', JSON.stringify(data));
    setLoggedInUI(user.displayName);
  } else {
    localStorage.removeItem('cc-user');
    sessionStorage.removeItem('cc-user');
    setLoggedOutUI();
  }
});

document.getElementById("club-button").onclick = async () => {
  const user = await authReady;
  window.location.href = user ? 'your_clubs.html' : 'login.html';
};

logoutButton.onclick = () => {
  if (!auth.currentUser) {
    window.location.href = 'login.html';
    return;
  }
  if (document.getElementById('appearance-modal').style.display === 'block') return;
  const dd = document.getElementById('profile-dropdown');
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
};

document.getElementById('dropdown-logout').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  if (auth.currentUser) {
    signOut(auth).catch(async (e) => await showAppAlert("Error signing out: " + e.message));
  } else {
    window.location.href = 'login.html';
  }
};

document.getElementById('dropdown-appearance').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'block';
  document.getElementById('appearance-modal').style.display = 'block';
  buildThemeOptions();
};

document.getElementById('close-appearance').onclick = closeAppearanceModal;
document.getElementById('profile-overlay').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  closeAppearanceModal();
};

function closeAppearanceModal() {
  document.getElementById('appearance-modal').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'none';
}

function buildThemeOptions() {
  const container = document.getElementById('theme-options');
  container.innerHTML = '';
  let pending = window.getSavedTheme();

  Object.entries(window.THEMES).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.dataset.key = key;
    if (key === pending) btn.classList.add('theme-swatch-active');
    btn.style.background = `linear-gradient(135deg, ${theme.dark} 0%, ${theme.accent} 100%)`;
    btn.onclick = () => {
      pending = key;
      container.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('theme-swatch-active'));
      btn.classList.add('theme-swatch-active');
    };
    container.appendChild(btn);
  });

  document.getElementById('save-theme-button').onclick = () => {
    localStorage.setItem('cc-theme', pending);
    window.location.reload();
  };
}



// Announcements badge on home page
document.getElementById('announcements-home-button').addEventListener('click', async () => {
  const user = await authReady;
  window.location.href = user ? 'global_announcements.html' : 'login.html';
});

async function getTotalUnreadAnnouncementsAcrossClubs(userId) {
  if (!userId) return 0;
  try {
    // Get all clubs
    const clubsSnap = await getDocs(collection(db, "clubs"));
    let total = 0;

    await Promise.all(clubsSnap.docs.map(async (clubDoc) => {
      try {
        const clubId = clubDoc.id;
        const memberDocRef = doc(db, "clubs", clubId, "members", userId);
        const memberSnap = await getDoc(memberDocRef);
        if (!memberSnap.exists()) return;

        const memberData = memberSnap.data();
        const cutoff = memberData.lastSeenAnnouncements || memberData.joinedAt;
        if (!cutoff) return;

        const announcementsRef = collection(db, "clubs", clubId, "announcements");
        const q = query(
          announcementsRef,
          where("createdAt", ">", cutoff),
          where("createdByUid", "!=", userId)
        );
        const snap = await getCountFromServer(q);
        total += snap.data().count;
      } catch (e) {
        console.warn(`Skipping club for unread count:`, e);
      }
    }));

    return total;
  } catch (e) {
    console.error("Error getting total unread announcements:", e);
    return 0;
  }
}

function updateHomeAnnouncementsBadge(count) {
  const badge = document.getElementById('homeUnreadAnnouncementsBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

authReady.then(async (user) => {
  if (!user) return;
  const count = await getTotalUnreadAnnouncementsAcrossClubs(user.uid);
  updateHomeAnnouncementsBadge(count);
});
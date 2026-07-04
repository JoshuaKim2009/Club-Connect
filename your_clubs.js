import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';
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
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const ACCENT = {
  manager: '#1c375f',
  admin:   '#5480c4',
  member:  '#6c747a',
};

let currentUser = null;
let cardIndex = 0;

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


onAuthStateChanged(auth, (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    loadAllClubs();
});



function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}


function buildCardHTML(clubName, roleLabel, memberCount) {
  return `
    <div class="cc-card-inner">
      <div class="cc-card-body">
        <span class="club-card-name">${clubName}</span>
        <div class="cc-card-meta-row">
          <span class="club-role-pill">${roleLabel}</span>
          <span class="club-card-meta">
            <i class="fa-solid fa-users"></i>
            ${memberCount}
          </span>
        </div>
      </div>
    </div>
  `;
}

async function loadAllClubs() {
    const container = document.getElementById("clubContainer");
    try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
            showNoClubsCard(container);
            return;
        }

        const userData = userDocSnap.data();
        const managedClubs = userData.managed_clubs || [];
        const memberClubs  = userData.member_clubs  || [];
        const adminClubs   = new Set(userData.admin_clubs || []);

        const [managedSnaps, memberSnaps] = await Promise.all([
            Promise.all(managedClubs.map(id => getDoc(doc(db, "clubs", id)))),
            Promise.all(memberClubs.map(id => getDoc(doc(db, "clubs", id))))
        ]);

        container.innerHTML = '';
        cardIndex = 0;

        managedSnaps.forEach((snap, i) => {
            if (!snap.exists()) return;
            const data = snap.data();
            const memberCount = (data.memberUIDs || []).length;

            const btn = document.createElement("button");
            btn.className = "club-btn";
            btn.dataset.clubId = managedClubs[i];
            btn.style.animationDelay = `${cardIndex * 100}ms`;
            btn.style.setProperty('--accent', ACCENT.manager);
            btn.innerHTML = buildCardHTML(data.clubName, ROLE_LABELS.manager, memberCount);
            btn.addEventListener("click", () => {
                window.location.href = `club_page_manager.html?id=${managedClubs[i]}`;
            });

            container.appendChild(btn);
            cardIndex++;
        });

        const memberClubsWithRoles = memberSnaps
            .map((snap, i) => ({
                snap,
                role: adminClubs.has(memberClubs[i]) ? 'admin' : 'member',
                id: memberClubs[i]
            }))
            .sort((a, b) => {
                if (a.role === 'admin' && b.role !== 'admin') return -1;
                if (a.role !== 'admin' && b.role === 'admin') return 1;
                return 0;
            });

        memberClubsWithRoles.forEach(({ snap, role, id }) => {
            if (!snap.exists()) return;

            const data = snap.data();
            const memberCount = (data.memberUIDs || []).length;
            const accentColor = ACCENT[role] || ACCENT.member;

            const btn = document.createElement("button");
            btn.className = "club-btn member-club-btn";
            btn.dataset.clubId = id;
            btn.dataset.userRole = role;
            btn.style.animationDelay = `${cardIndex * 100}ms`;
            btn.style.setProperty('--accent', accentColor);
            btn.innerHTML = buildCardHTML(data.clubName, getRoleLabel(role), memberCount);
            btn.addEventListener("click", async () => {
                if (role === 'manager' || role === 'admin') {
                    window.location.href = `club_page_manager.html?id=${id}`;
                } else {
                    window.location.href = `club_page_member.html?id=${id}`;
                }
            });

            container.appendChild(btn);
            cardIndex++;
        });

        if (container.children.length === 0) showNoClubsCard(container);
        hideLoadingScreen();
    } catch (error) {
        console.error("Error loading clubs:", error);
        showContainerError("Oops! Something went wrong.", true);
        hideLoadingScreen();
    }
}



function showNoClubsCard(container) {
  const card = document.createElement("div");
  card.className = "no-clubs-card";

  card.innerHTML = `
    <div class="cc-card-inner">
        <div class="cc-card-body">
        <span class="club-card-name">No Clubs Yet</span>
        <div class="cc-card-meta-row">
            <div style="display:flex; gap:8px;">
              <span class="club-role-pill" id="joinPill" style="--accent:#5f6b78; cursor:pointer;">Join one</span>
              <span class="club-role-pill" id="createPill" style="--accent:#5f6b78; cursor:pointer;">Create one</span>
            </div>
        </div>
        </div>
    </div>
  `;

  container.appendChild(card);
  document.getElementById("managed-section").style.display = "block";

  card.querySelector("#joinPill").addEventListener("click", () => {
    window.location.href = "join_club.html";
  });

  card.querySelector("#createPill").addEventListener("click", () => {
    window.location.href = "create_club.html";
  });
}
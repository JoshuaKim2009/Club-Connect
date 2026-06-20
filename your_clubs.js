import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';

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

// Role accent colors — left stripe + pill background
const ACCENT = {
  manager: '#1c375f',
  admin:   '#5480c4',
  member:  '#6c747a',
};

let currentUser = null;
let cardIndex = 0;



onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        console.log("Auth state changed: User is logged in.", user.uid);
        loadAllClubs();
    } else {
        console.log("Auth state changed: No user is logged in.");
        document.getElementById("clubContainer").innerHTML = "";
        document.getElementById("memberClubContainer").innerHTML = "";

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 0);
    }
});



function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) {
        console.warn("getMemberRoleForClub: clubId or uid is missing.");
        return null;
    }

    const cacheKey = `role_${clubId}_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        const memberRoleSnap = await getDoc(memberRoleRef);

        let role;
        if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
            role = memberRoleSnap.data().role;
        } else {
            const clubRef = doc(db, "clubs", clubId);
            const clubSnap = await getDoc(clubRef);
            role = (clubSnap.exists() && clubSnap.data().managerUid === uid) ? 'manager' : 'member';
        }

        sessionStorage.setItem(cacheKey, role);
        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
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

    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) return;

    const userData = userDocSnap.data();
    const managedClubs = userData.managed_clubs || [];
    const memberClubs  = userData.member_clubs  || [];

    const [managedSnaps, memberSnaps, roles] = await Promise.all([
        Promise.all(managedClubs.map(id => getDoc(doc(db, "clubs", id)))),
        Promise.all(memberClubs.map(id => getDoc(doc(db, "clubs", id)))),
        Promise.all(memberClubs.map(id => getMemberRoleForClub(id, currentUser.uid)))
    ]); 

    container.innerHTML = '';
    cardIndex = 0;

    //Managed clubs
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

    //Member clubs
    const memberClubsSorted = memberSnaps
        .map((snap, i) => ({ snap, role: roles[i], id: memberClubs[i] }))
        .sort((a, b) => {
            if (a.role === 'admin' && b.role !== 'admin') return -1;
            if (a.role !== 'admin' && b.role === 'admin') return 1;
            return 0;
        });

    memberClubsSorted.forEach(({ snap, role, id }) => {
        if (!snap.exists()) return;
        if (!role) return;

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

    if (container.children.length === 0) {
        showNoClubsCard(container);
    }
    document.getElementById("clubs-spinner").style.display = "none";
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
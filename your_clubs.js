import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const auth = getAuth(app);
const db = getFirestore(app);

// Role accent colors — left stripe + pill background
const ACCENT = {
  manager: '#1c375f',   // app navy  — authoritative
  admin:   '#ce4141',   // amber     — elevated
  member:  '#5f6b78',   // slate     — standard
};

let currentUser = null;
let userDocRef = null;
let unsubscribeUserDoc = null;
let cardIndex = 0;



onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        console.log("Auth state changed: User is logged in.", user.uid);
        userDocRef = doc(db, "users", currentUser.uid);
        setupRealtimeClubUpdates();
    } else {
        console.log("Auth state changed: No user is logged in.");
        document.getElementById("clubContainer").innerHTML = "";
        document.getElementById("memberClubContainer").innerHTML = "";

        if (unsubscribeUserDoc) {
            unsubscribeUserDoc();
            unsubscribeUserDoc = null;
        }
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 0);
    }
});



function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function getMemberRoleForClub(clubID, memberUid) {
  if (!clubID || !memberUid) {
    console.warn("getMemberRoleForClub: clubID or memberUid is missing.");
    return null;
  }
  try {
    const memberRoleRef = doc(db, "clubs", clubID, "members", memberUid);
    const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef, { source: 'server' });
      if (clubSnap.exists() && clubSnap.data().managerUid === memberUid) {
          return 'manager';
      }
      console.warn(`Role document not found for user ${memberUid} in club ${clubID}. Defaulting to 'member'.`);
      return 'member';
    }
  } catch (error) {
    console.error(`Error fetching role for user ${memberUid} in club ${clubID}:`, error);
    return null;
  }
}


// Builds the inner HTML for a club card.
// accent is injected as a CSS variable so both the left
// stripe (border-left) and the role pill share the same color.
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
    const userDocSnap = await getDoc(userDocRef, { source: 'server' });

    if (!userDocSnap.exists()) return;

    const userData = userDocSnap.data();
    const managedClubs = userData.managed_clubs || [];
    const memberClubs  = userData.member_clubs  || [];

    const [managedSnaps, memberSnaps] = await Promise.all([
        Promise.all(managedClubs.map(id => getDoc(doc(db, "clubs", id)))),
        Promise.all(memberClubs.map(id => getDoc(doc(db, "clubs", id))))
    ]);

    const roles = await Promise.all(
        memberClubs.map(id => getMemberRoleForClub(id, currentUser.uid))
    );

    container.innerHTML = '';
    cardIndex = 0;

    // ── Managed clubs ──────────────────────────────────────
    managedSnaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const memberCount = (data.memberUIDs || []).length;

        const btn = document.createElement("button");
        btn.className = "club-btn";
        btn.dataset.clubId = managedClubs[i];
        btn.style.animationDelay = `${cardIndex * 100}ms`;
        btn.style.setProperty('--accent', ACCENT.manager);

        btn.innerHTML = buildCardHTML(data.clubName, 'Manager', memberCount);

        btn.addEventListener("click", () => {
            window.location.href = `club_page_manager.html?id=${managedClubs[i]}`;
        });

        container.appendChild(btn);
        cardIndex++;
    });

    // ── Member clubs ───────────────────────────────────────
    memberSnaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const role = roles[i];
        if (!role) return;

        const data = snap.data();
        const memberCount = (data.memberUIDs || []).length;
        const accentColor = ACCENT[role] || ACCENT.member;

        const btn = document.createElement("button");
        btn.className = "club-btn member-club-btn";
        btn.dataset.clubId = memberClubs[i];
        btn.dataset.userRole = role;
        btn.style.animationDelay = `${cardIndex * 100}ms`;
        btn.style.setProperty('--accent', accentColor);

        btn.innerHTML = buildCardHTML(data.clubName, capitalizeFirstLetter(role), memberCount);

        btn.addEventListener("click", async () => {
            if (role === 'manager' || role === 'admin') {
                window.location.href = `club_page_manager.html?id=${memberClubs[i]}`;
            } else {
                window.location.href = `club_page_member.html?id=${memberClubs[i]}`;
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


function setupRealtimeClubUpdates() {
    if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
    }

    unsubscribeUserDoc = onSnapshot(userDocRef, (userDocSnap) => {
        console.log("User document updated in real-time. Refreshing club lists.");
        loadAllClubs();
    }, (error) => {
        console.error("Error listening to user document for club updates:", error);
        showAppAlert("Real-time club updates failed: " + error.message);
    });
}


function showNoClubsCard(container) {
  const card = document.createElement("div");
  card.className = "no-clubs-card";

  card.innerHTML = `
    <div class="cc-card-inner">
        <div class="cc-card-body">
        <span class="club-card-name">No Clubs Yet</span>
        <div class="cc-card-meta-row">
            <span class="club-role-pill" style="--accent:#5f6b78;">Join or create one</span>
        </div>
        </div>
    </div>
  `;

  container.appendChild(card);
  document.getElementById("managed-section").style.display = "block";
}
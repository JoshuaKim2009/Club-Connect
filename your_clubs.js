import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// You'll need getAuth and onAuthStateChanged to get the current user
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
// You'll need getFirestore, doc, and getDoc to fetch user and club documents
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

let clubNames = []; 
let clubIds = [];
let currentUser = null;
let memberClubNames = [];
let memberClubIds = [];
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
        clubNames = []; 
        clubIds = [];
        document.getElementById("clubContainer").innerHTML = ""; 

        memberClubNames = [];
        memberClubIds = [];
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


async function loadAllClubs() {
    const container = document.getElementById("clubContainer");
    
    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef, { source: 'server' });
    
    if (!userDocSnap.exists()) return;
    
    const userData = userDocSnap.data();
    const managedClubs = userData.managed_clubs || [];
    const memberClubs = userData.member_clubs || [];
    
    const [managedSnaps, memberSnaps] = await Promise.all([
        Promise.all(managedClubs.map(id => getDoc(doc(db, "clubs", id)))),
        Promise.all(memberClubs.map(id => getDoc(doc(db, "clubs", id))))
    ]);

    const roles = await Promise.all(
        memberClubs.map(id => getMemberRoleForClub(id, currentUser.uid))
    );

    container.innerHTML = '';

    managedSnaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const btn = document.createElement("button");
        btn.className = "club-btn fancy-button";
        btn.dataset.clubId = managedClubs[i];

        const inner = document.createElement("div");
        inner.className = "club-btn-inner";

        const nameSpan = document.createElement("span");
        nameSpan.className = "club-btn-name";
        nameSpan.textContent = data.clubName;

        const roleSpan = document.createElement("span");
        roleSpan.className = "club-role-text";
        roleSpan.textContent = "Manager";

        const metaDiv = document.createElement("div");
        metaDiv.className = "club-btn-meta";
        metaDiv.textContent = `${(data.memberUIDs || []).length} members`;

        inner.appendChild(nameSpan);
        inner.appendChild(roleSpan);
        inner.appendChild(metaDiv);
        btn.appendChild(inner);
        btn.addEventListener("click", () => {
            window.location.href = `club_page_manager.html?id=${managedClubs[i]}`;
        });
        container.appendChild(btn);
        btn.style.animationDelay = `${cardIndex * 150}ms`;
        cardIndex++;
    });

    memberSnaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const role = roles[i];
        if (!role) return;
        const data = snap.data();
        const btn = document.createElement("button");
        btn.className = "club-btn fancy-button member-club-btn";
        btn.dataset.clubId = memberClubs[i];
        btn.dataset.userRole = role;

        const inner = document.createElement("div");
        inner.className = "club-btn-inner";

        const nameSpan = document.createElement("span");
        nameSpan.className = "club-btn-name";
        nameSpan.textContent = data.clubName;

        const roleSpan = document.createElement("span");
        roleSpan.className = "club-role-text";
        roleSpan.textContent = capitalizeFirstLetter(role);

        const metaDiv = document.createElement("div");
        metaDiv.className = "club-btn-meta";
        metaDiv.textContent = `${(data.memberUIDs || []).length} members`;

        inner.appendChild(nameSpan);
        inner.appendChild(roleSpan);
        inner.appendChild(metaDiv);
        btn.appendChild(inner);
        btn.addEventListener("click", async () => {
            if (role === 'manager' || role === 'admin') {
                window.location.href = `club_page_manager.html?id=${memberClubs[i]}`;
            } else {
                window.location.href = `club_page_member.html?id=${memberClubs[i]}`;
            }
        });
        container.appendChild(btn);
        btn.style.animationDelay = `${cardIndex * 150}ms`;
        cardIndex++;
    });

    // if (container.children.length === 0) {
    //   const p = document.createElement("p");
    //   p.className = "fancy-label";
    //   p.textContent = "NO CLUBS YET";
    //   container.appendChild(p);
    // }
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

  const inner = document.createElement("div");
  inner.className = "club-btn-inner";

  const nameSpan = document.createElement("span");
  nameSpan.className = "club-btn-name";
  nameSpan.textContent = "NO CLUBS YET";

  const roleSpan = document.createElement("span");
  roleSpan.className = "club-role-text";
  roleSpan.textContent = "Join or create a club to get started";

  const metaDiv = document.createElement("div");
  metaDiv.className = "no-clubs-card-meta";

  const findBtn = document.createElement("button");
  findBtn.className = "fancy-black-button";
  findBtn.textContent = "FIND CLUBS";
  findBtn.addEventListener("click", () => {
    window.location.href = "join_club.html";
  });

  metaDiv.appendChild(roleSpan);
  metaDiv.appendChild(findBtn);

  inner.appendChild(nameSpan);
  inner.appendChild(metaDiv);
  card.appendChild(inner);
  container.appendChild(card);
}
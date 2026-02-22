// club_discovery.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

let currentUser = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log("User authenticated:", currentUser.uid);
    } else {
        console.log("No user authenticated. Redirecting to login.");
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    }
});


document.getElementById("createClubForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const school = normalizeSearchInput(document.getElementById("searchSchool").value);
    const state  = document.getElementById("searchState").value.trim();
    const club   = document.getElementById("searchClub").value.trim();

    const clubsGrid = document.getElementById("clubsGrid");
    clubsGrid.innerHTML = '<p class="no-results">SEARCHING...</p>';

    if (!state) {
        clubsGrid.innerHTML = "";
        await showAppAlert("Please enter a state to search.");
        return;
    }

    if (!school) {
        clubsGrid.innerHTML = "";
        await showAppAlert("Please enter a school to search.");
        return;
    }
    
    const clubsRef = collection(db, "clubs");
    const constraints = [];

    if (state)  constraints.push(where("stateLower", "==", state.toLowerCase()));
    // if (school) constraints.push(where("schoolNameLower", "==", school.toLowerCase()));
    if (club)   constraints.push(where("clubNameLower", "==", club.toLowerCase()));

    if (constraints.length === 0) {
        clubsGrid.innerHTML = "";
        await showAppAlert("Please enter at least one search field.");
        return;
    }

    try {
        const q = query(clubsRef, ...constraints);
        const snapshot = await getDocs(q);

        clubsGrid.innerHTML = "";

        if (snapshot.empty) {
            await showAppAlert("No clubs found matching your search.");
            return;
        }

        const matches = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            const searchableName   = data.clubNameLower   ?? data.clubName?.toLowerCase()   ?? "";
            const searchableSchool = data.schoolNameLower ?? data.schoolName?.toLowerCase() ?? "";
            const searchableState  = data.stateLower      ?? data.state?.toLowerCase()      ?? "";

            const matchesClub   = !club   || searchableName.includes(club.toLowerCase());
            const matchesSchool = !school || searchableSchool.includes(school.toLowerCase());
            const matchesState  = !state  || searchableState.includes(state.toLowerCase());

            if (matchesClub && matchesSchool && matchesState) {
                matches.push({ id: docSnap.id, ...data });
            }
        });

        matches.sort((a, b) => (b.memberUIDs?.length ?? 0) - (a.memberUIDs?.length ?? 0));

        if (matches.length === 0) {
            await showAppAlert("No clubs found matching your search.");
            return;
        }

        matches.forEach(data => {
            createClubCard(data.id, data.clubName, data.schoolName, data.state, data.clubActivity, data.description, data.joinCode, data.pendingMemberUIDs || [], data.memberUIDs || []);
        });

    } catch (error) {
        await showAppAlert("Error searching clubs. Please try again.");
    }
});




function createClubCard(clubId, clubName, schoolName, state, activity, description, joinCode, pendingMemberUIDs, memberUIDs) {
    const isPending = currentUser && pendingMemberUIDs.includes(currentUser.uid);
    const isMember  = currentUser && memberUIDs.includes(currentUser.uid);

    const card = document.createElement("div");
    card.className = "club-card";
    card.innerHTML = `
        <div class="club-card-header">
            <span class="club-card-name">${clubName}</span>
            <span class="club-card-activity">Activity | ${activity}</span>
        </div>
        <div class="club-card-body">
            <span><i class="fa-solid fa-school"></i> School | ${schoolName}</span>
            <span><i class="fa-solid fa-location-dot"></i> State | ${state}</span>
            <p class="club-description">${description}</p>
        </div>
        <button class="club-join-btn fancy-button" data-club-id="${clubId}" data-join-code="${joinCode}" ${isPending || isMember ? "disabled" : ""}>
            ${isMember ? "JOINED" : isPending ? "SENT" : "REQUEST TO JOIN"}
        </button>
    `;
    document.getElementById("clubsGrid").appendChild(card);
}


document.getElementById("clubsGrid").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!e.target.classList.contains("club-join-btn")) return;

    if (!currentUser) {
        await showAppAlert("You must be logged in to join a club.");
        return;
    }

    const clubId   = e.target.dataset.clubId;
    const clubRef  = doc(db, "clubs", clubId);
    const clubSnap = await getDoc(clubRef);

    if (!clubSnap.exists()) {
        await showAppAlert("Club not found.");
        return;
    }

    const clubData = clubSnap.data();

    if (clubData.managerUid === currentUser.uid) {
        await showAppAlert("You are the manager of this club.");
        return;
    }
    if ((clubData.memberUIDs || []).includes(currentUser.uid)) {
        await showAppAlert("You are already a member of this club.");
        return;
    }
    if ((clubData.pendingMemberUIDs || []).includes(currentUser.uid)) {
        await showAppAlert("You have already sent a join request for this club.");
        return;
    }

    await updateDoc(clubRef, { pendingMemberUIDs: arrayUnion(currentUser.uid) });
    await showAppAlert("Join request sent!");
});


function normalizeSearchInput(input) {
    let s = input.trim().toLowerCase();
    if (s.endsWith(' hs'))  s = s.slice(0, -3) + ' high school';
    if (s.endsWith(' ms'))  s = s.slice(0, -3) + ' middle school';
    if (s.endsWith(' es'))  s = s.slice(0, -3) + ' elementary school';
    if (s.endsWith(' h.s.')) s = s.slice(0, -5) + ' high school';
    if (s.endsWith(' m.s.')) s = s.slice(0, -5) + ' middle school';
    if (s.endsWith(' e.s.'))  s = s.slice(0, -5) + ' elementary school';
    if (s.endsWith(' h.s'))  s = s.slice(0, -4) + ' high school';
    if (s.endsWith(' m.s'))  s = s.slice(0, -4) + ' middle school';
    if (s.endsWith(' e.s'))  s = s.slice(0, -4) + ' elementary school';
    if (s.endsWith(' high'))  s = s + ' school';
    if (s.endsWith(' middle'))  s = s + ' school';
    if (s.endsWith(' elementary')) s = s + ' school';
    return s;
}

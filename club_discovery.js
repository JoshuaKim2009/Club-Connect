// club_discovery.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

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

    const school = document.getElementById("searchSchool").value.trim();
    const state  = document.getElementById("searchState").value.trim();
    const club   = document.getElementById("searchClub").value.trim();

    const clubsGrid = document.getElementById("clubsGrid");
    clubsGrid.innerHTML = '<p class="no-results">Searching...</p>';

    
    const clubsRef = collection(db, "clubs");
    const constraints = [];

    if (state)  constraints.push(where("stateLower", "==", state.toLowerCase()));
    if (school) constraints.push(where("schoolNameLower", "==", school.toLowerCase()));
    if (club)   constraints.push(where("clubNameLower",   "==", club.toLowerCase()));

    if (constraints.length === 0) {
        clubsGrid.innerHTML = '<p class="no-results">Please enter at least one search field.</p>';
        return;
    }

    try {
        const q = query(clubsRef, ...constraints);
        const snapshot = await getDocs(q);

        clubsGrid.innerHTML = "";

        if (snapshot.empty) {
            clubsGrid.innerHTML = '<p class="no-results">No clubs found matching your search.</p>';
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
            clubsGrid.innerHTML = '<p class="no-results">No clubs found matching your search.</p>';
            return;
        }

        matches.forEach(data => {
            createClubCard(data.id, data.clubName, data.schoolName, data.state, data.clubActivity, data.description, data.joinCode);
        });

    } catch (error) {
        clubsGrid.innerHTML = '<p class="no-results">Error searching clubs. Please try again.</p>';
    }
});




function createClubCard(clubId, clubName, schoolName, state, activity, description, joinCode) {
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
        <button class="club-join-btn fancy-button" data-club-id="${clubId}" data-join-code="${joinCode}">
            REQUEST TO JOIN
        </button>
    `;
    document.getElementById("clubsGrid").appendChild(card);
}
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

const CLUB_CATEGORIES = [
  'Academic', 'Activism', 'Athletics', 'Business', 'Community Service',
  'Culture & Identity', 'Fine Arts', 'Health & Wellness', 'Hobbies',
  'Honor Societies', 'Language', 'Leadership', 'Literature', 'Media',
  'STEM', 'Social Studies', 'Speech', 'Student Government', 'Other'
];

const categoryInput = document.getElementById("searchCategory");
const categoryDropdownList = document.getElementById("category-dropdown-list");

function buildCategoryDropdown() {
  categoryDropdownList.innerHTML = '';
  const allDiv = document.createElement('div');
  allDiv.className = 'state-option';
  allDiv.textContent = 'All Categories';
  allDiv.onclick = () => {
    categoryInput.value = '';
    categoryInput.placeholder = 'All Categories';
    categoryDropdownList.classList.remove('show');
  };
  categoryDropdownList.appendChild(allDiv);

  CLUB_CATEGORIES.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'state-option';
    div.textContent = cat;
    div.onclick = () => {
      categoryInput.value = cat;
      categoryDropdownList.classList.remove('show');
    };
    categoryDropdownList.appendChild(div);
  });
}

buildCategoryDropdown();

categoryInput.addEventListener('click', function() {
  buildCategoryDropdown();
  categoryDropdownList.classList.toggle('show');
});

document.addEventListener('click', function(e) {
  if (!categoryInput.contains(e.target) && !categoryDropdownList.contains(e.target)) {
    categoryDropdownList.classList.remove('show');
  }
});

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

    const clubsGrid = document.getElementById("clubsGrid");

    const school = normalizeSearchInput(document.getElementById("searchSchool").value);
    const rawState = document.getElementById("searchState").value.trim();
    const state = normalizeState(rawState);
    const selectedCategory = categoryInput.value;

    if (!state) {
        clubsGrid.innerHTML = "";
        await showAppAlert("Please enter a valid US state.");
        return;
    }
    const club = "";

    clubsGrid.innerHTML = '<p class="no-results">SEARCHING <i class="fa-solid fa-magnifying-glass" style="font-size: 0.9em; margin-left: 8px;"></i> </p>';

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

            const matchesCategory = !selectedCategory || (data.categoryLower ?? data.category?.toLowerCase() ?? '') === selectedCategory.toLowerCase();

            const isPublic = (data.visibility ?? 'public') !== 'private';

            if (matchesClub && matchesSchool && matchesState && isPublic && matchesCategory) {
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
            <span class="club-card-activity">${activity}</span>
        </div>
        <div class="club-card-body">
            <span><i class="fa-solid fa-school"></i> ${schoolName}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${state}</span>
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

    e.target.textContent = "SENT";
    e.target.disabled = true;
    await updateDoc(clubRef, { pendingMemberUIDs: arrayUnion(currentUser.uid) });
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


const states = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

const stateInput = document.getElementById('searchState');
const stateDropdownList = document.getElementById('state-dropdown-list');

stateInput.addEventListener('input', function () {
    const value = this.value.toLowerCase();
    stateDropdownList.innerHTML = '';

    if (value) {
        const filtered = states.filter(state => state.toLowerCase().includes(value));
        if (filtered.length > 0) {
            filtered.forEach(state => {
                const div = document.createElement('div');
                div.className = 'state-option';
                div.textContent = state;
                div.onclick = () => {
                    stateInput.value = state;
                    stateDropdownList.classList.remove('show');
                };
                stateDropdownList.appendChild(div);
            });
            stateDropdownList.classList.add('show');
        } else {
            stateDropdownList.classList.remove('show');
        }
    } else {
        stateDropdownList.classList.remove('show');
    }
});

document.addEventListener('click', function (e) {
    if (!stateInput.contains(e.target) && !stateDropdownList.contains(e.target)) {
        stateDropdownList.classList.remove('show');
    }
});


function normalizeState(input) {
    const trimmed = input.trim();

    const abbreviations = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming'
    };

    const fromAbbr = abbreviations[trimmed.toUpperCase()];
    if (fromAbbr) return fromAbbr;

    const matched = states.find(s => s.toLowerCase() === trimmed.toLowerCase());
    return matched || null;
}
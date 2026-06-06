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
  'Academic',
  'Activism',
  'Athletics',
  'Art',
  'Business',
  'Community Service',
  'Culture & Identity',
  'Health & Wellness',
  'Hobbies',
  'Honor Societies',
  'Humanities',
  'Language',
  'Leadership',
  'Literature',
  'Media',
  'Other',
  'Public Speaking',
  'STEM',
  'Student Government'
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
    const selectedCounty = countySearchInput.value.trim().toLowerCase();

    saveSearch(stateInput.value.trim(), countySearchInput.value.trim(), document.getElementById("searchSchool").value.trim(), selectedCategory);

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
            const matchesCounty = !selectedCounty || (data.countyName ?? '').toLowerCase().includes(selectedCounty);

            const isPublic = (data.visibility ?? 'public') !== 'private';

            if (matchesClub && matchesSchool && matchesState && isPublic && matchesCategory && matchesCounty) {
                matches.push({ id: docSnap.id, ...data });
            }
        });

        matches.sort((a, b) => (b.memberUIDs?.length ?? 0) - (a.memberUIDs?.length ?? 0));

        if (matches.length === 0) {
            await showAppAlert("No clubs found matching your search.");
            return;
        }

        matches.forEach(data => {
            createClubCard(data.id, data.clubName || 'Unnamed Club', data.schoolName || 'Unknown School', data.state || '', data.countyName || '', data.clubActivity || '', data.description || '', data.joinCode || '', data.pendingMemberUIDs || [], data.memberUIDs || [], data.clubSponsor || '');
        });

    } catch (error) {
        await showAppAlert("Error searching clubs. Please try again.");
    }
});


function createClubCard(clubId, clubName, schoolName, state, countyName, activity, description, joinCode, pendingMemberUIDs, memberUIDs, clubSponsor) {
    const isPending = currentUser && pendingMemberUIDs.includes(currentUser.uid);
    const isMember  = currentUser && memberUIDs.includes(currentUser.uid);
    const stateAbbrev = Object.keys(STATE_ABBREVS).find(k => STATE_ABBREVS[k] === state) || state;

    const card = document.createElement("div");
    card.className = "club-card";
    card.innerHTML = `
        <div class="club-card-header">
            <span class="club-card-name">${clubName}</span>
            <span class="club-card-activity">${activity}</span>
        </div>
        <div class="club-card-body">
            <span><i class="fa-solid fa-school"></i> ${schoolName}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${NO_COUNTY_STATES[state] ? state : countyName ? `${countyName}, ${stateAbbrev}` : state}</span>
            ${clubSponsor ? `<span class="club-sponsor"><i class="fa-solid fa-user"></i> Sponsor: ${clubSponsor}</span>` : ''}
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


const states = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','Puerto Rico','Guam','U.S. Virgin Islands','American Samoa','Northern Mariana Islands'];

const NO_COUNTY_STATES = {
	'District of Columbia': true,
	'Puerto Rico': true,
	'Guam': true,
	'U.S. Virgin Islands': true,
	'American Samoa': true,
	'Northern Mariana Islands': true,
};
const stateInput = document.getElementById('searchState');
const stateDropdownList = document.getElementById('state-dropdown-list');
const countySearchInput = document.getElementById('searchCounty');
const countySearchDropdown = document.getElementById('county-dropdown-list-search');
const countySearchSection = document.getElementById('county-search-section');

stateInput.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	stateDropdownList.innerHTML = '';

	const fullNameMatch = states.find(s => s.toLowerCase() === this.value.trim().toLowerCase());
	updateCountySearchVisibility(fullNameMatch || null);
	if (!fullNameMatch) countySearchInput.value = '';

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
					countySearchInput.value = '';
					updateCountySearchVisibility(state);
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

const STATE_ABBREVS = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
    'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
    'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
    'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
    'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi',
    'MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire',
    'NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina',
    'ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania',
    'RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee',
    'TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington',
    'WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
    'DC':'District of Columbia','D.C.':'District of Columbia',
};

function normalizeState(input) {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const upper = trimmed.toUpperCase();

	if (trimmed.length === 2) {
		const abbrev = STATE_ABBREVS[upper];
		if (abbrev) return abbrev;
	}
	if (upper === 'D.C.') return 'District of Columbia';

	const stripped = trimmed.toLowerCase().replace(/[,.]/g, '').replace(/\s+/g, ' ').trim();
	if (
		stripped === 'washington dc' ||
		stripped === 'washington d c' ||
		stripped === 'washington district of columbia' ||
		stripped === 'district of columbia'
	) return 'District of Columbia';

	return states.find(s => s.toLowerCase() === trimmed.toLowerCase()) || null;
}




let SEARCH_COUNTIES = [];
fetch('counties.json')
	.then(res => res.json())
	.then(data => {
		SEARCH_COUNTIES = data.map(c => ({ fips: c.A, state: c.B, name: c.C }));
		restoreSavedSearch();
	})
	.catch(() => {
		restoreSavedSearch();
	});

function updateCountySearchVisibility(stateName) {
	if (!stateName || NO_COUNTY_STATES[stateName]) {
		countySearchSection.style.display = 'none';
		countySearchInput.value = '';
	} else {
		countySearchSection.style.display = '';
	}
}

countySearchInput.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	const currentState = normalizeState(stateInput.value.trim());
	countySearchDropdown.innerHTML = '';

	let pool = currentState
		? SEARCH_COUNTIES.filter(c => c.state === currentState)
		: SEARCH_COUNTIES;

	if (value) pool = pool.filter(c => c.name.toLowerCase().includes(value));

	if (pool.length > 0) {
		pool.forEach(county => {
			const div = document.createElement('div');
			div.className = 'state-option';
			div.textContent = county.name;
			div.onclick = () => {
				countySearchInput.value = county.name;
				countySearchDropdown.classList.remove('show');
			};
			countySearchDropdown.appendChild(div);
		});
		countySearchDropdown.classList.add('show');
	} else {
		countySearchDropdown.classList.remove('show');
	}
});

document.addEventListener('click', function(e) {
	if (!countySearchInput.contains(e.target) && !countySearchDropdown.contains(e.target)) {
		countySearchDropdown.classList.remove('show');
	}
});

function saveSearch(state, county, school, category) {
	localStorage.setItem('discoverySearch', JSON.stringify({ state, county, school, category }));
}

function restoreSavedSearch() {
	const saved = localStorage.getItem('discoverySearch');
	if (!saved) return;
	const { state, county, school, category } = JSON.parse(saved);
	if (state) {
		stateInput.value = state;
		updateCountySearchVisibility(state);
	}
	if (county) countySearchInput.value = county;
	if (school) document.getElementById('searchSchool').value = school;
	if (category) {
		categoryInput.value = category;
	}
}
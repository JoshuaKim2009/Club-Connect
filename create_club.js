import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, collection, addDoc, updateDoc, arrayUnion, runTransaction, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { getOrCreateSchool, fetchSchoolsForCounty, normalizeSchoolName, schoolDocId } from './school-utils.js';
import { validateRequiredFields } from './validation-utils.js';
import { getSchoolInfoCache, setSchoolInfoCache } from './school-cache-utils.js';
import { initTagInput } from './tag-input.js';
import { getClubEmbeddings } from './embedding-utils.js';

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
let currentUserEmail = null;
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';

const STATE_ABBREVS = {
	'AL': 'Alabama',
	'AK': 'Alaska',
	'AZ': 'Arizona',
	'AR': 'Arkansas',
	'CA': 'California',
	'CO': 'Colorado',
	'CT': 'Connecticut',
	'DE': 'Delaware',
	'FL': 'Florida',
	'GA': 'Georgia',
	'HI': 'Hawaii',
	'ID': 'Idaho',
	'IL': 'Illinois',
	'IN': 'Indiana',
	'IA': 'Iowa',
	'KS': 'Kansas',
	'KY': 'Kentucky',
	'LA': 'Louisiana',
	'ME': 'Maine',
	'MD': 'Maryland',
	'MA': 'Massachusetts',
	'MI': 'Michigan',
	'MN': 'Minnesota',
	'MS': 'Mississippi',
	'MO': 'Missouri',
	'MT': 'Montana',
	'NE': 'Nebraska',
	'NV': 'Nevada',
	'NH': 'New Hampshire',
	'NJ': 'New Jersey',
	'NM': 'New Mexico',
	'NY': 'New York',
	'NC': 'North Carolina',
	'ND': 'North Dakota',
	'OH': 'Ohio',
	'OK': 'Oklahoma',
	'OR': 'Oregon',
	'PA': 'Pennsylvania',
	'RI': 'Rhode Island',
	'SC': 'South Carolina',
	'SD': 'South Dakota',
	'TN': 'Tennessee',
	'TX': 'Texas',
	'UT': 'Utah',
	'VT': 'Vermont',
	'VA': 'Virginia',
	'WA': 'Washington',
	'WV': 'West Virginia',
	'WI': 'Wisconsin',
	'WY': 'Wyoming',
	'DC': 'District of Columbia',
	'D.C.': 'District of Columbia',
};

let COUNTIES = [];
let CACHED_SCHOOLS = [];
const schoolCacheByCounty = new Map();


const countiesReady = fetch('counties.json')
	.then(res => res.json())
	.then(data => {
		COUNTIES = data.map(c => ({
			fips: c.A,
			state: c.B,
			name: c.C
		}));
	});

async function loadSchoolsFor(state, county) {
	if (!state || !county) {
		CACHED_SCHOOLS = [];
		return;
	}
	const key = `${state}|${county}`;
	if (!schoolCacheByCounty.has(key)) {
		schoolCacheByCounty.set(key, await fetchSchoolsForCounty(db, state, county));
	}
	CACHED_SCHOOLS = schoolCacheByCounty.get(key);
}


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
	'Public Speaking',
	'STEM',
	'Student Government',
	'Other'
];

const categoryInput = document.getElementById("category-select");
const categoryDropdownList = document.getElementById("category-dropdown-list");

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

categoryInput.addEventListener('click', function() {
	categoryDropdownList.classList.toggle('show');
});

document.addEventListener('click', function(e) {
	if (!categoryInput.contains(e.target) && !categoryDropdownList.contains(e.target)) {
		categoryDropdownList.classList.remove('show');
	}
});

function setLoading(btn) {
	btn._origHTML = btn.innerHTML;
	btn.disabled = true;
	btn.innerHTML = '<span class="spinner"></span>';
}

function clearLoading(btn) {
	btn.disabled = false;
	btn.innerHTML = btn._origHTML;
}

onAuthStateChanged(auth, async (user) => {
	if (!handleUserSwitch(user)) {
		if (!user) window.location.href = 'login.html';
		return;
	}
	currentUser = user;
	currentUserEmail = user.email;
	submitButton.disabled = false;

	await applyHomeSchoolInfo(user.uid);

	hideLoadingScreen();
});

async function applyHomeSchoolInfo(uid) {
	let schoolInfo = getSchoolInfoCache(uid);

	if (!schoolInfo) {
		schoolInfo = await fetchSchoolInfoFromFirestore(uid);
		if (schoolInfo) {
			setSchoolInfoCache(uid, schoolInfo);
		}
	}

	if (!schoolInfo) return;

	if (schoolInfo.state) {
		stateInput.value = schoolInfo.state;
		handleCountyVisibility(schoolInfo.state);
	}
	if (schoolInfo.county) {
		countyInput.value = schoolInfo.county;
		await countiesReady;
		const matchedCounty = COUNTIES.find(c => c.state === schoolInfo.state && c.name === schoolInfo.county);
		if (matchedCounty) {
			selectedCountyFips = matchedCounty.fips;
		}
	}
	if (schoolInfo.state && schoolInfo.county) {
		await loadSchoolsFor(schoolInfo.state, schoolInfo.county);
	}
	if (schoolInfo.school) {
		schoolNameInput.value = schoolInfo.school;
	}
}

async function fetchSchoolInfoFromFirestore(uid) {
	try {
		const userSnap = await getDoc(doc(db, "users", uid));
		if (userSnap.exists()) {
			const data = userSnap.data();
			return {
				state: data.state || '',
				county: data.county || '',
				school: data.school || ''
			};
		}
	} catch (e) {
		console.error("Could not prefill school info:", e);
	}
	return null;
}

function hideLoadingScreen() {
	const overlay = document.getElementById('loading-overlay');
	const content = document.getElementById('content');
	if (overlay) {
		overlay.classList.add('hidden');
		document.body.classList.remove('no-scroll');
		overlay.addEventListener('transitionend', () => {
			if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
		}, {
			once: true
		});
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

document.body.classList.add('no-scroll');

const submitButton = document.getElementById("submit-club-button");
const schoolNameInput = document.getElementById("school-name-select");
const clubNameInput = document.getElementById("club-name-select");
const clubDescriptionInput = document.getElementById("description-input");
const clubSponsorInput = document.getElementById("sponsor-select");
const clubLeaderInput = document.getElementById("club-leader-select");
const schoolEmailInput = document.getElementById("school-email-select");
const roomNumberInput = document.getElementById("room-number-select");
const meetingScheduleInput = document.getElementById("meeting-schedule-select");
const stateInput = document.getElementById("state-select");
const countyInput = document.getElementById("county-select");
const countyDropdownList = document.getElementById("county-dropdown-list");
const clubTopicsField = document.getElementById("club-topics-select");
const topicsInput = initTagInput(clubTopicsField);

countyInput.closest('.club-form-section').style.display = 'none';

let selectedCountyFips = null;


const createVisStrips = document.querySelectorAll('#visibility-strip-group-create .club-vis-strip');
createVisStrips.forEach(strip => {
	strip.addEventListener('click', () => {
		createVisStrips.forEach(s => s.classList.remove('club-vis-strip-selected'));
		strip.classList.add('club-vis-strip-selected');
	});
});

function getSelectedVisibility(groupId) {
	const selected = document.querySelector(`#${groupId} .club-vis-strip-selected`);
	return selected ? selected.dataset.value : null;
}


const TOTAL_CLUB_STEPS = 4;
let currentClubStep = 1;

const clubStepEls = [1, 2, 3, 4].map(n => document.getElementById(`club-step-${n}`));
const clubStepDots = [1, 2, 3, 4].map(n => document.getElementById(`club-dot-${n}`));
const clubStepConns = [1, 2, 3].map(n => document.getElementById(`club-conn-${n}`));
const clubStepSubtitle = document.getElementById('club-step-subtitle');
const backClubStepButton = document.getElementById('back-club-step-button');

const CLUB_STEP_SUBTITLES = {
	1: 'STEP 1 &middot; CLUB BASICS',
	2: 'STEP 2 &middot; ABOUT YOUR CLUB',
	3: 'STEP 3 &middot; OPTIONAL INFO',
	4: 'STEP 4 &middot; CLUB VISIBILITY',
};

function getStepRequiredFields(step) {
	const state = stateInput.value.trim();
	const normalizedState = normalizeState(state);
	const countyRequired = state && !(normalizedState && NO_COUNTY_STATES[normalizedState]);

	if (step === 1) {
		const fields = [{
				label: "Club Name",
				value: clubNameInput.value.trim()
			},
			{
				label: "State",
				value: state
			},
			{
				label: "School Name",
				value: schoolNameInput.value.trim()
			},
		];
		if (countyRequired) {
			fields.push({
				label: "County",
				value: countyInput.value.trim()
			});
		}
		return fields;
	}
	if (step === 2) {
		return [{
				label: "Category",
				value: categoryInput.value
			},
			{
				label: "Description",
				value: clubDescriptionInput.value.trim()
			},
		];
	}
	if (step === 4) {
		return [{
			label: "Visibility",
			value: getSelectedVisibility('visibility-strip-group-create')
		}, ];
	}
	return [];
}

function showClubStep(step) {
	clubStepEls.forEach((el, i) => el.classList.toggle('visible', i + 1 === step));
	clubStepSubtitle.innerHTML = CLUB_STEP_SUBTITLES[step];

	clubStepDots.forEach((dot, i) => {
		const n = i + 1;
		dot.classList.remove('active', 'done');
		if (n < step) {
			dot.classList.add('done');
			dot.innerHTML = '<i class="fa-solid fa-check"></i>';
		} else if (n === step) {
			dot.classList.add('active');
			dot.textContent = n;
		} else {
			dot.textContent = n;
		}
	});
	clubStepConns.forEach((conn, i) => conn.classList.toggle('done', i + 1 < step));

	backClubStepButton.classList.toggle('hidden-slot', step === 1);
	submitButton.textContent = step === TOTAL_CLUB_STEPS ? 'CREATE' : 'NEXT';

	window.scrollTo(0, 0);
}

backClubStepButton.addEventListener('click', () => {
	if (currentClubStep > 1) {
		currentClubStep--;
		showClubStep(currentClubStep);
	}
});

showClubStep(currentClubStep);


submitButton.disabled = true;

submitButton.addEventListener("click", async function(event) {
	event.preventDefault();

	if (!currentUser || !currentUser.uid) {
		await showAppAlert("You must be logged in to create a club.");
		console.warn("Attempted club creation by unauthenticated user. Aborting.");
		return;
	}

	if (currentClubStep < TOTAL_CLUB_STEPS) {
		const stepFields = getStepRequiredFields(currentClubStep);
		const stepValid = await validateRequiredFields(stepFields);
		if (!stepValid) return;

		currentClubStep++;
		showClubStep(currentClubStep);
		return;
	}

	const rawSchoolName = schoolNameInput.value.trim();
	const clubName = clubNameInput.value.trim();
	const clubDescription = clubDescriptionInput.value.trim();
	const state = stateInput.value.trim();
	const clubSponsor = clubSponsorInput.value.trim();
	const clubLeader = clubLeaderInput.value.trim();
	const schoolEmail = schoolEmailInput.value.trim();
	const roomNumber = roomNumberInput.value.trim();
	const meetingSchedule = meetingScheduleInput.value.trim();
	const countyName = countyInput.value.trim();
	const countyFips = selectedCountyFips;
	const clubCategory = categoryInput.value;
	const clubTopics = topicsInput.getTags();
	const clubVisibility = getSelectedVisibility('visibility-strip-group-create');

	const normalizedState = normalizeState(state);
	const countyRequired = state && !(normalizedState && NO_COUNTY_STATES[normalizedState]);

	const requiredFields = [{
			label: "Club Name",
			value: clubName
		},
		{
			label: "School Name",
			value: rawSchoolName
		},
		{
			label: "State",
			value: state
		},
		{
			label: "Category",
			value: clubCategory
		},
		{
			label: "Description",
			value: clubDescription
		},
		{
			label: "Visibility",
			value: clubVisibility
		},
	];
	if (countyRequired) {
		requiredFields.push({
			label: "County",
			value: countyName
		});
	}

	const requiredFieldsValid = await validateRequiredFields(requiredFields);
	if (!requiredFieldsValid) return;

	if (clubDescription.length > 1500) {
		await showAppAlert("Description must be 1500 characters or less.");
		return;
	}

	if (!normalizedState) {
		await showAppAlert("Please enter a valid state");
		return;
	}

	const schoolNameResult = normalizeSchoolName(rawSchoolName);
	let schoolName = rawSchoolName;

	if (!schoolNameResult.valid) {
		const confirmed = await showAppConfirm(`"${rawSchoolName}" looks like an abbreviation. Click YES if to continue or NO to correct it.`);
		if (!confirmed) {
			return;
		}
		schoolName = rawSchoolName;
	} else {
		if (schoolNameResult.normalized !== rawSchoolName) {
			const confirmed = await showAppConfirm(`We recommend changing "${rawSchoolName}" to "${schoolNameResult.normalized}". Would you like to use the recommended version?`);
			if (!confirmed) {
				schoolName = rawSchoolName;
			} else {
				schoolName = schoolNameResult.normalized;
			}
		}
	}

	setLoading(submitButton);

	try {
		const joinCode = await getUniqueJoinCode();
		if (!joinCode) {
			await showAppAlert("Failed to generate a unique join code. Please try again.");
			return;
		}
		console.log(`join code: ${joinCode}`);

		const newClubRef = doc(collection(db, "clubs"));
		const newClubId = newClubRef.id;

		const schoolId = schoolDocId(normalizedState, countyName, schoolName);

		const batch1 = writeBatch(db);

		const { descriptionEmbedding, topicsEmbedding } = await getClubEmbeddings({
			description: clubDescription,
			topics: clubTopics
		});

		batch1.set(doc(db, "schools", schoolId), {
			schoolId,
			name: schoolName,
			nameLower: schoolName.toLowerCase(),
			state: normalizedState,
			stateLower: normalizedState.toLowerCase(),
			county: countyName,
			countyLower: countyName.toLowerCase(),
			clubs: arrayUnion({
				id: newClubId,
				name: clubName
			})
		}, {
			merge: true
		});

		batch1.set(newClubRef, {
			schoolName: schoolName,
			schoolId: schoolId,
			state: normalizedState,
			clubName: clubName,
			clubNameLower: clubName.toLowerCase(),
			schoolNameLower: schoolName.toLowerCase(),
			stateLower: normalizedState.toLowerCase(),
			description: clubDescription,
			descriptionEmbedding: descriptionEmbedding,
			topicsEmbedding: topicsEmbedding,
			managerEmail: currentUserEmail,
			joinCode: joinCode,
			memberUIDs: [currentUser.uid],
			memberNames: {
				[currentUser.uid]: currentUser.displayName || "Unknown"
			},
			pendingMemberUIDs: [],
			managerUid: currentUser.uid,
			createdAt: serverTimestamp(),
			visibility: clubVisibility,
			category: clubCategory,
			categoryLower: clubCategory.toLowerCase(),
			topics: clubTopics,
			clubSponsor: clubSponsor,
			clubLeader: clubLeader,
			schoolEmail: schoolEmail,
			roomNumber: roomNumber,
			meetingSchedule: meetingSchedule,
			countyName: countyName,
			countyFips: countyFips || null
		});

		await batch1.commit();

		const batch2 = writeBatch(db);

		batch2.set(doc(db, "clubs", newClubId, "members", currentUser.uid), {
			role: "manager",
			joinedAt: serverTimestamp()
		});

		batch2.update(doc(db, "join_codes", joinCode), {
			clubId: newClubId,
			reserved: false
		});

		batch2.update(doc(db, "users", currentUser.uid), {
			managed_clubs: arrayUnion(newClubId)
		});

		await batch2.commit();

		console.log("Club created with ID: ", newClubId);

    clearLoading(submitButton);

    const step4Dot = document.getElementById('club-dot-4');

    step4Dot.classList.remove('active');
    step4Dot.classList.add('done');
    step4Dot.innerHTML = '<i class="fa-solid fa-check"></i>';

		await showAppAlert(`Club "${clubName}" created successfully!`);
		window.location.href = "your_clubs.html";

		schoolNameInput.value = '';
		clubNameInput.value = '';
		clubDescriptionInput.value = '';
		topicsInput.setTags([]);
		stateInput.value = '';
		clubSponsorInput.value = '';
		clubLeaderInput.value = '';
		schoolEmailInput.value = '';
		roomNumberInput.value = '';
		meetingScheduleInput.value = '';

	} catch (error) {
		console.error("Error creating club or updating user profile:", error);
		await showAppAlert("Something went wrong while creating your club. Please try again.");
	} finally {
		clearLoading(submitButton);
	}
});


function generateRandomCode(length, characters) {
	let result = '';
	const charactersLength = characters.length;
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}


async function getUniqueJoinCode() {
	while (true) {
		const potentialCode = generateRandomCode(JOIN_CODE_LENGTH, JOIN_CODE_CHARS);
		const joinCodeRef = doc(db, "join_codes", potentialCode);

		try {
			await runTransaction(db, async (transaction) => {
				const joinCodeDoc = await transaction.get(joinCodeRef);
				if (joinCodeDoc.exists()) {
					throw new Error("Code exists, retry transaction");
				}
				transaction.set(joinCodeRef, {
					reserved: true,
					createdAt: new Date(),
					generatedBy: currentUser.uid
				});
			});
			console.log(`Successfully reserved unique join code: ${potentialCode}`);
			return potentialCode;
		} catch (e) {
			if (e.message === "Code exists, retry transaction") {
				console.log(`Join code ${potentialCode} already exists, retrying generation.`);
			} else {
				console.error("Error during join code reservation transaction:", e);
			}
		}
	}
}


const states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'Guam', 'U.S. Virgin Islands', 'American Samoa', 'Northern Mariana Islands'];


const NO_COUNTY_STATES = {
	'District of Columbia': {
		fips: '11001',
		name: 'District of Columbia'
	},
	'Puerto Rico': {
		fips: null,
		name: 'Puerto Rico'
	},
	'Guam': {
		fips: null,
		name: 'Guam'
	},
	'U.S. Virgin Islands': {
		fips: null,
		name: 'U.S. Virgin Islands'
	},
	'American Samoa': {
		fips: null,
		name: 'American Samoa'
	},
	'Northern Mariana Islands': {
		fips: null,
		name: 'Northern Mariana Islands'
	},
};

function handleCountyVisibility(stateName) {
	const noCounty = NO_COUNTY_STATES[stateName];
	if (!stateName) {
		countyInput.closest('.club-form-section').style.display = 'none';
		countyInput.value = '';
		selectedCountyFips = null;
	} else if (noCounty) {
		countyInput.value = noCounty.name;
		selectedCountyFips = noCounty.fips;
		countyInput.disabled = true;
		countyInput.closest('.club-form-section').style.display = 'none';
	} else {
		countyInput.value = '';
		selectedCountyFips = null;
		countyInput.disabled = false;
		countyInput.closest('.club-form-section').style.display = '';
	}
}

function normalizeState(input) {
	const trimmed = input.trim();
	const upper = trimmed.toUpperCase();

	const abbrevKey = upper.replace(/\./g, '');
	if (STATE_ABBREVS[abbrevKey]) return STATE_ABBREVS[abbrevKey];
	if (STATE_ABBREVS[upper]) return STATE_ABBREVS[upper];

	const stripped = trimmed.toLowerCase().replace(/[,\.]/g, '').replace(/\s+/g, ' ').trim();
	if (
		stripped === 'washington dc' ||
		stripped === 'washington d c' ||
		stripped === 'washington district of columbia' ||
		stripped === 'district of columbia'
	) {
		return 'District of Columbia';
	}

	return states.find(s => s.toLowerCase() === trimmed.toLowerCase()) || null;
}


const stateDropdownList = document.getElementById('state-dropdown-list');

stateInput.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	stateDropdownList.innerHTML = '';

	const fullNameMatch = states.find(s => s.toLowerCase() === value.trim());
	handleCountyVisibility(fullNameMatch || '');

	if (value) {
		const normalized = normalizeState(this.value.trim());
		const filtered = states.filter(state =>
			state.toLowerCase().includes(value) ||
			(normalized && state === normalized)
		);
		if (filtered.length > 0) {
			filtered.forEach(state => {
				const div = document.createElement('div');
				div.className = 'state-option';
				div.textContent = state;
				div.onclick = () => {
					stateInput.value = state;
					stateDropdownList.classList.remove('show');
					countyDropdownList.innerHTML = '';
					countyDropdownList.classList.remove('show');
					handleCountyVisibility(state);
				};
				stateDropdownList.appendChild(div);
			});
			stateDropdownList.classList.add('show');
		} else {
			stateDropdownList.classList.remove('show');
		}
	} else {
		stateDropdownList.classList.remove('show');
		handleCountyVisibility('');
	}
});

document.addEventListener('click', function(e) {
	if (!stateInput.contains(e.target) && !stateDropdownList.contains(e.target)) {
		stateDropdownList.classList.remove('show');
	}
});


countyInput.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	const currentState = normalizeState(stateInput.value.trim());
	countyDropdownList.innerHTML = '';

	let pool = currentState ?
		COUNTIES.filter(c => c.state === currentState) :
		COUNTIES;

	if (value) {
		pool = pool.filter(c => c.name.toLowerCase().includes(value));
	}

	if (pool.length > 0) {
		pool.forEach(county => {
			const div = document.createElement('div');
			div.className = 'state-option';
			div.textContent = county.name;
			div.onclick = () => {
				countyInput.value = county.name;
				selectedCountyFips = county.fips;
				countyDropdownList.classList.remove('show');
				loadSchoolsFor(normalizeState(stateInput.value), county.name);
			};
			countyDropdownList.appendChild(div);
		});
		countyDropdownList.classList.add('show');
	} else {
		countyDropdownList.classList.remove('show');
	}
});

document.addEventListener('click', function(e) {
	if (!countyInput.contains(e.target) && !countyDropdownList.contains(e.target)) {
		countyDropdownList.classList.remove('show');
	}
});


const schoolDropdownList = document.getElementById('school-dropdown-list');

schoolNameInput.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	schoolDropdownList.innerHTML = '';

	const pool = CACHED_SCHOOLS.filter(s => s.nameLower.includes(value));

	if (value && pool.length > 0) {
		pool.forEach(school => {
			const div = document.createElement('div');
			div.className = 'state-option';
			div.textContent = school.name;
			div.onclick = () => {
				schoolNameInput.value = school.name;
				schoolDropdownList.classList.remove('show');
			};
			schoolDropdownList.appendChild(div);
		});
		schoolDropdownList.classList.add('show');
	} else {
		schoolDropdownList.classList.remove('show');
	}
});

document.addEventListener('click', function(e) {
	if (!schoolNameInput.contains(e.target) && !schoolDropdownList.contains(e.target)) {
		schoolDropdownList.classList.remove('show');
	}
});
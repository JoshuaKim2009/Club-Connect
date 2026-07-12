import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { getOrCreateSchool, fetchSchoolsForCounty, normalizeSchoolName } from './school-utils.js';

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

document.body.classList.add('no-scroll');

const displayNameInput = document.getElementById('displayName');
const saveBtn = document.getElementById('save-submit');

const editState = document.getElementById('editState');
const editStateDropdownList = document.getElementById('edit-state-dropdown-list');
const editCountyWrapper = document.getElementById('edit-county-wrapper');
const editCounty = document.getElementById('editCounty');
const editCountyDropdownList = document.getElementById('edit-county-dropdown-list');
const editSchool = document.getElementById('editSchool');
const editSchoolDropdownList = document.getElementById('edit-school-dropdown-list');

function hideLoadingScreen() {
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

const states = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','Puerto Rico','Guam','U.S. Virgin Islands','American Samoa','Northern Mariana Islands'];

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

const NO_COUNTY_STATES = {
	'District of Columbia': true,
	'Puerto Rico': true,
	'Guam': true,
	'U.S. Virgin Islands': true,
	'American Samoa': true,
	'Northern Mariana Islands': true,
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

function updateCountyVisibility(stateName) {
	const countyLabel = document.getElementById('edit-county-label');
	if (!stateName || NO_COUNTY_STATES[stateName]) {
		editCountyWrapper.style.display = 'none';
		if (countyLabel) countyLabel.style.display = 'none';
		editCounty.value = '';
	} else {
		editCountyWrapper.style.display = 'block';
		if (countyLabel) countyLabel.style.display = 'block';
	}
}

let COUNTIES = [];
fetch('counties.json')
	.then(res => res.json())
	.then(data => {
		COUNTIES = data.map(c => ({ fips: c.A, state: c.B, name: c.C }));
	});

let CACHED_SCHOOLS = [];
const schoolCacheByCounty = new Map();

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

editState.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	editStateDropdownList.innerHTML = '';
	const state = normalizeState(this.value);
	updateCountyVisibility(state);
	if (!state) editCounty.value = '';

	if (value) {
		const filtered = states.filter(s => s.toLowerCase().includes(value));
		if (filtered.length > 0) {
			filtered.forEach(s => {
				const div = document.createElement('div');
				div.className = 'state-option';
				div.textContent = s;
				div.onclick = () => {
					editState.value = s;
					editStateDropdownList.classList.remove('show');
					editCounty.value = '';
					updateCountyVisibility(s);
				};
				editStateDropdownList.appendChild(div);
			});
			editStateDropdownList.classList.add('show');
		} else {
			editStateDropdownList.classList.remove('show');
		}
	} else {
		editStateDropdownList.classList.remove('show');
	}
});

editCounty.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	const currentState = normalizeState(editState.value);
	editCountyDropdownList.innerHTML = '';

	let pool = currentState ? COUNTIES.filter(c => c.state === currentState) : COUNTIES;
	if (value) pool = pool.filter(c => c.name.toLowerCase().includes(value));

	if (pool.length > 0) {
		pool.forEach(county => {
			const div = document.createElement('div');
			div.className = 'state-option';
			div.textContent = county.name;
			div.onclick = () => {
				editCounty.value = county.name;
				editCountyDropdownList.classList.remove('show');
				loadSchoolsFor(normalizeState(editState.value), county.name);
			};
			editCountyDropdownList.appendChild(div);
		});
		editCountyDropdownList.classList.add('show');
	} else {
		editCountyDropdownList.classList.remove('show');
	}
});

editSchool.addEventListener('input', function() {
  const value = this.value.toLowerCase();
  editSchoolDropdownList.innerHTML = '';
  const pool = CACHED_SCHOOLS.filter(s => s.nameLower.includes(value));

  if (value && pool.length > 0) {
    pool.forEach(school => {
      const div = document.createElement('div');
      div.className = 'state-option';
      div.textContent = school.name;
      div.onclick = () => {
        editSchool.value = school.name;
        editSchoolDropdownList.classList.remove('show');
      };
      editSchoolDropdownList.appendChild(div);
    });
    editSchoolDropdownList.classList.add('show');
  } else {
    editSchoolDropdownList.classList.remove('show');
  }
});

document.addEventListener('click', function(e) {
	if (!editState.contains(e.target) && !editStateDropdownList.contains(e.target)) {
		editStateDropdownList.classList.remove('show');
	}
	if (!editCounty.contains(e.target) && !editCountyDropdownList.contains(e.target)) {
		editCountyDropdownList.classList.remove('show');
	}
	if (!editSchool.contains(e.target) && !editSchoolDropdownList.contains(e.target)) {
		editSchoolDropdownList.classList.remove('show');
	}
});

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    displayNameInput.value = user.displayName || '';

    // Prefill school fields if the user already has them on file
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.state) {
                editState.value = data.state;
                updateCountyVisibility(data.state);
            }
            if (data.county) editCounty.value = data.county;
            if (data.school) editSchool.value = data.school;
            if (data.state && data.county) {
                await loadSchoolsFor(data.state, data.county);
            }
        }
    } catch (e) {
        console.error("Could not load existing school info:", e);
    }

    hideLoadingScreen();
});

saveBtn.addEventListener('click', async () => {
    const newDisplayName = displayNameInput.value.trim();

    if (!newDisplayName) {
        await showAppAlert("Display name cannot be empty.");
        return;
    }

    const state = normalizeState(editState.value);
    const county = editCounty.value.trim();
    const rawSchool = editSchool.value.trim();

    // School fields are optional here — only validate/save them if the user filled something in
    const hasAnySchoolInput = editState.value.trim() || county || rawSchool;

    if (hasAnySchoolInput) {
        if (!state) {
            await showAppAlert("Please select a valid state, or clear the school fields entirely to skip.");
            return;
        }
        if (!NO_COUNTY_STATES[state] && !county) {
            await showAppAlert("Please select your county.");
            return;
        }
        if (!rawSchool) {
            await showAppAlert("Please enter your school name.");
            return;
        }
    }

    saveBtn.style.width = saveBtn.offsetWidth + 'px';
    saveBtn.style.height = saveBtn.offsetHeight + 'px';
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span>';

    try {
        const user = auth.currentUser;

        await updateProfile(user, { displayName: newDisplayName });

        const updatePayload = { name: newDisplayName };

        if (hasAnySchoolInput) {
            const schoolResult = normalizeSchoolName(rawSchool);
            const school = schoolResult.valid ? schoolResult.normalized : rawSchool;
            const schoolId = await getOrCreateSchool(db, state, county, school);

            updatePayload.state = state;
            updatePayload.stateLower = state.toLowerCase();
            updatePayload.county = county;
            updatePayload.countyLower = county.toLowerCase();
            updatePayload.school = school;
            updatePayload.schoolLower = school.toLowerCase();
            updatePayload.schoolId = schoolId;
        }

        await updateDoc(doc(db, "users", user.uid), updatePayload);

        const data = { displayName: newDisplayName, email: user.email, uid: user.uid };
        localStorage.setItem('cc-user', JSON.stringify(data));
        sessionStorage.setItem('cc-user', JSON.stringify(data));

        await showAppAlert("Account updated successfully!");
        history.back();

    } catch (error) {
        await showAppAlert("Failed to update account: " + error.message);
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'SAVE';
    }
});
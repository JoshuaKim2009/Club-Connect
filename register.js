import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert } from './dialog.js';
import { getOrCreateSchool, fetchSchoolsForCounty, normalizeSchoolName, schoolDocId } from './school-utils.js';

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


function getRegisterErrorMessage(code) {
  switch (code) {
    case 'auth/email-already-in-use':
      return "An account with this email already exists. Try logging in instead.";
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address. Please double-check it.";
    case 'auth/weak-password':
      return "Your password is too weak. Try something longer with a mix of letters and numbers.";
    case 'auth/operation-not-allowed':
      return "Registration is currently unavailable. Please try again later.";
    case 'auth/too-many-requests':
      return "Too many attempts in a short time. Please wait a moment and try again.";
    case 'auth/network-request-failed':
      return "Couldn't reach the server. Please check your internet connection and try again.";
    default:
      return "Something went wrong while creating your account. Please try again.";
  }
}


const step1 = document.getElementById("registerStep1");
const step2 = document.getElementById("registerStep2");
const successStep = document.getElementById("registerSuccess");
const loginCard = document.getElementById("registerLoginCard");

const dot1 = document.getElementById("reg-dot-1");
const dot2 = document.getElementById("reg-dot-2");
const conn1 = document.getElementById("reg-conn-1");

function showStep(step) {
  step1.classList.toggle("visible", step === 1);
  step2.classList.toggle("visible", step === 2);
  successStep.classList.toggle("visible", step === 3);
  loginCard.classList.toggle("visible", step === 1);
}

document.getElementById("register-next").addEventListener("click", async () => {
  const state = normalizeState(regState.value);
  const county = regCounty.value.trim();
  const school = document.getElementById("regSchool").value.trim();

  if (!state) {
    await showAppAlert("Please select your state.");
    return;
  }

  if (!NO_COUNTY_STATES[state] && !county) {
    await showAppAlert("Please select your county.");
    return;
  }

  if (!school) {
    await showAppAlert("Please enter your school name.");
    return;
  }

  dot1.classList.add("done");
  dot1.classList.remove("active");
  dot2.classList.add("active");
  conn1.classList.add("done");
  showStep(2);
});

document.getElementById("register-back").addEventListener("click", () => {
  dot2.classList.remove("active");
  dot1.classList.add("active");
  dot1.classList.remove("done");
  conn1.classList.remove("done");
  showStep(1);
});


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

const regState = document.getElementById('regState');
const regStateDropdownList = document.getElementById('reg-state-dropdown-list');
const regCountyWrapper = document.getElementById('reg-county-wrapper');
const regCounty = document.getElementById('regCounty');
const regCountyDropdownList = document.getElementById('reg-county-dropdown-list');

regState.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	regStateDropdownList.innerHTML = '';

	const state = normalizeState(this.value);
  
  updateCountyVisibility(state);

  if (!state) regCounty.value = '';

	if (value) {
		const filtered = states.filter(state => state.toLowerCase().includes(value));
		if (filtered.length > 0) {
			filtered.forEach(state => {
				const div = document.createElement('div');
				div.className = 'state-option';
				div.textContent = state;
				div.onclick = () => {
					regState.value = state;
					regStateDropdownList.classList.remove('show');
					regCounty.value = '';
					updateCountyVisibility(state);
				};
				regStateDropdownList.appendChild(div);
			});
			regStateDropdownList.classList.add('show');
		} else {
			regStateDropdownList.classList.remove('show');
		}
	} else {
		regStateDropdownList.classList.remove('show');
	}
});

document.addEventListener('click', function(e) {
	if (!regState.contains(e.target) && !regStateDropdownList.contains(e.target)) {
		regStateDropdownList.classList.remove('show');
	}
	if (!regCounty.contains(e.target) && !regCountyDropdownList.contains(e.target)) {
		regCountyDropdownList.classList.remove('show');
	}
});

function updateCountyVisibility(stateName) {
	if (!stateName || NO_COUNTY_STATES[stateName]) {
		regCountyWrapper.style.display = 'none';
		regCounty.value = '';
	} else {
		regCountyWrapper.style.display = 'block';
	}
}

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


let REGISTER_COUNTIES = [];
let CACHED_SCHOOLS = [];
const schoolCacheByCounty = new Map();
fetch('counties.json')
	.then(res => res.json())
	.then(data => {
		REGISTER_COUNTIES = data.map(c => ({ fips: c.A, state: c.B, name: c.C }));
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

regCounty.addEventListener('input', function() {
	const value = this.value.toLowerCase();
	const currentState = normalizeState(regState.value);
	regCountyDropdownList.innerHTML = '';

	let pool = currentState
		? REGISTER_COUNTIES.filter(c => c.state === currentState)
		: REGISTER_COUNTIES;

	if (value) pool = pool.filter(c => c.name.toLowerCase().includes(value));

	if (pool.length > 0) {
		pool.forEach(county => {
			const div = document.createElement('div');
			div.className = 'state-option';
			div.textContent = county.name;
			div.onclick = () => {
				regCounty.value = county.name;
				regCountyDropdownList.classList.remove('show');
				loadSchoolsFor(normalizeState(regState.value), county.name);
			};
			regCountyDropdownList.appendChild(div);
		});
		regCountyDropdownList.classList.add('show');
	} else {
		regCountyDropdownList.classList.remove('show');
	}
});

const regSchool = document.getElementById('regSchool');
const regSchoolDropdownList = document.getElementById('reg-school-dropdown-list');

regSchool.addEventListener('input', function() {
  const value = this.value.toLowerCase();
  regSchoolDropdownList.innerHTML = '';

  const pool = CACHED_SCHOOLS.filter(s => s.nameLower.includes(value));

  if (value && pool.length > 0) {
    pool.forEach(school => {
      const div = document.createElement('div');
      div.className = 'state-option';
      div.textContent = school.name;
      div.onclick = () => {
        regSchool.value = school.name;
        regSchoolDropdownList.classList.remove('show');
      };
      regSchoolDropdownList.appendChild(div);
    });
    regSchoolDropdownList.classList.add('show');
  } else {
    regSchoolDropdownList.classList.remove('show');
  }
});

document.addEventListener('click', function(e) {
  if (!regSchool.contains(e.target) && !regSchoolDropdownList.contains(e.target)) {
    regSchoolDropdownList.classList.remove('show');
  }
});



const submit = document.getElementById("register-submit");

function resetSubmit() {
  submit.disabled = false;
  submit.innerHTML = "CREATE";
  submit.style.width = "";
  submit.style.height = "";
}

submit.addEventListener("click", async function(event) {
  event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (!name) {
    await showAppAlert("Please enter your full name.");
    return;
  }
  if (!email) {
    await showAppAlert("Please enter your email address.");
    return;
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    await showAppAlert("That doesn't look like a valid email address. Please double-check it.");
    return;
  }
  if (!password) {
    await showAppAlert("Please enter a password.");
    return;
  }
  if (password.length < 6) {
    await showAppAlert("Your password is too weak.");
    return;
  }
  if (password !== confirmPassword) {
    await showAppAlert("Your passwords don't match. Please try again.");
    return;
  }

  const state = normalizeState(regState.value);
  const county = regCounty.value.trim();
  const rawSchool = document.getElementById("regSchool").value.trim();
  const schoolResult = normalizeSchoolName(rawSchool);
  const school = schoolResult.valid ? schoolResult.normalized : rawSchool;


  submit.style.width  = submit.offsetWidth  + 'px';
  submit.style.height = submit.offsetHeight + 'px';
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span>';

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await updateProfile(user, { displayName: name });

    const schoolId = schoolDocId(state, county, school);

    const batch = writeBatch(db);
    batch.set(doc(db, "schools", schoolId), {
      schoolId,
      name: school,
      nameLower: school.toLowerCase(),
      state,
      stateLower: state.toLowerCase(),
      county,
      countyLower: county.toLowerCase(),
    }, { merge: true });
    batch.set(doc(db, "users", user.uid), {
      name,
      email,
      state,
      stateLower: state.toLowerCase(),
      county,
      countyLower: county.toLowerCase(),
      school,
      schoolLower: school.toLowerCase(),
      schoolId,
    });
    await batch.commit();



    localStorage.setItem('discoverySearch', JSON.stringify({ state, county, school, category: '' }));

    const data = { displayName: user.displayName, email: user.email, uid: user.uid };
    localStorage.setItem('cc-user', JSON.stringify(data));
    sessionStorage.setItem('cc-user', JSON.stringify(data));

    const locationText = county ? `${county}, ${state}` : state;
    document.getElementById("registerDoneSummary").innerHTML =
      `Welcome, ${name}.<br>Your account has been created successfully!`;

    dot2.classList.add("done");
    dot2.classList.remove("active");
    showStep(3);

  } catch (error) {
    await showAppAlert(getRegisterErrorMessage(error.code));
    resetSubmit();
  }
});

document.getElementById("register-continue").addEventListener("click", () => {
  window.location.href = "index.html";
});
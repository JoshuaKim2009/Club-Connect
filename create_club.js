// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
// IMPORTANT: Ensure getAuth and onAuthStateChanged are imported for authentication
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
// IMPORTANT: Ensure collection, addDoc, updateDoc, and arrayUnion are imported for Firestore
import { getFirestore, doc, setDoc, collection, addDoc, updateDoc, arrayUnion, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const analytics = getAnalytics(app);

const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let currentUserEmail = null;
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    currentUserEmail = user.email;
    console.log("User is logged in. UID:", currentUser.uid, "Email:", currentUserEmail);
    document.getElementById("submit-club-button").disabled = false;
  } else {
    currentUser = null;
    currentUserEmail = null;
    console.warn("No user is logged in. Club creation will not have an manager and cannot link to user profile.");
    document.getElementById("submit-club-button").disabled = true;
  }
});

const submitButton = document.getElementById("submit-club-button");
const schoolNameInput = document.getElementById("school-name-select");
const clubNameInput = document.getElementById("club-name-select");
const clubDescriptionInput = document.getElementById("description-input");
const clubActivityInput = document.getElementById("main-activity-select");
const stateInput = document.getElementById("state-select");



submitButton.disabled = true;

submitButton.addEventListener("click", async function(event){
    event.preventDefault();
    submitButton.disabled = true;

    if (!currentUser || !currentUser.uid) {
      await showAppAlert("You must be logged in to create a club.");
      console.warn("Attempted club creation by unauthenticated user. Aborting.");
      return; 
    }

    const rawSchoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubDescription = clubDescriptionInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();
    const state = stateInput.value.trim();


    if (!clubName || !rawSchoolName || !state || !clubActivity || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        submitButton.disabled = false;
        return; 
    }

    const normalizedState = normalizeState(state);

    if (!normalizedState) {
        await showAppAlert("Please enter a valid state");
        submitButton.disabled = false;
        return;
    }

    const schoolNameResult = normalizeSchoolName(rawSchoolName);
    let schoolName;

    if (!schoolNameResult.valid) {
        if (schoolNameResult.error === 'suspicious') {
            const confirmed = await showAppConfirm(`"${rawSchoolName}" doesn't look like a typical school name. Continue anyways?`);
            if (!confirmed) {
                submitButton.disabled = false;
                return;
            }
            schoolName = rawSchoolName;
        } else {
            const confirmed = await showAppConfirm(`"${rawSchoolName}" looks like an abbreviation. Click YES if to continue anyways or NO to correct it.`);
            if (!confirmed) {
                submitButton.disabled = false;
                return;
            }
            schoolName = rawSchoolName; 
        }
    } else {
        if (schoolNameResult.normalized !== rawSchoolName) {
            const confirmed = await showAppConfirm(`We changed your school name from "${rawSchoolName}" to "${schoolNameResult.normalized}". Is this correct?`);
            if (!confirmed) {
                submitButton.disabled = false;
                return;
            }
        }
        schoolName = schoolNameResult.normalized;
    }

    try {
        console.log("Attempting to save club data to Firestore...");
        const joinCode = await getUniqueJoinCode();
        if (!joinCode) {
            await showAppAlert("Failed to generate a unique join code. Please try again.");
            return;
        }
        console.log(`Generated and reserved unique join code: ${joinCode}`);

        const newClubRef = doc(collection(db, "clubs"));
        const newClubId = newClubRef.id;

        await setDoc(newClubRef, {
            schoolName: schoolName,
            state: normalizedState,
            clubName: clubName,
            description: clubDescription,
            clubActivity: clubActivity,
            managerEmail: currentUserEmail,
            joinCode: joinCode,
            memberUIDs: [currentUser.uid],
            pendingMemberUIDs: [],
            managerUid: currentUser.uid,
            createdAt: serverTimestamp()
        });
        console.log("Club document written with ID: ", newClubId);

        await createManagerMemberEntry(newClubId, currentUser.uid);

        const joinCodeRef = doc(db, "join_codes", joinCode);
        await updateDoc(joinCodeRef, { clubId: newClubId, reserved: false });
        console.log(`Join code ${joinCode} linked to club ID ${newClubId}.`);


        console.log(`Attempting to add club ID ${newClubId} to user ${currentUser.uid}'s managed_clubs list in 'users' collection...`);
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            managed_clubs: arrayUnion(newClubId)
        });
        console.log("User's managed_clubs list in 'users' collection updated successfully.");

        await showAppAlert(`Club "${clubName}" saved successfully!`);
        window.location.href = "your_clubs.html";

        schoolNameInput.value = '';
        clubNameInput.value = '';
        clubDescriptionInput.value = '';
        clubActivityInput.value = '';
        stateInput.value = '';

    } catch (error) {
        console.error("Error creating club or updating user profile:", error);
        await showAppAlert("Failed to create club: " + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Create Club";
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
    while (true) { // Keep trying until a unique code is found and reserved
        const potentialCode = generateRandomCode(JOIN_CODE_LENGTH, JOIN_CODE_CHARS);
        const joinCodeRef = doc(db, "join_codes", potentialCode); // Reference to a document named after the code

        try {
            await runTransaction(db, async (transaction) => {
                const joinCodeDoc = await transaction.get(joinCodeRef);
                if (joinCodeDoc.exists()) {
                    // Code already exists, throw to retry the transaction/loop
                    throw new Error("Code exists, retry transaction");
                }
                // If it doesn't exist, reserve it within this transaction
                transaction.set(joinCodeRef, { reserved: true, createdAt: new Date(), generatedBy: currentUser.uid });
            });
            // If the transaction completes without throwing, the code is unique and reserved
            console.log(`Successfully reserved unique join code: ${potentialCode}`);
            return potentialCode; // Return the unique code
        } catch (e) {
            if (e.message === "Code exists, retry transaction") {
                console.log(`Join code ${potentialCode} already exists, retrying generation.`);
                // Continue the loop to generate another code
            } else {
                console.error("Error during join code reservation transaction:", e);
                // For other errors, we might want to throw or handle differently,
                // but for this retry-until-success scenario, we just let it loop.
            }
        }
    }
}




async function createManagerMemberEntry(clubId, managerUid) {
    const db = getFirestore(); // Get the Firestore instance (already initialized globally)
    const managerMemberRef = doc(db, "clubs", clubId, "members", managerUid);
    await setDoc(managerMemberRef, {
        role: "manager", // The manager is assigned the 'manager' role
        joinedAt: serverTimestamp() // Use serverTimestamp for a reliable timestamp
    });
    console.log(`Manager ${managerUid} added to members subcollection with role 'manager' for club ${clubId}.`);
}



function normalizeSchoolName(schoolName) {
    const trimmed = schoolName.trim();
    
    if (!trimmed) {
        return { valid: false, normalized: '', error: 'Please enter a school name.' };
    }

    const hasNoSpaces = !trimmed.includes(' ');
    const isAllLowercase = trimmed === trimmed.toLowerCase();
    const hasRepeatedChars = /(.)\1{2,}/.test(trimmed);
    const isShort = trimmed.length < 15;

    if (hasNoSpaces && isAllLowercase && isShort) {
        return { 
            valid: false, 
            normalized: '', 
            error: 'suspicious'
        };
    }

    if (hasRepeatedChars) {
        return { 
            valid: false, 
            normalized: '', 
            error: 'suspicious'
        };
    }

    const words = trimmed.split(' ');
    
    for (let word of words) {
        if (word.toUpperCase() === 'HS' || word.toUpperCase() === 'H.S' || word.toUpperCase() === 'H.S.' ||
            word.toUpperCase() === 'MS' || word.toUpperCase() === 'M.S' || word.toUpperCase() === 'M.S.' ||
            word.toUpperCase() === 'ES' || word.toUpperCase() === 'E.S' || word.toUpperCase() === 'E.S.') {
            continue;
        }
        
        if (word.length >= 2 && /[A-Z]/.test(word) && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
            return { 
                valid: false, 
                normalized: '', 
                error: 'Please spell out the full school name without abbreviations.' 
            };
        }
    }
    
    let normalized = trimmed;

    if (normalized.toUpperCase().endsWith(' HS') || normalized.toUpperCase().endsWith(' H.S') || normalized.toUpperCase().endsWith(' H.S.')) {
        if (!normalized.toLowerCase().endsWith('high school')) {
            if (normalized.toUpperCase().endsWith(' HS')) {
                normalized = normalized.slice(0, -2) + 'High School';
            } else if (normalized.toUpperCase().endsWith(' H.S.')) {
                normalized = normalized.slice(0, -4) + 'High School';
            } else if (normalized.toUpperCase().endsWith(' H.S')) {
                normalized = normalized.slice(0, -3) + 'High School';
            }
        }
    }

    if (normalized.toUpperCase().endsWith(' MS') || normalized.toUpperCase().endsWith(' M.S') || normalized.toUpperCase().endsWith(' M.S.')) {
        if (!normalized.toLowerCase().endsWith('middle school')) {
            if (normalized.toUpperCase().endsWith(' MS')) {
                normalized = normalized.slice(0, -2) + 'Middle School';
            } else if (normalized.toUpperCase().endsWith(' M.S.')) {
                normalized = normalized.slice(0, -4) + 'Middle School';
            } else if (normalized.toUpperCase().endsWith(' M.S')) {
                normalized = normalized.slice(0, -3) + 'Middle School';
            }
        }
    }

    if (normalized.toUpperCase().endsWith(' ES') || normalized.toUpperCase().endsWith(' E.S') || normalized.toUpperCase().endsWith(' E.S.')) {
        if (!normalized.toLowerCase().endsWith('elementary school')) {
            if (normalized.toUpperCase().endsWith(' ES')) {
                normalized = normalized.slice(0, -2) + 'Elementary School';
            } else if (normalized.toUpperCase().endsWith(' E.S.')) {
                normalized = normalized.slice(0, -4) + 'Elementary School';
            } else if (normalized.toUpperCase().endsWith(' E.S')) {
                normalized = normalized.slice(0, -3) + 'Elementary School';
            }
        }
    }

    while (normalized.includes('  ')) {
        normalized = normalized.replace('  ', ' ');
    }
    normalized = normalized.trim();
    
    return { valid: true, normalized: normalized, error: '' };
}

const states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];

function normalizeState(stateInput) {
    const validStates = states;
    
    const trimmed = stateInput.trim();
    
    // Find matching state (case-insensitive)
    const matchedState = validStates.find(state => state.toLowerCase() === trimmed.toLowerCase());
    
    return matchedState || null;
}


const stateDropdownList = document.getElementById('state-dropdown-list');

stateInput.addEventListener('input', function() {
  const value = this.value.toLowerCase();
  stateDropdownList.innerHTML = '';
  
  if (value) {
    const filtered = states.filter(state => state.toLowerCase().includes(value));
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
});

stateInput.addEventListener('input', function() {
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

document.addEventListener('click', function(e) {
  if (!stateInput.contains(e.target) && !stateDropdownList.contains(e.target)) {
    stateDropdownList.classList.remove('show');
  }
});
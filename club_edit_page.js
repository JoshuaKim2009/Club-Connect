//club_edit_page.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp, deleteDoc, query, collection, getDocs, arrayRemove } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let currentClubId = null;
//let currentUserRoles = []; 

function getClubIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('clubId');
}
currentClubId = getClubIdFromUrl();


const submitButton = document.getElementById("update-club-button");
const schoolNameInput = document.getElementById("school-name-edit");
const clubNameInput = document.getElementById("club-name-edit");
const clubActivityInput = document.getElementById("main-activity-edit");
const clubDescriptionInput = document.getElementById("description-edit");
const deleteButton = document.getElementById("delete-club-button");
const backButton = document.getElementById("back-button-edit");
const stateInput = document.getElementById("state-edit");


submitButton.disabled = true;
schoolNameInput.disabled = true;
clubNameInput.disabled = true;
clubActivityInput.disabled = true;
clubDescriptionInput.disabled = true;


async function loadClubData(clubId, managerUid) {
  if (!clubId) {
    await showAppAlert("No club ID provided for editing.");
    console.error("No club ID found in URL.");
    window.location.href = `club_page_manager.html?id=${clubId}`;
    return;
  }

  const clubRef = doc(db, "clubs", clubId);
  try {
    const clubDoc = await getDoc(clubRef);
    if (clubDoc.exists()) {
        const clubData = clubDoc.data();
        
        const isManager = clubData.managerUid === managerUid;
        let isAdminOfThisClub = false;

        
        if (!isManager && managerUid) {
            const memberRef = doc(db, "clubs", clubId, "members", managerUid);
            const memberDoc = await getDoc(memberRef);
            if (memberDoc.exists() && memberDoc.data().role === 'admin') {
                isAdminOfThisClub = true;
            }
        }

        if (!isManager && !isAdminOfThisClub) {
            await showAppAlert("You are not authorized to edit this club.");
            console.warn("Unauthorized attempt to edit club:", clubId, "by user:", managerUid);
            window.location.href = `club_page_manager.html?id=${clubId}`;
            return;
        }

        schoolNameInput.value = clubData.schoolName || '';
        clubNameInput.value = clubData.clubName || '';
        clubActivityInput.value = clubData.clubActivity || '';
        clubDescriptionInput.value = clubData.description || '';
        stateInput.value = clubData.state || '';

        schoolNameInput.disabled = false;
        clubNameInput.disabled = false;
        clubActivityInput.disabled = false;
        clubDescriptionInput.disabled = false;
        submitButton.disabled = false;
        stateInput.disabled = false;


        

    } else {
      await showAppAlert("Club not found.");
      console.error("Club document not found:", clubId);
      window.location.href = `club_page_manager.html?id=${clubId}`;
    }
  } catch (error) {
    console.error("Error loading club data:", error);
    await showAppAlert("Failed to load club data: " + error.message);
    window.location.href = `club_page_manager.html?id=${clubId}`;
  }
}



onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    currentUserEmail = user.email;
    console.log("User is logged in. UID:", currentUser.uid, "Email:", currentUserEmail);

    
    if (currentClubId) {
      await loadClubData(currentClubId, currentUser.uid);
    } else {
        await showAppAlert("No club ID specified for editing.");
        window.location.href = `club_page_manager.html?id=${currentClubId}`;
    }

  } else {
    currentUser = null;
    currentUserEmail = null;
    console.warn("No user is logged in. Redirecting to login.");
    await showAppAlert("You must be logged in to edit a club.");
    window.location.href = "login.html";
  }
});


submitButton.addEventListener("click", async function(event){
    event.preventDefault();

    submitButton.disabled = true;

    if (!currentUser || !currentUser.uid) {
      await showAppAlert("You must be logged in to update a club.");
      console.warn("Attempted club update by unauthenticated user. Aborting.");
      submitButton.disabled = false;
      submitButton.textContent = "UPDATE";
      return;
    }
    if (!currentClubId) {
        await showAppAlert("No club selected for update.");
        console.warn("Attempted club update without a club ID. Aborting.");
        submitButton.disabled = false;
        submitButton.textContent = "UPDATE";
        return;
    }

    const rawSchoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();
    const clubDescription = clubDescriptionInput.value.trim();
    const state = stateInput.value.trim();


    if (!clubName || !rawSchoolName || !state || !clubActivity || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        submitButton.disabled = false;
        submitButton.textContent = "UPDATE";
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
                submitButton.textContent = "UPDATE";
                return;
            }
            schoolName = rawSchoolName;
        } else {
            const confirmed = await showAppConfirm(`"${rawSchoolName}" looks like an abbreviation. Click YES to continue anyways or NO to correct it.`);
            if (!confirmed) {
                submitButton.disabled = false;
                submitButton.textContent = "UPDATE";
                return;
            }
            schoolName = rawSchoolName; 
        }
    } else {
        if (schoolNameResult.normalized !== rawSchoolName) {
            const confirmed = await showAppConfirm(`We changed your school name from "${rawSchoolName}" to "${schoolNameResult.normalized}". Is this correct?`);
            if (!confirmed) {
                submitButton.disabled = false;
                submitButton.textContent = "UPDATE";
                return;
            }
        }
        schoolName = schoolNameResult.normalized;
    }

    try {
        console.log("Attempting to update club data in Firestore...");
        const clubRef = doc(db, "clubs", currentClubId);

        await updateDoc(clubRef, {
            schoolName: schoolName,
            state: normalizedState,
            clubName: clubName,
            description: clubDescription,
            clubActivity: clubActivity,
            lastModifiedBy: currentUser.uid,
            lastModifiedAt: serverTimestamp()
        });
        console.log("Club document updated with ID: ", currentClubId);

        await showAppAlert(`Club "${clubName}" updated successfully!`);
        window.location.href = `club_page_manager.html?id=${currentClubId}`;

    } catch (error) {
        console.error("Error updating club:", error);
        await showAppAlert("Failed to update club: " + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "UPDATE";
    }
});


backButton.addEventListener("click", async function(event){
    window.location.href = `club_page_manager.html?id=${currentClubId}`;
});


deleteButton.addEventListener("click", async function(event){
    event.preventDefault();
    await deleteClub(currentClubId);
});


async function deleteClub(clubId) {
    if (!currentUser || !currentUser.uid) {
        await showAppAlert("You must be logged in to delete a club.");
        console.warn("Attempted club deletion by unauthenticated user. Aborting.");
        return;
    }

    if (!clubId) {
        await showAppAlert("No club ID provided for deletion.");
        console.warn("No clubId provided to deleteClub function.");
        return;
    }

    

    try {
        console.log(`Attempting to delete club with ID: ${clubId}`);

        const clubRef = doc(db, "clubs", clubId);
        const clubSnap = await getDoc(clubRef);

        if (!clubSnap.exists()) {
            await showAppAlert("Club not found. It might have already been deleted.");
            console.warn(`Club with ID ${clubId} not found.`);
            return;
        }

        const clubData = clubSnap.data();
        const managerUid = clubData.managerUid;
        const joinCode = clubData.joinCode;

        if (managerUid !== currentUser.uid) {
            await showAppAlert("You are not authorized to delete this club. Only the club manager can perform this action.");
            console.warn(`User ${currentUser.uid} attempted to delete club ${clubId} but is not the manager.`);
            return;
        }

        const confirmed = await showAppConfirm("Are you absolutely sure you want to delete this club? This action cannot be undone.");
        if (!confirmed) {
            console.log("Club deletion cancelled by user.");
            return;
        }


        console.log(`Fetching members for club ${clubId} to update their user profiles...`);
        const membersCollectionRef = collection(db, "clubs", clubId, "members");
        const memberDocsSnap = await getDocs(membersCollectionRef);
        const memberUIDsToUpdate = [];
        memberDocsSnap.forEach((memberDoc) => {
            memberUIDsToUpdate.push(memberDoc.id);
        });
        console.log(`Found ${memberUIDsToUpdate.length} members to update their user profiles.`);

        if (memberUIDsToUpdate.length > 0) {
            console.log(`Removing club ID ${clubId} from all members' 'member_clubs' lists...`);
            const updateMemberPromises = memberUIDsToUpdate.map(async (memberUid) => {
                if (memberUid === managerUid) {
                    console.log(`Skipping member_clubs update for manager UID ${memberUid}.`);
                    return Promise.resolve(); 
                }
                const memberUserDocRef = doc(db, "users", memberUid);
                try {
                    await updateDoc(memberUserDocRef, {
                        member_clubs: arrayRemove(clubId) 
                    });
                    console.log(`Club ID ${clubId} removed from member ${memberUid}'s 'member_clubs' list.`);
                } catch (memberUpdateError) {
                    console.error(`Error removing club ID from member ${memberUid}'s profile:`, memberUpdateError);
                }
            });
            await Promise.all(updateMemberPromises);
            console.log("All members' 'member_clubs' lists updated.");
        }


        console.log(`Deleting members subcollection for club ${clubId}...`);
        const deleteMemberSubcollectionPromises = [];
        memberDocsSnap.forEach((memberDoc) => {
            deleteMemberSubcollectionPromises.push(deleteDoc(memberDoc.ref));
        });
        await Promise.all(deleteMemberSubcollectionPromises);
        console.log(`All members subcollection documents for club ${clubId} deleted.`);

        console.log(`Deleting events subcollection for club ${clubId}...`);
        const eventsCollectionRef = collection(db, "clubs", clubId, "events");
        const eventDocsSnap = await getDocs(eventsCollectionRef);
        const deleteEventSubcollectionPromises = [];
        eventDocsSnap.forEach((eventDoc) => {
            deleteEventSubcollectionPromises.push(deleteDoc(eventDoc.ref));
        });
        await Promise.all(deleteEventSubcollectionPromises);
        console.log(`All events subcollection documents for club ${clubId} deleted.`);

        console.log(`Deleting occurrenceRsvps subcollection for club ${clubId}...`);
        const rsvpsCollectionRef = collection(db, "clubs", clubId, "occurrenceRsvps");
        const rsvpDocsSnap = await getDocs(rsvpsCollectionRef);
        const deleteRsvpSubcollectionPromises = [];
        rsvpDocsSnap.forEach((rsvpDoc) => {
            deleteRsvpSubcollectionPromises.push(deleteDoc(rsvpDoc.ref));
        });
        await Promise.all(deleteRsvpSubcollectionPromises);
        console.log(`All occurrenceRsvps subcollection documents for club ${clubId} deleted.`);

        console.log(`Deleting announcements subcollection for club ${clubId}...`);
        const announcementsCollectionRef = collection(db, "clubs", clubId, "announcements");
        const announcementDocsSnap = await getDocs(announcementsCollectionRef);

        const deleteAnnouncementPromises = [];
        announcementDocsSnap.forEach((announcementDoc) => {
            deleteAnnouncementPromises.push(deleteDoc(announcementDoc.ref));
            console.log(`  Marked announcement doc ${announcementDoc.id} for deletion.`);
        });

        await Promise.all(deleteAnnouncementPromises);
        console.log(`All announcements for club ${clubId} deleted.`);

        console.log(`Deleting messages subcollection for club ${clubId}...`);
        const messagesCollectionRef = collection(db, "clubs", clubId, "messages");
        const messageDocsSnap = await getDocs(messagesCollectionRef);

        const deleteMessagePromises = [];
        messageDocsSnap.forEach((messageDoc) => {
            deleteMessagePromises.push(deleteDoc(messageDoc.ref));
            console.log(`  Marked message doc ${messageDoc.id} for deletion.`);
        });

        await Promise.all(deleteMessagePromises);
        console.log(`All messages for club ${clubId} deleted.`);

        console.log(`Deleting polls subcollection for club ${clubId}...`);
        const pollsCollectionRef = collection(db, "clubs", clubId, "polls");
        const pollDocsSnap = await getDocs(pollsCollectionRef);

        const deletePollPromises = [];
        pollDocsSnap.forEach((pollDoc) => {
            deletePollPromises.push(deleteDoc(pollDoc.ref));
            console.log(`  Marked poll doc ${pollDoc.id} for deletion.`);
        });

        await Promise.all(deletePollPromises);
        console.log(`All polls for club ${clubId} deleted.`);

        console.log(`Deleting club document with ID: ${clubId}...`);
        await deleteDoc(clubRef);
        console.log(`Club document ${clubId} deleted.`);

        if (joinCode) {
            console.log(`Deleting join code ${joinCode}...`);
            const joinCodeRef = doc(db, "join_codes", joinCode);
            await deleteDoc(joinCodeRef);
            console.log(`Join code ${joinCode} deleted.`);
        }

        console.log(`Removing club ID ${clubId} from manager ${currentUser.uid}'s managed_clubs list...`);
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            managed_clubs: arrayRemove(clubId)
        });
        console.log(`Club ID ${clubId} removed from manager's managed_clubs list.`);

        await showAppAlert(`Club "${clubData.clubName}" has been successfully deleted.`);
        window.location.href = "your_clubs.html";

    } catch (error) {
        console.error("Error deleting club:", error);
        await showAppAlert("Failed to delete club: " + error.message);
    }
}

const states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];

function normalizeState(stateInput) {
    const validStates = states;
    
    const trimmed = stateInput.trim();
    
    // Find matching state (case-insensitive)
    const matchedState = validStates.find(state => state.toLowerCase() === trimmed.toLowerCase());
    
    return matchedState || null;
}


const stateDropdownList = document.getElementById('state-dropdown-list-edit');

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


function normalizeSchoolName(schoolName) {
    const trimmed = schoolName.trim();
    
    if (!trimmed) {
        return { valid: false, normalized: '', error: 'Please enter a school name.' };
    }

    const hasNoSpaces = !/\s/.test(trimmed);
    const isAllLowercase = trimmed === trimmed.toLowerCase();
    const hasRepeatedChars = /(.)\1{2,}/.test(trimmed); // 3+ same chars in a row
    const hasWeirdPattern = /[;,.'\/\[\]\\]/.test(trimmed); // suspicious punctuation
    const hasConsonantCluster = /[bcdfghjklmnpqrstvwxyz]{5,}/i.test(trimmed);
    const isShort = trimmed.length < 15;
    const hasMixedCaseNoSpaces = hasNoSpaces && /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed) && trimmed.length < 10;
    const hasRepeatingPattern = /(.{2,})\1{2,}/.test(trimmed);
    const words = trimmed.split(/\s+/);
    const hasRepeatedWords = words.length > 2 && words.some((word, i) => words.indexOf(word) !== i && words.lastIndexOf(word) !== i); // Same word appears 3+ times

    if ((hasNoSpaces || hasRepeatedWords) && (isAllLowercase && isShort || hasRepeatedChars || hasWeirdPattern || hasConsonantCluster || hasMixedCaseNoSpaces || hasRepeatingPattern)) {
        return { 
            valid: false, 
            normalized: '', 
            error: 'suspicious'
        };
    }
    
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
    if (!/High School$/i.test(normalized)) {
        normalized = normalized.replace(/\bHS\b$/i, 'High School');
    }

    if (!/Middle School$/i.test(normalized)) {
        normalized = normalized.replace(/\bMS\b$/i, 'Middle School');
    }

    if (!/Elementary School$/i.test(normalized)) {
        normalized = normalized.replace(/\bES\b$/i, 'Elementary School');
    }
    
    normalized = normalized.replace(/\bH\.?S\.?\b$/i, 'High School');
    
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return { valid: true, normalized: normalized, error: '' };
}
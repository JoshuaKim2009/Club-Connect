//club_edit_page.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, updateDoc, serverTimestamp, deleteDoc, query, collection, getDocs, arrayRemove } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { ROLE_LABELS } from './roleLabels.js';
import { handleUserSwitch } from './auth-guard.js';


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

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

let currentUser = null;
let currentUserEmail = null;
let currentClubId = null;
let originalClubData = null;

document.body.classList.add('no-scroll');

let COUNTIES = [];

fetch('counties.json')
  .then(res => res.json())
  .then(data => {
    COUNTIES = data.map(c => ({ fips: c.A, state: c.B, name: c.C }));
  });


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

const categoryInput = document.getElementById("category-edit");
const categoryDropdownList = document.getElementById("category-dropdown-list-edit");

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

function getClubIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('clubId');
}
currentClubId = getClubIdFromUrl();

function setLoading(btn) {
    btn._origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
}

function clearLoading(btn) {
    btn.disabled = false;
    btn.innerHTML = btn._origHTML;
}

const submitButton = document.getElementById("update-club-button");
const schoolNameInput = document.getElementById("school-name-edit");
const clubNameInput = document.getElementById("club-name-edit");
const clubActivityInput = document.getElementById("main-activity-edit");
const clubDescriptionInput = document.getElementById("description-edit");
const deleteButton = document.getElementById("delete-club-button");
const backButton = document.getElementById("back-button-edit");
const stateInput = document.getElementById("state-edit");
const clubSponsorInput = document.getElementById("sponsor-edit");
const clubLeaderInput = document.getElementById("club-leader-edit");
const schoolEmailInput = document.getElementById("school-email-edit");
const roomNumberInput = document.getElementById("room-number-edit");
const meetingScheduleInput = document.getElementById("meeting-schedule-edit");
const countyInput = document.getElementById("county-edit");
const countyDropdownList = document.getElementById("county-dropdown-list-edit");

countyInput.closest('.club-form-section').style.display = 'none';


let selectedCountyFips = null;

submitButton.disabled = true;
schoolNameInput.disabled = true;
clubNameInput.disabled = true;
clubActivityInput.disabled = true;
clubDescriptionInput.disabled = true;
categoryInput.disabled = true;
clubSponsorInput.disabled = true;
clubLeaderInput.disabled = true;
schoolEmailInput.disabled = true;
roomNumberInput.disabled = true;
meetingScheduleInput.disabled = true;
countyInput.disabled = true;

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

async function loadClubData(clubId, managerUid) {
    if (!clubId) {
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
                hideLoadingScreen();
                showContainerError("You don't have permission to edit this club.");
                return;
            }

            schoolNameInput.value = clubData.schoolName || '';
            clubNameInput.value = clubData.clubName || '';
            clubActivityInput.value = clubData.clubActivity || '';
            clubDescriptionInput.value = clubData.description || '';
            stateInput.value = clubData.state || '';
            clubSponsorInput.value = clubData.clubSponsor || '';
            clubLeaderInput.value = clubData.clubLeader || '';
            schoolEmailInput.value = clubData.schoolEmail || '';
            roomNumberInput.value = clubData.roomNumber || '';
            meetingScheduleInput.value = clubData.meetingSchedule || '';
            handleCountyVisibility(clubData.state || '');
            countyInput.value = clubData.countyName || '';
            selectedCountyFips = clubData.countyFips || null;
            const savedVis = clubData.visibility || 'public';
            editVisStrips.forEach(s => {
                s.classList.toggle('club-vis-strip-selected', s.dataset.value === savedVis);
            });

            schoolNameInput.disabled = false;
            clubNameInput.disabled = false;
            clubActivityInput.disabled = false;
            clubDescriptionInput.disabled = false;
            submitButton.disabled = false;
            stateInput.disabled = false;
            categoryInput.disabled = false;
            clubSponsorInput.disabled = false;
            clubLeaderInput.disabled = false;
            schoolEmailInput.disabled = false;
            roomNumberInput.disabled = false;
            meetingScheduleInput.disabled = false;
            if (!NO_COUNTY_STATES[clubData.state]) {
                countyInput.disabled = false;
            }
            if (clubData.category) categoryInput.value = clubData.category;

            originalClubData = {
                schoolName: clubData.schoolName || '',
                clubName: clubData.clubName || '',
                clubActivity: clubData.clubActivity || '',
                description: clubData.description || '',
                state: clubData.state || '',
                visibility: clubData.visibility || 'public',
                category: clubData.category || '',
                clubSponsor: clubData.clubSponsor || '',
                clubLeader: clubData.clubLeader || '',
                schoolEmail: clubData.schoolEmail || '',
                roomNumber: clubData.roomNumber || '',
                meetingSchedule: clubData.meetingSchedule || '',
                countyName: clubData.countyName || '',
                countyFips: clubData.countyFips || null,
            };

            hideLoadingScreen();
        } else {
            hideLoadingScreen();
            showContainerError("This club doesn't exist.");
        }
    } catch (error) {
        console.error("Error loading club data:", error);
        hideLoadingScreen();
        showContainerError("Oops! Something went wrong.", true);
    }
}


onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    currentUserEmail = user.email;

    if (currentClubId) {
        await loadClubData(currentClubId, currentUser.uid);
    } else {
        hideLoadingScreen();
        showContainerError("No club ID provided.");
    }
});


const editVisStrips = document.querySelectorAll('#visibility-strip-group-edit .club-vis-strip');
editVisStrips.forEach(strip => {
  strip.addEventListener('click', () => {
    editVisStrips.forEach(s => s.classList.remove('club-vis-strip-selected'));
    strip.classList.add('club-vis-strip-selected');
  });
});

function getSelectedVisibilityEdit() {
  const selected = document.querySelector('#visibility-strip-group-edit .club-vis-strip-selected');
  return selected ? selected.dataset.value : null;
}


submitButton.addEventListener("click", async function(event){
    event.preventDefault();

    submitButton.disabled = true;
    setLoading(submitButton)

    if (!currentUser || !currentUser.uid) {
      await showAppAlert("You must be logged in to update a club.");
      console.warn("Attempted club update by unauthenticated user. Aborting.");
      clearLoading(submitButton);
      return;
    }
    if (!currentClubId) {
        await showAppAlert("No club selected for update.");
        console.warn("Attempted club update without a club ID. Aborting.");
        clearLoading(submitButton);
        return;
    }

    const rawSchoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();
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
    const clubVisibility = getSelectedVisibilityEdit();

    if (
        originalClubData &&
        rawSchoolName === originalClubData.schoolName &&
        clubName === originalClubData.clubName &&
        clubActivity === originalClubData.clubActivity &&
        clubDescription === originalClubData.description &&
        state === originalClubData.state &&
        clubVisibility === originalClubData.visibility &&
        clubCategory === originalClubData.category && 
        clubSponsor === originalClubData.clubSponsor &&
        clubLeader === originalClubData.clubLeader &&
        schoolEmail === originalClubData.schoolEmail &&
        roomNumber === originalClubData.roomNumber &&
        meetingSchedule === originalClubData.meetingSchedule &&
        countyInput.value.trim() === originalClubData.countyName &&
        (selectedCountyFips ?? null) === (originalClubData.countyFips ?? null)
    ) {
        await showAppAlert("No changes were made.");
        clearLoading(submitButton);
        return;
    }

    if (!clubName || !rawSchoolName || !state || !clubActivity || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        clearLoading(submitButton);
        return;
    }

    if (clubDescription.length > 500) {
        await showAppAlert("Description must be 500 characters or less.");
        clearLoading(submitButton);
        return;
    }

    const normalizedState = normalizeState(state);
    
    if (!normalizedState) {
        await showAppAlert("Please enter a valid state");
        clearLoading(submitButton);
        return;
    }

    const schoolNameResult = normalizeSchoolName(rawSchoolName);
    let schoolName = rawSchoolName;

    if (!schoolNameResult.valid) {
        const confirmed = await showAppConfirm(`"${rawSchoolName}" looks like an abbreviation. Click YES to continue or NO to correct it.`);
        if (!confirmed) {
            clearLoading(submitButton);
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

    if (!clubVisibility) {
        await showAppAlert("Please select a club visibility.");
        clearLoading(submitButton);
        return;
    }

    try {
        console.log("Attempting to update club data in Firestore...");
        const clubRef = doc(db, "clubs", currentClubId);

        await updateDoc(clubRef, {
            schoolName: schoolName,
            state: normalizedState,
            clubName: clubName,
            clubNameLower: clubName.toLowerCase(),
            schoolNameLower: schoolName.toLowerCase(),
            stateLower: normalizedState.toLowerCase(),
            description: clubDescription,
            clubActivity: clubActivity,
            lastModifiedBy: currentUser.uid,
            lastModifiedAt: serverTimestamp(),
            visibility: clubVisibility,
            category: clubCategory,
            categoryLower: clubCategory.toLowerCase(),
            clubSponsor: clubSponsor,
            clubLeader: clubLeader,
            schoolEmail: schoolEmail,
            roomNumber: roomNumber,
            meetingSchedule: meetingSchedule,
            countyName: countyName,
            countyFips: countyFips || null
        });
        console.log("Club document updated with ID: ", currentClubId);

        await showAppAlert(`Club "${clubName}" updated successfully!`);
        window.location.href = `club_page_manager.html?id=${currentClubId}`;

    } catch (error) {
        console.error("Error updating club:", error);
        await showAppAlert("Failed to update club: " + error.message);
    } finally {
        clearLoading(submitButton);
    }
});


backButton.addEventListener("click", async function(event){
    window.location.href = `club_page_manager.html?id=${currentClubId}`;
});


deleteButton.addEventListener("click", async function(event){
    event.preventDefault();
    setLoading(deleteButton);
    await deleteClub(currentClubId);
    clearLoading(deleteButton);
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
            await showAppAlert(`You are not authorized to delete this club. Only the club ${ROLE_LABELS.manager.toLowerCase()} can perform this action.`);
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
                if (memberUid === managerUid) return Promise.resolve();
                const memberUserDocRef = doc(db, "users", memberUid);
                try {
                    await updateDoc(memberUserDocRef, {
                        member_clubs: arrayRemove(clubId),
                        admin_clubs: arrayRemove(clubId)  // safe even if they weren't admin
                    });
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

        console.log(`Deleting resourceSections subcollection for club ${clubId}...`);
        const resourceSectionsCollectionRef = collection(db, "clubs", clubId, "resourceSections");
        const resourceSectionDocsSnap = await getDocs(resourceSectionsCollectionRef);
        const deleteResourceSectionPromises = [];
        resourceSectionDocsSnap.forEach((sectionDoc) => {
            deleteResourceSectionPromises.push(deleteDoc(sectionDoc.ref));
        });
        await Promise.all(deleteResourceSectionPromises);
        console.log(`All resourceSections for club ${clubId} deleted.`);

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

const states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'Guam', 'U.S. Virgin Islands', 'American Samoa', 'Northern Mariana Islands'];


const NO_COUNTY_STATES = {
  'District of Columbia': { fips: '11001', name: 'District of Columbia' },
  'Puerto Rico': { fips: null, name: 'Puerto Rico' },
  'Guam': { fips: null, name: 'Guam' },
  'U.S. Virgin Islands': { fips: null, name: 'U.S. Virgin Islands' },
  'American Samoa': { fips: null, name: 'American Samoa' },
  'Northern Mariana Islands': { fips: null, name: 'Northern Mariana Islands' },
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
    'DC': 'District of Columbia',
    'D.C.': 'District of Columbia',
};

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


const stateDropdownList = document.getElementById('state-dropdown-list-edit');

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

  let pool = currentState
    ? COUNTIES.filter(c => c.state === currentState)
    : COUNTIES;

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

function normalizeSchoolName(schoolName) {
    const trimmed = schoolName.trim();
    
    if (!trimmed) {
        return { valid: false, normalized: '', error: 'Please enter a school name.' };
    }

    const words = trimmed.split(' ');
    
    if (words.length === 1) {
        const word = words[0];
        if (word.length >= 2 && word.length <= 5 && /^[a-zA-Z]+$/.test(word)) {
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

    if (normalized.toLowerCase().endsWith(' high')) normalized = normalized + ' School';
    if (normalized.toLowerCase().endsWith(' middle')) normalized = normalized + ' School';
    if (normalized.toLowerCase().endsWith(' elementary')) normalized = normalized + ' School';

    while (normalized.includes('  ')) {
        normalized = normalized.replace('  ', ' ');
    }
    normalized = normalized.trim();
    
    return { valid: true, normalized: normalized, error: '' };
}



function showContainerError(message, showRetry = false, topMargin = '165px') {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
        <div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button type="button" class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}
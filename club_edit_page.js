import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
// REMOVED: let currentUserRoles = []; // This is no longer needed for club-specific admin status

function getClubIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('clubId');
}
currentClubId = getClubIdFromUrl();


const submitButton = document.getElementById("submit-club-button");
const schoolNameInput = document.getElementById("school-name-edit");
const clubNameInput = document.getElementById("club-name-edit");
const clubActivityInput = document.getElementById("main-activity-edit");
const clubDescriptionInput = document.getElementById("description-edit");

submitButton.disabled = true;
schoolNameInput.disabled = true;
clubNameInput.disabled = true;
clubActivityInput.disabled = true;
clubDescriptionInput.disabled = true;


// MODIFIED: Removed 'userRoles' parameter as it's not applicable here
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
      let isAdminOfThisClub = false; // Flag to check if current user is an admin for THIS club

      // NEW AUTHORIZATION LOGIC:
      // If the user is not the direct manager, we check if they are an admin for *this specific club*
      if (!isManager && managerUid) { // Ensure managerUid (currentUser.uid) is available
          const memberRef = doc(db, "clubs", clubId, "members", managerUid);
          const memberDoc = await getDoc(memberRef); // Fetch the member document for the current user
          if (memberDoc.exists() && memberDoc.data().role === 'admin') {
              isAdminOfThisClub = true;
          }
      }

      // User is authorized if they are the manager OR an admin of *this specific club*
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

      schoolNameInput.disabled = false;
      clubNameInput.disabled = false;
      clubActivityInput.disabled = false;
      clubDescriptionInput.disabled = false;
      submitButton.disabled = false;

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

// REMOVED: async function fetchUserRoles(uid) {...} // This function is no longer relevant for club-specific roles


onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    currentUserEmail = user.email;
    console.log("User is logged in. UID:", currentUser.uid, "Email:", currentUserEmail);

    // REMOVED: await fetchUserRoles(currentUser.uid); // Not needed now
    
    if (currentClubId) {
      // MODIFIED CALL: 'currentUserRoles' parameter removed
      await loadClubData(currentClubId, currentUser.uid);
    } else {
        await showAppAlert("No club ID specified for editing.");
        window.location.href = `club_page_manager.html?id=${currentClubId}`;
    }

  } else {
    currentUser = null;
    currentUserEmail = null;
    // REMOVED: currentUserRoles = []; // Not needed now
    console.warn("No user is logged in. Redirecting to login.");
    await showAppAlert("You must be logged in to edit a club.");
    window.location.href = "login.html";
  }
});


submitButton.addEventListener("click", async function(event){
    event.preventDefault();

    submitButton.disabled = true;
    submitButton.textContent = "Updating Club...";

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

    const schoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();
    const clubDescription = clubDescriptionInput.value.trim();

    if (!clubName || !schoolName || !clubActivity || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        submitButton.disabled = false;
        submitButton.textContent = "UPDATE";
        return;
    }

    try {
        console.log("Attempting to update club data in Firestore...");
        const clubRef = doc(db, "clubs", currentClubId);

        await updateDoc(clubRef, {
            schoolName: schoolName,
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

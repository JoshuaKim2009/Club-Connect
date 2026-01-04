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
// REMOVED: let currentUserRoles = []; // This is no longer needed for club-specific admin status

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
    // submitButton.textContent = "Updating Club...";

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

        // --- Authorization Check: Only the manager can delete the club ---
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


        // IMPORTANT: First, get all member UIDs *before* deleting the members subcollection documents.
        console.log(`Fetching members for club ${clubId} to update their user profiles...`);
        const membersCollectionRef = collection(db, "clubs", clubId, "members");
        const memberDocsSnap = await getDocs(membersCollectionRef);
        const memberUIDsToUpdate = [];
        memberDocsSnap.forEach((memberDoc) => {
            memberUIDsToUpdate.push(memberDoc.id); // memberDoc.id is the memberUid
        });
        console.log(`Found ${memberUIDsToUpdate.length} members to update their user profiles.`);

        // Update each member's user document to remove the club from their `member_clubs` array
        if (memberUIDsToUpdate.length > 0) {
            console.log(`Removing club ID ${clubId} from all members' 'member_clubs' lists...`);
            const updateMemberPromises = memberUIDsToUpdate.map(async (memberUid) => {
                // Skip updating the manager's member_clubs, as their managed_clubs is handled separately
                // and they might be the same array, leading to redundancy or issues if both exist.
                if (memberUid === managerUid) {
                    console.log(`Skipping member_clubs update for manager UID ${memberUid}.`);
                    return Promise.resolve(); // Resolve immediately for manager
                }
                const memberUserDocRef = doc(db, "users", memberUid);
                try {
                    await updateDoc(memberUserDocRef, {
                        member_clubs: arrayRemove(clubId) // Assuming you have a 'member_clubs' array for members
                    });
                    console.log(`Club ID ${clubId} removed from member ${memberUid}'s 'member_clubs' list.`);
                } catch (memberUpdateError) {
                    // Log the error but don't stop the entire deletion process
                    console.error(`Error removing club ID from member ${memberUid}'s profile:`, memberUpdateError);
                }
            });
            await Promise.all(updateMemberPromises);
            console.log("All members' 'member_clubs' lists updated.");
        }


        // 1. Delete all documents in the 'members' subcollection
        console.log(`Deleting members subcollection for club ${clubId}...`);
        // We already have memberDocsSnap from above, so we can reuse it
        const deleteMemberSubcollectionPromises = [];
        memberDocsSnap.forEach((memberDoc) => {
            deleteMemberSubcollectionPromises.push(deleteDoc(memberDoc.ref));
        });
        await Promise.all(deleteMemberSubcollectionPromises); // Wait for all member documents to be deleted
        console.log(`All members subcollection documents for club ${clubId} deleted.`);

        // 1b. Delete all documents in the 'events' subcollection
        console.log(`Deleting events subcollection for club ${clubId}...`);
        const eventsCollectionRef = collection(db, "clubs", clubId, "events");
        const eventDocsSnap = await getDocs(eventsCollectionRef);
        const deleteEventSubcollectionPromises = [];
        eventDocsSnap.forEach((eventDoc) => {
            deleteEventSubcollectionPromises.push(deleteDoc(eventDoc.ref));
        });
        await Promise.all(deleteEventSubcollectionPromises); // Wait for all event documents to be deleted
        console.log(`All events subcollection documents for club ${clubId} deleted.`);

        // 1c. Delete all documents in the 'occurrenceRsvps' subcollection
        console.log(`Deleting occurrenceRsvps subcollection for club ${clubId}...`);
        const rsvpsCollectionRef = collection(db, "clubs", clubId, "occurrenceRsvps");
        const rsvpDocsSnap = await getDocs(rsvpsCollectionRef);
        const deleteRsvpSubcollectionPromises = [];
        rsvpDocsSnap.forEach((rsvpDoc) => {
            deleteRsvpSubcollectionPromises.push(deleteDoc(rsvpDoc.ref));
        });
        await Promise.all(deleteRsvpSubcollectionPromises); // Wait for all RSVP documents to be deleted
        console.log(`All occurrenceRsvps subcollection documents for club ${clubId} deleted.`);

        // 2. Delete the main club document
        console.log(`Deleting club document with ID: ${clubId}...`);
        await deleteDoc(clubRef);
        console.log(`Club document ${clubId} deleted.`);

        // 3. Delete the associated join code document
        if (joinCode) {
            console.log(`Deleting join code ${joinCode}...`);
            const joinCodeRef = doc(db, "join_codes", joinCode);
            await deleteDoc(joinCodeRef);
            console.log(`Join code ${joinCode} deleted.`);
        }

        // 4. Remove the club ID from the manager's 'managed_clubs' list
        console.log(`Removing club ID ${clubId} from manager ${currentUser.uid}'s managed_clubs list...`);
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            managed_clubs: arrayRemove(clubId)
        });
        console.log(`Club ID ${clubId} removed from manager's managed_clubs list.`);

        await showAppAlert(`Club "${clubData.clubName}" has been successfully deleted.`);
        // Optional: Redirect user to a different page, e.g., their clubs list
        window.location.href = "your_clubs.html"; // <-- You might want to change this redirect destination

    } catch (error) {
        console.error("Error deleting club:", error);
        await showAppAlert("Failed to delete club: " + error.message);
    }
}
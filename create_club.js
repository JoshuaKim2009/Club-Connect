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


submitButton.disabled = true;

submitButton.addEventListener("click", async function(event){
    event.preventDefault();
    submitButton.disabled = true;

    if (!currentUser || !currentUser.uid) {
      await showAppAlert("You must be logged in to create a club.");
      console.warn("Attempted club creation by unauthenticated user. Aborting.");
      return; 
    }

    const schoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubDescription = clubDescriptionInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();

    if (!clubName || !schoolName || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        return; 
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

/**
 * Generates and reserves a unique 6-digit join code using a Firestore transaction.
 * This function will retry until a unique code is successfully written to the 'join_codes' collection.
 * @returns {Promise<string>} A promise that resolves with the unique join code.
 */
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
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
// IMPORTANT: Ensure getAuth and onAuthStateChanged are imported for authentication
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
// IMPORTANT: Ensure collection, addDoc, updateDoc, and arrayUnion are imported for Firestore
import { getFirestore, doc, setDoc, collection, addDoc, updateDoc, arrayUnion, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';


// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
  authDomain: "club-connect-data.firebaseapp.com",
  projectId: "club-connect-data",
  storageBucket: "club-connect-data.firebasestorage.app",
  messagingSenderId: "903230180616",
  appId: "1:903230180616:web:a13856c505770bcc0b30bd",
  measurementId: "G-B8DR377JX6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const db = getFirestore(app); // Initialize Firestore
const auth = getAuth(app);    // Initialize Firebase Authentication

// Variables to hold the current user's object and email
let currentUser = null;
let currentUserEmail = null;
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';

// Listen for authentication state changes to get the current user
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user; // Store the full user object
    currentUserEmail = user.email;
    console.log("User is logged in. UID:", currentUser.uid, "Email:", currentUserEmail);
    // You might want to enable your form submit button here
    document.getElementById("submit-club-button").disabled = false;
  } else {
    currentUser = null;
    currentUserEmail = null;
    console.warn("No user is logged in. Club creation will not have an manager and cannot link to user profile.");
    // You might want to disable your form submit button here
    document.getElementById("submit-club-button").disabled = true;
    // Consider redirecting to login or showing a login prompt
  }
});

// References to your HTML elements (ensure these IDs exist in your HTML)
const submitButton = document.getElementById("submit-club-button");
const schoolNameInput = document.getElementById("school-name-select");
const clubNameInput = document.getElementById("club-name-select");
const clubDescriptionInput = document.getElementById("description-input");
const clubActivityInput = document.getElementById("main-activity-select");


// Initially disable the submit button until auth state is confirmed
submitButton.disabled = true;

// Event listener for the submit button
submitButton.addEventListener("click", async function(event){
    event.preventDefault(); // Prevent default form submission
    submitButton.disabled = true; // Disable the button
    submitButton.textContent = "Creating Club..."; // Optional: change button text for feedback

    // --- CRITICAL CHECK: Ensure a user is logged in ---
    if (!currentUser || !currentUser.uid) {
      await showAppAlert("You must be logged in to create a club.");
      console.warn("Attempted club creation by unauthenticated user. Aborting.");
      return; // Stop execution
    }
    // --- END CRITICAL CHECK ---

    const schoolName = schoolNameInput.value.trim();
    const clubName = clubNameInput.value.trim();
    const clubDescription = clubDescriptionInput.value.trim();
    const clubActivity = clubActivityInput.value.trim();

    // Basic form validation
    if (!clubName || !schoolName || !clubDescription) {
        await showAppAlert("Please fill in all club details.");
        return; // Stop execution if validation fails
    }

    try {
        console.log("Attempting to save club data to Firestore...");
        const joinCode = await getUniqueJoinCode();
        if (!joinCode) {
            await showAppAlert("Failed to generate a unique join code. Please try again.");
            return; // Stop if code generation fails
        }
        console.log(`Generated and reserved unique join code: ${joinCode}`);

        // 1. Create the new club document with an auto-generated ID
        // We use doc() first to get a new ID, then set the data with setDoc.
        const newClubRef = doc(collection(db, "clubs")); // Get a reference for a new document
        const newClubId = newClubRef.id; // Get the auto-generated ID

        await setDoc(newClubRef, { // Use setDoc on the newClubRef
            schoolName: schoolName,
            clubName: clubName,
            description: clubDescription,
            clubActivity: clubActivity,
            managerEmail: currentUserEmail,
            joinCode: joinCode,
            // Initialize memberUIDs with the manager's UID
            memberUIDs: [currentUser.uid],
            pendingMemberUIDs: [], // Start with an empty list
            managerUid: currentUser.uid, // Store the UID of the manager
            createdAt: serverTimestamp() // Use serverTimestamp for a reliable timestamp
        });
        console.log("Club document written with ID: ", newClubId);

        // 2. Call the helper function to create the manager's role document in the 'members' subcollection
        await createManagerMemberEntry(newClubId, currentUser.uid);

        // 3. Link the join code to the new club ID
        const joinCodeRef = doc(db, "join_codes", joinCode);
        await updateDoc(joinCodeRef, { clubId: newClubId, reserved: false });
        console.log(`Join code ${joinCode} linked to club ID ${newClubId}.`);


        // 4. Add the new club's ID to the current user's 'managed_clubs' list in the 'users' collection
        console.log(`Attempting to add club ID ${newClubId} to user ${currentUser.uid}'s managed_clubs list in 'users' collection...`);
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            managed_clubs: arrayUnion(newClubId)
        });
        console.log("User's managed_clubs list in 'users' collection updated successfully.");

        await showAppAlert(`Club "${clubName}" saved successfully!`);
        window.location.href = "your_clubs.html";

        // Optionally, clear the form fields after successful submission
        schoolNameInput.value = '';
        clubNameInput.value = '';
        clubDescriptionInput.value = '';
        clubActivityInput.value = '';

    } catch (error) {
        console.error("Error creating club or updating user profile:", error);
        await showAppAlert("Failed to create club: " + error.message);
    } finally {
        submitButton.disabled = false; // Re-enable the button
        submitButton.textContent = "Create Club"; // Reset button text
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
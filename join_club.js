import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, updateDoc, arrayUnion, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert, showAppConfirm } from './dialog.js';


// Your Firebase configuration (this should be the same as in your other Firebase scripts)
const firebaseConfig = {
  apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
  authDomain: "club-connect-data.firebaseapp.com",
  projectId: "club-connect-data",
  storageBucket: "club-connect-data.firebasestorage.app",
  messagingSenderId: "903230180616",
  appId: "1:903230180616:web:a13856c505770bcc0b30bd",
  measurementId: "G-B8DR377JX6"
};

// Initialize Firebase services
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);


let currentUserUid = null; // Declare a variable to store the UID globally

onAuthStateChanged(auth, (user) => {
    if (user) {
    // User is signed in.
    currentUserUid = user.uid; // <-- HERE IS THE USER UID
    console.log("Current User UID:", currentUserUid);
    // You can now use currentUserUid for Firestore queries, etc.
    } else {
    // No user is signed in.
    currentUserUid = null;
    console.log("No user is signed in.");
    }
});


const clubNameInput = document.getElementById("club-name-input");
const joinCodeInput = document.getElementById("join-code-input");
const submitButton = document.getElementById("submit-join-club-button"); 

if (submitButton) {
    submitButton.addEventListener("click", async (event) => { // <-- ADD 'async' here
        event.preventDefault();

        if (!currentUserUid) {
            await showAppAlert("You must be logged in to join a club.", "Authentication Required");
            return; // Stop execution if not logged in
        }
        
        const enteredClubName = clubNameInput.value.trim();
        const enteredJoinCode = joinCodeInput.value.trim().toUpperCase();

        if (enteredClubName && enteredJoinCode) {
            console.log("All fields are filled out! Proceeding to check club existence.");
            console.log("Entered Club Name:", enteredClubName);
            console.log("Entered Join Code:", enteredJoinCode);

            // The 'await' keyword is crucial here because checkIfClubExists is an async function
            const clubUID = await checkIfClubExists(enteredClubName, enteredJoinCode);
            console.log("Result from checkIfClubExists (clubUID):", clubUID);

            if (!clubUID){
                await showAppAlert("This club does not exist", "Club not found");
            }

            


            
            const clubDocRef = doc(db, "clubs", clubUID);
            const clubSnap = await getDoc(clubDocRef);

            if (!clubSnap.exists()) {
                await showAppAlert("Club data not found. This is unexpected. Please try again.", "Error");
                return; 
            }

            const clubData = clubSnap.data();
            const clubManagerUid = clubData.managerUid; 

            // 1. Check if the current user is the manager
            if (clubManagerUid === currentUserUid) {
                await showAppAlert("You are already the manager of this club. You cannot join your own club.", "Already a Member");
                return; // Stop execution
            }

            const pendingMembers = clubData.pendingMemberUIDs || [];
            const approvedMembers = clubData.memberUIDs || [];

            if (pendingMembers.includes(currentUserUid)) {
                await showAppAlert("You have already sent a request to join this club.", "Request Already Sent");
                return;
            }
            if (approvedMembers.includes(currentUserUid)) {
                await showAppAlert("You are already a member of this club.", "Already a Member");
                return; 
            }


            
            
            
            await addPendingMemberRequest(clubUID);
            window.location.href = "your_clubs.html";
            





        } else {
            console.log("Some fields are empty. Please fill them all.");
            if (!enteredClubName) console.log("Missing: Club Name");
            if (!enteredJoinCode) console.log("Missing: Join Code");
        }
    });
}




async function addPendingMemberRequest(clubId) {
    if (!currentUserUid) {
        console.error("No user logged in to send a pending member request.");
        throw new Error("User not authenticated.");
    }

    try {
        const clubDocRef = doc(db, "clubs", clubId); // Get a reference to the specific club document

        await updateDoc(clubDocRef, {
            pendingMemberUIDs: arrayUnion(currentUserUid) // Add the current user's UID to the list
        });
        console.log(`User ${currentUserUid} added to pendingMemberUIDs for club ${clubId}.`);
        await showAppAlert("Join request sent to be reviewed!");
    } catch (error) {
        await showAppAlert("Join request failed!");
        console.error(`Error adding user ${currentUserUid} to pendingMemberUIDs for club ${clubId}:`, error);
        throw error; // Re-throw the error so the caller can handle it
        
    }
}


async function checkIfClubExists(clubName, joinCode) {
    const normalizedClubName = clubName.toLowerCase();

    try {
        const clubsRef = collection(db, "clubs");
        const q = query(clubsRef, where("joinCode", "==", joinCode));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log(`[checkIfClubExists] No club found with join code: ${joinCode}`);
            return null;
        }

        let foundClubId = null;
        querySnapshot.forEach(docSnap => {
            const clubData = docSnap.data();
            if (clubData.clubName && clubData.clubName.toLowerCase() === normalizedClubName) {
                foundClubId = docSnap.id;
            }
        });

        if (foundClubId) {
            console.log(`[checkIfClubExists] Club found: ID ${foundClubId}, Name: ${clubName}, Code: ${joinCode}`);
            return foundClubId;
        } else {
            console.log(`[checkIfClubExists] Club found by code (${joinCode}) but name (${clubName}) did not match.`);
            return null;
        }

    } catch (error) {
        console.error("[checkIfClubExists] Error checking club existence:", error);
        return null;
    }
}

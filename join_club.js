import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, updateDoc, arrayUnion, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const db = getFirestore(app);
const auth = getAuth(app);


let currentUserUid = null; 

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid; 
        console.log("Current User UID:", currentUserUid);
    } else {
        currentUserUid = null;
        console.log("No user is signed in.");
    }
});


const clubNameInput = document.getElementById("club-name-input");
const joinCodeInput = document.getElementById("join-code-input");
const submitButton = document.getElementById("submit-join-club-button"); 

if (submitButton) {
    submitButton.addEventListener("click", async (event) => {
        event.preventDefault();

        if (!currentUserUid) {
            await showAppAlert("You must be logged in to join a club.", "Authentication Required");
            return;
        }
        
        const enteredClubName = clubNameInput.value.trim();
        const enteredJoinCode = joinCodeInput.value.trim().toUpperCase();

        if (enteredClubName && enteredJoinCode) {
            console.log("All fields are filled out! Proceeding to check club existence.");
            console.log("Entered Club Name:", enteredClubName);
            console.log("Entered Join Code:", enteredJoinCode);

            const clubUID = await checkIfClubExists(enteredClubName, enteredJoinCode);
            console.log("Result from checkIfClubExists (clubUID):", clubUID);

            if (!clubUID){
                await showAppAlert("This club does not exist", "Club not found");
                return;
            }

            


            
            const clubDocRef = doc(db, "clubs", clubUID);
            const clubSnap = await getDoc(clubDocRef);

            if (!clubSnap.exists()) {
                await showAppAlert("Club data not found. This is unexpected. Please try again.", "Error");
                return; 
            }

            const clubData = clubSnap.data();
            const clubManagerUid = clubData.managerUid; 

            if (clubManagerUid === currentUserUid) {
                await showAppAlert("You are already the manager of this club. You cannot join your own club.", "Already a Member");
                return; 
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
        const clubDocRef = doc(db, "clubs", clubId);

        await updateDoc(clubDocRef, {
            pendingMemberUIDs: arrayUnion(currentUserUid)
        });
        console.log(`User ${currentUserUid} added to pendingMemberUIDs for club ${clubId}.`);
        await showAppAlert("Join request sent to be reviewed!");
    } catch (error) {
        await showAppAlert("Join request failed!");
        console.error(`Error adding user ${currentUserUid} to pendingMemberUIDs for club ${clubId}:`, error);
        throw error;
        
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



document.getElementById("discover-club-button").addEventListener("click", (e) => {
    window.location.href = "club_discovery.html";
});
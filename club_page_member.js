import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// Only import necessary Firestore functions for reading data
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
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
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null; // To store the current Firebase Auth user object

// Function to get a query parameter from the URL
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Get the clubId from the URL
const clubId = getUrlParameter('id');

const clubPageTitle = document.getElementById('clubPageTitle');
const clubDetailsDiv = document.getElementById('clubDetails');
const membersContainer = document.getElementById('membersContainer'); 

// Variables specific to THIS club and THIS user's view
var managerName = "";
var managerUid = "";
var myName = "";
var myUid = "";
var myCurrentRoleInClub = ""; // To store the current user's role for this specific club

// --- NEW AUTHENTICATION LOGIC ---
onAuthStateChanged(auth, async (user) => {
    currentUser = user; 
    if (user) {
        myUid = user.uid;
        myName = user.displayName || user.email; // Use display name or email as fallback

        console.log("User is authenticated on club member page. UID:", myUid, "Name:", myName);
        if (clubId) {
            clubPageTitle.textContent = ""; // Clear initial title
            await fetchClubDetails(clubId, myUid, myName); 
        } else {
            clubPageTitle.textContent = "Error: No Club ID provided";
            clubDetailsDiv.innerHTML = "<p>Please return to your clubs page and select a club.</p>";
        }
    } else {
        console.log("No user authenticated on club member page. Redirecting to login.");
        clubPageTitle.textContent = "Not Authenticated";
        clubDetailsDiv.innerHTML = "<p>You must be logged in to view club details. Redirecting...</p>";
        setTimeout(() => {
            window.location.href = 'login.html'; 
        }, 2000);
    }
});
// --- END NEW AUTHENTICATION LOGIC ---


async function fetchClubDetails(id, currentUserId, currentUserName) {
    try {
        const clubRef = doc(db, "clubs", id);
        const clubSnap = await getDoc(clubRef);

        // Fetch the current user's role for this specific club
        myCurrentRoleInClub = await getMemberRoleForClub(id, currentUserId);

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            console.log("Fetched club data:", clubData);

            // Access check: User must be an manager, admin, or member to view this page
            if (myCurrentRoleInClub === 'manager' || myCurrentRoleInClub === 'admin' || myCurrentRoleInClub === 'member') {
                // Fetch the actual manager's name using their UID from clubData
                const actualManagerUid = clubData.managerUid;
                let actualManagerName = 'Unknown Manager';

                if (actualManagerUid) {
                    const managerUserRef = doc(db, "users", actualManagerUid);
                    const managerUserSnap = await getDoc(managerUserRef);
                    if (managerUserSnap.exists() && managerUserSnap.data().name) {
                        actualManagerName = managerUserSnap.data().name;
                    }
                }

                managerName = actualManagerName; 
                managerUid = actualManagerUid;   

                clubPageTitle.textContent = (clubData.clubName || 'Unnamed Club');

                clubDetailsDiv.innerHTML = `
                    <div class="club-info-container">
                        <p>MANAGER | ${actualManaferName}</p>
                        <p>Your Role | ${myCurrentRoleInClub.toUpperCase()}</p> <!-- Display user's role -->
                        <p>Join Code | <button id="copyJoinCodeButton" class="copy-button">${clubData.joinCode || 'N/A'}</button></p>
                    </div>
                `;

                const copyButton = document.getElementById('copyJoinCodeButton');
                if (copyButton && clubData.joinCode) { // Ensure button exists and there's a code to copy
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton); // Pass the button element itself
                    });
                }

                // --- Collect data for ALL APPROVED members (including manager/admin if they are in memberUIDs) ---
                const approvedMemberUids = clubData.memberUIDs || [];
                const approvedMemberNames = [];
                const approvedMemberIds = [];
                const approvedMemberRoles = [];

                // Fetch roles for all approved members concurrently
                // This ensures each member's role is known for display
                const memberRolePromises = approvedMemberUids.map(memberUid => getMemberRoleForClub(id, memberUid));
                const memberRoles = await Promise.all(memberRolePromises);

                for (let i = 0; i < approvedMemberUids.length; i++) {
                    const memberUid = approvedMemberUids[i];
                    const userRef = doc(db, "users", memberUid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        approvedMemberNames.push(userData.name || `User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member'); // Use fetched role or default
                    } else {
                        console.warn(`User document not found for approved member UID: ${memberUid}`);
                        approvedMemberNames.push(`Unknown User (${memberUid})`);
                        approvedMemberIds.push(memberUid);
                        approvedMemberRoles.push(memberRoles[i] || 'member');
                    }
                }
                
                // Call the simplified display function for members
                displayMembersForMemberPage(approvedMemberNames, approvedMemberIds, approvedMemberRoles);


            } else { // User is neither manager, admin, nor member
                clubPageTitle.textContent = "Access Denied";
                clubDetailsDiv.innerHTML = "<p>You do not have permission to view this club.</p>";
                console.warn(`User ${currentUserId} attempted to view club ${id} but is not a member.`);
                // Redirect user back to their clubs page after a delay
                setTimeout(() => {
                    window.location.href = 'your_clubs.html';
                }, 2000);
            }


        } else { // Club document does not exist
            clubPageTitle.textContent = "Club Not Found";
            clubDetailsDiv.innerHTML = "<p>Sorry, this club does not exist.</p>";
            console.warn(`Club document with ID ${id} not found.`);
            setTimeout(() => {
                window.location.href = 'your_clubs.html';
            }, 2000);
        }
    } catch (error) {
        console.error("Error fetching club details:", error);
        clubPageTitle.textContent = "Error Loading Club";
        clubDetailsDiv.innerHTML = "<p>An error occurred while loading club details. Please try again.</p>";
    }
}



async function getMemberRoleForClub(clubID, memberUid) {
  if (!clubID || !memberUid) {
    console.warn("getMemberRoleForClub: clubID or memberUid is missing.");
    return null;
  }
  try {
    const memberRoleRef = doc(db, "clubs", clubID, "members", memberUid);
    const memberRoleSnap = await getDoc(memberRoleRef);
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      // Fallback: Check if they are the manager from the main club document
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef);
      if (clubSnap.exists() && clubSnap.data().managerUid === memberUid) {
          return 'manager'; 
      }
      console.warn(`Role document not found for user ${memberUid} in club ${clubID}. Defaulting to 'member'.`);
      return 'member'; 
    }
  } catch (error) {
    console.error(`Error fetching role for user ${memberUid} in club ${clubID}:`, error);
    return null; 
  }
}


async function copyToClipboard(originalCode, buttonElement) {
    try {
        await navigator.clipboard.writeText(originalCode);

        // Store original button text and then change it
        const originalButtonText = buttonElement.textContent;
        buttonElement.textContent = ' Copied! ';
        buttonElement.disabled = true; // Disable the button to prevent re-clicks

        // Revert text and re-enable button after a short delay
        setTimeout(() => {
            buttonElement.textContent = originalButtonText; // Restore original text
            buttonElement.disabled = false; // Re-enable the button
        }, 850); 

    } catch (err) {
        console.error('Failed to copy text:', err);
        await showAppAlert('Failed to copy Join Code. Please copy it manually: ' + originalCode);
    }
}



function displayMembersForMemberPage(memberNames, memberUids, memberRoles) {
    if (!membersContainer) {
        console.error("HTML element with id 'membersContainer' not found. Please add it to your HTML.");
        return;
    }

    membersContainer.innerHTML = ""; // Clear any previous content
   
    const title = document.createElement("h3");
    title.textContent = "CLUB MEMBERS"; // A more general title for the member list
    membersContainer.appendChild(title);

    if (memberNames.length === 0) {
        const noMembers = document.createElement("p");
        noMembers.className = 'fancy-label'; 
        noMembers.textContent = "No members in this club yet.";
        membersContainer.appendChild(noMembers);
        return;
    }

    memberNames.forEach((name, index) => {
        const memberUid = memberUids[index];
        const memberRole = memberRoles[index];

        const memberCardDiv = document.createElement("div");
        memberCardDiv.className = "member-card"; // Re-use styling if defined in your CSS

        const nameDisplayDiv = document.createElement("div");
        let displayName = name;
        displayName = `${name}`;

        nameDisplayDiv.innerHTML = `${displayName} <span class="member-role-text">${memberRole.toUpperCase()}</span>`;
        nameDisplayDiv.className = "member-name-display";
        memberCardDiv.appendChild(nameDisplayDiv);
        
        // NO ACTION BUTTONS FOR REGULAR MEMBERS ON THIS PAGE
        // If you need "leave club" functionality, that would be a separate button outside this list.

        membersContainer.appendChild(memberCardDiv);
    });
}


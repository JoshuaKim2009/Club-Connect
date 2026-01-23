import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, setDoc, deleteDoc, serverTimestamp, runTransaction, query, orderBy, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";


import { showAppAlert, showAppConfirm } from './dialog.js';


// Your web app's Firebase configuration (replicated from your_clubs.js for self-containment)
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
const auth = getAuth(app); // Initialize auth here too!

let currentUser = null; // To store the authenticated user

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
var managerName = "";
var managerUid = "";
var myName = "";
var myUid = "";
let lastKnownCurrentUserRole = null;



const popupOverlay = document.getElementById('popup-overlay');
const roleManagementPopup = document.getElementById('role-management-popup');
const memberNameForRoleDisplay = document.getElementById('member-name-for-role');
const roleSelect = document.getElementById('role-select');
const submitRoleChangeButton = document.getElementById('submit-role-change');
const cancelRoleChangeButton = document.getElementById('cancel-role-change');

const pendingRequestsContainer = document.getElementById('pendingRequestsContainer');

let currentMemberRoleInPopup = null;
let selectedMemberUid = null; // To store the UID of the member whose role is being managed

// --- NEW AUTHENTICATION LOGIC ---
onAuthStateChanged(auth, async (user) => {
    currentUser = user; // Update the global currentUser
    if (user) {
        console.log("User is authenticated on club manager page:", user.uid);
        if (clubId) {
            clubPageTitle.textContent = "";
            myName = user.displayName;
            myUid = user.uid;
            await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, true);
        } else {
            clubPageTitle.textContent = "Error: No Club ID provided";
            clubDetailsDiv.innerHTML = "<p>Please return to your clubs page and select a club.</p>";
        }
    } else {
        console.log("No user authenticated on club manager page. Redirecting to login.");
        clubPageTitle.textContent = "Not Authenticated";
        clubDetailsDiv.innerHTML = "<p>You must be logged in to view club details. Redirecting...</p>";
        // Redirect to login page after a short delay
        setTimeout(() => {
            window.location.href = 'login.html'; // Assuming you have a login.html
        }, 2000);
    }
});
// --- END NEW AUTHENTICATION LOGIC ---

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchClubDetails(id, currentUserId, currentUserName, animateCardEntry, skipEvents = false) {
    try {
        const clubRef = doc(db, "clubs", id);
        
        const clubSnap = await getDoc(clubRef, { source: 'server' });

        const currentUserRole = await getMemberRoleForClub(id, currentUserId);
        if (lastKnownCurrentUserRole !== null && lastKnownCurrentUserRole !== currentUserRole) {
            await showAppAlert(`Your role for this club has been updated to ${capitalizeFirstLetter(currentUserRole)}!`);
        }
        lastKnownCurrentUserRole = currentUserRole;

        if (currentUserRole !== 'manager' && currentUserRole !== 'admin') {
            console.log(`User ${currentUserId} is a ${currentUserRole} for club ${id}. Redirecting to member page.`);
            window.location.href = `club_page_member.html?id=${id}`;
            return; // Important: Exit the function after redirecting
        }

        if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            console.log("Fetched club data:", clubData);

            // IMPORTANT: Add a check here to ensure the logged-in user is the manager
            if (clubData.managerUid === currentUserId || currentUserRole === 'manager' || currentUserRole === 'admin') {
                clubPageTitle.textContent = (clubData.clubName || 'Unnamed Club');

                const actualManagerUid = clubData.managerUid;
                let actualManagerName = 'Unknown Manager';

                if (actualManagerUid) {
                    const managerUserRef = doc(db, "users", actualManagerUid);
                    const managerUserSnap = await getDoc(managerUserRef, { source: 'server' });
                    if (managerUserSnap.exists() && managerUserSnap.data().name) {
                        actualManagerName = managerUserSnap.data().name;
                    }
                }

                managerName = actualManagerName;
                managerUid = actualManagerUid;

                // Display other club details
                clubDetailsDiv.innerHTML = `
                    <div class="club-info-container">
                        <p>Manager | ${actualManagerName}</p>
                        <p>Your Role | ${capitalizeFirstLetter(currentUserRole)}</p>
                        <p>Join Code | <button id="copyJoinCodeButton" class="copy-button">${clubData.joinCode || 'N/A'}</button></p>
                    </div>
                `;

                const copyButton = document.getElementById('copyJoinCodeButton');
                if (copyButton && clubData.joinCode) { // Ensure button exists and there's a code to copy
                    copyButton.addEventListener('click', () => {
                        copyToClipboard(clubData.joinCode, copyButton); // Pass the button element itself
                    });
                }
            } else {
                clubPageTitle.textContent = "Access Denied";
                clubDetailsDiv.innerHTML = "<p>You do not have permission to view details for this club.</p>";
                console.warn(`User ${currentUserId} attempted to view club ${id} but is not the manager (${clubData.managerUid}).`);
            }

            const pendingMemberUids = clubData.pendingMemberUIDs || []; // Get the array of UIDs, default to empty if not present
            const memberNames = [];
            const memberIds = []; // To store UIDs for the display function

            for (const memberUid of pendingMemberUids) {
                const userRef = doc(db, "users", memberUid);
                const userSnap = await getDoc(userRef, { source: 'server' });

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    memberNames.push(userData.name || `User (${memberUid})`); // Use the user's 'name' field
                    memberIds.push(memberUid);
                } else {
                    console.warn(`User document not found for pending member UID: ${memberUid}`);
                    memberNames.push(`Unknown User (${memberUid})`);
                    memberIds.push(memberUid);
                }
            }

            

            const approvedMemberUids = clubData.memberUIDs || []; // Get the array of APPROVED UIDs
            const approvedMemberNames = [];
            const approvedMemberIds = [];
            // >>>>>>>>>>> THIS LINE DECLARES IT <<<<<<<<<<<<<
            const approvedMemberRoles = []; // <--- This line is essential for 'approvedMemberRoles' to be defined!

            for (const memberUid of approvedMemberUids) {
                const userRef = doc(db, "users", memberUid);
                const userSnap = await getDoc(userRef, { source: 'server' });

                // Fetch member role from subcollection
                const memberRoleRef = doc(db, "clubs", id, "members", memberUid);
                const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
                let memberRole = 'member'; // Default role if not found

                if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
                    memberRole = memberRoleSnap.data().role;
                }

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    approvedMemberNames.push(userData.name || `User (${memberUid})`);
                    approvedMemberIds.push(memberUid);
                    approvedMemberRoles.push(memberRole);
                } else {
                    console.warn(`User document not found for approved member UID: ${memberUid}`);
                    approvedMemberNames.push(`Unknown User (${memberUid})`);
                    approvedMemberIds.push(memberUid);
                    approvedMemberRoles.push(memberRole);
                }
            }

            //Sorting for Pending Members
            const sortedPending = sortMembersAlphabetically(memberNames, memberIds);
            displayPendingMembers(sortedPending.names, sortedPending.uids);

            //Sorting for Approved Members
            const sortedApproved = sortMembersAlphabetically(approvedMemberNames, approvedMemberIds, approvedMemberRoles);
            displayMembers(sortedApproved.names, sortedApproved.uids, sortedApproved.roles);
            
            if (pendingMemberUids.length > 0) {
                pendingRequestsContainer.style.order = -1; 
                membersContainer.style.order = 0;
                pendingRequestsContainer.style.display = '';
            } else {
                membersContainer.style.order = -1;
                pendingRequestsContainer.style.order = 0;
                pendingRequestsContainer.style.display = 'none';
            }

            
            if (!skipEvents) {
                await fetchAndDisplayUpcomingEvent(id, animateCardEntry);
            }



        } else {
            clubPageTitle.textContent = "Club Not Found";
            clubDetailsDiv.innerHTML = "<p>Sorry, this club does not exist or you do not have permission to view it.</p>";
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
    const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef, { source: 'server' });
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






function displayPendingMembers(memberNames, memberUids) {
    const container = document.getElementById("pendingRequestsContainer");
    
    if (container) {
        container.innerHTML = ""; // Clear any previous content
        
        // --- Move title creation here, BEFORE the empty check ---
        const title = document.createElement("h3");
        title.textContent = "MEMBERSHIP REQUESTS";
        container.appendChild(title);
        // --- End of moved title creation ---

        if (memberNames.length === 0) {
            const noRequests = document.createElement("p"); // Create a new paragraph element
            noRequests.className = 'fancy-label'; // Apply your desired class
            noRequests.textContent = "No pending member requests for this club."; // Set the text content
            container.appendChild(noRequests); // Append it to the container
            return; // Exit the function after displaying the message
        }
        
        memberNames.forEach((name, index) => {
            const memberUid = memberUids[index];

            const memberCardDiv = document.createElement("div");
            memberCardDiv.className = "pending-member-card"; 

            const nameDisplayDiv = document.createElement("div");
            nameDisplayDiv.textContent = name;
            nameDisplayDiv.className = "pending-member-name-display"; 
            memberCardDiv.appendChild(nameDisplayDiv);

            const actionButtonsDiv = document.createElement("div");
            actionButtonsDiv.className = "pending-member-actions"; 

            const approveBtn = document.createElement("button");
            approveBtn.textContent = "ACCEPT";
            approveBtn.className = "approve-member-btn";
            approveBtn.dataset.memberUid = memberUid; 
            approveBtn.dataset.memberName = name; 

            approveBtn.addEventListener("click", async () => {
                console.log(`Approving member: ${name} (UID: ${memberUid})`);
                await approveMember(clubId, memberUid);
                if (currentUser && clubId) {
                    //await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false);
                }
            });
            actionButtonsDiv.appendChild(approveBtn);

            const denyBtn = document.createElement("button"); 
            denyBtn.textContent = "DENY";
            denyBtn.className = "deny-member-btn"; 
            denyBtn.dataset.memberUid = memberUid; 
            denyBtn.dataset.memberName = name; 

            denyBtn.addEventListener("click", async () => {
                console.log(`Denying member: ${name} (UID: ${memberUid})`);
                await denyMember(clubId, memberUid);
                if (currentUser && clubId) {
                    //await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false);
                }
            });
            actionButtonsDiv.appendChild(denyBtn);

            memberCardDiv.appendChild(actionButtonsDiv); 
            container.appendChild(memberCardDiv); 
        });
    } else {
        console.error("HTML element with id 'pendingRequestsContainer' not found. Please add it to your HTML.");
    }
}





async function approveMember(clubID, memberID) {
    if (!clubID || !memberID) {
        console.error("approveMember: clubID or memberID is missing.");
        return;
    }

    try {
        // 1. Update the club document: add member to memberUIDs, remove from pendingMemberUIDs
        const clubRef = doc(db, "clubs", clubID);
        await updateDoc(clubRef, {
            memberUIDs: arrayUnion(memberID),
            pendingMemberUIDs: arrayRemove(memberID)
        });
        console.log(`Successfully moved user ${memberID} from pending to members for club ${clubID}.`);

        // 2. Update the user document: add clubID to member_clubs
        const userRef = doc(db, "users", memberID);
        await updateDoc(userRef, {
            member_clubs: arrayUnion(clubID)
        });

        await createMemberRoleDocument(clubID, memberID); // This will assign the default 'member' role

        console.log(`Successfully added club ${clubID} to user ${memberID}'s member_clubs.`);

        

    } catch (error) {
        console.error("Error approving member:", error);
        await showAppAlert("Failed to approve member: " + error.message);
    }
}


async function denyMember(clubID, memberID) {
    if (!clubID || !memberID) {
        console.error("denyMember: clubID or memberID is missing.");
        return;
    }

    try {
        const clubRef = doc(db, "clubs", clubID);
        // Only remove the member from the pendingMemberUIDs array
        await updateDoc(clubRef, {
            pendingMemberUIDs: arrayRemove(memberID)
        });
        console.log(`Successfully denied membership for user ${memberID} from club ${clubID}.`);

        await showAppAlert("Member request denied successfully!");

    } catch (error) {
        console.error("Error denying member:", error);
        await showAppAlert("Failed to deny member: " + error.message);
    }
}





function displayMembers(memberNames, memberUids, memberRoles) {
    if (!membersContainer) { // Use the globally declared membersContainer
        console.error("HTML element with id 'membersContainer' not found. Please add it to your HTML.");
        return;
    }

    membersContainer.innerHTML = ""; // Clear any previous content
   
    const title = document.createElement("h3");
    title.textContent = "MEMBERS"; // Title for the members list
    membersContainer.appendChild(title);

    memberNames.forEach((name, index) => {
        const memberUid = memberUids[index];
        const memberRole = memberRoles[index]; // Get the role for the current member

        if (managerUid === memberUid){
            const memberCardDivManager = document.createElement("div");
            memberCardDivManager.className = "member-card";
            const nameDisplayDivManager = document.createElement("div");
            nameDisplayDivManager.innerHTML = `${managerName} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
            nameDisplayDivManager.className = "member-name-display";
            memberCardDivManager.appendChild(nameDisplayDivManager);

            if (myUid === managerUid){
                const actionButtonsDivManager = document.createElement("div");
                actionButtonsDivManager.className = "member-actions"; // For grouping buttons
                const removeBtnManager = document.createElement("button");
                removeBtnManager.textContent = "REMOVE";
                removeBtnManager.className = "manager-remove-member-btn";
                const optionsBtn = document.createElement("button");
                optionsBtn.textContent = "OPTIONS";
                optionsBtn.className = "manager-remove-member-btn";
                actionButtonsDivManager.appendChild(optionsBtn);
                actionButtonsDivManager.appendChild(removeBtnManager);
                memberCardDivManager.appendChild(actionButtonsDivManager);
            }
            membersContainer.appendChild(memberCardDivManager);
            
        } else { 
            const memberCardDiv = document.createElement("div");
            memberCardDiv.className = "member-card";

            const nameDisplayDiv = document.createElement("div");
            // Changed: Removed parentheses, added span for role styling
            nameDisplayDiv.innerHTML = `${name} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
            nameDisplayDiv.className = "member-name-display";
            memberCardDiv.appendChild(nameDisplayDiv);

            const actionButtonsDiv = document.createElement("div");
            actionButtonsDiv.className = "member-actions";

            if(myUid === managerUid){
                const optionsBtn = document.createElement("button");
                optionsBtn.textContent = "OPTIONS";
                optionsBtn.className = "options-member-btn"; // Apply the new gray button style
                optionsBtn.dataset.memberUid = memberUid;
                optionsBtn.dataset.memberName = name;
                optionsBtn.dataset.memberRole = memberRole; // Pass the current role
                optionsBtn.addEventListener("click", () => {
                    openRoleManagementPopup(memberUid, name, memberRole);
                });
                actionButtonsDiv.appendChild(optionsBtn);

                memberCardDiv.appendChild(actionButtonsDiv);


                const removeBtn = document.createElement("button");
                removeBtn.textContent = "REMOVE";
                removeBtn.className = "remove-member-btn"; // Apply the new red button style
                removeBtn.dataset.memberUid = memberUid;
                removeBtn.dataset.memberName = name;
                removeBtn.addEventListener("click", async () => {
                    console.log(`Attempting to remove member: ${name} (UID: ${memberUid}) from club ${clubId}`);
                    if (await showAppConfirm(`Are you sure you want to remove ${name} from this club?`)) {
                        await removeMember(clubId, memberUid);
                        // Re-fetch club details to update both pending and approved member lists
                        if (currentUser && clubId) {
                            //await fetchClubDetails(clubId, myUid, myName, false); 
                        }
                    }
                });
                actionButtonsDiv.appendChild(removeBtn);
            }
            membersContainer.appendChild(memberCardDiv);
            

            
        }
    });
}





async function removeMember(clubID, memberID) {
    if (!clubID || !memberID) {
        console.error("removeMember: clubID or memberID is missing.");
        return;
    }

    try {
        // 1. Remove memberID from the club's memberUIDs array
        const clubRef = doc(db, "clubs", clubID);
        await updateDoc(clubRef, {
            memberUIDs: arrayRemove(memberID)
        });
        console.log(`Successfully removed user ${memberID} from club ${clubID}'s memberUIDs.`);

        // 2. Remove clubID from the user's member_clubs array
        const userRef = doc(db, "users", memberID);
        await updateDoc(userRef, {
            member_clubs: arrayRemove(clubID)
        });
        console.log(`Successfully removed club ${clubID} from user ${memberID}'s member_clubs.`);

        await deleteMemberRoleDocument(clubID, memberID);

        //await showAppAlert("Member removed successfully!");

    } catch (error) {
        console.error("Error removing member:", error);
        await showAppAlert("Failed to remove member: " + error.message);
    }
}













async function createMemberRoleDocument(clubId, memberUid) {
    if (!clubId || !memberUid) {
        console.error("createMemberRoleDocument: clubId or memberUid is missing.");
        return;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubId, "members", memberUid);
        await setDoc(memberDocRef, {
            role: "member", 
            joinedAt: serverTimestamp() 
        });
        console.log(`User ${memberUid} added to members subcollection with role 'member' for club ${clubId}.`);
    } catch (error) {
        console.error("Error creating member role document:", error);
        throw new Error("Failed to create member role document: " + error.message);
    }
}




async function deleteMemberRoleDocument(clubId, memberUid) {
    if (!clubId || !memberUid) {
        console.error("deleteMemberRoleDocument: clubId or memberUid is missing.");
        return;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubId, "members", memberUid);
        await deleteDoc(memberDocRef);
        console.log(`User ${memberUid} removed from members subcollection for club ${clubId}.`);
    } catch (error) {
        console.error("Error deleting member role document:", error);
        throw new Error("Failed to delete member role document: " + error.message);
    }
}



async function makeMemberAdmin(clubID, memberUid) {
    if (!clubID || !memberUid) {
        console.error("makeMemberAdmin: clubId or memberUid is missing.");
        return;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubID, "members", memberUid);
        await updateDoc(memberDocRef, {
            role: "admin",
        });
        console.log(`User ${memberUid}'s role updated to 'admin' for club ${clubID}.`);
    } catch (error) {
        console.error("Error updating member role to admin:", error);
        throw new Error("Failed to update member role to admin: " + error.message);
    }
}

async function makeMemberMember(clubID, memberUid) {
    if (!clubID || !memberUid) {
        console.error("makeMemberMember: clubId or memberUid is missing.");
        return;
    }

    try {
        const memberDocRef = doc(db, "clubs", clubID, "members", memberUid);
        await updateDoc(memberDocRef, {
            role: "member",
        });
        console.log(`User ${memberUid}'s role updated to 'member' for club ${clubID}.`);
    } catch (error) {
        console.error("Error updating member role to member:", error);
        throw new Error("Failed to update member role to member: " + error.message);
    }
}

async function transferClubManagement(clubID, newManagerUid) {
    if (!clubID || !newManagerUid) {
        console.error("transferClubManagement: clubID or newManagerUid is missing.");
        throw new Error("Missing clubID or newManagerUid for management transfer.");
    }

    try {
        await runTransaction(db, async (transaction) => {
            const clubRef = doc(db, "clubs", clubID);
            const clubDoc = await transaction.get(clubRef);

            if (!clubDoc.exists()) {
                throw new Error("Club document does not exist!");
            }
            const clubData = clubDoc.data();
            const previousManagerUid = clubData.managerUid;

            if (previousManagerUid === newManagerUid) {
                throw new Error("Cannot transfer management to the current manager.");
            }

            const newManagerUserRef = doc(db, "users", newManagerUid);
            const newManagerUserDoc = await transaction.get(newManagerUserRef);

            if (!newManagerUserDoc.exists()) {
                throw new Error(`New manager user document (${newManagerUid}) does not exist!`);
            }
            const newManagerUserData = newManagerUserDoc.data();
            const newManagerEmail = newManagerUserData.email || null; 

            const previousManagerUserRef = doc(db, "users", previousManagerUid);
            await transaction.get(previousManagerUserRef);



            transaction.update(clubRef, {
                managerUid: newManagerUid,
                managerEmail: newManagerEmail, 
            });

            transaction.update(previousManagerUserRef, {
                managed_clubs: arrayRemove(clubID),
                member_clubs: arrayUnion(clubID)
            });

            transaction.update(newManagerUserRef, {
                managed_clubs: arrayUnion(clubID),
                member_clubs: arrayRemove(clubID)
            });

            const previousManagerMemberRef = doc(db, "clubs", clubID, "members", previousManagerUid);
            const newManagerMemberRef = doc(db, "clubs", clubID, "members", newManagerUid);

            transaction.update(previousManagerMemberRef, { role: "admin" }); 

            transaction.update(newManagerMemberRef, { role: "manager" });

            console.log(`Management of club ${clubID} successfully transferred from ${previousManagerUid} to ${newManagerUid}.`);
        });

        await showAppAlert("Club management transferred successfully!"); 
        window.location.href = 'your_clubs.html';

    } catch (error) {
        console.error("Error during club management transfer transaction:", error);
        await showAppAlert("Failed to transfer club management: " + error.message);
        throw error; 
    }
}



function openRoleManagementPopup(memberUid, memberName, currentRole) {
    document.body.classList.add('no-scroll');
    selectedMemberUid = memberUid;
    currentMemberRoleInPopup = currentRole;

    memberNameForRoleDisplay.textContent = `Manage ${memberName}`;
    roleSelect.value = currentRole; 

    popupOverlay.style.display = 'flex';
    roleManagementPopup.style.display = 'flex';
}

function closeRoleManagementPopup() {
    selectedMemberUid = null; 
    popupOverlay.style.display = 'none';
    roleManagementPopup.style.display = 'none';
    document.body.classList.remove('no-scroll');
}

cancelRoleChangeButton.addEventListener('click', closeRoleManagementPopup);


submitRoleChangeButton.addEventListener('click', async () => {
    const newRole = roleSelect.value;
    const memberName = memberNameForRoleDisplay.textContent.replace('Manage ', '');

    if (newRole === currentMemberRoleInPopup) {
        console.log(`Role for ${selectedMemberUid} is already ${newRole}. No change needed.`);
        //await showAppAlert(`Role is already ${newRole}. No update performed.`);
        closeRoleManagementPopup();
        return; 
    }

    try {
        let updatePerformed = false; 

        if (newRole === "admin") {
            await makeMemberAdmin(clubId, selectedMemberUid);
            updatePerformed = true;
        } else if (newRole === "member") {
            await makeMemberMember(clubId, selectedMemberUid); 
            updatePerformed = true;
        } else if (newRole === "manager") {
            if (await showAppConfirm(`Are you absolutely sure you want to transfer management of this club to ${memberName}?`)) {
                await transferClubManagement(clubId, selectedMemberUid); 
                updatePerformed = true;
            } else {
                console.log("Management transfer cancelled by user.");
                return; 
            }
        } else {
            console.warn(`Attempted to set an unknown role: ${newRole}`);
            await showAppAlert(`Invalid role selected: ${newRole}. No update performed.`);
            closeRoleManagementPopup();
            return;
        }

        if (updatePerformed && newRole !== "manager") {
            closeRoleManagementPopup();

            // if (currentUser && clubId) {
            //     fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false);
            // }
        }

    } catch (error) {
        console.error("Error changing member role:", error);
        await showAppAlert("Failed to change member role: " + error.message);
    }
});



const editClubButton = document.getElementById("edit-club-button");

editClubButton.addEventListener('click', async () => {
    window.location.href = `club_edit_page.html?clubId=${clubId}`;
});





document.addEventListener('DOMContentLoaded', () => {
    const viewScheduleButton = document.getElementById('viewScheduleButton');

    if (viewScheduleButton) {
        viewScheduleButton.addEventListener('click', () => {
            window.location.href = `schedule.html?clubId=${clubId}&returnTo=manager`;
        });
    } else {
        console.warn("Element with ID 'viewScheduleButton' not found. Schedule button functionality may be impacted.");
    }

});



// Map Date.getUTCDay() (0 for Sunday, 1 for Monday, etc.) to day names
const dayNamesMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Helper to format a time string from "HH:mm" to "h:mm AM/PM"
function formatTime(timeString) {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(); // Use a dummy date to leverage Date object for formatting
        date.setHours(hours, minutes);
        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.error("Error formatting time:", e);
        return timeString; // Return original if invalid time string
    }
}

// Helper to format a date string for display (ensuring UTC consistency)
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
    try {
        // Ensure the date is parsed in UTC for consistent formatting
        return new Date(dateString + 'T00:00:00Z').toLocaleDateString(undefined, options);
    } catch (e) {
        console.error("Error formatting date:", e);
        return dateString; // Return original if invalid date string
    }
}



function createLoadingEventCardHtml() {
    return `
        <div class="event-card-loading">
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
            <div class="loading-line"></div>
        </div>
    `;
}

function createNoEventsCardHtml(message = "No upcoming events scheduled.") {
    // This function now returns a div element, not just innerHTML
    const cardDiv = document.createElement('div');
    cardDiv.className = 'event-card animate-in'; // Start with animate-in class
    cardDiv.innerHTML = `
        <p class="fancy-black-label">${message}</p>
    `;
    return cardDiv;
}


function sortMembersAlphabetically(names, uids, roles = null) {
    const combinedMembers = names.map((name, index) => ({
        name: name,
        uid: uids[index],
        role: roles ? roles[index] : undefined
    }));

    // Sort the combined array by name
    combinedMembers.sort((a, b) => a.name.localeCompare(b.name));

    // Separate them back into sorted arrays
    const sortedNames = combinedMembers.map(member => member.name);
    const sortedUids = combinedMembers.map(member => member.uid);
    const sortedRoles = roles ? combinedMembers.map(member => member.role) : null;

    return { names: sortedNames, uids: sortedUids, roles: sortedRoles };
}

async function fetchAndDisplayUpcomingEvent(currentClubId, animateCard) {
    const closestEventDisplay = document.getElementById('closestEventDisplay');
    if (!closestEventDisplay) {
        console.warn("Element with ID 'closestEventDisplay' not found in HTML.");
        return;
    }

    // closestEventDisplay.innerHTML = createLoadingEventCardHtml(); // THIS LINE IS NOW REMOVED
    // The loading card is now in the HTML by default

    const eventsRef = collection(db, "clubs", currentClubId, "events");

    try {
        const querySnapshot = await getDocs(eventsRef);
        let allPossibleOccurrences = [];


        querySnapshot.forEach(doc => {
            const eventData = doc.data();
            const eventId = doc.id;
            const exceptions = eventData.exceptions || [];

            if (eventData.isWeekly) {
                const startDate = new Date(eventData.weeklyStartDate + 'T00:00:00Z');
                const endDate = new Date(eventData.weeklyEndDate + 'T00:00:00Z');
                const daysToMatch = eventData.daysOfWeek.map(day => dayNamesMap.indexOf(day));

                let currentDate = new Date(startDate);
                while (currentDate.getTime() <= endDate.getTime()) {
                    const currentOccDateString = currentDate.toISOString().split('T')[0];

                    if (daysToMatch.includes(currentDate.getUTCDay()) && !exceptions.includes(currentOccDateString)) {
                        allPossibleOccurrences.push({
                            eventData: eventData,
                            occurrenceDate: new Date(currentDate),
                            originalEventId: eventId
                        });
                    }
                    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                }
            } else { // One-time event
                const eventDateString = new Date(eventData.eventDate + 'T00:00:00Z').toISOString().split('T')[0];
                if (!exceptions.includes(eventDateString)) {
                    allPossibleOccurrences.push({
                        eventData: eventData,
                        occurrenceDate: new Date(eventData.eventDate + 'T00:00:00Z'),
                        originalEventId: eventId
                    });
                }
            }
        });


        const now = new Date();

        allPossibleOccurrences = allPossibleOccurrences.filter(occurrence => {
            const eventDateStr = occurrence.occurrenceDate.toISOString().split('T')[0];
            const eventEndTimeStr = occurrence.eventData.endTime;

            const eventEndMomentLocal = new Date(`${eventDateStr}T${eventEndTimeStr}`);

            return eventEndMomentLocal.getTime() > now.getTime();
        });

        allPossibleOccurrences.sort((a, b) => {
            const dateTimeA = new Date(a.occurrenceDate.toISOString().split('T')[0] + 'T' + a.eventData.startTime + ':00Z').getTime();
            const dateTimeB = new Date(b.occurrenceDate.toISOString().split('T')[0] + 'T' + b.eventData.startTime + ':00Z').getTime();
            return dateTimeA - dateTimeB;
        });

        let nextEvent = allPossibleOccurrences.length > 0 ? allPossibleOccurrences[0] : null;

        let finalCardElement;

        closestEventDisplay.innerHTML = '';

        if (nextEvent) {
            console.log("There is an event scheduled:", nextEvent.eventData.eventName, "on", nextEvent.occurrenceDate.toISOString().split('T')[0], "at", nextEvent.eventData.startTime);

            finalCardElement = document.createElement('div');
            finalCardElement.className = 'event-card'; // Start with just the base class
            if (animateCard) { // <--- ADD THIS BLOCK
                finalCardElement.classList.add('animate-in');
            }

            const formattedDate = formatDate(nextEvent.occurrenceDate.toISOString().split('T')[0]);
            const formattedStartTime = formatTime(nextEvent.eventData.startTime);
            const formattedEndTime = formatTime(nextEvent.eventData.endTime);

            finalCardElement.innerHTML = `
                <h3>${nextEvent.eventData.eventName}</h3>
                <p>•  Date: ${formattedDate}</p>
                <p>•  Time: ${formattedStartTime} - ${formattedEndTime}</p>
                <p>•  Address: ${nextEvent.eventData.address}</p>
                <p>•  Location: ${nextEvent.eventData.location}</p>
                ${nextEvent.eventData.notes ? `<p>•  Notes: ${nextEvent.eventData.notes}</p>` : ''}
            `;
            closestEventDisplay.appendChild(finalCardElement);

        } else {
            console.log("No events found at all.");
           finalCardElement = createNoEventsCardHtml();
            if (!animateCard) { // <--- ADD THIS BLOCK: If no animation, remove the animate-in class
                finalCardElement.classList.remove('animate-in');
            }
            closestEventDisplay.appendChild(finalCardElement);
        }

        if (animateCard) { // <--- ADD THIS conditional check
            setTimeout(() => {
                if (finalCardElement) {
                  finalCardElement.classList.add('is-visible');
                }
            }, 10);
        } else { // <--- ADD THIS ELSE BLOCK: If no animation, make it immediately visible
            if (finalCardElement) {
                finalCardElement.classList.add('is-visible');
            }
        }

    } catch (error) {
        console.error("Error fetching event:", error);
        closestEventDisplay.innerHTML = ''; 
        const errorCard = createNoEventsCardHtml("Error loading event. Please try again.");
        closestEventDisplay.appendChild(errorCard);
        if (animateCard) {
            setTimeout(() => {
                errorCard.classList.add('is-visible');
            }, 10);
        } else { 
            errorCard.classList.add('is-visible');
        }
    }
}


const docRef = doc(db, "clubs", clubId);
const membersRef = collection(db, "clubs", clubId, "members");


let isInitialSnapshot = true;


// 1. Listen for Main Club Doc (Handles Join/Leave)
onSnapshot(docRef, async (docSnap) => {
    if (isInitialSnapshot) return; // Skip first run
    
    if (docSnap.exists() && currentUser) {
        console.log("Main doc changed, full UI sync...");
        // This updates the join code and internal arrays
        await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false, true);
    }
});


// 2. Listen for Members Subcollection (Handles ROLE changes)
onSnapshot(membersRef, async (snapshot) => {
    if (isInitialSnapshot) {
        isInitialSnapshot = false; 
        return;
    }


    console.log("Role update detected! Updating the Member List UI...");
    
    // Instead of just calling fetchClubDetails, we force a refresh of the member list
    if (currentUser && clubId) {
        // We call fetchClubDetails with 'true' for skipEvents 
        // to ensure the event card doesn't shimmer.
        await fetchClubDetails(clubId, currentUser.uid, currentUser.displayName, false, true);
    }
});

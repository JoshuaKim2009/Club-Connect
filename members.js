import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, arrayUnion, arrayRemove, setDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
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

let currentUser = null;
let clubId = null;
let role = null;

const membersContainer = document.getElementById('membersContainer');
const pendingRequestsContainer = document.getElementById('pendingRequestsContainer');
const popupOverlay = document.getElementById('popup-overlay');
const roleManagementPopup = document.getElementById('role-management-popup');
const memberNameForRoleDisplay = document.getElementById('member-name-for-role');
const roleSelect = document.getElementById('role-select');
const submitRoleChangeButton = document.getElementById('submit-role-change');
const cancelRoleChangeButton = document.getElementById('cancel-role-change');
const dynamicWrapper = document.getElementById('dynamic-sections-wrapper');

let currentMemberRoleInPopup = null;
let selectedMemberUid = null;
let managerName = "";
let managerUid = "";
let myName = "";
let myUid = "";
let firstLoad = true;

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    if (currentClubId) {
        if (role === 'manager' || role === 'admin') {
            window.location.href = `club_page_manager.html?id=${currentClubId}`;
        } else {
            window.location.href = `club_page_member.html?id=${currentClubId}`;
        }
    } else {
        window.location.href = 'your_clubs.html';
    }
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user) {
        myUid = user.uid;
        myName = user.displayName || user.email;

        if (clubId) {
            role = await getMemberRoleForClub(clubId, currentUser.uid);
            console.log(`User ${currentUser.uid} role for club ${clubId}: ${role}`);

            await fetchAndDisplayMembers();
            setupRealtimeListeners();

        } else {
            membersContainer.innerHTML = "<p class='fancy-label'>No club ID provided.</p>";
        }
    } else {
        membersContainer.innerHTML = "<p class='fancy-label'>You must be logged in. Redirecting...</p>";
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    }
});


function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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

function sortMembersAlphabetically(names, uids, roles = null) {
    const combinedMembers = names.map((name, index) => ({
        name: name,
        uid: uids[index],
        role: roles ? roles[index] : undefined
    }));

    combinedMembers.sort((a, b) => a.name.localeCompare(b.name));

    const sortedNames = combinedMembers.map(member => member.name);
    const sortedUids = combinedMembers.map(member => member.uid);
    const sortedRoles = roles ? combinedMembers.map(member => member.role) : null;

    return { names: sortedNames, uids: sortedUids, roles: sortedRoles };
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

async function approveMember(clubID, memberID) {
    if (!clubID || !memberID) {
        console.error("approveMember: clubID or memberID is missing.");
        return;
    }

    try {
        const clubRef = doc(db, "clubs", clubID);
        await updateDoc(clubRef, {
            memberUIDs: arrayUnion(memberID),
            pendingMemberUIDs: arrayRemove(memberID)
        });
        console.log(`Successfully moved user ${memberID} from pending to members for club ${clubID}.`);

        const userRef = doc(db, "users", memberID);
        await updateDoc(userRef, {
            member_clubs: arrayUnion(clubID)
        });

        await createMemberRoleDocument(clubID, memberID);

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

async function removeMember(clubID, memberID) {
    if (!clubID || !memberID) {
        console.error("removeMember: clubID or memberID is missing.");
        return;
    }

    try {
        const clubRef = doc(db, "clubs", clubID);
        await updateDoc(clubRef, {
            memberUIDs: arrayRemove(memberID)
        });
        console.log(`Successfully removed user ${memberID} from club ${clubID}'s memberUIDs.`);

        const userRef = doc(db, "users", memberID);
        await updateDoc(userRef, {
            member_clubs: arrayRemove(clubID)
        });
        console.log(`Successfully removed club ${clubID} from user ${memberID}'s member_clubs.`);

        await deleteMemberRoleDocument(clubID, memberID);

    } catch (error) {
        console.error("Error removing member:", error);
        await showAppAlert("Failed to remove member: " + error.message);
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




function displayPendingMembers(memberNames, memberUids) {
    const container = document.getElementById("pendingRequestsContainer");
    
    if (container) {
        container.innerHTML = "";

        const title = document.createElement("h3");
        title.textContent = "MEMBERSHIP REQUESTS";
        container.appendChild(title);

        if (memberNames.length === 0) {
            const noRequests = document.createElement("p"); 
            noRequests.className = 'fancy-label';
            noRequests.textContent = "No pending member requests for this club."; 
            container.appendChild(noRequests);
            return;
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
            });
            actionButtonsDiv.appendChild(denyBtn);

            memberCardDiv.appendChild(actionButtonsDiv); 
            container.appendChild(memberCardDiv); 
        });
    } else {
        console.error("HTML element with id 'pendingRequestsContainer' not found. Please add it to your HTML.");
    }
}

function displayMembers(memberNames, memberUids, memberRoles) {
    if (!membersContainer) {
        console.error("HTML element with id 'membersContainer' not found. Please add it to your HTML.");
        return;
    }

    membersContainer.innerHTML = "";
   
    const title = document.createElement("h3");
    title.textContent = `CLUB MEMBERS (${memberNames.length})`; 
    membersContainer.appendChild(title);

    memberNames.forEach((name, index) => {
        const memberUid = memberUids[index];
        const memberRole = memberRoles[index];

        if (managerUid === memberUid){
            const memberCardDivManager = document.createElement("div");
            memberCardDivManager.className = "member-card";
            const nameDisplayDivManager = document.createElement("div");
            nameDisplayDivManager.innerHTML = `${managerName} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
            nameDisplayDivManager.className = "member-name-display";
            memberCardDivManager.appendChild(nameDisplayDivManager);

            if (myUid === managerUid && (role === 'manager' || role === 'admin')){
                const actionButtonsDivManager = document.createElement("div");
                actionButtonsDivManager.className = "member-actions";
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
            nameDisplayDiv.innerHTML = `${name} <span class="member-role-text">${capitalizeFirstLetter(memberRole)}</span>`;
            nameDisplayDiv.className = "member-name-display";
            memberCardDiv.appendChild(nameDisplayDiv);

            const actionButtonsDiv = document.createElement("div");
            actionButtonsDiv.className = "member-actions";

            if(myUid === managerUid && (role === 'manager' || role === 'admin')){
                const optionsBtn = document.createElement("button");
                optionsBtn.textContent = "OPTIONS";
                optionsBtn.className = "options-member-btn";
                optionsBtn.dataset.memberUid = memberUid;
                optionsBtn.dataset.memberName = name;
                optionsBtn.dataset.memberRole = memberRole;
                optionsBtn.addEventListener("click", () => {
                    openRoleManagementPopup(memberUid, name, memberRole);
                });
                actionButtonsDiv.appendChild(optionsBtn);

                memberCardDiv.appendChild(actionButtonsDiv);

                const removeBtn = document.createElement("button");
                removeBtn.textContent = "REMOVE";
                removeBtn.className = "remove-member-btn";
                removeBtn.dataset.memberUid = memberUid;
                removeBtn.dataset.memberName = name;
                removeBtn.addEventListener("click", async () => {
                    console.log(`Attempting to remove member: ${name} (UID: ${memberUid}) from club ${clubId}`);
                    if (await showAppConfirm(`Are you sure you want to remove ${name} from this club?`)) {
                        await removeMember(clubId, memberUid);
                    }
                });
                actionButtonsDiv.appendChild(removeBtn);
            }
            membersContainer.appendChild(memberCardDiv);
        }
    });
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
        }

    } catch (error) {
        console.error("Error changing member role:", error);
        await showAppAlert("Failed to change member role: " + error.message);
    }
});



async function fetchAndDisplayMembers() {
    if (firstLoad) {
        dynamicWrapper.classList.remove('loaded');
    }
    try {
        const clubRef = doc(db, "clubs", clubId);
        const clubSnap = await getDoc(clubRef, { source: 'server' });

        if (!clubSnap.exists()) {
            membersContainer.innerHTML = "<p class='fancy-label'>Club not found.</p>";
            return;
        }

        const clubData = clubSnap.data();
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

        // Handle pending members (only for managers/admins)
        if (role === 'manager' || role === 'admin') {
            const pendingMemberUids = clubData.pendingMemberUIDs || [];
            const memberNames = [];
            const memberIds = [];

            for (const memberUid of pendingMemberUids) {
                const userRef = doc(db, "users", memberUid);
                const userSnap = await getDoc(userRef, { source: 'server' });

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    memberNames.push(userData.name || `User (${memberUid})`);
                    memberIds.push(memberUid);
                } else {
                    console.warn(`User document not found for pending member UID: ${memberUid}`);
                    memberNames.push(`Unknown User (${memberUid})`);
                    memberIds.push(memberUid);
                }
            }

            const sortedPending = sortMembersAlphabetically(memberNames, memberIds);
            displayPendingMembers(sortedPending.names, sortedPending.uids);

            if (pendingMemberUids.length > 0) {
                pendingRequestsContainer.style.order = -1; 
                membersContainer.style.order = 0;
                pendingRequestsContainer.style.display = '';
            } else {
                membersContainer.style.order = -1;
                pendingRequestsContainer.style.order = 0;
                pendingRequestsContainer.style.display = 'none';
            }
        } else {
            // Hide pending requests for regular members
            pendingRequestsContainer.style.display = 'none';
        }

        // Handle approved members
        const approvedMemberUids = clubData.memberUIDs || []; 
        const approvedMemberNames = [];
        const approvedMemberIds = [];
        const approvedMemberRoles = [];

        for (const memberUid of approvedMemberUids) {
            const userRef = doc(db, "users", memberUid);
            const userSnap = await getDoc(userRef, { source: 'server' });

            const memberRoleRef = doc(db, "clubs", clubId, "members", memberUid);
            const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
            let memberRole = 'member'; 

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

        const sortedApproved = sortMembersAlphabetically(approvedMemberNames, approvedMemberIds, approvedMemberRoles);
        displayMembers(sortedApproved.names, sortedApproved.uids, sortedApproved.roles);

        dynamicWrapper.classList.add('loaded');
        firstLoad = false;

    } catch (error) {
        console.error("Error fetching members:", error);
        membersContainer.innerHTML = "<p class='fancy-label'>Error loading members.</p>";
        dynamicWrapper.classList.add('loaded');
        firstLoad = false;
    }
}



let isInitialSnapshot = true;

function setupRealtimeListeners() {
    const docRef = doc(db, "clubs", clubId);
    const membersRef = collection(db, "clubs", clubId, "members");

    onSnapshot(docRef, async (docSnap) => {
        if (isInitialSnapshot) return; 
        
        if (docSnap.exists() && currentUser) {
            console.log("Main doc changed, refreshing members list...");
            await fetchAndDisplayMembers();
        }
    });

    onSnapshot(membersRef, async (snapshot) => {
        if (isInitialSnapshot) {
            isInitialSnapshot = false; 
            return;
        }

        console.log("Role update detected! Updating the Member List UI...");
        
        if (currentUser && clubId) {
            await fetchAndDisplayMembers();
        }
    });
}
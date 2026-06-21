import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, updateDoc, arrayUnion, arrayRemove, setDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';

document.querySelector('#role-select option[value="member"]').textContent = ROLE_LABELS.member;
document.querySelector('#role-select option[value="admin"]').textContent = ROLE_LABELS.admin;
document.querySelector('#role-select option[value="manager"]').textContent = ROLE_LABELS.manager;

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
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
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
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    }
});


function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) {
        console.warn("getMemberRoleForClub: clubId or uid is missing.");
        return null;
    }

    const cacheKey = `role_${clubId}_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        const memberRoleSnap = await getDoc(memberRoleRef);

        let role;
        if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
            role = memberRoleSnap.data().role;
        } else {
            const clubRef = doc(db, "clubs", clubId);
            const clubSnap = await getDoc(clubRef);
            role = (clubSnap.exists() && clubSnap.data().managerUid === uid) ? 'manager' : 'member';
        }

        sessionStorage.setItem(cacheKey, role);
        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
}

function sortMembersAlphabetically(names, uids, roles = null) {
    const combined = names.map((name, i) => ({ name, uid: uids[i], role: roles ? roles[i] : undefined }));
    combined.sort((a, b) => a.name.localeCompare(b.name));
    return {
        names: combined.map(m => m.name),
        uids: combined.map(m => m.uid),
        roles: roles ? combined.map(m => m.role) : null
    };
}


async function approveMember(clubID, memberID) {
    if (!clubID || !memberID) { console.error("approveMember: missing args."); return; }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "clubs", clubID), {
            memberUIDs: arrayUnion(memberID),
            pendingMemberUIDs: arrayRemove(memberID)
        });
        batch.update(doc(db, "users", memberID), { member_clubs: arrayUnion(clubID) });
        batch.set(doc(db, "clubs", clubID, "members", memberID), {
            role: "member",
            joinedAt: serverTimestamp()
        });
        await batch.commit();
        console.log(`Successfully moved user ${memberID} from pending to members for club ${clubID}.`);
    } catch (error) {
        console.error("Error approving member:", error);
        await showAppAlert("Failed to approve member: " + error.message);
    }
}

async function denyMember(clubID, memberID) {
    if (!clubID || !memberID) { console.error("denyMember: missing args."); return; }
    try {
        await updateDoc(doc(db, "clubs", clubID), { pendingMemberUIDs: arrayRemove(memberID) });
        console.log(`Successfully denied membership for user ${memberID} from club ${clubID}.`);
    } catch (error) {
        console.error("Error denying member:", error);
        await showAppAlert("Failed to deny member: " + error.message);
    }
}

async function removeMember(clubID, memberID) {
    if (!clubID || !memberID) { console.error("removeMember: missing args."); return; }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "clubs", clubID), { memberUIDs: arrayRemove(memberID) });
        batch.update(doc(db, "users", memberID), {
            member_clubs: arrayRemove(clubID),
            admin_clubs: arrayRemove(clubID)
        });
        batch.delete(doc(db, "clubs", clubID, "members", memberID));
        await batch.commit();
        console.log(`Successfully removed user ${memberID} from club ${clubID}.`);
    } catch (error) {
        console.error("Error removing member:", error);
        await showAppAlert("Failed to remove member: " + error.message);
    }
}


async function updateMemberRole(clubID, memberUid, newRole) {
    if (!clubID || !memberUid) { console.error("updateMemberRole: missing args."); return; }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "clubs", clubID, "members", memberUid), { role: newRole });
        batch.update(doc(db, "users", memberUid), {
            admin_clubs: newRole === 'admin' ? arrayUnion(clubID) : arrayRemove(clubID)
        });
        await batch.commit();
        console.log(`User ${memberUid}'s role updated to '${newRole}' for club ${clubID}.`);
    } catch (error) {
        console.error(`Error updating member role to ${newRole}:`, error);
        throw new Error(`Failed to update member role to ${newRole}: ` + error.message);
    }
}

async function transferClubManagement(clubID, newManagerUid) {
    if (!clubID || !newManagerUid) {
        throw new Error("Missing clubID or newManagerUid for management transfer.");
    }
    try {
        await runTransaction(db, async (transaction) => {
            const clubRef = doc(db, "clubs", clubID);
            const clubDoc = await transaction.get(clubRef);
            if (!clubDoc.exists()) throw new Error("Club document does not exist!");

            const previousManagerUid = clubDoc.data().managerUid;
            if (previousManagerUid === newManagerUid) throw new Error("Cannot transfer management to the current manager.");

            const newManagerUserRef = doc(db, "users", newManagerUid);
            const newManagerUserDoc = await transaction.get(newManagerUserRef);
            if (!newManagerUserDoc.exists()) throw new Error(`New manager user document (${newManagerUid}) does not exist!`);

            const newManagerEmail = newManagerUserDoc.data().email || null;
            const previousManagerUserRef = doc(db, "users", previousManagerUid);
            await transaction.get(previousManagerUserRef);

            transaction.update(clubRef, { managerUid: newManagerUid, managerEmail: newManagerEmail });
            transaction.update(previousManagerUserRef, {
                managed_clubs: arrayRemove(clubID),
                member_clubs: arrayUnion(clubID),
                admin_clubs: arrayUnion(clubID)
            });
            transaction.update(newManagerUserRef, {
                managed_clubs: arrayUnion(clubID),
                member_clubs: arrayRemove(clubID),
                admin_clubs: arrayRemove(clubID)
            });
            transaction.update(doc(db, "clubs", clubID, "members", previousManagerUid), { role: "admin" });
            transaction.update(doc(db, "clubs", clubID, "members", newManagerUid), { role: "manager" });
        });

        await showAppAlert(`${ROLE_LABELS.manager} role transferred successfully!`);
        window.location.href = 'your_clubs.html';
    } catch (error) {
        console.error("Error during club management transfer transaction:", error);
        await showAppAlert("Failed to transfer club management: " + error.message);
        throw error;
    }
}



function displayPendingMembers(memberNames, memberUids) {
    const container = document.getElementById("pendingRequestsContainer");
    if (!container) { console.error("pendingRequestsContainer not found."); return; }

    container.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = "REQUESTS";
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
        approveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        approveBtn.className = "approve-member-btn";
        approveBtn.addEventListener("click", async () => {
            console.log(`Approving member: ${name} (UID: ${memberUid})`);
            await approveMember(clubId, memberUid);
            // Realtime listeners handle the UI refresh
        });
        actionButtonsDiv.appendChild(approveBtn);

        const denyBtn = document.createElement("button");
        denyBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        denyBtn.className = "deny-member-btn";
        denyBtn.addEventListener("click", async () => {
            console.log(`Denying member: ${name} (UID: ${memberUid})`);
            await denyMember(clubId, memberUid);
            // Realtime listeners handle the UI refresh
        });
        actionButtonsDiv.appendChild(denyBtn);

        memberCardDiv.appendChild(actionButtonsDiv);
        container.appendChild(memberCardDiv);
    });
}

// Builds a single member card's action buttons area and returns it,
// or returns null if no actions apply for this viewer's role.
function buildMemberActions(memberUid, memberName, memberRole) {
    const actionButtonsDiv = document.createElement("div");
    actionButtonsDiv.className = "member-actions";

    // Your own card: show leave button
    if (memberUid === myUid) {
        const leaveBtn = document.createElement("button");
        leaveBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i>';
        leaveBtn.className = "options-member-btn";
        leaveBtn.addEventListener("click", async () => {
            if (memberRole === 'manager') {
                await showAppAlert(`Transfer the ${ROLE_LABELS.manager.toLowerCase()} role before leaving the club.`);
                return;
            }
            if (await showAppConfirm("Are you sure you want to leave this club?")) {
                await removeMember(clubId, myUid);
                window.location.href = 'your_clubs.html';
            }
        });
        actionButtonsDiv.appendChild(leaveBtn);
        return actionButtonsDiv;
    }

    // Manager/admin viewing other members
    if (role === 'manager' || role === 'admin') {
        const optionsBtn = document.createElement("button");
        optionsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';

        const canManage = role === 'manager' || (role === 'admin' && memberRole === 'member');

        if (canManage) {
            optionsBtn.className = "options-member-btn";
            optionsBtn.addEventListener("click", () => openRoleManagementPopup(memberUid, memberName, memberRole));
        } else {
            optionsBtn.className = "options-member-btn options-member-btn--disabled";
            optionsBtn.addEventListener("click", async () => {
                await showAppAlert(`You cannot manage ${ROLE_LABELS.admin.toLowerCase()}s or ${ROLE_LABELS.manager.toLowerCase()}s.`);
            });
        }

        actionButtonsDiv.appendChild(optionsBtn);
        return actionButtonsDiv;
    }

    return null;
}

function displayMembers(memberNames, memberUids, memberRoles) {
    if (!membersContainer) { console.error("membersContainer not found."); return; }

    membersContainer.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = "CLUB MEMBERS";
    membersContainer.appendChild(title);

    memberNames.forEach((name, index) => {
        const memberUid = memberUids[index];
        const memberRole = memberRoles[index];

        const memberCardDiv = document.createElement("div");
        memberCardDiv.className = "member-card";

        const nameDisplayDiv = document.createElement("div");
        nameDisplayDiv.className = "member-name-display";
        nameDisplayDiv.innerHTML = `${name} ${(memberRole === 'admin' || memberRole === 'manager') ? `<span class="member-role-text">${getRoleLabel(memberRole)}</span>` : ''}`;
        memberCardDiv.appendChild(nameDisplayDiv);

        const actions = buildMemberActions(memberUid, name, memberRole);
        if (actions) memberCardDiv.appendChild(actions);

        membersContainer.appendChild(memberCardDiv);
    });
}


function openRoleManagementPopup(memberUid, memberName, currentRole) {
    document.body.classList.add('no-scroll');
    selectedMemberUid = memberUid;
    currentMemberRoleInPopup = currentRole;

    memberNameForRoleDisplay.textContent = `Manage ${memberName}`;
    roleSelect.value = currentRole;

    const managerOption = roleSelect.querySelector('option[value="manager"]');
    const memberOption = roleSelect.querySelector('option[value="member"]');

    if (role === 'admin') {
        managerOption.style.display = 'none';
        memberOption.style.display = currentRole === 'admin' ? 'none' : '';
    } else {
        managerOption.style.display = '';
        memberOption.style.display = '';
    }

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

document.getElementById('remove-member-popup-btn').addEventListener('click', async () => {
    const memberName = memberNameForRoleDisplay.textContent.replace('Manage ', '');
    if (await showAppConfirm(`Are you sure you want to remove ${memberName} from this club?`)) {
        await removeMember(clubId, selectedMemberUid);
        closeRoleManagementPopup();
    }
});

submitRoleChangeButton.addEventListener('click', async () => {
    const newRole = roleSelect.value;
    const memberName = memberNameForRoleDisplay.textContent.replace('Manage ', '');

    if (role === 'admin') {
        if (currentMemberRoleInPopup !== 'member' || newRole !== 'admin') {
            await showAppAlert(`${ROLE_LABELS.admin}s can only promote ${ROLE_LABELS.member.toLowerCase()}s to ${ROLE_LABELS.admin.toLowerCase()}.`);
            closeRoleManagementPopup();
            return;
        }
    }

    if (newRole === currentMemberRoleInPopup) {
        closeRoleManagementPopup();
        return;
    }

    try {
        if (newRole === "admin" || newRole === "member") {
            await updateMemberRole(clubId, selectedMemberUid, newRole);
            closeRoleManagementPopup();
        } else if (newRole === "manager") {
            if (await showAppConfirm(`Are you absolutely sure you want to transfer the ${ROLE_LABELS.manager.toLowerCase()} role to ${memberName}?`)) {
                await transferClubManagement(clubId, selectedMemberUid);
                // transferClubManagement redirects on success, no need to close popup
            }
        } else {
            console.warn(`Attempted to set an unknown role: ${newRole}`);
            await showAppAlert(`Invalid role selected: ${getRoleLabel(newRole)}. No update performed.`);
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
        const clubSnap = await getDoc(clubRef);

        if (!clubSnap.exists()) {
            membersContainer.innerHTML = "<p class='fancy-label'>Club not found.</p>";
            return;
        }

        const clubData = clubSnap.data();
        const actualManagerUid = clubData.managerUid;
        let actualManagerName = `Unknown ${ROLE_LABELS.manager}`;

        if (actualManagerUid) {
            const managerUserSnap = await getDoc(doc(db, "users", actualManagerUid));
            if (managerUserSnap.exists() && managerUserSnap.data().name) {
                actualManagerName = managerUserSnap.data().name;
            }
        }

        managerName = actualManagerName;
        managerUid = actualManagerUid;

        // Pending members (managers/admins only)
        if (role === 'manager' || role === 'admin') {
            const pendingMemberUids = clubData.pendingMemberUIDs || [];
            const pendingNames = [];
            const pendingIds = [];

            await Promise.all(pendingMemberUids.map(async (uid) => {
                const userSnap = await getDoc(doc(db, "users", uid));
                pendingNames.push(userSnap.exists() ? (userSnap.data().name || `User (${uid})`) : `Unknown User (${uid})`);
                pendingIds.push(uid);
            }));

            const sortedPending = sortMembersAlphabetically(pendingNames, pendingIds);
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
            pendingRequestsContainer.style.display = 'none';
        }

        // Approved members
        const approvedMemberUids = clubData.memberUIDs || [];
        const approvedNames = [];
        const approvedIds = [];
        const approvedRoles = [];

        await Promise.all(approvedMemberUids.map(async (uid) => {
            const [userSnap, roleSnap] = await Promise.all([
                getDoc(doc(db, "users", uid)),
                getDoc(doc(db, "clubs", clubId, "members", uid))
            ]);

            const memberRole = (roleSnap.exists() && roleSnap.data().role) ? roleSnap.data().role : 'member';
            approvedNames.push(userSnap.exists() ? (userSnap.data().name || `User (${uid})`) : `Unknown User (${uid})`);
            approvedIds.push(uid);
            approvedRoles.push(memberRole);
        }));

        const sortedApproved = sortMembersAlphabetically(approvedNames, approvedIds, approvedRoles);
        displayMembers(sortedApproved.names, sortedApproved.uids, sortedApproved.roles);

        dynamicWrapper.classList.add('loaded');
        document.body.classList.remove('no-scroll');
        firstLoad = false;

    } catch (error) {
        console.error("Error fetching members:", error);
        membersContainer.innerHTML = "<p class='fancy-label'>Error loading members.</p>";
        dynamicWrapper.classList.add('loaded');
        document.body.classList.remove('no-scroll');
        firstLoad = false;
    }
}


function setupRealtimeListeners() {
    const docRef = doc(db, "clubs", clubId);
    const membersRef = collection(db, "clubs", clubId, "members");

    // Each listener has its own initial-fire guard
    let mainDocInitial = true;
    let membersColInitial = true;

    onSnapshot(docRef, async (docSnap) => {
        if (mainDocInitial) { mainDocInitial = false; return; }
        if (docSnap.exists() && currentUser) {
            console.log("Main doc changed, refreshing members list...");
            await fetchAndDisplayMembers();
        }
    });

    onSnapshot(membersRef, async () => {
        if (membersColInitial) { membersColInitial = false; return; }
        sessionStorage.removeItem(`role_${clubId}_${currentUser.uid}`);
        console.log("Role update detected! Updating the Member List UI...");
        if (currentUser && clubId) {
            await fetchAndDisplayMembers();
        }
    });
}
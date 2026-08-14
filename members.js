import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, updateDoc, arrayUnion, arrayRemove, setDoc, deleteDoc, deleteField, serverTimestamp, runTransaction, onSnapshot, collection, writeBatch } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';
import { handleUserSwitch } from './auth-guard.js';
import { getRole, cacheRole } from './roleCache.js';

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
const transferConfirmRow = document.getElementById('transfer-confirm-row');
const transferConfirmLabel = document.getElementById('transfer-confirm-label');
const transferConfirmCheckbox = document.getElementById('transfer-confirm-checkbox');
const transferConfirmText = document.getElementById('transfer-confirm-text');
const dynamicWrapper = document.getElementById('dynamic-sections-wrapper');
const removeMemberButton = document.getElementById('remove-member-popup-btn');

let currentMemberRoleInPopup = null;
let selectedMemberUid = null;
let managerName = "";
let managerUid = "";
let myName = "";
let myUid = "";
let firstLoad = true;
let isLeavingClub = false;

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    window.location.href = currentClubId
        ? `club_page.html?clubId=${currentClubId}`
        : 'your_clubs.html';
}

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    clubId = getUrlParameter('clubId');
    myUid = user.uid;
    myName = user.displayName || user.email;

    if (!clubId) {
        document.body.classList.remove('no-scroll');
        showContainerError(dynamicWrapper, "No club ID provided.");
        return;
    }

    try {
        const clubSnap = await getDoc(doc(db, "clubs", clubId));

        if (!clubSnap.exists()) {
            document.body.classList.remove('no-scroll');
            showContainerError(dynamicWrapper, "This club doesn't exist.", false, '75px');
            return;
        }

        role = await getRole(db, clubId, currentUser.uid, clubSnap);

        if (role === null) {
            document.body.classList.remove('no-scroll');
            showContainerError(dynamicWrapper, "You're not a member of this club.", false, '75px');
            return;
        }

        await fetchAndDisplayMembers();
        setupRealtimeListeners();

    } catch (error) {
        console.error("Error:", error);
        document.body.classList.remove('no-scroll');
        showContainerError(dynamicWrapper, "Oops! Something went wrong.", true, '75px');
    }
});


function sortMembersAlphabetically(names, uids, roles = null) {
    const combined = names.map((name, i) => ({ name, uid: uids[i], role: roles ? roles[i] : undefined }));
    combined.sort((a, b) => a.name.localeCompare(b.name));
    return {
        names: combined.map(m => m.name),
        uids: combined.map(m => m.uid),
        roles: roles ? combined.map(m => m.role) : null
    };
}


async function approveMember(clubID, memberID, memberName) {
    if (!clubID || !memberID) { console.error("approveMember: missing args."); return; }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "clubs", clubID), {
            memberUIDs: arrayUnion(memberID),
            pendingMemberUIDs: arrayRemove(memberID),
            [`memberNames.${memberID}`]: memberName || "Unknown"
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
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("approve members"));
        } else {
            await showAppAlert("Something went wrong while approving this member.");
        }
    }
}

async function denyMember(clubID, memberID) {
    if (!clubID || !memberID) { console.error("denyMember: missing args."); return; }
    try {
        await updateDoc(doc(db, "clubs", clubID), { pendingMemberUIDs: arrayRemove(memberID) });
        console.log(`Successfully denied membership for user ${memberID} from club ${clubID}.`);
    } catch (error) {
        console.error("Error denying member:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("deny members"));
        } else {
            await showAppAlert("Something went wrong while denying this request.");
        }
    }
}

async function removeMember(clubID, memberID) {
    if (!clubID || !memberID) { console.error("removeMember: missing args."); return; }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, "clubs", clubID), {
            memberUIDs: arrayRemove(memberID),
            [`memberNames.${memberID}`]: deleteField()
        });
        batch.update(doc(db, "users", memberID), {
            member_clubs: arrayRemove(clubID),
            admin_clubs: arrayRemove(clubID)
        });
        batch.delete(doc(db, "clubs", clubID, "members", memberID));
        await batch.commit();
        console.log(`Successfully removed user ${memberID} from club ${clubID}.`);
    } catch (error) {
        console.error("Error removing member:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("remove members"));
        } else {
            await showAppAlert("Something went wrong while removing this member.");
        }
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
        throw error;
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
            const previousManagerUserDoc = await transaction.get(previousManagerUserRef);
            if (!previousManagerUserDoc.exists()) throw new Error(`Previous manager user document (${previousManagerUid}) does not exist!`);

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
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage(`transfer the ${ROLE_LABELS.manager.toLowerCase()} role`));
        } else {
            await showAppAlert("Something went wrong while transferring club management.");
        }
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
            if (approveBtn.disabled) return;
            approveBtn.disabled = true;
            denyBtn.disabled = true;
            console.log(`Approving member: ${name} (UID: ${memberUid})`);
            await approveMember(clubId, memberUid, name);
            // Realtime listeners handle the UI refresh
        });
        actionButtonsDiv.appendChild(approveBtn);

        const denyBtn = document.createElement("button");
        denyBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        denyBtn.className = "deny-member-btn";
        denyBtn.addEventListener("click", async () => {
            if (denyBtn.disabled) return;
            denyBtn.disabled = true;
            approveBtn.disabled = true;
            console.log(`Denying member: ${name} (UID: ${memberUid})`);
            await denyMember(clubId, memberUid);
            // Realtime listeners handle the UI refresh
        });
        actionButtonsDiv.appendChild(denyBtn);

        memberCardDiv.appendChild(actionButtonsDiv);
        container.appendChild(memberCardDiv);
    });
}

function buildMemberActions(memberUid, memberName, memberRole) {
    const actionButtonsDiv = document.createElement("div");
    actionButtonsDiv.className = "member-actions";

    if (memberUid === myUid) {
        const leaveBtn = document.createElement("button");
        leaveBtn.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i>';
        leaveBtn.className = "options-member-btn";
        leaveBtn.addEventListener("click", async () => {
            if (isLeavingClub) return;
            if (memberRole === 'manager') {
                await showAppAlert(`Transfer the ${ROLE_LABELS.manager.toLowerCase()} role before leaving the club.`);
                return;
            }
            if (await showAppConfirm("Are you sure you want to leave this club?")) {
                isLeavingClub = true;
                await removeMember(clubId, myUid);
                window.location.href = 'your_clubs.html';
            }
        });
        actionButtonsDiv.appendChild(leaveBtn);
        return actionButtonsDiv;
    }

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

    const placeholder = document.createElement("button");
    placeholder.className = "options-member-btn options-member-btn--placeholder";
    placeholder.innerHTML = '<i class="fa-solid fa-gear"></i>';
    placeholder.disabled = true;
    placeholder.tabIndex = -1;
    placeholder.setAttribute('aria-hidden', 'true');
    actionButtonsDiv.appendChild(placeholder);
    return actionButtonsDiv;
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

    memberNameForRoleDisplay.textContent = `${memberName}`;
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

    updateTransferConfirmRow();

    popupOverlay.style.display = 'flex';
    roleManagementPopup.style.display = 'flex';
}

function hideRoleManagementPopup() {
    popupOverlay.style.display = 'none';
    roleManagementPopup.style.display = 'none';
}

function showRoleManagementPopup() {
    popupOverlay.style.display = 'flex';
    roleManagementPopup.style.display = 'flex';
}

function closeRoleManagementPopup() {
    selectedMemberUid = null;
    hideRoleManagementPopup();
    document.body.classList.remove('no-scroll');
    resetTransferConfirmRow();
}

function isRoleManagementPopupOpen() {
    return roleManagementPopup.style.display === 'flex';
}

async function popupAlert(message, title) {
    hideRoleManagementPopup();
    await showAppAlert(message, title);
    closeRoleManagementPopup();
}

async function popupConfirm(message) {
    hideRoleManagementPopup();
    const confirmed = await showAppConfirm(message);
    if (!confirmed) showRoleManagementPopup();
    return confirmed;
}

function updateTransferConfirmRow() {
    if (roleSelect.value === 'manager') {
        transferConfirmCheckbox.checked = false;
        transferConfirmLabel.classList.remove('transfer-confirm-invalid');
        transferConfirmText.textContent = `Yes, transfer the ${ROLE_LABELS.manager} role to ${memberNameForRoleDisplay.textContent}.`;
        transferConfirmRow.classList.remove('hidden');
    } else {
        resetTransferConfirmRow();
    }
}

function resetTransferConfirmRow() {
    transferConfirmRow.classList.add('hidden');
    transferConfirmCheckbox.checked = false;
    transferConfirmLabel.classList.remove('transfer-confirm-invalid');
}

function shakeTransferConfirm() {
    // transferConfirmText.textContent = `You must check this box to transfer the ${ROLE_LABELS.manager.toLowerCase()} role.`;
    transferConfirmLabel.classList.remove('transfer-confirm-invalid');
    void transferConfirmLabel.offsetWidth; 
    transferConfirmLabel.classList.add('transfer-confirm-invalid');
}

cancelRoleChangeButton.addEventListener('click', closeRoleManagementPopup);

roleSelect.addEventListener('change', updateTransferConfirmRow);

transferConfirmCheckbox.addEventListener('change', () => {
    if (transferConfirmCheckbox.checked) {
        transferConfirmLabel.classList.remove('transfer-confirm-invalid');
    }
});

removeMemberButton.addEventListener('click', async () => {
    const memberName = memberNameForRoleDisplay.textContent;
    if (await popupConfirm(`Are you sure you want to remove ${memberName} from this club?`)) {
        const uidToRemove = selectedMemberUid;
        closeRoleManagementPopup();
        await removeMember(clubId, uidToRemove);
    }
});

submitRoleChangeButton.addEventListener('click', async () => {
    const newRole = roleSelect.value;

    if (role === 'admin') {
        if (currentMemberRoleInPopup !== 'member' || newRole !== 'admin') {
            await popupAlert(`${ROLE_LABELS.admin}s can only promote ${ROLE_LABELS.member.toLowerCase()}s to ${ROLE_LABELS.admin.toLowerCase()}.`);
            return;
        }
    }

    if (newRole === currentMemberRoleInPopup) {
        closeRoleManagementPopup();
        return;
    }

    if (newRole === "manager") {
        if (!transferConfirmCheckbox.checked) {
            shakeTransferConfirm();
            return;
        }
        const uid = selectedMemberUid;
        closeRoleManagementPopup();
        try {
            await transferClubManagement(clubId, uid);
        } catch (error) {
            console.error("Error transferring club management:", error);
        }
        return;
    }

    if (newRole !== "admin" && newRole !== "member") {
        console.warn(`Attempted to set an unknown role: ${newRole}`);
        await popupAlert(`Invalid role selected: ${getRoleLabel(newRole)}. No update performed.`);
        return;
    }

    const uid = selectedMemberUid;
    closeRoleManagementPopup();

    try {
        await updateMemberRole(clubId, uid, newRole);
    } catch (error) {
        console.error("Error changing member role:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("change member roles"));
        } else {
            await showAppAlert("Something went wrong while changing this member's role.");
        }
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
        const managerNamesMap = clubData.memberNames || {};
        let actualManagerName = `Unknown ${ROLE_LABELS.manager}`;
        if (actualManagerUid && managerNamesMap[actualManagerUid]) {
            actualManagerName = managerNamesMap[actualManagerUid];
        } else if (actualManagerUid) {
            const managerUserSnap = await getDoc(doc(db, "users", actualManagerUid));
            if (managerUserSnap.exists() && managerUserSnap.data().name) {
                actualManagerName = managerUserSnap.data().name;
            }
        }

        managerName = actualManagerName;
        managerUid = actualManagerUid;

        const isAdminView = role === 'manager' || role === 'admin';
        const pendingMemberUids = isAdminView ? (clubData.pendingMemberUIDs || []) : [];
        const approvedMemberUids = clubData.memberUIDs || [];
        const memberNamesMap = clubData.memberNames || {};

        const pendingNames = [];
        const pendingIds = [];
        const approvedNames = [];
        const approvedIds = [];
        const approvedRoles = [];

        const pendingFetch = Promise.all(pendingMemberUids.map(async (uid) => {
            const userSnap = await getDoc(doc(db, "users", uid));
            pendingNames.push(userSnap.exists() ? (userSnap.data().name || `User (${uid})`) : `Unknown User (${uid})`);
            pendingIds.push(uid);
        }));

        const approvedFetch = Promise.all(approvedMemberUids.map(async (uid) => {
            const needsFallback = !memberNamesMap[uid];
            const [roleSnap, userSnap] = await Promise.all([
                getDoc(doc(db, "clubs", clubId, "members", uid)),
                needsFallback ? getDoc(doc(db, "users", uid)) : Promise.resolve(null)
            ]);

            const memberRole = (roleSnap.exists() && roleSnap.data().role) ? roleSnap.data().role : 'member';
            const resolvedName = memberNamesMap[uid]
                || (userSnap && userSnap.exists() ? (userSnap.data().name || `User (${uid})`) : `Unknown User (${uid})`);

            approvedNames.push(resolvedName);
            approvedIds.push(uid);
            approvedRoles.push(memberRole);
        }));

        await Promise.all([pendingFetch, approvedFetch]);

        if (isAdminView) {
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

    let mainDocInitial = true;
    let membersColInitial = true;

    onSnapshot(docRef, async (docSnap) => {
        if (mainDocInitial) { mainDocInitial = false; return; }
        if (isLeavingClub) return;
        if (docSnap.exists() && currentUser) {
            console.log("Main doc changed, refreshing members list...");
            await fetchAndDisplayMembers();
        }
    });

    onSnapshot(membersRef, async (snapshot) => {
        if (membersColInitial) { membersColInitial = false; return; }

        const myChange = snapshot.docChanges().find(change => change.doc.id === currentUser.uid);
        if (myChange) {
            const newRole = myChange.type === 'removed'
                ? null
                : (myChange.doc.data().role || 'member');

            if (newRole !== role) {
                const previousRole = role;
                role = newRole;
                cacheRole(clubId, currentUser.uid, role);

                if (isRoleManagementPopupOpen()) {
                    closeRoleManagementPopup();
                }

                if (role === null) {
                    if (isLeavingClub) return;
                    document.body.classList.remove('no-scroll');
                    showContainerError(dynamicWrapper, "You're no longer a member of this club.", false, '75px');
                    return;
                }

                if (previousRole !== null) {
                    await showAppAlert(`Your role for this club has been updated to ${getRoleLabel(role)}!`);
                }
            }
        }

        console.log("Member list changed, updating UI...");
        await fetchAndDisplayMembers();
    });
}


function showContainerError(container, message, showRetry = false, topPadding = '75px') {
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 20px; padding-top: ${topPadding};">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}


popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay && roleManagementPopup.style.display === 'flex') {
        closeRoleManagementPopup();
    }
});


function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club ${ROLE_LABELS.manager.toLowerCase()} if you think this is a mistake.`;
}
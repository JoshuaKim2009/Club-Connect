import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, addDoc, serverTimestamp  } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

let isLoggedIn = false;
let userEmail = "";
let userName = "";
let role = null;
let currentUser = null;

const addPollButton = document.getElementById('add-poll-button');
const pollCreationModal = document.getElementById('poll-creation-modal');
const pollOverlay = document.getElementById('popup-overlay');

const clubId = getUrlParameter('clubId');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    
    const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberDoc.exists()) return memberDoc.data().role || 'member';
    
    const clubDoc = await getDoc(doc(db, "clubs", clubId));
    return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
}

window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo');

    if (currentClubId) {
        let redirectUrl = 'your_clubs.html';

        if (returnToPage === 'manager') {
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        } else if (returnToPage === 'member') {
            redirectUrl = `club_page_member.html?id=${currentClubId}`;
        } else {
            console.warn("Invalid or missing 'returnTo' parameter, defaulting to manager page.");
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        }
        window.location.href = redirectUrl;
    } else {
        window.location.href = 'your_clubs.html';
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        isLoggedIn = true;
        userName = user.displayName || "";
        userEmail = user.email || "";

        console.log(userEmail);

        if (clubId) {
            
            role = await getMemberRoleForClub(clubId, currentUser.uid);
            
            if (addPollButton) {
                if (role === 'manager' || role === 'admin') {
                    addPollButton.style.display = 'block';
                    addPollButton.removeEventListener('click', createPollEditingCard);
                    addPollButton.addEventListener('click', createPollEditingCard);
                } else {
                    addPollButton.style.display = 'none'; 
                }
            }
            
            // startRealtimeListener();
        } else {
            window.location.href = 'your_clubs.html';
        }
    } else {
        window.location.href = 'login.html';
    }
});

var pollTypeChoice = "After";

async function createPollEditingCard() {
    pollOverlay.style.display = 'block';
    pollCreationModal.style.display = 'block';
    document.body.classList.add('no-scroll');
}


document.querySelector('.checkbox-group').addEventListener('change', (e) => {
    const pollInfoText = document.getElementById('poll-type-info');
    if (e.target.value === "Before"){
        pollInfoText.textContent = `Users will always see poll percentages.`;
    } else if (e.target.value === "After"){
        pollInfoText.textContent = `Poll percentages will be shown after a user votes.`;
    } else {
        pollInfoText.textContent = `Poll percentages will never be revealed to users.`;
    }
    pollTypeChoice = e.target.value;
    console.log(pollTypeChoice);
});

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

document.addEventListener('input', (e) => {
    if (e.target.classList.contains('poll-option-input')) {
        autoResize(e.target);
    }
});

const MAX_OPTIONS = 10;

window.addPollOption = function () {
    const list = document.getElementById('poll-options-list');
    const current = list.querySelectorAll('.poll-option-row').length;
    if (current >= MAX_OPTIONS) return;

    const row = document.createElement('div');
    row.className = 'poll-option-row';

    const input = document.createElement('textarea');
    input.className = 'poll-option-input';
    input.placeholder = `Option ${current + 1}`;
    input.rows = 1;

    row.appendChild(input);
    list.appendChild(row);

    autoResize(input);
    input.focus();
    updateAddButtonState();
}

window.subtractPollOption = function () {
    const list = document.getElementById('poll-options-list');
    const rows = list.querySelectorAll('.poll-option-row');
    if (rows.length <= 2) return;

    rows[rows.length - 1].remove();
    updateAddButtonState();
}

function updateAddButtonState() {
    const list = document.getElementById('poll-options-list');
    const current = list.querySelectorAll('.poll-option-row').length;
    document.getElementById('add-option-btn').disabled = current >= MAX_OPTIONS;
    document.getElementById('subtract-option-btn').disabled = current <= 2;
}

document.querySelectorAll('.poll-option-input').forEach(autoResize);
updateAddButtonState();

function resetPollEditingCard(){
    document.getElementById('poll-title-input').value = '';

    const list = document.getElementById('poll-options-list');
    list.innerHTML = `
        <div class="poll-option-row">
            <textarea class="poll-option-input" placeholder="Option 1" rows="1"></textarea>
        </div>
        <div class="poll-option-row">
            <textarea class="poll-option-input" placeholder="Option 2" rows="1"></textarea>
        </div>
    `;

    list.querySelectorAll('.poll-option-input').forEach(autoResize);

    updateAddButtonState();
}

function hidePollEditingCard(){
    pollCreationModal.style.display = 'none';
    pollOverlay.style.display = 'none';
    document.body.classList.remove('no-scroll');
}

const postButton = document.getElementById('post-poll-button');

postButton.addEventListener('click', async () => {
    const pollId = await savePoll();
    
    if (pollId) {
        resetPollEditingCard();
        hidePollEditingCard();
    }
});


const cancelButton = document.getElementById('cancel-poll-button');

cancelButton.addEventListener('click', async ()  => {
    resetPollEditingCard();
    hidePollEditingCard();
});

async function savePoll() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to create a poll.");
        return null;
    }

    const titleInput = document.getElementById('poll-title-input').value.trim();
    
    const optionInputs = document.querySelectorAll('.poll-option-input');
    const options = [];
    
    optionInputs.forEach((input, index) => {
        const optionText = input.value.trim();
        if (optionText) {
            options.push({
                text: optionText,
                votes: [] 
            });
        }
    });

    if (!titleInput) {
        await showAppAlert("Poll title is required!");
        return null;
    }

    if (options.length < 2) {
        await showAppAlert("Please provide at least 2 poll options!");
        return null;
    }

    try {
        const pollsRef = collection(db, "clubs", clubId, "polls");
        
        const pollData = {
            title: titleInput,
            options: options,
            visibility: pollTypeChoice, 
            createdAt: serverTimestamp(),
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId: clubId,
            isActive: true
        };

        const newPollRef = await addDoc(pollsRef, pollData);
        const newPollId = newPollRef.id;

        await showAppAlert("Poll created successfully!");
        return newPollId;

    } catch (error) {
        console.error("Error creating poll:", error);
        await showAppAlert("Failed to create poll: " + error.message);
        return null;
    }
}
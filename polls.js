import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const pollEditModal = document.getElementById('poll-edit-modal');


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
            
            setupRealtimePollsListener();
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
        pollInfoText.textContent = `Users will always see poll percentages. The creator of the poll and manager can always see results.`;
    } else if (e.target.value === "After"){
        pollInfoText.textContent = `Poll percentages will be shown after a user votes. The creator of the poll and manager can always see results.`;
    } else {
        pollInfoText.textContent = `Poll percentages will never be revealed to users. The creator of the poll and manager can always see results.`;
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
    

    const optionInputs = document.querySelectorAll('#poll-options-list .poll-option-input');
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

        hidePollEditingCard()
        await showAppAlert("Poll created successfully!");
        return newPollId;

    } catch (error) {
        console.error("Error creating poll:", error);
        await showAppAlert("Failed to create poll: " + error.message);
        return null;
    }
}

let pollsListenerUnsubscribe = null;

function setupRealtimePollsListener() {
    if (!clubId) {
        console.warn("setupRealtimePollsListener called without clubId.");
        return;
    }

    if (pollsListenerUnsubscribe) {
        pollsListenerUnsubscribe();
        pollsListenerUnsubscribe = null;
    }

    const pollsRef = collection(db, "clubs", clubId, "polls");
    const q = query(pollsRef, orderBy("createdAt", "desc"));

    pollsListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
        const pollsContainer = document.getElementById('polls-container');
        
        querySnapshot.docChanges().forEach((change) => {
            const pollData = change.doc.data();
            const pollId = change.doc.id;

            if (change.type === "added") {
                const pollCard = createPollCard(pollData, pollId);
                pollsContainer.prepend(pollCard);
            } 
            else if (change.type === "modified") {
                const existingCard = pollsContainer.querySelector(`[data-poll-id="${pollId}"]`);
                if (existingCard) {
                    updatePollCard(existingCard, pollData, pollId);
                }
            } 
            else if (change.type === "removed") {
                const existingCard = pollsContainer.querySelector(`[data-poll-id="${pollId}"]`);
                if (existingCard) {
                    existingCard.remove();
                }
            }
        });

        const noPollsMessage = document.getElementById('no-polls-message');
        if (pollsContainer.children.length === 0 && noPollsMessage) {
            noPollsMessage.style.display = 'block';
        } else if (noPollsMessage) {
            noPollsMessage.style.display = 'none';
        }
    }, (error) => {
        console.error("Error fetching realtime polls:", error);
    });
}

function createPollCard(pollData, pollId) {
    const card = document.createElement('div');
    card.className = 'poll-card';
    card.dataset.pollId = pollId;

    const totalVotes = pollData.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    const userHasVoted = pollData.options.some(opt => opt.votes.includes(currentUser.uid));
    
    let canSeeResults = false;
    if (pollData.visibility === "Before") {
        canSeeResults = true;
    } else if (pollData.visibility === "After") {
        canSeeResults = userHasVoted;
    } else if (pollData.visibility === "Never") {
        canSeeResults = false;
    }
    
    if (((role === 'manager' || role === 'admin') && (pollData.createdByUid === currentUser.uid)) || (role === 'manager')) {
        canSeeResults = true;
    }

    let optionsHTML = '<div class="poll-options-list">';
    pollData.options.forEach((option, index) => {
        const voteCount = option.votes.length;
        const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : 0;
        const userVotedForThis = option.votes.includes(currentUser.uid);

        optionsHTML += `
            <div class="poll-option-item" data-option-index="${index}">
                <div class="poll-option-header">
                    <label class="poll-option-label">
                        <input type="radio" 
                               name="poll-${pollId}" 
                               class="poll-radio" 
                               data-poll-id="${pollId}" 
                               data-option-index="${index}"
                               ${userVotedForThis ? 'checked' : ''}>
                        <span class="poll-option-text">${option.text}</span>
                        ${canSeeResults ? `<span class="poll-vote-count">(${voteCount})</span>` : ''}
                    </label>
                </div>
                ${canSeeResults ? `
                    <div class="poll-results-bar">
                        <div class="poll-bar" style="width: ${percentage}%"></div>
                        <span class="poll-percentage">${percentage}%</span>
                    </div>
                ` : ''}
            </div>
        `;
    });
    optionsHTML += '</div>';

    card.innerHTML = `
        <h3>${pollData.title}</h3>
        ${optionsHTML}
        <div class="poll-meta">
            <span>Total votes: ${totalVotes}</span>
            <span>Created by ${pollData.createdByName}</span>
        </div>
        ${pollData.createdByUid === currentUser.uid ? `
            <div class="poll-actions">
                <button class="edit-poll-btn" data-poll-id="${pollId}">
                    <span class="button-text">EDIT</span><span class="button-icon"><i class="fa-solid fa-pencil"></i></span>
                </button>
                <button class="delete-poll-btn" data-poll-id="${pollId}">
                    <span class="button-text">DELETE</span><span class="button-icon"><i class="fa-solid fa-trash"></i></span>
                </button>
            </div>
        ` : ''}
    `;

    card.querySelectorAll('.poll-radio').forEach(radio => {
        radio.addEventListener('click', (e) => {
            const clickedRadio = e.currentTarget;
            const pollId = clickedRadio.dataset.pollId;
            const optionIndex = parseInt(clickedRadio.dataset.optionIndex);
            
            if (clickedRadio.dataset.wasChecked === 'true') {
                clickedRadio.checked = false;
                clickedRadio.dataset.wasChecked = 'false';
                handleVote(pollId, optionIndex, pollData);
            } else {
                card.querySelectorAll('.poll-radio').forEach(r => {
                    r.dataset.wasChecked = 'false';
                });
                clickedRadio.dataset.wasChecked = 'true';
                handleVote(pollId, optionIndex, pollData);
            }
        });
        
        if (radio.checked) {
            radio.dataset.wasChecked = 'true';
        } else {
            radio.dataset.wasChecked = 'false';
        }
    });

    const deleteBtn = card.querySelector('.delete-poll-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pollId = e.currentTarget.dataset.pollId;
            deletePoll(pollId);
        });
    }

    const editBtn = card.querySelector('.edit-poll-btn');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pollId = e.currentTarget.dataset.pollId;
            editPoll(pollId, pollData);
        });
    }

    return card;
}

function updatePollCard(existingCard, pollData, pollId) {
    const totalVotes = pollData.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    const userHasVoted = pollData.options.some(opt => opt.votes.includes(currentUser.uid));
    
    let canSeeResults = false;
    if (pollData.visibility === "Before") {
        canSeeResults = true;
    } else if (pollData.visibility === "After") {
        canSeeResults = userHasVoted;
    } else if (pollData.visibility === "Never") {
        canSeeResults = false;
    }
    
    if (((role === 'manager' || role === 'admin') && (pollData.createdByUid === currentUser.uid)) || (role === 'manager')) {
        canSeeResults = true;
    }

    pollData.options.forEach((option, index) => {
        const optionElement = existingCard.querySelector(`[data-option-index="${index}"]`);
        if (!optionElement) return;

        const voteCount = option.votes.length;
        const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : 0;
        const userVotedForThis = option.votes.includes(currentUser.uid);

        const radio = optionElement.querySelector('.poll-radio');
        if (radio) {
            radio.checked = userVotedForThis;
            radio.dataset.wasChecked = userVotedForThis ? 'true' : 'false';
        }

        const voteCountElement = optionElement.querySelector('.poll-vote-count');
        if (canSeeResults) {
            if (voteCountElement) {
                voteCountElement.textContent = `(${voteCount})`;
            } else {
                const label = optionElement.querySelector('.poll-option-label');
                const span = document.createElement('span');
                span.className = 'poll-vote-count';
                span.textContent = `(${voteCount})`;
                label.appendChild(span);
            }
        } else {
            if (voteCountElement) {
                voteCountElement.remove();
            }
        }

        const resultsBar = optionElement.querySelector('.poll-results-bar');
        if (canSeeResults) {
            if (resultsBar) {
                const bar = resultsBar.querySelector('.poll-bar');
                const percentageSpan = resultsBar.querySelector('.poll-percentage');
                bar.style.width = `${percentage}%`;
                percentageSpan.textContent = `${percentage}%`;
            } else {
                const barHTML = `
                    <div class="poll-results-bar">
                        <div class="poll-bar" style="width: ${percentage}%"></div>
                        <span class="poll-percentage">${percentage}%</span>
                    </div>
                `;
                optionElement.querySelector('.poll-option-header').insertAdjacentHTML('afterend', barHTML);
            }
        } else {
            if (resultsBar) {
                resultsBar.remove();
            }
        }
    });

    const metaElement = existingCard.querySelector('.poll-meta');
    if (metaElement) {
        metaElement.innerHTML = `
            <span>Total votes: ${totalVotes}</span>
            <span>Created by ${pollData.createdByName}</span>
        `;
    }
}

window.addEventListener('beforeunload', () => {
    if (pollsListenerUnsubscribe) {
        pollsListenerUnsubscribe();
    }
});


async function handleVote(pollId, optionIndex, pollData) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to vote.");
        return;
    }

    try {
        const pollRef = doc(db, "clubs", clubId, "polls", pollId);
        
        const userUid = currentUser.uid;

        let previousVoteIndex = -1;
        pollData.options.forEach((option, index) => {
            if (option.votes.includes(userUid)) {
                previousVoteIndex = index;
            }
        });

        if (previousVoteIndex === optionIndex) {
            pollData.options[optionIndex].votes = pollData.options[optionIndex].votes.filter(
                uid => uid !== userUid
            );
        } 
        else if (previousVoteIndex !== -1) {
            pollData.options[previousVoteIndex].votes = pollData.options[previousVoteIndex].votes.filter(
                uid => uid !== userUid
            );
            pollData.options[optionIndex].votes.push(userUid);
        }
        else {
            pollData.options[optionIndex].votes.push(userUid);
        }

        await updateDoc(pollRef, {
            options: pollData.options
        });

    } catch (error) {
        console.error("Error saving vote:", error);
        await showAppAlert("Failed to save vote: " + error.message);
    }
}


async function deletePoll(pollId) {
    const confirmed = await showAppConfirm("Are you sure you want to delete this poll? This action cannot be undone.");
    if (!confirmed) return;

    try {
        const pollRef = doc(db, "clubs", clubId, "polls", pollId);
        await deleteDoc(pollRef);
        await showAppAlert("Poll deleted successfully!");
    } catch (error) {
        console.error("Error deleting poll:", error);
        await showAppAlert("Failed to delete poll: " + error.message);
    }
}

async function editPoll(pollId, pollData) {
    pollOverlay.style.display = 'block';
    pollEditModal.style.display = 'block';
    document.body.classList.add('no-scroll');
    
    const visibilityRadios = pollEditModal.querySelectorAll('input[name="poll-edit-option"]');
    visibilityRadios.forEach(radio => {
        if (radio.value === pollData.visibility) {
            radio.checked = true;
        }
    });
    
    const saveButton = document.getElementById('save-poll-edit-button');
    const cancelButton = document.getElementById('cancel-poll-edit-button');
    
    const newSaveButton = saveButton.cloneNode(true);
    const newCancelButton = cancelButton.cloneNode(true);
    saveButton.parentNode.replaceChild(newSaveButton, saveButton);
    cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);
    
    newSaveButton.addEventListener('click', async () => {
        const selectedVisibility = pollEditModal.querySelector('input[name="poll-edit-option"]:checked').value;
        
        try {
            const pollRef = doc(db, "clubs", clubId, "polls", pollId);
            await updateDoc(pollRef, { visibility: selectedVisibility });

            pollEditModal.style.display = 'none';
            pollOverlay.style.display = 'none';
            document.body.classList.remove('no-scroll');
            await showAppAlert("Poll visibility updated successfully!");
        } catch (error) {
            console.error("Error updating poll:", error);
            await showAppAlert("Failed to update poll: " + error.message);
        }
    });
    
    newCancelButton.addEventListener('click', () => {
        pollEditModal.style.display = 'none';
        pollOverlay.style.display = 'none';
        document.body.classList.remove('no-scroll');
    });
}
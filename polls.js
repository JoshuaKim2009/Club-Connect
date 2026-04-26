import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, deleteDoc, serverTimestamp, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const visMessages = {
    Before: "Results are visible to all members before and after voting. The poll creator and manager can always see results.",
    After:  "Results are hidden until a member votes, then revealed to them. The poll creator and manager can always see results.",
    Never:  "Results are never shown to members regardless of voting. The poll creator and manager can always see results."
};

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

async function createPollEditingCard() {
    if (document.querySelector('.editing-poll-card')) {
        await showAppAlert("Please finish the current poll before adding a new one.");
        return;
    }
    const card = _createPollEditingCardElement();
    const pollsContainer = document.getElementById('polls-container');
    const noPollsMessage = document.getElementById('no-polls-message');
    if (noPollsMessage) noPollsMessage.style.display = 'none';
    pollsContainer.insertBefore(card, pollsContainer.firstChild);
    card.querySelector('.poll-title-input-inline').focus();
}

function _createPollEditingCardElement() {
    const card = document.createElement('div');
    card.className = 'poll-card editing-poll-card';

    card.innerHTML = `
        <h3>CREATE POLL</h3>
        <div class="poll-section-box">
            <label style="font-size:20px;margin-bottom:6px;">Title</label>
            <textarea class="poll-option-input poll-title-input-inline" placeholder="Poll title..." rows="1"></textarea>
        </div>

        <div class="poll-options-selection">
            <label>Show results to voter:</label>
            <div class="vis-strip-group">
                <div class="vis-strip" data-value="Before">
                    <span class="vis-strip-title">BEFORE</span>
                    <span class="vis-strip-sub">${visMessages.Before}</span>
                </div>
                <div class="vis-strip" data-value="After">
                    <span class="vis-strip-title">AFTER</span>
                    <span class="vis-strip-sub">${visMessages.After}</span>
                </div>
                <div class="vis-strip" data-value="Never">
                    <span class="vis-strip-title">NEVER</span>
                    <span class="vis-strip-sub">${visMessages.Never}</span>
                </div>
            </div>
        </div>

        <div class="poll-section-box">
            <label style="font-size:20px;margin-bottom:6px;">Options</label>
            <div class="poll-options-list-inline" style="display:flex;flex-direction:column;gap:8px;">
                <div class="poll-option-row"><textarea class="poll-option-input" placeholder="Option 1" rows="1"></textarea></div>
                <div class="poll-option-row"><textarea class="poll-option-input" placeholder="Option 2" rows="1"></textarea></div>
            </div>

            <button class="subtract-option-inline-btn" disabled>
                <i class="fa-solid fa-minus"></i>
            </button>

            <button class="add-option-inline-btn">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>

        <div class="poll-creation-actions">
            <button class="post-poll-inline-btn fancy-button">POST</button>
            <button class="cancel-poll-inline-btn fancy-button">CANCEL</button>
        </div>
    `;

    // auto-resize on input
    card.querySelectorAll('.poll-option-input').forEach(autoResize);
    card.addEventListener('input', (e) => {
        if (e.target.classList.contains('poll-option-input')) autoResize(e.target);
    });

    // visibility radio info text
    const visStrips = card.querySelectorAll('.vis-strip');
    visStrips.forEach(strip => {
        strip.addEventListener('click', () => {
            visStrips.forEach(s => s.classList.remove('vis-strip-selected'));
            strip.classList.add('vis-strip-selected');
        });
    });
    // set default selected
    card.querySelector('.vis-strip[data-value="After"]').classList.add('vis-strip-selected');

    // add / remove option buttons
    const optionsList = card.querySelector('.poll-options-list-inline');
    const addBtn      = card.querySelector('.add-option-inline-btn');
    const subtractBtn = card.querySelector('.subtract-option-inline-btn');

    function updateInlineOptionBtns() {
        const count = optionsList.querySelectorAll('.poll-option-row').length;
        addBtn.disabled      = count >= MAX_OPTIONS;
        subtractBtn.disabled = count <= 2;
        addBtn.style.color      = addBtn.disabled      ? '#555' : '#000';
        subtractBtn.style.color = subtractBtn.disabled ? '#555' : '#000';
    }
    updateInlineOptionBtns();

    addBtn.addEventListener('click', () => {
        const count = optionsList.querySelectorAll('.poll-option-row').length;
        if (count >= MAX_OPTIONS) return;
        const row = document.createElement('div');
        row.className = 'poll-option-row';
        const ta = document.createElement('textarea');
        ta.className = 'poll-option-input';
        ta.placeholder = `Option ${count + 1}`;
        ta.rows = 1;
        row.appendChild(ta);
        optionsList.appendChild(row);
        autoResize(ta);
        ta.focus();
        updateInlineOptionBtns();
    });

    subtractBtn.addEventListener('click', () => {
        const rows = optionsList.querySelectorAll('.poll-option-row');
        if (rows.length <= 2) return;
        rows[rows.length - 1].remove();
        updateInlineOptionBtns();
    });

    // POST
    card.querySelector('.post-poll-inline-btn').addEventListener('click', async () => {
        const title   = card.querySelector('.poll-title-input-inline').value.trim();
        const options = [...card.querySelectorAll('.poll-options-list-inline .poll-option-input')]
            .map(i => i.value.trim()).filter(Boolean).map(text => ({ text, votes: [] }));
        const visibility = card.querySelector('.vis-strip-selected')?.dataset.value || 'After';

        if (!title)            { await showAppAlert("Poll title is required!");                  return; }
        if (options.length < 2){ await showAppAlert("Please provide at least 2 poll options!"); return; }

        try {
            await addDoc(collection(db, "clubs", clubId, "polls"), {
                title, options, visibility,
                createdAt:     serverTimestamp(),
                createdByUid:  currentUser.uid,
                createdByName: currentUser.displayName || "Anonymous",
                clubId, isActive: true
            });
            await updateLastSeenPolls();
            card.remove();
        } catch (err) {
            console.error("Error creating poll:", err);
            await showAppAlert("Failed to create poll: " + err.message);
        }
    });

    // CANCEL
    card.querySelector('.cancel-poll-inline-btn').addEventListener('click', () => {
        card.remove();
        const pollsContainer = document.getElementById('polls-container');
        const noPollsMessage = document.getElementById('no-polls-message');
        if (noPollsMessage && pollsContainer.querySelectorAll('.poll-card:not(.editing-poll-card)').length === 0) {
            if (role === 'member') { noPollsMessage.style.display = 'block'; }
        }
    });

    return card;
}

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

let pollsListenerUnsubscribe = null;

function setupRealtimePollsListener() {
    if (!clubId) return;
    if (pollsListenerUnsubscribe) { pollsListenerUnsubscribe(); pollsListenerUnsubscribe = null; }

    const pollsRef = collection(db, "clubs", clubId, "polls");
    const q = query(pollsRef, orderBy("createdAt", "desc"));

    let isInitialSnapshot = true; // <-- ADD THIS

    pollsListenerUnsubscribe = onSnapshot(q, (querySnapshot) => {
        const pollsContainer = document.getElementById('polls-container');

        querySnapshot.docChanges().forEach((change) => {
            const pollData = change.doc.data();
            const pollId = change.doc.id;

            if (change.type === "added") {
                const pollCard = createPollCard(pollData, pollId);
                if (isInitialSnapshot) {
                    pollsContainer.appendChild(pollCard);       // preserve desc order
                } else {
                    pollsContainer.insertBefore(pollCard, pollsContainer.firstChild); // new poll → top
                }
            } else if (change.type === "modified") {
                const existingCard = pollsContainer.querySelector(`[data-poll-id="${pollId}"]`);
                if (existingCard) updatePollCard(existingCard, pollData, pollId);
            } else if (change.type === "removed") {
                const existingCard = pollsContainer.querySelector(`[data-poll-id="${pollId}"]`);
                if (existingCard) existingCard.remove();
            }
        });

        isInitialSnapshot = false; // <-- flip after first batch

        const noPollsMessage = document.getElementById('no-polls-message');
        if (pollsContainer.children.length === 0) {
            if (role === 'member' && noPollsMessage) {
                noPollsMessage.textContent = 'NO POLLS YET';
                noPollsMessage.style.display = 'block';
            }
        } else if (noPollsMessage) {
            noPollsMessage.style.display = 'none';
        }

        updateLastSeenPolls();
    }, (error) => { console.error("Error fetching realtime polls:", error); });
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
                                name="poll-${pollId}-${currentUser.uid}"  
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
                handleVote(pollId, optionIndex);
            } else {
                card.querySelectorAll('.poll-radio').forEach(r => {
                    r.dataset.wasChecked = 'false';
                });
                clickedRadio.dataset.wasChecked = 'true';
                handleVote(pollId, optionIndex);
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


async function handleVote(pollId, optionIndex) {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to vote.");
        return;
    }

    const pollRef = doc(db, "clubs", clubId, "polls", pollId);
    const userUid = currentUser.uid;

    try {
        await runTransaction(db, async (transaction) => {
            const pollSnap = await transaction.get(pollRef);

            if (!pollSnap.exists()) {
                throw new Error("Poll not found");
            }

            const pollData = pollSnap.data();
            const options = structuredClone(pollData.options);

            let previousVoteIndex = -1;

            options.forEach((option, index) => {
                if (option.votes.includes(userUid)) {
                    previousVoteIndex = index;
                }
            });

            // toggle logic (same as yours, just safer)
            if (previousVoteIndex === optionIndex) {
                options[optionIndex].votes =
                    options[optionIndex].votes.filter(uid => uid !== userUid);
            } 
            else {
                if (previousVoteIndex !== -1) {
                    options[previousVoteIndex].votes =
                        options[previousVoteIndex].votes.filter(uid => uid !== userUid);
                }
                options[optionIndex].votes.push(userUid);
            }

            transaction.update(pollRef, { options });
        });

    } catch (error) {
        console.error("Transaction failed:", error);
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
    const pollRef = doc(db, "clubs", clubId, "polls", pollId);
    const pollSnap = await getDoc(pollRef);
    if (!pollSnap.exists()) { await showAppAlert("Poll not found."); return; }
    pollData = pollSnap.data();

    const existingCard = document.querySelector(`[data-poll-id="${pollId}"]`);
    if (!existingCard) return;

    const editCard = document.createElement('div');
    editCard.className = 'poll-card editing-poll-card';
    editCard.innerHTML = `
        <h3>${pollData.title}</h3>
        <div class="poll-options-selection" style="margin-top:12px;">
            <label>Show results to voter:</label>
            <div class="vis-strip-group">
                <div class="vis-strip" data-value="Before">
                    <span class="vis-strip-title">BEFORE</span>
                    <span class="vis-strip-sub">${visMessages.Before}</span>
                </div>
                <div class="vis-strip" data-value="After">
                    <span class="vis-strip-title">AFTER</span>
                    <span class="vis-strip-sub">${visMessages.After}</span>
                </div>
                <div class="vis-strip" data-value="Never">
                    <span class="vis-strip-title">NEVER</span>
                    <span class="vis-strip-sub">${visMessages.Never}</span>
                </div>
            </div>
        </div>
        <div class="poll-creation-actions" style="margin-top:14px;">
            <button class="save-edit-inline-btn fancy-button">SAVE</button>
            <button class="cancel-edit-inline-btn fancy-button">CANCEL</button>
        </div>
    `;

    // pre-check current visibility
    const editVisStrips = editCard.querySelectorAll('.vis-strip');
    editVisStrips.forEach(strip => {
        strip.addEventListener('click', () => {
            editVisStrips.forEach(s => s.classList.remove('vis-strip-selected'));
            strip.classList.add('vis-strip-selected');
        });
    });

    const currentVisibility = pollData.visibility || 'After';

    const selectedStrip = editCard.querySelector(`.vis-strip[data-value="${currentVisibility}"]`);
    if (selectedStrip) {
        selectedStrip.classList.add('vis-strip-selected');
    }

    editCard.querySelector('.save-edit-inline-btn').addEventListener('click', async () => {
        const selected = editCard.querySelector('.vis-strip-selected')?.dataset.value || 'After';
        try {
            await updateDoc(doc(db, "clubs", clubId, "polls", pollId), { visibility: selected });
            editCard.replaceWith(existingCard);
        } catch (err) {
            await showAppAlert("Failed to update poll: " + err.message);
        }
    });

    editCard.querySelector('.cancel-edit-inline-btn').addEventListener('click', () => {
        editCard.replaceWith(existingCard);
    });

    existingCard.replaceWith(editCard);
}


async function updateLastSeenPolls() {
    if (!currentUser || !clubId) return;

    const memberDocRef = doc(db, "clubs", clubId, "members", currentUser.uid);

    try {
        await updateDoc(memberDocRef, {
            lastSeenPolls: serverTimestamp()
        });
        console.log("Updated lastSeenPolls timestamp");
    } catch (error) {
        console.error("Failed to update lastSeenPolls:", error);
    }
}

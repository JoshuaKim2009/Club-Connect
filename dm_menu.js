// dm_menu.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, doc, getDoc, setDoc, serverTimestamp, query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';

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
const newDmButton = document.getElementById('newDmButton');
const newDmModal = document.getElementById('new-dm-modal');
const newDmOverlay = document.getElementById('new-dm-overlay');
const cancelNewDmButton = document.getElementById('cancel-new-dm-button');
let cachedMembers = null;

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

const clubId = getUrlParameter('clubId');
const returnTo = getUrlParameter('returnTo');
document.body.classList.add('no-scroll');
let loadingScreenHidden = false;
const contentEl = document.getElementById('content');
if (contentEl) contentEl.style.display = 'none';


const backButton = document.getElementById('back-button');

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    if (!clubId) {
        window.location.href = 'your_clubs.html';
        return;
    }

    try {
        const clubSnap = await getDoc(doc(db, 'clubs', clubId));
        if (!clubSnap.exists()) {
            showContainerError("This club doesn't exist.");
            hideLoadingScreen();
            return;
        }
        hideLoadingScreen();
        loadDms();
    } catch (error) {
        console.error(error);
        showContainerError("Oops! Something went wrong.", true);
        hideLoadingScreen();
    }
});

if (backButton) {
    backButton.addEventListener('click', () => {
        if (returnTo === 'manager') {
            window.location.href = `club_page_manager.html?id=${clubId}`;
        } else if (returnTo === 'member') {
            window.location.href = `club_page_member.html?id=${clubId}`;
        } else {
            window.location.href = 'your_clubs.html';
        }
    });
}

function createDmCard(convId, otherUid, otherName, lastMessage, timeStr, unreadCount) {
    const card = document.createElement('div');
    card.className = 'dm-card';

    const initial = otherName.charAt(0).toUpperCase();
    let messageText = "messages";
    if (unreadCount === 1){
        messageText = "message";
    }
    const avatarColor = getColorFromLetter(initial);

    card.innerHTML = `
        <div class="dm-card-avatar" style="background-color: ${avatarColor};">${initial}</div>
        <div class="dm-card-body">
            <div class="dm-card-name">${otherName}</div>
            <div class="dm-card-preview">${lastMessage}</div>
        </div>
        <div class="dm-card-meta">
            <div class="dm-card-time">${timeStr}</div>
            ${unreadCount > 0 ? `<div class="dm-unread-badge">${unreadCount} new ${messageText}</div>` : ''}
        </div>
    `;

    card.addEventListener('click', () => {
        window.location.href = `direct_messages.html?convId=${convId}&otherUid=${otherUid}&otherName=${encodeURIComponent(otherName)}&clubId=${clubId}&returnTo=${returnTo}`;
    });

    return card;
}

function getColorFromLetter(letter) {
    const colors = [
        'rgb(130, 80, 180)',
        'rgb(60, 140, 130)',
        'rgb(190, 75, 75)',
        'rgb(75, 150, 60)',
        'rgb(60, 110, 190)',
        'rgb(190, 130, 45)',
    ];
    const index = letter.charCodeAt(0) % colors.length;
    return colors[index];
}


async function loadDms() {
    const list = document.getElementById('dm-list');

    const memberUIDsPromise = getDoc(doc(db, 'clubs', clubId))
        .then(snap => snap.exists() ? new Set(snap.data().memberUIDs || []) : null)
        .catch(err => {
            console.warn('Could not fetch club members for DM filtering, showing all:', err);
            return null;
        });

    const q = query(
        collection(db, 'directMessages'),
        where('participants', 'array-contains', currentUser.uid),
        orderBy('lastMessageAt', 'desc')
    );

    let isInitialDmLoad = true;

    onSnapshot(q, async (snapshot) => {
        const memberUIDsSet = await memberUIDsPromise; 
        list.querySelectorAll('.dm-card').forEach(c => c.remove());

        let cardIndex = 0;
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.lastMessageText) return;

            const otherUid = data.participants.find(uid => uid !== currentUser.uid);
            if (memberUIDsSet && !memberUIDsSet.has(otherUid)) return;

            const convId = docSnap.id;
            const otherName = data.participantNames?.[otherUid] || 'Unknown';
            const unreadCount = data.unreadCounts?.[currentUser.uid] || 0;
            const lastMessage = data.lastMessageText || '';
            const lastMessageAt = data.lastMessageAt?.toDate();

            let timeStr = '';
            if (lastMessageAt) {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const msgDate = new Date(lastMessageAt.getFullYear(), lastMessageAt.getMonth(), lastMessageAt.getDate());

                if (msgDate.getTime() === today.getTime()) {
                    const hours = lastMessageAt.getHours();
                    const minutes = lastMessageAt.getMinutes().toString().padStart(2, '0');
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    const displayHours = hours % 12 || 12;
                    timeStr = `${displayHours}:${minutes} ${ampm}`;
                } else if (msgDate.getTime() === yesterday.getTime()) {
                    timeStr = 'Yesterday';
                } else {
                    timeStr = lastMessageAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }
            }

            const card = createDmCard(convId, otherUid, otherName, lastMessage, timeStr, unreadCount);
            list.appendChild(card);
            if (isInitialDmLoad) animateCardIn(card, cardIndex++);
        });

        isInitialDmLoad = false;
    }, (error) => {
        console.error('Error loading DMs:', error);
        showContainerError("Oops! Something went wrong.", true);
    });
}

function closeNewDmModal() {
    newDmOverlay.style.display = 'none';
    newDmModal.style.display = 'none';
    document.body.classList.remove('no-scroll');
}

function openNewDmModal() {
    newDmOverlay.style.display = 'block';
    document.body.classList.add('no-scroll');
    loadMembers();
}

async function loadMembers() {
    if (cachedMembers) {
        showModal();
        renderMemberList(cachedMembers);
        return;
    }

    document.getElementById('new-dm-loading').style.display = 'flex';

    try {
        const membersRef = collection(db, 'clubs', clubId, 'members');
        const snap = await getDocs(membersRef);

        const memberDocs = snap.docs.filter(d => d.id !== currentUser.uid);

        const userSnaps = await Promise.all(
            memberDocs.map(d => getDoc(doc(db, 'users', d.id)))
        );

        const members = memberDocs.map((d, i) => ({
            uid: d.id,
            name: userSnaps[i].exists() ? (userSnaps[i].data().name || 'Unknown') : 'Unknown'
        }));

        cachedMembers = members;
        document.getElementById('new-dm-loading').style.display = 'none';
        showModal();
        renderMemberList(cachedMembers);

    } catch (err) {
        console.error('Error loading members:', err);
        document.getElementById('new-dm-loading').style.display = 'none';
        newDmOverlay.style.display = 'none';
        document.body.classList.remove('no-scroll');
        await showAppAlert('Failed to load members.');
    }
}

function showModal() {
    newDmOverlay.style.display = 'block';
    newDmModal.style.display = 'flex';
}

function renderMemberList(members) {
    const memberList = document.getElementById('member-list');
    memberList.innerHTML = '';

    if (members.length === 0) {
        memberList.innerHTML = '<p class="fancy-black-label">No other members found.</p>';
        return;
    }

    members.forEach(({ uid, name }) => {
        const btn = document.createElement('button');
        btn.className = 'member-dm-btn';
        btn.textContent = name;
        btn.addEventListener('click', async () => {
            await openOrCreateConversation(uid, name);
        });
        memberList.appendChild(btn);
    });
}

async function openOrCreateConversation(otherUid, otherName) {
    const sortedUids = [currentUser.uid, otherUid].sort();
    const convId = `${sortedUids[0]}_${sortedUids[1]}`;

    const convRef = doc(db, 'directMessages', convId);
    const convSnap = await getDoc(convRef);

    if (!convSnap.exists()) {
        await setDoc(convRef, {
            participants: sortedUids,
            participantNames: {
                [currentUser.uid]: currentUser.displayName || 'Unknown',
                [otherUid]: otherName
            },
            createdAt: serverTimestamp(),
            lastMessageAt: serverTimestamp(),
            lastMessageText: '',
            lastMessageType: 'text',
            lastMessageSenderUid: '',
            unreadCounts: {
                [currentUser.uid]: 0,
                [otherUid]: 0
            }
        });
    }

    window.location.href = `direct_messages.html?convId=${convId}&otherUid=${otherUid}&otherName=${encodeURIComponent(otherName)}&clubId=${clubId}&returnTo=${returnTo}`;
}

if (newDmButton) {
    newDmButton.addEventListener('click', openNewDmModal);
}

if (cancelNewDmButton) {
    cancelNewDmButton.addEventListener('click', closeNewDmModal);
}

newDmOverlay.addEventListener('click', closeNewDmModal);



function animateCardIn(card, index = 0) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    card.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
        setTimeout(() => {
            card.style.opacity = '';
            card.style.transform = '';
            card.style.transition = '';
        }, 300);
    }, index * 50);
}



function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;

    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    } else {
        document.body.classList.remove('no-scroll');
    }
    if (content) {
        content.style.display = 'block';
        Array.from(content.querySelectorAll(':scope > *')).forEach(item => {
            item.classList.add('revealed-child');
        });
    }
}

function showContainerError(message, showRetry = false, topMargin = '142px') {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
        <div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button type="button" class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}
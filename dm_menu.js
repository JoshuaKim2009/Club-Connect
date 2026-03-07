// dm_menu.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, serverTimestamp, query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const backButton = document.getElementById('back-button');

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        if (!clubId) {
            window.location.href = 'your_clubs.html';
            return;
        }
        loadDms();
    } else {
        window.location.href = 'login.html';
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


function loadDms() {
    const list = document.getElementById('dm-list');
    const newDmBtn = list.querySelector('.new-dm-btn');

    const q = query(
        collection(db, 'directMessages'),
        where('participants', 'array-contains', currentUser.uid),
        orderBy('lastMessageAt', 'desc')
    );

    onSnapshot(q, (snapshot) => {
        list.querySelectorAll('.dm-card').forEach(c => c.remove());

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.lastMessageText) return;
            const convId = docSnap.id;
            const otherUid = data.participants.find(uid => uid !== currentUser.uid);
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
        });
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
        const members = [];

        for (const d of snap.docs) {
            if (d.id === currentUser.uid) continue;
            const userRef = doc(db, 'users', d.id);
            const userSnap = await getDoc(userRef);
            const name = userSnap.exists() ? (userSnap.data().name || 'Unknown') : 'Unknown';
            members.push({ uid: d.id, name });
        }

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
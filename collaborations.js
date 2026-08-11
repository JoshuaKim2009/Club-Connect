import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, getDocs, onSnapshot, serverTimestamp, limit, startAfter, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getRoleLabel, ROLE_LABELS } from './roleLabels.js';
import { getRole } from './roleCache.js';

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


// firebase stuff
async function createCollaboration(fromClubId, title, description, toClubIds, user) {
    const collabData = {
        title,
        description,
        fromClubId,
        toClubIds,
        createdByUid: user.uid,
        createdByName: user.displayName || "Unknown",
        createdAt: serverTimestamp()
    };

    const collabCollectionRef = collection(db, "collaborations");
    const collabRef = await addDoc(collabCollectionRef, collabData);

    return { id: collabRef.id, ...collabData };
}

const COLLAB_PAGE = 3;

async function fetchCollabPage(clubId, tab, afterSnap = null) {
    const parts = [
        collection(db, "collaborations"),
        tab === 'sent'
            ? where("fromClubId", "==", clubId)
            : where("toClubIds", "array-contains", clubId),
        orderBy("createdAt", "desc")
    ];
    if (afterSnap) parts.push(startAfter(afterSnap));
    parts.push(limit(COLLAB_PAGE + 1));

    const snap = await getDocs(query(...parts));
    const docs = snap.docs;
    const hasMore = docs.length > COLLAB_PAGE;
    const page = hasMore ? docs.slice(0, COLLAB_PAGE) : docs;

    return {
        items: page.map(d => ({ id: d.id, ...d.data() })),
        lastSnap: page.length ? page[page.length - 1] : afterSnap,
        hasMore
    };
}

async function fetchCollabCount(clubId, tab) {
    const q = query(
        collection(db, "collaborations"),
        tab === 'sent'
            ? where("fromClubId", "==", clubId)
            : where("toClubIds", "array-contains", clubId)
    );
    return (await getCountFromServer(q)).data().count;
}

const schoolClubsCache = new Map();

async function fetchSchoolClubs(schoolId) {
    if (!schoolClubsCache.has(schoolId)) {
        const schoolSnap = await getDoc(doc(db, "schools", schoolId));
        const clubs = schoolSnap.exists() ? (schoolSnap.data().clubs || []) : [];
        schoolClubsCache.set(schoolId, clubs);
    }
    return schoolClubsCache.get(schoolId);
}

async function resolveClubNames(clubIds) {
    const clubs = await fetchSchoolClubs(currentSchoolId);
    const result = {};
    clubIds.forEach(id => {
        const match = clubs.find(c => c.id === id);
        result[id] = match ? match.name : "Unknown club";
    });
    return result;
}

async function fetchClubsInSchool(schoolId, excludeClubId) {
    const clubs = await fetchSchoolClubs(schoolId);
    return clubs.filter(c => c.id !== excludeClubId);
}

async function updateCollaboration(collabId, title, description) {
    await updateDoc(doc(db, "collaborations", collabId), { title, description });
    return { id: collabId, title, description };
}

async function createComment(collabId, text, authorClubId, user) {
    const commentData = {
        text,
        authorUid: user.uid,
        authorName: user.displayName || "Unknown",
        authorClubId,
        createdAt: serverTimestamp()
    };
    const commentRef = await addDoc(collection(db, "collaborations", collabId, "comments"), commentData);
    return { id: commentRef.id, ...commentData };
}

async function deleteComment(collabId, commentId) {
    await deleteDoc(doc(db, "collaborations", collabId, "comments", commentId));
}


// page logic
let currentUser = null;
let clubId = null;
let currentUserRole = null;
let currentSchoolId = null;
let currentClubName = null;
let activeTab = 'sent';
let isEditingCollab = false;
let renderToken = 0;
const COMMENT_PAGE = 6;
let activeThread = null;

function killActiveThread() {
    if (activeThread && activeThread.unsub) activeThread.unsub();
    activeThread = null;
}

const listCache = { sent: null, received: null };
const counts = { sent: 0, received: 0 };
const selectedClubIds = new Set();
let currentPickerClubs = [];

const collabContainer = document.getElementById('collabContainer');
const addCollabButton = document.getElementById('add-collab-button');
const editingCollabCard = document.getElementById('editing-collab-card');
const sentTabBtn = document.getElementById('sent-tab-btn');
const receivedTabBtn = document.getElementById('received-tab-btn');
const tabRow = document.querySelector('.collab-tab-row');
const threadCache = new Map();
let canManageCollabs = false;

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function initials(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function relativeTime(timestamp) {
    if (!timestamp) return 'Just now';
    const date = typeof timestamp === 'number'
        ? new Date(timestamp)
        : (timestamp.toDate ? timestamp.toDate() : null);
    if (!date) return 'Just now';
    const seconds = (Date.now() - date.getTime()) / 1000;
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function clubNameFor(id) {
    const clubs = schoolClubsCache.get(currentSchoolId) || [];
    const match = clubs.find(c => c.id === id);
    return match ? match.name : 'Unknown club';
}

function updateComposePlaceholder(card, count) {
    card.querySelector('.collab-compose-input').placeholder =
        count === 0 ? 'Be the first to reply' : `Reply as ${currentClubName}`;
}

function refreshRelativeTimes() {
    document.querySelectorAll('.collab-strip-time[data-created-at]').forEach(el => {
        const ms = Number(el.dataset.createdAt);
        if (ms) el.textContent = relativeTime(ms);
    });
    document.querySelectorAll('.collab-comment-row[data-created-at]').forEach(row => {
        const ms = Number(row.dataset.createdAt);
        if (!ms) return;
        row.querySelector('.collab-comment-meta').textContent =
            `${clubNameFor(row.dataset.authorClubId)} \u00b7 ${relativeTime(ms)}`;
    });
}

function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

window.goToClubPage = function () {
    window.location.href = clubId
        ? `club_page.html?clubId=${clubId}`
        : 'your_clubs.html';
};

function hideLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    }
    if (content) {
        content.style.display = 'block';
        Array.from(content.children).forEach((item, i) => {
            setTimeout(() => item.classList.add('revealed-child'), i * 100);
        });
    }
}

function showContainerError(container, message, showRetry = false) {
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <p class="fancy-label">${esc(message)}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}

function denyAccess(message) {
    hideLoadingScreen();
    if (tabRow) tabRow.style.display = 'none';
    if (addCollabButton) addCollabButton.style.display = 'none';
    showContainerError(collabContainer, message);
}



document.body.classList.add('no-scroll');

setTimeout(() => {
    refreshRelativeTimes();
    setInterval(refreshRelativeTimes, 60000);
}, 60000 - (Date.now() % 60000));

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRelativeTimes();
});

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (!clubId) {
        window.location.href = 'your_clubs.html';
        return;
    }

    try {
        const clubSnap = await getDoc(doc(db, "clubs", clubId));

        if (!clubSnap.exists()) return denyAccess("This club doesn't exist.");

        currentClubName = clubSnap.data().clubName || 'Unnamed club';
        currentSchoolId = clubSnap.data().schoolId || null;

        const schoolPromise = currentSchoolId ? fetchSchoolClubs(currentSchoolId) : Promise.resolve([]);

        currentUserRole = await getRole(db, clubId, currentUser.uid, clubSnap);

        if (currentUserRole === null) return denyAccess("You're not a member of this club.");

        canManageCollabs = currentUserRole === 'manager' || currentUserRole === 'admin';

        if (canManageCollabs) {
            addCollabButton.style.display = 'block';
            addCollabButton.addEventListener('click', openCreateForm);
            addCollabButton.addEventListener('mouseenter', () => fetchClubsInSchool(currentSchoolId, clubId), { once: true });
            addCollabButton.addEventListener('touchstart', () => fetchClubsInSchool(currentSchoolId, clubId), { once: true, passive: true });
            document.getElementById('collab-post-btn').addEventListener('click', postNewCollaboration);
            document.getElementById('collab-cancel-btn').addEventListener('click', closeCreateForm);
        } else {
            tabRow.style.marginTop = '-45px';
        }
        sentTabBtn.addEventListener('click', () => switchTab('sent'));
        receivedTabBtn.addEventListener('click', () => switchTab('received'));

        const sentPromise = fetchCollabPage(clubId, 'sent');
        const countsPromise = Promise.all([
            fetchCollabCount(clubId, 'sent'),
            fetchCollabCount(clubId, 'received')
        ]);

        const [sentPage] = await Promise.all([sentPromise, schoolPromise]);

        listCache.sent = sentPage;

        activeTab = 'sent';
        sentTabBtn.classList.add('collab-tab-selected');
        receivedTabBtn.classList.remove('collab-tab-selected');
        await paintList(sentPage.items, 'sent');

        hideLoadingScreen();

        countsPromise.then(([sentCount, receivedCount]) => {
            counts.sent = sentCount;
            counts.received = receivedCount;
            updateTabCounts();
        }).catch(err => console.error("Error fetching collaboration counts:", err));

    } catch (error) {
        hideLoadingScreen();
        console.error("Error fetching club details or user role:", error);
        if (tabRow) tabRow.style.display = 'none';
        if (addCollabButton) addCollabButton.style.display = 'none';
        showContainerError(collabContainer, "Couldn't load collaborations.", true);
    }
});



async function switchTab(tab) {
    if (tab === activeTab) return;

    activeTab = tab;
    sentTabBtn.classList.toggle('collab-tab-selected', tab === 'sent');
    receivedTabBtn.classList.toggle('collab-tab-selected', tab === 'received');

    const token = ++renderToken;

    if (listCache[tab]) {
        await paintList(listCache[tab].items, tab, token);
        return;
    }

    collabContainer.innerHTML = '';

    try {
        const page = await fetchCollabPage(clubId, tab);

        if (token !== renderToken) return;

        listCache[tab] = page;
        await paintList(page.items, tab, token);
    } catch (error) {
        if (token !== renderToken) return;
        console.error("Error loading collaborations:", error);
        showContainerError(collabContainer, "Couldn't load collaborations.", true);
    }
}

async function paintList(list, tab, token = renderToken) {
    killActiveThread();
    collabContainer.innerHTML = '';

    if (list.length === 0) {
        renderEmptyState(tab);
        return;
    }

    const allClubIds = [...new Set(list.flatMap(item => [item.fromClubId, ...(item.toClubIds || [])]))];
    const nameMap = await resolveClubNames(allClubIds);

    if (token !== renderToken) return;

    const frag = document.createDocumentFragment();
    list.forEach(item => frag.appendChild(createCollabCard(item, nameMap)));
    collabContainer.innerHTML = '';
    collabContainer.appendChild(frag);
    renderCollabLoadMore(tab);
}

function renderEmptyState(tab) {
    const card = document.createElement('div');
    card.className = 'empty-state-card-dashed static';

    if (tab === 'sent') {
        card.innerHTML = canManageCollabs
            ? `<i class="fa-solid fa-handshake"></i>
               <p class="empty-state-dashed-title">Start your first collab</p>
               <p class="empty-state-dashed-subtitle">Tap NEW COLLAB to reach out to another club</p>`
            : `<i class="fa-solid fa-handshake"></i>
               <p class="empty-state-dashed-title">No collabs started yet</p>
               <p class="empty-state-dashed-subtitle">Collabs sent by your club officers appear here</p>`;
    } else {
        card.innerHTML = `<i class="fa-solid fa-handshake"></i>
           <p class="empty-state-dashed-title">Nothing sent your way yet</p>
           <p class="empty-state-dashed-subtitle">${canManageCollabs
               ? `Collabs other clubs send you land here`
               : `Collabs other clubs send you land here`}</p>`;
    }

    collabContainer.appendChild(card);
}

function clearEmptyState() {
    const empty = collabContainer.querySelector('.empty-state-card-dashed');
    if (empty) empty.remove();
}

function updateTabCounts() {
    sentTabBtn.innerHTML = `SENT<span class="collab-tab-badge">${counts.sent}</span>`;
    receivedTabBtn.innerHTML = `RECEIVED<span class="collab-tab-badge">${counts.received}</span>`;
}



function createCollabCard(data, nameMap) {
    const isMine = data.fromClubId === clubId;
    const toClubIds = data.toClubIds || [];

    const stripLabel = isMine
        ? (toClubIds.length === 1
            ? `Sent to ${nameMap[toClubIds[0]] || 'Unknown club'}`
            : `Sent to ${toClubIds.length} clubs`)
        : `Received from ${nameMap[data.fromClubId] || 'Unknown club'}`;

    const fromChip = `<span class="collab-chip ${isMine ? 'collab-chip-you' : 'collab-chip-from'}">${esc(nameMap[data.fromClubId] || 'Unknown club')}</span>`;
    const toChips = toClubIds.map(id =>
        `<span class="collab-chip ${id === clubId ? 'collab-chip-you' : ''}">${esc(nameMap[id] || 'Unknown club')}</span>`
    ).join('');

    const card = document.createElement('div');
    card.className = `collab-card ${isMine ? 'collab-card-sent' : 'collab-card-received'}`;
    card.dataset.collabId = data.id;

    card.innerHTML = `
        <div class="collab-strip">
            <span>${esc(stripLabel)}</span>
            <span class="collab-strip-right">
                <span class="collab-strip-time" data-created-at="${data.createdAt?.toMillis ? data.createdAt.toMillis() : ''}">${esc(relativeTime(data.createdAt))}</span>
            </span>
        </div>
        <div class="collab-body">
            <h3>${esc(data.title)}</h3>
            <div class="collab-chips">${fromChip}<span class="collab-chip-arrow">&rarr;</span>${toChips}</div>
            <p class="collab-desc">${esc(data.description)}</p>
        </div>
        <button class="collab-toggle" aria-expanded="false">
            <span class="collab-toggle-label">
                <i class="fa-regular fa-comment" aria-hidden="true" style="margin-left: 2px;"></i>
                <span>Replies</span>
            </span>
            <i class="fa-solid fa-chevron-down collab-toggle-caret" aria-hidden="true"></i>
        </button>
        <div class="collab-thread-panel" inert>
            <div class="collab-thread-inner">
                <div class="collab-comment-list"></div>
                <div class="collab-compose-row">
                    <input class="collab-compose-input" maxlength="500" placeholder="Reply as ${esc(currentClubName)}">
                    <button class="collab-compose-btn" aria-label="Send reply" disabled><i class="fa-solid fa-arrow-up"></i></button>
                </div>
            </div>
        </div>
    `;

    const toggle = card.querySelector('.collab-toggle');
    toggle.addEventListener('click', () => {
        toggleThread(card, data.id).catch(async (err) => {
            console.error("Thread toggle failed:", err);
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            if (isPermissionError(err)) {
                await showAppAlert(permissionDeniedMessage("view replies on this collaboration"));
            } else {
                await showAppAlert("Couldn't load replies. Try again.");
            }
        });
    });

    const input = card.querySelector('.collab-compose-input');
    const sendBtn = card.querySelector('.collab-compose-btn');

    input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing && input.value.trim()) postComment(card, data.id, input);
    });
    sendBtn.addEventListener('click', () => postComment(card, data.id, input));

    return card;
}

function closeActiveThread() {
    if (!activeThread) return;
    const card = activeThread.card;
    const panel = card.querySelector('.collab-thread-panel');
    const toggle = card.querySelector('.collab-toggle');
    const listEl = card.querySelector('.collab-comment-list');

    if (activeThread.unsub) activeThread.unsub();
    activeThread = null;

    panel.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    panel.setAttribute('inert', '');

    panel.addEventListener('transitionend', function done(e) {
        if (e.propertyName !== 'grid-template-rows') return;
        panel.removeEventListener('transitionend', done);
        if (panel.classList.contains('open')) return;
        listEl.innerHTML = '';
        card.classList.remove('is-open');
    });
}

let isTogglingThread = false;

async function toggleThread(card, collabId) {
    if (isTogglingThread) return;
    isTogglingThread = true;

    try {
        const wasOpen = activeThread && activeThread.collabId === collabId;
        closeActiveThread();
        if (wasOpen) return;

        const panel = card.querySelector('.collab-thread-panel');
        const toggle = card.querySelector('.collab-toggle');
        const listEl = card.querySelector('.collab-comment-list');

        toggle.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');

        await fetchSchoolClubs(currentSchoolId);

        let cache = threadCache.get(collabId);

        if (!cache) {
            const snap = await getDocs(query(
                collection(db, "collaborations", collabId, "comments"),
                orderBy("createdAt", "desc"),
                limit(COMMENT_PAGE + 1)
            ));
            const docs = snap.docs;
            const hasMore = docs.length > COMMENT_PAGE;
            const page = hasMore ? docs.slice(0, COMMENT_PAGE) : docs;

            cache = {
                comments: page.slice().reverse().map(d => ({ id: d.id, ...d.data() })),
                oldestSnap: page.length ? page[page.length - 1] : null,
                newestSnap: page.length ? page[0] : null,
                hasMore
            };
            threadCache.set(collabId, cache);
        }

        activeThread = { collabId, card, cache, loading: false, unsub: null };

        listEl.innerHTML = '';
        cache.comments.forEach(c => listEl.appendChild(createCommentRow(c, collabId)));
        renderLoadMore(listEl, collabId);
        updateComposePlaceholder(card, cache.comments.length);
        listEl.scrollTop = listEl.scrollHeight;

        card.classList.add('is-open');
        panel.removeAttribute('inert');
        panel.classList.add('open');

        startNewCommentListener(card, collabId, cache.newestSnap);
    } finally {
        isTogglingThread = false;
    }
}

function renderLoadMore(listEl, collabId) {
    listEl.querySelector('.collab-load-more')?.remove();
    if (!activeThread || !activeThread.cache.hasMore) return;
    const btn = document.createElement('button');
    btn.className = 'collab-load-more';
    btn.textContent = 'Load earlier replies';
    btn.addEventListener('click', () => loadOlderComments(listEl, collabId, btn));
    listEl.insertBefore(btn, listEl.firstChild);
}

const LOAD_MORE_LABEL = 'Load more <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';

function renderCollabLoadMore(tab) {
    collabContainer.querySelector(':scope > .collab-load-more')?.remove();
    const cache = listCache[tab];
    if (!cache || !cache.hasMore) return;

    const btn = document.createElement('button');
    btn.className = 'collab-load-more collab-load-more-list';
    btn.innerHTML = LOAD_MORE_LABEL;
    btn.addEventListener('click', () => loadMoreCollabs(tab, btn));
    collabContainer.appendChild(btn);
}

async function loadMoreCollabs(tab, btn) {
    const cache = listCache[tab];
    if (!cache || !cache.hasMore || cache.loading) return;

    cache.loading = true;
    btn.disabled = true;
    btn.innerHTML = 'Loading…';
    const token = renderToken;

    try {
        const page = await fetchCollabPage(clubId, tab, cache.lastSnap);
        if (token !== renderToken) return;

        cache.items = [...cache.items, ...page.items];
        cache.lastSnap = page.lastSnap;
        cache.hasMore = page.hasMore;

        const ids = [...new Set(page.items.flatMap(i => [i.fromClubId, ...(i.toClubIds || [])]))];
        const nameMap = await resolveClubNames(ids);
        if (token !== renderToken) return;

        const frag = document.createDocumentFragment();
        page.items.forEach(i => frag.appendChild(createCollabCard(i, nameMap)));

        btn.remove();
        collabContainer.appendChild(frag);
        renderCollabLoadMore(tab);
    } catch (error) {
        console.error("Error loading more collaborations:", error);
        btn.disabled = false;
        btn.innerHTML = LOAD_MORE_LABEL;
    } finally {
        cache.loading = false;
    }
}

async function loadOlderComments(listEl, collabId, btn) {
    if (!activeThread || activeThread.loading || !activeThread.cache.hasMore) return;
    activeThread.loading = true;
    btn.disabled = true;
    btn.textContent = 'Loading…';

    const prevHeight = listEl.scrollHeight;
    const prevTop = listEl.scrollTop;
    const cache = activeThread.cache;

    try {
        const snap = await getDocs(query(
            collection(db, "collaborations", collabId, "comments"),
            orderBy("createdAt", "desc"),
            startAfter(cache.oldestSnap),
            limit(COMMENT_PAGE + 1)
        ));

        if (!activeThread || activeThread.collabId !== collabId) return;

        const docs = snap.docs;
        cache.hasMore = docs.length > COMMENT_PAGE;
        const page = cache.hasMore ? docs.slice(0, COMMENT_PAGE) : docs;
        if (page.length) cache.oldestSnap = page[page.length - 1];

        const newRows = page.slice().reverse().map(d => ({ id: d.id, ...d.data() }));
        cache.comments = [...newRows, ...cache.comments];

        const frag = document.createDocumentFragment();
        newRows.forEach(c => frag.appendChild(createCommentRow(c, collabId)));

        btn.remove();
        listEl.insertBefore(frag, listEl.firstChild);
        renderLoadMore(listEl, collabId);
        listEl.scrollTop = prevTop + (listEl.scrollHeight - prevHeight);
    } catch (error) {
        console.error("Error loading earlier replies:", error);
        btn.disabled = false;
        btn.textContent = 'Load earlier replies';
    } finally {
        if (activeThread) activeThread.loading = false;
    }
}

function startNewCommentListener(card, collabId, newestSnap) {
    const listEl = card.querySelector('.collab-comment-list');
    const ref = collection(db, "collaborations", collabId, "comments");
    const q = newestSnap
        ? query(ref, orderBy("createdAt", "asc"), startAfter(newestSnap))
        : query(ref, orderBy("createdAt", "asc"));

    activeThread.unsub = onSnapshot(q, (snap) => {
        if (!activeThread || activeThread.collabId !== collabId) return;
        const cache = activeThread.cache;
        const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
        let mineAdded = false;

        snap.docChanges().forEach(change => {
            if (change.type !== 'added') return;
            const c = {
                id: change.doc.id,
                ...change.doc.data() 
            };
            if (listEl.querySelector(`[data-comment-id="${c.id}"]`)) return;
            listEl.appendChild(createCommentRow(c, collabId));
            if (!cache.comments.some(x => x.id === c.id)) cache.comments.push(c);
            if (c.createdAt) cache.newestSnap = change.doc;
            if (c.authorUid === currentUser.uid) mineAdded = true;
        });

        updateComposePlaceholder(card, listEl.querySelectorAll('.collab-comment-row').length);
        if (nearBottom || mineAdded) listEl.scrollTop = listEl.scrollHeight;
    }, (error) => console.error("Comment listener error:", error));
}

function createCommentRow(c, collabId) {
    const isMine = c.authorUid === currentUser.uid;
    const isMyClub = c.authorClubId === clubId;

    const row = document.createElement('div');
    row.className = `collab-comment-row ${isMyClub ? 'is-my-club' : ''}`;
    row.dataset.commentId = c.id;
    row.dataset.authorClubId = c.authorClubId || '';
    row.dataset.createdAt = c.createdAt?.toMillis ? c.createdAt.toMillis() : '';
    row.innerHTML = `
        <div class="collab-avatar">${esc(initials(c.authorName))}</div>
        <div class="collab-comment-main">
            <p class="collab-comment-who">
                ${esc(isMine ? 'You' : c.authorName)}<span class="collab-comment-meta">${esc(clubNameFor(c.authorClubId))} &middot; ${esc(relativeTime(c.createdAt))}</span>
                ${isMine ? `<button class="collab-comment-del" aria-label="Delete reply"><i class="fa-solid fa-xmark"></i></button>` : ''}
            </p>
            <p class="collab-comment-text"></p>
        </div>
    `;
    row.querySelector('.collab-comment-text').textContent = c.text;

    if (isMine) {
        row.querySelector('.collab-comment-del')
           .addEventListener('click', () => handleDeleteComment(collabId, c.id, row));
    }
    return row;
}

async function postComment(card, collabId, inputEl) {
    const text = inputEl.value.trim();
    if (!text) return;

    const sendBtn = card.querySelector('.collab-compose-btn');
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.focus();

    try {
        await createComment(collabId, text, clubId, currentUser);
    } catch (error) {
        console.error("Error posting comment:", error);
        if (!inputEl.value.trim()) inputEl.value = text;
        sendBtn.disabled = !inputEl.value.trim();
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("reply to this collaboration"));
        } else {
            await showAppAlert("Something went wrong while posting your reply.");
        }
    }
}

async function handleDeleteComment(collabId, commentId, commentRow) {
    const confirmed = await showAppConfirm("Delete this reply?");
    if (!confirmed) return;

    try {
        await deleteComment(collabId, commentId);
    } catch (error) {
        console.error("Error deleting comment:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("delete this reply"));
        } else {
            await showAppAlert("Something went wrong while deleting the reply.");
        }
        return;
    }

    commentRow.remove();

    const cache = threadCache.get(collabId);
    if (cache) cache.comments = cache.comments.filter(c => c.id !== commentId);
}


async function openCreateForm() {
    if (isEditingCollab) {
        await showAppAlert("Finish or cancel the current post first.");
        return;
    }
    isEditingCollab = true;
    editingCollabCard.style.display = 'block';
    selectedClubIds.clear();

    const searchInput = document.getElementById('collab-club-search');
    const dropdown = document.getElementById('collab-club-dropdown');
    searchInput.value = '';
    dropdown.classList.remove('show');
    renderPickedPills();

    currentPickerClubs = await fetchClubsInSchool(currentSchoolId, clubId);

    searchInput.oninput = renderClubDropdown;
    searchInput.onfocus = renderClubDropdown;
    document.addEventListener('click', closeDropdownIfOutside);
    editingCollabCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closeDropdownIfOutside(e) {
    if (!e.target.closest('.collab-search-wrap')) {
        document.getElementById('collab-club-dropdown').classList.remove('show');
    }
}

function renderClubDropdown() {
    const dropdown = document.getElementById('collab-club-dropdown');
    const term = document.getElementById('collab-club-search').value.trim().toLowerCase();

    if (!term) {
        dropdown.classList.remove('show');
        return;
    }

    const available = currentPickerClubs.filter(c => !selectedClubIds.has(c.id));
    const startsWith = available.filter(c => c.name.toLowerCase().startsWith(term));
    const contains = available.filter(c => !c.name.toLowerCase().startsWith(term) && c.name.toLowerCase().includes(term));
    const ranked = [...startsWith, ...contains].slice(0, 8);

    if (ranked.length === 0) {
        dropdown.innerHTML = '';
        dropdown.classList.remove('show');
        return;
    }

    dropdown.innerHTML = ranked.map(c =>
        `<div class="collab-club-dropdown-item" data-id="${esc(c.id)}">${esc(c.name)}</div>`
    ).join('');

    dropdown.querySelectorAll('.collab-club-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedClubIds.add(item.dataset.id);
            document.getElementById('collab-club-search').value = '';
            renderPickedPills();
            dropdown.classList.remove('show');
        });
    });

    dropdown.classList.add('show');
}

function renderPickedPills() {
    const pillsContainer = document.getElementById('collab-picked-pills');
    pillsContainer.innerHTML = [...selectedClubIds].map(id => {
        const club = currentPickerClubs.find(c => c.id === id);
        return `<span class="collab-club-pill">${esc(club ? club.name : id)}<button data-id="${esc(id)}" aria-label="Remove club"><i class="fa-solid fa-xmark"></i></button></span>`;
    }).join('');

    pillsContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedClubIds.delete(btn.dataset.id);
            renderPickedPills();
        });
    });

    const searchInput = document.getElementById('collab-club-search');
    searchInput.placeholder = selectedClubIds.size === 0 ? 'Search clubs...' : 'Search more clubs...';
}

function closeCreateForm() {
    isEditingCollab = false;
    editingCollabCard.style.display = 'none';
    document.getElementById('collab-title-input').value = '';
    document.getElementById('collab-desc-input').value = '';
    selectedClubIds.clear();
    renderPickedPills();
    document.removeEventListener('click', closeDropdownIfOutside);
}

async function postNewCollaboration() {
    if (!canManageCollabs) return;
    const title = document.getElementById('collab-title-input').value.trim();
    const description = document.getElementById('collab-desc-input').value.trim();
    const postBtn = document.getElementById('collab-post-btn');

    if (!title) { await showAppAlert("Add a title so clubs know what this is."); return; }
    if (!description) { await showAppAlert("Add a description with the details."); return; }
    if (selectedClubIds.size === 0) { await showAppAlert("Pick at least one club to send this to."); return; }

    const toClubIds = [...selectedClubIds];
    postBtn.disabled = true;

    try {
        const newCollab = await createCollaboration(clubId, title, description, toClubIds, currentUser);
        closeCreateForm();

        if (listCache.sent) listCache.sent.items.unshift(newCollab);
        counts.sent += 1;
        updateTabCounts();

        if (activeTab === 'sent') {
            clearEmptyState();
            const nameMap = await resolveClubNames([clubId, ...toClubIds]);
            const card = createCollabCard({ ...newCollab, createdAt: { toMillis: () => Date.now(), toDate: () => new Date() } }, nameMap);
            collabContainer.prepend(card);
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    } catch (error) {
        console.error("Error creating collaboration:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("create collaborations"));
        } else {
            await showAppAlert("Something went wrong while creating the collaboration.");
        }
    } finally {
        postBtn.disabled = false;
    }
}

function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club ${ROLE_LABELS.manager.toLowerCase()} if you think this is a mistake.`;
}
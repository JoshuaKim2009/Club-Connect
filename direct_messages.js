import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, writeBatch, doc, collection, serverTimestamp, query, onSnapshot, orderBy, getDocs, limit, startAfter, startAt, endBefore, updateDoc, arrayUnion, arrayRemove, increment } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { ROLE_LABELS } from './roleLabels.js';

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
const auth = getAuth(app);

const QUICK_REACTIONS = ['👍', '❤️', '😂', '💀', '😭'];
const DELETED_MESSAGE_TEXT = "This message was deleted";

const db = getFirestore(app);

let currentUser = null;
let convId = null;
let otherUid = null;
let otherName = null;
let clubId = null;

let newestDoc = null;
let oldestDoc = null;
let hasMoreMessages = true;
let isLoadingOlder = false;
let previousSenderId = null;
let previousDateKey = null;
let loadedMessageIds = new Set();
let selectedMessageForOptions = null;
let unsubscribeMessages = null;
let editsUnsubs = [];
let updateLastSeenTimeout = null;

const PAGE_SIZE = 20;

const chatInput = document.getElementById('chatInput');
const inputContainer = document.getElementById('inputContainer');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById('back-button');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

function getMessagesRef() {
    return collection(db, "directMessages", convId, "messages");
}

function getConvRef() {
    return doc(db, "directMessages", convId);
}

const titleEl = document.getElementById('dmChatTitle');
if (titleEl) {
    titleEl.textContent = getUrlParameter('otherName') || 'DIRECT MESSAGE';
}

onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    convId = getUrlParameter('convId');
    otherUid = getUrlParameter('otherUid');
    otherName = getUrlParameter('otherName');
    clubId = getUrlParameter('clubId');

    if (!convId) {
        window.location.href = 'your_clubs.html';
        return;
    }

    const titleEl = document.getElementById('dmChatTitle');
    if (titleEl) titleEl.textContent = otherName || 'DIRECT MESSAGE';


    await loadInitialMessages();
    startRealtimeListener();
});

if (backButton) {
    backButton.addEventListener('click', () => {
        window.location.href = `dm_menu.html?clubId=${clubId}`;
    });
}

async function loadInitialMessages() {
    loadedMessageIds.clear();
    if (!convId || !currentUser) return;

    const messagesRef = getMessagesRef();
    const q = query(messagesRef, orderBy("createdAt", "desc"), limit(PAGE_SIZE + 1));

    try {
        showChatState('loading');

        const snapshot = await getDocs(q);
        const docs = snapshot.docs;

        hasMoreMessages = docs.length > PAGE_SIZE;
        const messageDocs = hasMoreMessages ? docs.slice(0, PAGE_SIZE) : docs;

        if (messageDocs.length > 0) {
            oldestDoc = messageDocs[messageDocs.length - 1];
            newestDoc = messageDocs[0];

            if (hasMoreMessages && docs.length > PAGE_SIZE) {
                const nextMessage = docs[PAGE_SIZE].data();
                previousSenderId = nextMessage.createdByUid;
            }
        }

        const reversedDocs = [...messageDocs].reverse();
        if (hasMoreMessages && docs.length > PAGE_SIZE) {
            previousDateKey = getMessageDateKey(docs[PAGE_SIZE].data().createdAt);
        }

        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;
            loadedMessageIds.add(messageId);

            const now = new Date();
            const currentDateKey = getMessageDateKey(messageData.createdAt) || `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
            if (currentDateKey && currentDateKey !== previousDateKey) {
                const dateSeparator = document.createElement('div');
                dateSeparator.className = 'date-separator';
                dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt ? messageData.createdAt.toDate() : new Date())}</span>`;
                chatMessages.appendChild(dateSeparator);
                previousDateKey = currentDateKey;
                previousSenderId = null;
            }

            const showSenderName = previousSenderId !== messageData.createdByUid;
            const messageElement = createMessageElement(messageId, messageData, showSenderName);
            chatMessages.appendChild(messageElement);

            previousSenderId = messageData.createdByUid;
            previousDateKey = currentDateKey;
        }

        if (chatMessages.querySelectorAll('.message-wrapper').length === 0) {
            showChatState('empty');
        } else {
            showChatState('none');
        }

        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });

    } catch (error) {
        console.error("Error loading messages:", error);
        showChatState('error');
    } finally {
        requestAnimationFrame(() => {
            const allMessages = chatMessages.querySelectorAll('.message-wrapper');
            allMessages.forEach(msg => msg.classList.add('show'));
            chatMessages.classList.add('loaded');
        });
        await updateLastSeenMessages();
    }
}

async function loadOlderMessages() {
    if (!hasMoreMessages || isLoadingOlder || !oldestDoc || !convId) return;

    isLoadingOlder = true;
    const previousScrollHeight = chatMessages.scrollHeight;

    const messagesRef = getMessagesRef();
    const q = query(messagesRef, orderBy("createdAt", "desc"), startAfter(oldestDoc), limit(PAGE_SIZE + 1));

    try {
        const snapshot = await getDocs(q);
        const docs = snapshot.docs;

        if (docs.length === 0) { hasMoreMessages = false; isLoadingOlder = false; return; }

        hasMoreMessages = docs.length > PAGE_SIZE;
        const messageDocs = hasMoreMessages ? docs.slice(0, PAGE_SIZE) : docs;

        const previousOldestDoc = oldestDoc;
        oldestDoc = messageDocs[messageDocs.length - 1];

        const reversedDocs = [...messageDocs].reverse();
        const tempFragment = document.createDocumentFragment();

        let tempPreviousSenderId = null;
        let tempPreviousDateKey = null;
        if (hasMoreMessages && docs.length > PAGE_SIZE) {
            const nextOlderMessage = docs[PAGE_SIZE].data();
            tempPreviousSenderId = nextOlderMessage.createdByUid;
            tempPreviousDateKey = getMessageDateKey(nextOlderMessage.createdAt);
        }

        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;

            if (loadedMessageIds.has(messageId)) continue;
            loadedMessageIds.add(messageId);

            const now = new Date();
            const currentDateKey = getMessageDateKey(messageData.createdAt) || `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
            if (currentDateKey && currentDateKey !== tempPreviousDateKey) {
                const dateSeparator = document.createElement('div');
                dateSeparator.className = 'date-separator show';
                dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt ? messageData.createdAt.toDate() : new Date())}</span>`;
                tempFragment.appendChild(dateSeparator);
                tempPreviousDateKey = currentDateKey;
                tempPreviousSenderId = null;
            }

            const showSenderName = tempPreviousSenderId !== messageData.createdByUid;
            const messageElement = createMessageElement(messageId, messageData, showSenderName);
            messageElement.classList.add('show');
            tempFragment.appendChild(messageElement);
            tempPreviousSenderId = messageData.createdByUid;
        }

        if (tempFragment.children.length > 0) {
            chatMessages.insertBefore(tempFragment, chatMessages.firstChild);
            const newScrollHeight = chatMessages.scrollHeight;
            chatMessages.scrollTop = chatMessages.scrollTop + (newScrollHeight - previousScrollHeight);
        }

        watchEdits(oldestDoc, previousOldestDoc);
    } catch (error) {
        console.error("Error loading older messages:", error);
    } finally {
        isLoadingOlder = false;
    }
}

// Each loaded chunk gets its own listener over exactly its own range. Re-subscribing
function watchEdits(startDoc = null, endBeforeDoc = null) {
    if (!convId) return;

    const parts = [orderBy("createdAt", "asc")];
    if (startDoc) parts.push(startAt(startDoc));
    if (endBeforeDoc) parts.push(endBefore(endBeforeDoc));

    const unsub = onSnapshot(query(getMessagesRef(), ...parts), (snapshot) => {
        for (const change of snapshot.docChanges()) {
            if (change.type === "modified") updateMessage(change.doc.id, change.doc.data());
            if (change.type === "removed") { removeMessage(change.doc.id); loadedMessageIds.delete(change.doc.id); }
        }
    }, (error) => console.error("Edits listener error:", error));

    editsUnsubs.push(unsub);
}

function startRealtimeListener() {
    if (!convId || !currentUser || unsubscribeMessages) return;

    const messagesRef = getMessagesRef();

    let newMessagesQuery = newestDoc
        ? query(messagesRef, orderBy("createdAt", "asc"), startAfter(newestDoc))
        : query(messagesRef, orderBy("createdAt", "asc"));

    unsubscribeMessages = onSnapshot(newMessagesQuery, async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            const messageData = change.doc.data();
            const messageId = change.doc.id;

            if (change.type === "added") {
                if (loadedMessageIds.has(messageId)) continue;
                loadedMessageIds.add(messageId);

                const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
                const now = new Date();
                const currentDateKey = getMessageDateKey(messageData.createdAt) || `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
                if (currentDateKey && currentDateKey !== previousDateKey) {
                    const dateSeparator = document.createElement('div');
                    dateSeparator.className = 'date-separator show';
                    dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt ? messageData.createdAt.toDate() : new Date())}</span>`;
                    chatMessages.appendChild(dateSeparator);
                    previousSenderId = null;
                    previousDateKey = currentDateKey;
                }

                const showSenderName = previousSenderId !== messageData.createdByUid;
                document.querySelector('.chat-state-overlay')?.remove();
                await displayMessage(messageId, messageData, showSenderName);
                previousSenderId = messageData.createdByUid;
                if (messageData.createdAt) newestDoc = change.doc;
                if (isNearBottom || messageData.createdByUid === currentUser.uid) scrollToBottom();
            }
        }
    }, (error) => { console.error("Error:", error); });

    watchEdits(oldestDoc);
}

function createMessageElement(messageId, messageData, showSenderName) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    messageWrapper.dataset.messageId = messageId;
    messageWrapper.dataset.senderId = messageData.createdByUid;
    if (messageData.createdAt) messageWrapper.dataset.dateKey = getMessageDateKey(messageData.createdAt);

    if (messageData.createdByUid === currentUser.uid) messageWrapper.classList.add('sent');

    if (showSenderName) {
        const senderName = document.createElement('div');
        senderName.className = 'sender-name';

        const nameText = document.createElement('span');
        nameText.textContent = resolveDisplayName(messageData.createdByUid);
        senderName.appendChild(nameText);

        const timestamp = document.createElement('span');
        timestamp.className = 'message-timestamp';
        const date = messageData.createdAt ? messageData.createdAt.toDate() : new Date();
        const hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        timestamp.textContent = `${displayHours}:${minutes} ${ampm}`;
        senderName.appendChild(timestamp);

        messageWrapper.appendChild(senderName);
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    if (messageData.deleted) {
        messageDiv.textContent = DELETED_MESSAGE_TEXT;
        messageDiv.classList.add('deleted-message');
    } else {
        messageDiv.innerHTML = linkifyText(messageData.message);
    }
    if (messageData.createdByUid === currentUser.uid) messageDiv.classList.add('sent');
    messageWrapper.appendChild(messageDiv);
    const messageContent = messageDiv;

    let pressTimer;
    let touchStartY = 0;

    messageWrapper.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            messageContent.classList.add('pressing');
            pressTimer = setTimeout(() => {
                messageContent.classList.remove('pressing');
                showMessageOptions(messageId, messageData, messageWrapper);
            }, 250);
        }
    });

    messageWrapper.addEventListener('mouseup', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageWrapper.addEventListener('mouseleave', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageWrapper.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        messageContent.classList.add('pressing');
        pressTimer = setTimeout(() => {
            messageContent.classList.remove('pressing');
            navigator.vibrate && navigator.vibrate(50);
            showMessageOptions(messageId, messageData, messageWrapper);
        }, 250);
    });

    messageWrapper.addEventListener('touchend', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageWrapper.addEventListener('touchmove', (e) => {
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dy > 10) {
            messageContent.classList.remove('pressing');
            clearTimeout(pressTimer);
        }
    });

    renderReactions(messageWrapper, messageData.reactions || []);

    return messageWrapper;
}

async function displayMessage(messageId, messageData, showSenderName) {
    if (!messageData) return;
    const messageElement = createMessageElement(messageId, messageData, showSenderName);
    chatMessages.appendChild(messageElement);
    requestAnimationFrame(() => { messageElement.classList.add('show'); });

    if (updateLastSeenTimeout) clearTimeout(updateLastSeenTimeout);
    updateLastSeenTimeout = setTimeout(() => { updateLastSeenMessages(); }, 500);
}

function updateMessage(messageId, messageData) {
    const messageWrapper = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageWrapper) return;
    const bubble = messageWrapper.querySelector('.message');
    if (bubble) {
        if (messageData.deleted) {
            bubble.textContent = DELETED_MESSAGE_TEXT;
            bubble.classList.add('deleted-message');
        } else {
            bubble.innerHTML = linkifyText(messageData.message);
        }
    }
    renderReactions(messageWrapper, messageData.reactions || []);
}

function removeMessage(messageId) {
    const messageWrapper = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
    if (messageWrapper) messageWrapper.remove();
}

async function saveMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    const batch = writeBatch(db);
    const messagesRef = getMessagesRef();
    const newMessageRef = doc(messagesRef);

    const messageData = {
        message: text,
        createdByUid: currentUser.uid,
        createdAt: serverTimestamp(),
        type: "text"
    };

    batch.set(newMessageRef, messageData);

    // update conversation doc with last message preview and unread count
    batch.update(getConvRef(), {
        lastMessageAt: serverTimestamp(),
        lastMessageText: text,
        lastMessageType: "text",
        lastMessageSenderUid: currentUser.uid,
        [`unreadCounts.${otherUid}`]: increment(1)
    });

    try {
        await batch.commit();
        chatInput.value = "";
    } catch (error) {
        console.error("Failed to send message:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("send messages in this conversation"));
        } else {
            await showAppAlert("Something went wrong while sending your message.");
        }
    }
}

async function updateLastSeenMessages() {
    if (!currentUser || !convId) return;
    try {
        await updateDoc(getConvRef(), {
            [`unreadCounts.${currentUser.uid}`]: 0
        });
    } catch (error) {
        console.error("Failed to update last seen:", error);
    }
}

if (sendButton) {
    sendButton.addEventListener('click', async () => {
        if (chatInput.value.trim()) await saveMessage();
    });
}

if (chatInput) {
    chatInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            if (chatInput.value.trim()) await saveMessage();
        }
    });
}

if (chatMessages) {
    chatMessages.addEventListener('scroll', () => {
        if (chatMessages.scrollTop < 300 && hasMoreMessages && !isLoadingOlder) loadOlderMessages();
    });
}

function showMessageOptions(messageId, messageData, messageElement) {
    if (messageData.deleted || messageElement.querySelector('.deleted-message')) return;
    selectedMessageForOptions = { id: messageId, data: messageData, element: messageElement };

    document.getElementById('modalSenderName').textContent = resolveDisplayName(messageData.createdByUid);
    const deleteBtn = document.getElementById('deleteOptionButton');
    const isOwner = messageData.createdByUid === currentUser.uid;
    deleteBtn.style.display = isOwner ? 'flex' : 'none';

    document.getElementById('messageOptionsModal').classList.toggle('no-actions', !isOwner);

    const modalMessageContainer = document.getElementById('modalMessageContainer');
    modalMessageContainer.innerHTML = '';
    const messageContent = messageElement.querySelector('.message');
    if (messageContent) {
        const messageClone = messageContent.cloneNode(true);
        messageClone.querySelector('.message-reactions')?.remove();
        modalMessageContainer.appendChild(messageClone);
    }

    chatMessages.classList.add('blur-background');
    document.getElementById('messageOptionsOverlay').classList.add('show');

    document.querySelector('.modal-reactions-float')?.remove();

    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'modal-reactions-float';

    QUICK_REACTIONS.forEach(emoji => {
        const myEntry = !!messageElement.querySelector(`.reaction-chip[data-emoji="${emoji}"].mine`);
        const btn = document.createElement('div');
        btn.className = 'reaction-pick-btn-sm' + (myEntry ? ' mine' : '');
        btn.textContent = emoji;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.classList.toggle('mine');
            const shouldAdd = btn.classList.contains('mine');
            await toggleReaction(messageId, emoji, shouldAdd);
            hideMessageOptions();
        });
        reactionsBar.appendChild(btn);
    });

    const moreBtn = document.createElement('div');
    moreBtn.className = 'reaction-pick-btn-sm reaction-pick-btn-more';
    moreBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showEmojiPickerOverlay(messageId);
    });
    reactionsBar.appendChild(moreBtn);

    document.getElementById('messageOptionsModal').appendChild(reactionsBar);
}

function hideMessageOptions() {
    const modal = document.getElementById('messageOptionsModal');
    modal.style.opacity = '';
    modal.style.pointerEvents = '';
    chatMessages.classList.remove('blur-background');
    document.getElementById('messageOptionsOverlay').classList.remove('show');
    selectedMessageForOptions = null;
}

document.getElementById('messageOptionsOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'messageOptionsOverlay') hideMessageOptions();
});

document.getElementById('deleteOptionButton')?.addEventListener('click', async () => {
    if (!selectedMessageForOptions) return;

    const messageToDelete = selectedMessageForOptions;

    document.getElementById('messageOptionsOverlay').classList.remove('show');

    const confirmed = await showAppConfirm("Delete this message? This can't be undone.", "Delete message?");

    if (!confirmed) {
        document.getElementById('messageOptionsOverlay').classList.add('show');
        return;
    }

    const messagesRef = getMessagesRef();
    const msgRef = doc(messagesRef, messageToDelete.id);
    const batch = writeBatch(db);
    batch.update(msgRef, { deleted: true, reactions: [] });

    if (newestDoc?.id === messageToDelete.id) {
        batch.update(getConvRef(), { lastMessageText: DELETED_MESSAGE_TEXT });
    }

    try {
        await batch.commit();
        hideMessageOptions();
    } catch (error) {
        console.error("Error deleting message:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("delete this message"));
        } else {
            await showAppAlert("Something went wrong while deleting this message.");
        }
    }
});

function scrollToBottom() {
    requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
}

function adjustChatMessagesHeight() {
    const chatMessages = document.getElementById('chatMessages');
    const inputContainer = document.getElementById('inputContainer');
    if (!chatMessages || !inputContainer) return;
    chatMessages.style.height = `${window.innerHeight - inputContainer.offsetHeight}px`;
}

window.addEventListener('load', adjustChatMessagesHeight);
let resizeTimeout = null;
window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(adjustChatMessagesHeight, 100);
});

if (inputContainer) {
    inputContainer.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
    inputContainer.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    inputContainer.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function linkifyText(text) {
    const escaped = escapeHtml(text);
    const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
    return escaped.replace(urlPattern, (url) => {
        let href = url.startsWith('http') ? url : 'https://' + url;
        return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
    });
}

function formatDateSeparator(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    const messageDate = new Date(date);
    messageDate.setHours(0, 0, 0, 0);
    if (messageDate.getTime() === today.getTime()) return 'Today';
    else if (messageDate.getTime() === yesterday.getTime()) return 'Yesterday';
    else return messageDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function getMessageDateKey(timestamp) {
    if (!timestamp) return null;
    const date = timestamp.toDate();
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isPermissionError(error) {
    return error && error.code === 'permission-denied';
}

function permissionDeniedMessage(actionPhrase) {
    return `You don't have permission to ${actionPhrase}. Try reloading the page, and reach out to a club ${ROLE_LABELS.manager.toLowerCase()} if you think this is a mistake.`;
}

async function toggleReaction(messageId, emoji, shouldAdd = null) {
    if (!currentUser || !convId) return;
    const msgRef = doc(getMessagesRef(), messageId);
    const entry = { emoji, uid: currentUser.uid };
    const remove = shouldAdd !== null ? !shouldAdd
        : !!chatMessages.querySelector(`[data-message-id="${messageId}"] .reaction-chip[data-emoji="${emoji}"].mine`);

    try {
        if (remove) await updateDoc(msgRef, { reactions: arrayRemove(entry) });
        else await updateDoc(msgRef, { reactions: arrayUnion(entry) });
    } catch (error) {
        console.error("Error updating reaction:", error);
        if (isPermissionError(error)) {
            await showAppAlert(permissionDeniedMessage("react to this message"));
        } else {
            await showAppAlert("Something went wrong while saving your reaction.");
        }
    }
}

function renderReactions(messageWrapper, reactions) {
    messageWrapper.querySelector('.message-reactions')?.remove();
    if (!reactions || reactions.length === 0) return;

    const order = [];
    const groups = {};
    for (const r of reactions) {
        if (!groups[r.emoji]) { groups[r.emoji] = []; order.push(r.emoji); }
        groups[r.emoji].push(r.uid);
    }

    const row = document.createElement('div');
    row.className = 'message-reactions';

    for (const emoji of order) {
        const uids = groups[emoji];
        const mine = uids.includes(currentUser.uid);
        const chip = document.createElement('div');
        chip.className = 'reaction-chip' + (mine ? ' mine' : '');
        chip.dataset.emoji = emoji;
        chip.innerHTML = `<span>${emoji}</span><span class="reaction-chip-count">${uids.length}</span>`;
        const msgId = messageWrapper.dataset.messageId;
        chip.addEventListener('mousedown', (e) => e.stopPropagation());
        chip.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        chip.addEventListener('click', (e) => { e.stopPropagation(); toggleReaction(msgId, emoji); });
        row.appendChild(chip);
    }

    messageWrapper.appendChild(row);
    const distFromBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    if (distFromBottom < 150) {
        scrollToBottom();
    }
}

function showEmojiPickerOverlay(messageId) {
    const modal = document.getElementById('messageOptionsModal');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';

    const overlay = document.createElement('div');
    overlay.className = 'emoji-picker-overlay';
    overlay.id = 'emojiPickerOverlay';

    const picker = document.createElement('emoji-picker');
    overlay.appendChild(picker);

    if (picker.shadowRoot) {
        const style = document.createElement('style');
        style.textContent = `
            ::-webkit-scrollbar { display: none; }
            * { scrollbar-width: none; -ms-overflow-style: none; }

            .search-row, .search-wrapper, .pad-top {
                background: transparent !important;
                border-bottom: none !important;
            }

            .search-row {
                padding: 4px 10px 8px 10px !important;
                box-sizing: border-box !important;
            }

            input[type="search"] {
                background: linear-gradient(#ffffff, #f5f5f5) !important;
                font-family: "Teko", sans-serif !important;
                font-size: 20px !important;
                color: black !important;
                border: 2px solid black !important;
                border-radius: 10px !important;
                padding: 2px 10px !important;
                outline: none !important;
                width: 100% !important;
                box-sizing: border-box !important;
                margin: 0 !important;
            }

            input[type="search"]:focus {
                outline: none !important;
            }

            input[type="search"]::-webkit-search-cancel-button {
                -webkit-appearance: none;
                appearance: none;
                height: 12px;
                width: 12px;
                background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23000000'><path d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'/></svg>");
                background-size: contain;
                background-repeat: no-repeat;
                cursor: pointer;
                opacity: 0.6;
            }

            .skintone-button, .skintone-button-wrapper {
                display: none !important;
            }
        `;
        picker.shadowRoot.appendChild(style);
    }
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('show');
        requestAnimationFrame(() => {
            const searchInput = picker.shadowRoot?.querySelector('input[type="search"]');
            searchInput?.focus();
        });
    });

    picker.addEventListener('emoji-click', async (e) => {
        const emoji = e.detail.unicode;
        await toggleReaction(messageId, emoji);
        closeEmojiPickerOverlay(false);
        hideMessageOptions();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeEmojiPickerOverlay(true);
    });
}

function closeEmojiPickerOverlay(restoreModal) {
    const overlay = document.getElementById('emojiPickerOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    if (restoreModal) {
        const modal = document.getElementById('messageOptionsModal');
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'all';
    }
}



function showChatState(type) {
    const existing = document.querySelector('.chat-state-overlay');

    if (type === 'loading' && existing?.querySelector('.chat-loading-bubble')) {
        return;
    }

    if (type === 'empty' && existing?.querySelector('.chat-loading-bubble')) {
        const bubble = existing.querySelector('.chat-loading-bubble');
        bubble.classList.add('settled');

        const text = document.createElement('p');
        text.className = 'fancy-label empty-text';
        text.style.marginTop = '-4px';
        text.textContent = 'NO MESSAGES YET';
        existing.appendChild(text);

        setTimeout(() => text.classList.add('show'), 320);
        return;
    }

    existing?.remove();
    if (type === 'none') return;

    const div = document.createElement('div');
    div.className = 'chat-state-overlay' + (type !== 'loading' ? ' chat-state-text' : '');

    if (type === 'loading') {
        div.innerHTML = `
            <div class="chat-loading-bubble">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        `;
    } else if (type === 'empty') {
        div.innerHTML = `<p class="fancy-label">NO MESSAGES YET</p>`;
    } else if (type === 'error') {
        div.innerHTML = `
            <p class="fancy-label">Oops! Something went wrong.</p>
            <button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size:24px;">TRY AGAIN</button>
        `;
    }

    document.querySelector('.chat-container').appendChild(div);
}

function resolveDisplayName(uid) {
    if (currentUser && uid === currentUser.uid) return currentUser.displayName || "Unknown";
    if (uid === otherUid) return otherName || "Unknown";
    return "Unknown";
}
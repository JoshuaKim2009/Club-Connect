//chat.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, writeBatch, doc, getDoc, collection, setDoc, serverTimestamp, query, onSnapshot, orderBy, getDocs, limit, startAfter, updateDoc, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
// import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-storage.js";
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
//const storage = getStorage(app);



enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Persistence failed: Multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('Persistence not available in this browser');
    }
  });


let messageCount = 0;

let isLoggedIn = false;
let userEmail = "";
let userName = "";
let role = null;
let clubId = null;
let currentUser = null;
let newestDoc = null;
const MAX_IMAGES_PER_SEND = 5;
let pendingImages = [];
let isDropdownOpen = false;
let updateLastSeenTimeout = null;


let unsubscribeMessages = null;

const PAGE_SIZE = 20;
let oldestDoc = null;
let hasMoreMessages = true;
let isLoadingOlder = false;
let previousSenderId = null;
let loadedMessageIds = new Set();
const QUICK_REACTION_EMOJIS = ['👍', '👎', '❤️', '😭', '💀', '🔥'];
let activeReactionPicker = null;

const chatInput = document.getElementById('chatInput');
const inputContainer = document.getElementById('inputContainer');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById("back-button");

const addButton = document.getElementById('addButton');
const uploadDropdown = document.getElementById('uploadDropdown');
const imageUploadOption = document.getElementById('imageUploadOption');
const imageFileInput = document.getElementById('imageFileInput');
const pendingImagesContainer = document.getElementById('pendingImagesContainer');

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

clubId = getUrlParameter('clubId');

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    
    const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberDoc.exists()) return memberDoc.data().role || 'member';
    
    const clubDoc = await getDoc(doc(db, "clubs", clubId));
    return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
}

document.addEventListener('DOMContentLoaded', () => {
    if (chatMessages) {
        chatMessages.classList.add('loading');
    }
});

onAuthStateChanged(auth, async (user) => {
    
    if (user) {
        currentUser = user;
        isLoggedIn = true;
        userName = user.displayName || "";
        userEmail = user.email || "";

        console.log(userEmail);

        if (clubId) {
            if (chatMessages) {
                chatMessages.classList.remove('loading');
            }
                        
            const rolePromise = getMemberRoleForClub(clubId, currentUser.uid);
            const messagesPromise = loadInitialMessages();
            
            [role] = await Promise.all([rolePromise, messagesPromise]);
            
            
            // await updateLastSeenMessages();
            
            startRealtimeListener();
            startReactionListener();
        } else {
            window.location.href = 'your_clubs.html';
        }
    } else {
        window.location.href = 'login.html';
    }
    
});

//If you are a manager it takes you to manager page but if you are member it takes you back to member
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

if (backButton) {
    backButton.addEventListener("click", () => {
        window.goToClubPage();
    });
}

async function loadInitialMessages() {
    loadedMessageIds.clear();
    if (!clubId || !currentUser) return;

    const messagesRef = collection(db, "clubs", clubId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "desc"), limit(PAGE_SIZE + 1));
    
    try {
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
        
        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;
            loadedMessageIds.add(messageId);
            
            const showSenderName = previousSenderId !== messageData.createdByUid;
            await displayMessage(messageId, messageData, showSenderName);
            previousSenderId = messageData.createdByUid;
        }
        
        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (error) {
        console.error("Error:", error);
    } finally {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    
        chatMessages.classList.add('loaded');
        // requestAnimationFrame(() => {
        //     chatMessages.classList.add('loaded');
        // });
    }
}

async function loadOlderMessages() {
    if (!hasMoreMessages || isLoadingOlder || !oldestDoc || !clubId) return;
    
    isLoadingOlder = true;
    const previousScrollHeight = chatMessages.scrollHeight;
    
    const messagesRef = collection(db, "clubs", clubId, "messages");
    const q = query(
        messagesRef, 
        orderBy("createdAt", "desc"), 
        startAfter(oldestDoc), 
        limit(PAGE_SIZE + 1)
    );
    
    try {
        const snapshot = await getDocs(q);
        const docs = snapshot.docs;
        
        if (docs.length === 0) {
            hasMoreMessages = false;
            isLoadingOlder = false;
            return;
        }
        
        hasMoreMessages = docs.length > PAGE_SIZE;
        const messageDocs = hasMoreMessages ? docs.slice(0, PAGE_SIZE) : docs;
        
        oldestDoc = messageDocs[messageDocs.length - 1];
        
        const reversedDocs = [...messageDocs].reverse();
        const tempFragment = document.createDocumentFragment();
        
        let tempPreviousSenderId = null;
        if (hasMoreMessages && docs.length > PAGE_SIZE) {
            const nextOlderMessage = docs[PAGE_SIZE].data();
            tempPreviousSenderId = nextOlderMessage.createdByUid;
        }
        
        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;
            
            if (loadedMessageIds.has(messageId)) continue;
            
            loadedMessageIds.add(messageId);
            
            const showSenderName = tempPreviousSenderId !== messageData.createdByUid;
            const messageElement = createMessageElement(messageId, messageData, showSenderName);
            messageElement.classList.add('show');
            tempFragment.appendChild(messageElement);
            tempPreviousSenderId = messageData.createdByUid;

            messageCount+=1;
            console.log(messageCount);
            
            
        }
        
        if (tempFragment.children.length > 0) {
            const existingFirstWrapper = chatMessages.querySelector('.message-wrapper');
            if (existingFirstWrapper) {
                const lastLoadedSenderId = tempPreviousSenderId;
                const existingFirstSenderId = existingFirstWrapper.dataset.senderId;
                
                if (lastLoadedSenderId === existingFirstSenderId) {
                    const existingSenderName = existingFirstWrapper.querySelector('.sender-name');
                    if (existingSenderName) existingSenderName.remove();
                } else if (!existingFirstWrapper.querySelector('.sender-name')) {
                    const senderName = document.createElement('div');
                    senderName.className = 'sender-name';
                    const lastMsgData = reversedDocs[reversedDocs.length - 1].data();
                    senderName.textContent = lastMsgData.createdByName || "Anonymous";
                    existingFirstWrapper.insertBefore(senderName, existingFirstWrapper.firstChild);
                }
            }
            chatMessages.insertBefore(tempFragment, chatMessages.firstChild);
            
            const newScrollHeight = chatMessages.scrollHeight;
            chatMessages.scrollTop = chatMessages.scrollTop + (newScrollHeight - previousScrollHeight);
        }
    } catch (error) {
        console.error("Error:", error);
    } finally {
        isLoadingOlder = false;
    }
}

function startRealtimeListener() {
    if (!clubId || !currentUser || unsubscribeMessages) return;
    
    const messagesRef = collection(db, "clubs", clubId, "messages");
    
    let q = newestDoc 
        ? query(messagesRef, orderBy("createdAt", "asc"), startAfter(newestDoc))
        : query(messagesRef, orderBy("createdAt", "asc"));
    
    unsubscribeMessages = onSnapshot(q, async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            const messageData = change.doc.data();
            const messageId = change.doc.id;
            
            if (change.type === "added") {
                if (loadedMessageIds.has(messageId)) continue;
                
                loadedMessageIds.add(messageId);
                
                const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
                
                const showSenderName = previousSenderId !== messageData.createdByUid;
                await displayMessage(messageId, messageData, showSenderName);
                previousSenderId = messageData.createdByUid;
                
                if (messageData.createdAt) {
                    newestDoc = change.doc;
                }
                
                if (isNearBottom || messageData.createdByUid === currentUser.uid) {
                    setTimeout(() => {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }, 50);
                }
            }
            if (change.type === "modified") {
                updateMessage(messageId, messageData);
            }
            if (change.type === "removed") {
                removeMessage(messageId);
                loadedMessageIds.delete(messageId);
            }
        }
    }, (error) => {
        console.error("Error:", error);
    });
}

function startReactionListener() {
    if (!clubId || !currentUser) return;
    
    const messagesRef = collection(db, "clubs", clubId, "messages");
    
    const q = query(messagesRef, orderBy("createdAt", "desc"));
    
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const messageId = change.doc.id;
            const messageData = change.doc.data();
            
            if (change.type === "modified" && loadedMessageIds.has(messageId)) {
                updateMessage(messageId, messageData);
            }
        });
    }, { includeMetadataChanges: false });
}

function createMessageElement(messageId, messageData, showSenderName) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    messageWrapper.dataset.messageId = messageId;
    messageWrapper.dataset.senderId = messageData.createdByUid;
    
    if (messageData.createdByUid === currentUser.uid) {
        messageWrapper.classList.add('sent');
    }

    if (showSenderName) {
        const senderName = document.createElement('div');
        senderName.className = 'sender-name';
        senderName.textContent = messageData.createdByName || "Anonymous";
        messageWrapper.appendChild(senderName);
    }

    if (messageData.type === "image" && messageData.imageUrl) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message message-image';
        if (messageData.createdByUid === currentUser.uid) {
            imageContainer.classList.add('sent');
        }
        
        const img = document.createElement('img');
        img.src = messageData.imageUrl;
        img.alt = "Image";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "8px";
        img.style.display = "block";
        
        imageContainer.appendChild(img);
        messageWrapper.appendChild(imageContainer);
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.textContent = messageData.message;
        if (messageData.createdByUid === currentUser.uid) {
            messageDiv.classList.add('sent');
        }
        
        let pressTimer;
        
        messageDiv.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                showReactionPicker(messageId, messageData, messageDiv);
            }, 500);
        });
        
        messageDiv.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
        });
        
        messageDiv.addEventListener('touchmove', () => {
            clearTimeout(pressTimer);
        });
        
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showReactionPicker(messageId, messageData, messageDiv);
        });
        
        messageWrapper.appendChild(messageDiv);
    }
    
    if (messageData.reactions && Object.keys(messageData.reactions).length > 0) {
        const reactionsDiv = createReactionsDisplay(messageId, messageData.reactions);
        messageWrapper.appendChild(reactionsDiv);
    }
    
    return messageWrapper;
}


async function displayMessage(messageId, messageData, showSenderName) {
    if (!messageData) return;
    
    const messageElement = createMessageElement(messageId, messageData, showSenderName);
    chatMessages.appendChild(messageElement);

    requestAnimationFrame(() => {
        messageElement.classList.add('show');
    });

    messageCount+=1;
    
    console.log(messageCount);
    
    if (updateLastSeenTimeout) {
        clearTimeout(updateLastSeenTimeout);
    }
    updateLastSeenTimeout = setTimeout(() => {
        updateLastSeenMessages();
    }, 500);
}

function updateMessage(messageId, messageData) {
    const messageWrapper = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageWrapper) return;
    
    const oldReactions = messageWrapper.querySelector('.reactions-container');
    if (oldReactions) oldReactions.remove();
    
    if (messageData.reactions && Object.keys(messageData.reactions).length > 0) {
        const reactionsDiv = createReactionsDisplay(messageId, messageData.reactions);
        messageWrapper.appendChild(reactionsDiv);
    }
    
    console.log("Updated message:", messageId, messageData);
}

function removeMessage(messageId) {
    const messageWrapper = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
    if (messageWrapper) {
        messageWrapper.remove();
    }
    console.log("Removed message:", messageId);
}

async function saveMessage() {
    const text = chatInput.value.trim();
    if (!text) {
        return;
    }
    const batch = writeBatch(db);
    const messagesRef = collection(db, "clubs", clubId, "messages");
    const newMessageRef = doc(messagesRef); 
    const messageData = {
        message: text,
        createdByUid: currentUser.uid,
        createdByName: currentUser.displayName || "Anonymous",
        clubId: clubId,
        createdAt: serverTimestamp(),
        type: "text"
    };

    batch.set(newMessageRef, messageData);

    try {
        await batch.commit();
        
        //await updateLastSeenMessages();
        chatInput.value = "";
    } catch (error) {
        console.error("Failed to send message:", error);
    }
}


if (sendButton) {
    sendButton.addEventListener('click', async () => {
        if (pendingImages.length > 0) {
            await saveImages();
        }
        if (chatInput.value.trim()) {
            await saveMessage();
        }
    });
}

if (chatInput) {
    chatInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            if (pendingImages.length > 0) {
                await saveImages();
            }
            if (chatInput.value.trim()) {
                await saveMessage();
            }
        }
    });
}

if (chatMessages) {
    chatMessages.addEventListener('scroll', () => {
        if (chatMessages.scrollTop < 300 && hasMoreMessages && !isLoadingOlder) {
            loadOlderMessages();
        }
    });
}

async function saveImages() {
    clearPendingImages();
    await showAppAlert("Image sending not implemented");
}

if (chatInput && inputContainer && chatMessages) {
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const viewportHeight = window.visualViewport.height;
            const windowHeight = window.innerHeight;
            const keyboardHeight = windowHeight - viewportHeight;
            
            if (keyboardHeight > 0) {
                inputContainer.style.bottom = `${keyboardHeight}px`;
                chatMessages.style.paddingBottom = `${keyboardHeight + 85}px`;
                
                setTimeout(() => {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 100);
            } else {
                inputContainer.style.bottom = `env(safe-area-inset-bottom)`;
                chatMessages.style.paddingBottom = `calc(85px + env(safe-area-inset-bottom) + 20px)`;
            }
        });
    }

    let lastHeight = window.innerHeight;
    window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;
        const diff = lastHeight - currentHeight;
        
        if (diff > 150) { 
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        lastHeight = currentHeight;
    });
}

async function updateLastSeenMessages() {
    console.log("called update Last seen");
    if (!currentUser || !clubId) return;

    const memberDocRef = doc(db, "clubs", clubId, "members", currentUser.uid);

    try {
        await updateDoc(memberDocRef, {
            lastSeenMessages: serverTimestamp()
        });
        console.log("Updated timestamp");
    } catch (error) {
        console.error("Failed:", error);
    }
}

if (addButton) {
    addButton.addEventListener('click', (e) => {
        e.stopPropagation();
        isDropdownOpen = !isDropdownOpen;
        uploadDropdown.classList.toggle('show', isDropdownOpen);
    });
}

document.addEventListener('click', (e) => {
    if (isDropdownOpen && 
        !uploadDropdown.contains(e.target) && 
        !addButton.contains(e.target)) {
        isDropdownOpen = false;
        uploadDropdown.classList.remove('show');
    }
});

if (imageUploadOption) {
    imageUploadOption.addEventListener('click', () => {
        imageFileInput.click();
        isDropdownOpen = false;
        uploadDropdown.classList.remove('show');
    });
}

if (pollOption) {
    pollOption.addEventListener('click', () => {
        isDropdownOpen = false;
        uploadDropdown.classList.remove('show');
        createPollEditCard();
    });
}

if (imageFileInput) {
    imageFileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        
        if (pendingImages.length + files.length > MAX_IMAGES_PER_SEND) {
            showAppAlert(`You can only send up to ${MAX_IMAGES_PER_SEND} images at once`);
            return;
        }
        
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                const previewUrl = URL.createObjectURL(file);
                pendingImages.push({ file, previewUrl });
                addPendingImagePreview(previewUrl, pendingImages.length - 1);
            }
        });
        
        imageFileInput.value = '';
    });
}

function createPollEditCard(){
    showAppAlert("adding soon");
}


function addPendingImagePreview(previewUrl, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pending-image-wrapper';
    wrapper.dataset.index = index;
    
    const img = document.createElement('img');
    img.src = previewUrl;
    
    const removeBtn = document.createElement('div');
    removeBtn.className = 'pending-image-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removePendingImage(index));
    
    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    pendingImagesContainer.appendChild(wrapper);
}

function removePendingImage(index) {
    const imageData = pendingImages[index];
    if (imageData) {
        URL.revokeObjectURL(imageData.previewUrl);
    }
    
    pendingImages.splice(index, 1);
    
    pendingImagesContainer.innerHTML = '';
    pendingImages.forEach((img, i) => {
        addPendingImagePreview(img.previewUrl, i);
    });
}

function clearPendingImages() {
    pendingImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
    pendingImages = [];
    pendingImagesContainer.innerHTML = '';
}






function showReactionPicker(messageId, messageData, targetElement) {
    if (activeReactionPicker) {
        activeReactionPicker.remove();
        activeReactionPicker = null;
    }
    
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    
    QUICK_REACTION_EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', async () => {
            await addReaction(messageId, emoji);
            picker.remove();
            activeReactionPicker = null;
        });
        picker.appendChild(btn);
    });
    
    const moreBtn = document.createElement('button');
    moreBtn.className = 'reaction-btn more-btn';
    moreBtn.textContent = '+';
    moreBtn.addEventListener('click', () => {
        showFullEmojiPicker(messageId, targetElement);
        picker.remove();
        activeReactionPicker = null;
    });
    picker.appendChild(moreBtn);
    
    const rect = targetElement.getBoundingClientRect();
    const pickerWidth = 280;
    
    picker.style.position = 'fixed';
    
    let top = rect.top - 50;
    
    const isSentMessage = targetElement.classList.contains('sent');
    let left;
    
    if (isSentMessage) {
        left = rect.right - pickerWidth - 22;
    } else {
        left = rect.left;
    }
    
    if (top < 10) {
        top = rect.bottom + 10;
    }
    
    if (left + pickerWidth > window.innerWidth - 10) {
        left = window.innerWidth - pickerWidth - 10;
    }
    
    if (left < 10) {
        left = 10;
    }
    
    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;
    
    document.body.appendChild(picker);
    activeReactionPicker = picker;
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerHandler(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                activeReactionPicker = null;
                document.removeEventListener('click', closePickerHandler);
            }
        });
    }, 100);
}

function showFullEmojiPicker(messageId, targetElement) {
    if (activeReactionPicker) {
        activeReactionPicker.remove();
        activeReactionPicker = null;
    }
    
    const pickerContainer = document.createElement('div');
    pickerContainer.className = 'emoji-picker-container';
    
    const emojiPicker = document.createElement('emoji-picker');
    
    emojiPicker.addEventListener('emoji-click', async (event) => {
        const selectedEmoji = event.detail.unicode;
        await addReaction(messageId, selectedEmoji);
        pickerContainer.remove();
        activeReactionPicker = null;
    });
    
    pickerContainer.appendChild(emojiPicker);
    
    const rect = targetElement.getBoundingClientRect();
    pickerContainer.style.position = 'fixed';
    
    const pickerHeight = 400;
    const pickerWidth = 350;
    
    let top = rect.top - pickerHeight - 10;
    
    if (top < 10) {
        top = rect.bottom + 10;
        
        if (top + pickerHeight > window.innerHeight - 10) {
            top = Math.max(10, (window.innerHeight - pickerHeight) / 2);
        }
    }
    
    const isSentMessage = targetElement.classList.contains('sent');
    let left;
    
    if (isSentMessage) {
        left = rect.right - pickerWidth;
    } else {
        left = rect.left;
    }
    
    if (left + pickerWidth > window.innerWidth - 10) {
        left = window.innerWidth - pickerWidth - 10;
    }
    
    if (left < 10) {
        left = 10;
    }
    
    pickerContainer.style.top = `${top}px`;
    pickerContainer.style.left = `${left}px`;
    
    document.body.appendChild(pickerContainer);
    activeReactionPicker = pickerContainer;
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerHandler(e) {
            if (!pickerContainer.contains(e.target) && !targetElement.contains(e.target)) {
                pickerContainer.remove();
                activeReactionPicker = null;
                document.removeEventListener('click', closePickerHandler);
            }
        }, {once: true});
    }, 100);
}

async function addReaction(messageId, emoji) {
    if (!currentUser || !clubId) return;
    
    try {
        const messageRef = doc(db, "clubs", clubId, "messages", messageId);
        const messageSnap = await getDoc(messageRef);
        
        if (!messageSnap.exists()) return;
        
        const messageData = messageSnap.data();
        const reactions = messageData.reactions || {};
        
        if (reactions[emoji] && reactions[emoji].users && reactions[emoji].users.includes(currentUser.uid)) {
            reactions[emoji].users = reactions[emoji].users.filter(uid => uid !== currentUser.uid);
            
            if (reactions[emoji].users.length === 0) {
                delete reactions[emoji];
            }
        } else {
            if (!reactions[emoji]) {
                const maxOrder = Object.values(reactions).reduce((max, reaction) => {
                    return Math.max(max, reaction.order || 0);
                }, 0);
                
                reactions[emoji] = {
                    users: [currentUser.uid],
                    order: maxOrder + 1
                };
            } else {
                reactions[emoji].users.push(currentUser.uid);
            }
        }
        
        await updateDoc(messageRef, { reactions });
    } catch (error) {
        console.error("Error adding reaction:", error);
    }
}

function createReactionsDisplay(messageId, reactions) {
    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'reactions-container';
    
    const sortedReactions = Object.entries(reactions).sort((a, b) => {
        const orderA = a[1].order || 0;
        const orderB = b[1].order || 0;
        return orderA - orderB;
    });
    
    sortedReactions.forEach(([emoji, reactionData]) => {
        const uids = reactionData.users || [];
        
        if (uids.length === 0) return;
        
        const reactionBubble = document.createElement('button');
        reactionBubble.className = 'reaction-bubble';
        
        if (uids.includes(currentUser.uid)) {
            reactionBubble.classList.add('user-reacted');
        }
        
        reactionBubble.innerHTML = `${emoji} ${uids.length}`;
        
        reactionBubble.addEventListener('click', async () => {
            await addReaction(messageId, emoji);
        });
        
        reactionsContainer.appendChild(reactionBubble);
    });
    
    return reactionsContainer;
}
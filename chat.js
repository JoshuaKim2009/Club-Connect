//chat.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, writeBatch, doc, getDoc, collection, setDoc, where, serverTimestamp, query, onSnapshot, orderBy, getDocs, limit, startAfter, updateDoc, getCountFromServer, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const QUICK_REACTIONS = ['👍', '❤️', '😂', '💀', '😭'];


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
let selectedMessageForOptions = null;
let replyingToMessage = null;

const chatInput = document.getElementById('chatInput');
const inputContainer = document.getElementById('inputContainer');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById("back-button");

const addButton = document.getElementById('addButton');
const uploadDropdown = document.getElementById('uploadDropdown');
const imageUploadOption = document.getElementById('imageUploadOption');
// const pollOption = document.getElementById('pollOption');
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
        } else {
            window.location.href = 'your_clubs.html';
        }
    } else {
        window.location.href = 'login.html';
    }
    
});


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
        let previousDateKey = null;
        if (hasMoreMessages && docs.length > PAGE_SIZE) {
            previousDateKey = getMessageDateKey(docs[PAGE_SIZE].data().createdAt);
        }

        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;
            loadedMessageIds.add(messageId);
            
            const currentDateKey = getMessageDateKey(messageData.createdAt);
            if (currentDateKey && currentDateKey !== previousDateKey) {
                const dateSeparator = document.createElement('div');
                dateSeparator.className = 'date-separator';
                dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt.toDate())}</span>`;
                chatMessages.appendChild(dateSeparator);
                previousDateKey = currentDateKey;
                previousSenderId = null; // Reset so sender name shows after date separator
            }
            
            const showSenderName = previousSenderId !== messageData.createdByUid;
            
            const messageElement = createMessageElement(messageId, messageData, showSenderName);
            chatMessages.appendChild(messageElement);
            
            previousSenderId = messageData.createdByUid;
            messageCount++;
            console.log(messageCount);
        }

        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });

    } catch (error) {
        console.error(error);
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
            
            // Check if there needs a date separator
            const currentDateKey = getMessageDateKey(messageData.createdAt);
            if (currentDateKey && currentDateKey !== tempPreviousDateKey) {
                const dateSeparator = document.createElement('div');
                dateSeparator.className = 'date-separator show';
                dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt.toDate())}</span>`;
                tempFragment.appendChild(dateSeparator);
                tempPreviousDateKey = currentDateKey;
                tempPreviousSenderId = null;
            }
            
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
                const lastLoadedDateKey = tempPreviousDateKey;
                const existingFirstDateKey = existingFirstWrapper.dataset.dateKey;
                
                if (lastLoadedDateKey === existingFirstDateKey) {
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
            }
            chatMessages.insertBefore(tempFragment, chatMessages.firstChild);
            
            const newScrollHeight = chatMessages.scrollHeight;
            chatMessages.scrollTop = chatMessages.scrollTop + (newScrollHeight - previousScrollHeight);
        }
    } catch (error) {
        console.error(error);
    } finally {
        isLoadingOlder = false;
    }
}

function startRealtimeListener() {
    if (!clubId || !currentUser || unsubscribeMessages) return;
    
    const messagesRef = collection(db, "clubs", clubId, "messages");
    
    // listener 1: new messages only (original behavior, cheap)
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
                const lastMessage = chatMessages.querySelector('.message-wrapper:last-of-type');
                if (lastMessage && messageData.createdAt) {
                    const lastMessageDate = lastMessage.dataset.dateKey;
                    const currentDateKey = getMessageDateKey(messageData.createdAt);
                    if (currentDateKey && currentDateKey !== lastMessageDate) {
                        const dateSeparator = document.createElement('div');
                        dateSeparator.className = 'date-separator show';
                        dateSeparator.innerHTML = `<span class="date-separator-text">${formatDateSeparator(messageData.createdAt.toDate())}</span>`;
                        chatMessages.appendChild(dateSeparator);
                        previousSenderId = null;
                    }
                }
                const showSenderName = previousSenderId !== messageData.createdByUid;
                await displayMessage(messageId, messageData, showSenderName);
                previousSenderId = messageData.createdByUid;
                if (messageData.createdAt) newestDoc = change.doc;
                if (isNearBottom || messageData.createdByUid === currentUser.uid) scrollToBottom();
            }
        }
    }, (error) => { console.error("Error:", error); });

    // listener 2: watches loaded messages for edits/deletes only
    if (oldestDoc && newestDoc) {
        onSnapshot(
            query(messagesRef, orderBy("createdAt", "asc"), startAfter(oldestDoc), limit(PAGE_SIZE)),
            (snapshot) => {
                for (const change of snapshot.docChanges()) {
                    if (change.type === "modified") updateMessage(change.doc.id, change.doc.data());
                    if (change.type === "removed") { removeMessage(change.doc.id); loadedMessageIds.delete(change.doc.id); }
                }
            }
        );
    }
}

function createMessageElement(messageId, messageData, showSenderName) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    messageWrapper.dataset.messageId = messageId;
    messageWrapper.dataset.senderId = messageData.createdByUid;
    if (messageData.createdAt) {
        messageWrapper.dataset.dateKey = getMessageDateKey(messageData.createdAt);
    }
    
    if (messageData.createdByUid === currentUser.uid) {
        messageWrapper.classList.add('sent');
    }

    if (showSenderName) {
        const senderName = document.createElement('div');
        senderName.className = 'sender-name';
        
        const nameText = document.createElement('span');
        nameText.textContent = messageData.createdByName || "Anonymous";
        senderName.appendChild(nameText);
        
        if (messageData.createdAt) {
            const timestamp = document.createElement('span');
            timestamp.className = 'message-timestamp';
            
            const date = messageData.createdAt.toDate();
            const hours = date.getHours();
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            
            timestamp.textContent = `${displayHours}:${minutes} ${ampm}`;
            senderName.appendChild(timestamp);
        }
        
        messageWrapper.appendChild(senderName);
    }

    if (messageData.replyTo) {
        const replyPreview = document.createElement('div');
        replyPreview.className = 'reply-preview-container';
        if (messageData.createdByUid === currentUser.uid) {
            replyPreview.classList.add('sent');
        }
        
        const replyBubbleContainer = document.createElement('div');
        replyBubbleContainer.className = 'reply-bubble-container';

        const replyName = document.createElement('div');
        replyName.className = 'reply-name';
        replyName.textContent = messageData.replyTo.senderName;

        const replyBubble = document.createElement('div');
        replyBubble.className = 'reply-bubble';
        replyBubble.dataset.replyToMessageId = messageData.replyTo.messageId;

        const replyText = document.createElement('div');
        replyText.className = 'reply-text';
        const maxLength = 50;
        let displayText = messageData.replyTo.text;
        if (displayText.length > maxLength) {
            displayText = displayText.substring(0, maxLength) + '...';
        }
        replyText.textContent = displayText;
        if (messageData.replyTo.text === "This message was deleted") {
            replyText.style.fontStyle = 'italic';
            replyText.style.opacity = '0.6';
        }

        replyBubble.appendChild(replyText);
        replyBubbleContainer.appendChild(replyName);
        replyBubbleContainer.appendChild(replyBubble);
        replyPreview.appendChild(replyBubbleContainer);

        
        replyBubbleContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentWrapper = chatMessages.querySelector(`[data-message-id="${messageId}"]`);
            const currentReplyText = currentWrapper?.querySelector('.reply-text')?.textContent;
            const updatedData = { ...messageData, replyTo: { ...messageData.replyTo, text: currentReplyText || messageData.replyTo.text }};
            showThreadView(messageId, updatedData);
        });
        
        messageWrapper.appendChild(replyPreview);

        addReplyLineConnector(messageWrapper, replyPreview);
    }

    let messageContent;

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
        messageContent = imageContainer;
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.innerHTML = linkifyText(messageData.message);
        if (messageData.deleted) {
            messageDiv.classList.add('deleted-message');
        }
        if (messageData.createdByUid === currentUser.uid) {
            messageDiv.classList.add('sent');
        }
        
        messageWrapper.appendChild(messageDiv);
        messageContent = messageDiv; 
    }
    let pressTimer;

    messageContent.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            messageContent.classList.add('pressing');
            pressTimer = setTimeout(() => {
                messageContent.classList.remove('pressing');
                showMessageOptions(messageId, messageData, messageWrapper);
            }, 250);
        }
    });

    messageContent.addEventListener('mouseup', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('mouseleave', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('touchstart', (e) => {
        messageContent.classList.add('pressing');
        pressTimer = setTimeout(() => {
            messageContent.classList.remove('pressing');
            navigator.vibrate && navigator.vibrate(50);
            showMessageOptions(messageId, messageData, messageWrapper);
        }, 250);
    });

    messageContent.addEventListener('touchend', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('touchmove', () => {
        messageContent.classList.remove('pressing');
        clearTimeout(pressTimer);
    });

    renderReactions(messageWrapper, messageData.reactions || []);

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
    const bubble = messageWrapper.querySelector('.message');
    if (bubble) {
        bubble.innerHTML = linkifyText(messageData.message);
        if (messageData.deleted) {
            bubble.classList.add('deleted-message');
        }
    }
    const replyTextEl = messageWrapper.querySelector('.reply-text');
    if (replyTextEl && messageData.replyTo) {
        replyTextEl.textContent = messageData.replyTo.text.length > 50 
            ? messageData.replyTo.text.substring(0, 50) + '...' 
            : messageData.replyTo.text;
        if (messageData.replyTo.text === "This message was deleted") {
            replyTextEl.style.fontStyle = 'italic';
            replyTextEl.style.opacity = '0.6';
        }
    }
    renderReactions(messageWrapper, messageData.reactions || []);
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

    if (replyingToMessage) {
        messageData.replyTo = {
            messageId: replyingToMessage.id,
            text: replyingToMessage.text,
            senderName: replyingToMessage.senderName,
            type: replyingToMessage.type || "text",
            imageUrl: replyingToMessage.imageUrl || null,
            createdByUid: replyingToMessage.createdByUid
        };
    }

    batch.set(newMessageRef, messageData);

    try {
        await batch.commit();
        
        //await updateLastSeenMessages();
        chatInput.value = "";
        if (replyingToMessage) {
            cancelReply();
        }
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
    chatMessages.addEventListener('wheel', (e) => {
        if (replyingToMessage) e.preventDefault();
    }, { passive: false });

    chatMessages.addEventListener('touchstart', (e) => {
        if (replyingToMessage) e.preventDefault();
    }, { passive: false });

    chatMessages.addEventListener('touchmove', (e) => {
        if (replyingToMessage) e.preventDefault();
    }, { passive: false });

}

async function saveImages() {
    clearPendingImages();
    await showAppAlert("Image sending not implemented");
}

async function updateLastSeenMessages() {
    console.log("called update Last seen");
    if (!currentUser || !clubId) return;

    const memberDocRef = doc(db, "clubs", clubId, "members", currentUser.uid);

    await updateDoc(memberDocRef, {
        lastSeenMessages: serverTimestamp()
    });
    console.log("Updated timestamp");
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

// if (pollOption) {
//     pollOption.addEventListener('click', () => {
//         isDropdownOpen = false;
//         uploadDropdown.classList.remove('show');
//         createPollEditCard();
//     });
// }

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

// function createPollEditCard(){
//     showAppAlert("adding soon");
// }


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



function showMessageOptions(messageId, messageData, messageElement) {
    if (messageData.deleted) return;
    selectedMessageForOptions = {
        id: messageId,
        data: messageData,
        element: messageElement
    };
    
    document.getElementById('modalSenderName').textContent = messageData.createdByName || "Anonymous";
    const deleteBtn = document.getElementById('deleteOptionButton');
    const isOwner = messageData.createdByUid === currentUser.uid;
    deleteBtn.style.display = isOwner ? 'flex' : 'none';
    
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

    const existingReactionsBar = document.querySelector('.modal-reactions-row');
    if (existingReactionsBar) existingReactionsBar.remove();

    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'modal-reactions-row';

    const currentReactions = messageData.reactions || [];
    QUICK_REACTIONS.forEach(emoji => {
        const myEntry = currentReactions.find(r => r.emoji === emoji && r.uid === currentUser.uid);
        const btn = document.createElement('div');
        btn.className = 'reaction-pick-btn' + (myEntry ? ' mine' : '');
        btn.textContent = emoji;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleReaction(messageId, emoji);
            hideMessageOptions();
        });
        reactionsBar.appendChild(btn);
    });

    const morBtn = document.createElement('div');
    morBtn.className = 'reaction-pick-btn';
    morBtn.textContent = '+';
    morBtn.style.fontSize = '22px';
    morBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showEmojiPickerOverlay(messageId);
    });
    reactionsBar.appendChild(morBtn);

    const actionsSection = document.querySelector('.message-options-actions');
    actionsSection.parentNode.insertBefore(reactionsBar, actionsSection);
}

function hideMessageOptions() {
    const modal = document.getElementById('messageOptionsModal');
    modal.style.opacity = '';
    modal.style.pointerEvents = '';

    if (!replyingToMessage) {
        chatMessages.classList.remove('blur-background');
    }
    document.getElementById('messageOptionsOverlay').classList.remove('show');
    selectedMessageForOptions = null;
}

function startReply(messageId, messageData) {
    replyingToMessage = {
        id: messageId,
        text: messageData.type === "image" ? "Image" : messageData.message,
        senderName: messageData.createdByName || "Anonymous",
        type: messageData.type || "text",
        imageUrl: messageData.imageUrl || null,
        createdByUid: messageData.createdByUid
    };
    
    document.getElementById('replyToName').textContent = replyingToMessage.senderName;
    document.getElementById('replyToMessage').textContent = replyingToMessage.text;
    
    document.getElementById('replyPreviewBar').classList.add('show');

    document.body.classList.add('scroll-locked');
    
    chatMessages.classList.add('scroll-locked');

    chatMessages.classList.add('blur-background');
    
    // chatMessages.style.paddingBottom = `calc(165px + env(safe-area-inset-bottom) + 20px)`;
    
    chatInput.focus();
}

function cancelReply() {
    replyingToMessage = null;
    
    document.getElementById('replyPreviewBar').classList.remove('show');
    
    chatMessages.classList.remove('scroll-locked');
    chatMessages.classList.remove('blur-background');
    
    // chatMessages.style.paddingBottom = `calc(85px + env(safe-area-inset-bottom) + 20px)`;
    document.body.classList.remove('scroll-locked');
}

document.getElementById('cancelReplyButton')?.addEventListener('click', cancelReply);

document.getElementById('messageOptionsOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'messageOptionsOverlay') {
        hideMessageOptions();
    }
});

document.getElementById('replyOptionButton')?.addEventListener('click', () => {
    if (selectedMessageForOptions) {
        startReply(selectedMessageForOptions.id, selectedMessageForOptions.data);
        hideMessageOptions();
    }
});



function showThreadView(replyMessageId, replyMessageData) {
    if (!replyMessageData.replyTo) return;
    const threadOverlay = document.createElement('div');
    threadOverlay.className = 'thread-view-overlay';
    threadOverlay.id = 'threadViewOverlay';
    
    const threadContainer = document.createElement('div');
    threadContainer.className = 'thread-view-container';
    
    const originalMsgWrapper = document.createElement('div');
    originalMsgWrapper.className = 'thread-message-wrapper';
    if (replyMessageData.replyTo.createdByUid === currentUser.uid) {
        originalMsgWrapper.classList.add('sent');
    }
    if (replyMessageData.replyTo.type === 'image') {
        originalMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.replyTo.senderName}</div>
            <div class="thread-message ${replyMessageData.replyTo.createdByUid === currentUser.uid ? 'sent' : ''} message-image">
                <img src="${replyMessageData.replyTo.imageUrl}" alt="Image" style="max-width: 100%; border-radius: 8px;">
            </div>
        `;
    } else {
        originalMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.replyTo.senderName}</div>
            <div class="thread-message ${replyMessageData.replyTo.createdByUid === currentUser.uid ? 'sent' : ''}">${linkifyText(replyMessageData.replyTo.text)}</div>
        `;
    }

    if (replyMessageData.replyTo.text === "This message was deleted") {
        const threadMsg = originalMsgWrapper.querySelector('.thread-message');
        if (threadMsg) {
            threadMsg.style.fontStyle = 'italic';
            threadMsg.style.opacity = '0.6';
        }
    }
    
    const replyMsgWrapper = document.createElement('div');
    replyMsgWrapper.className = 'thread-message-wrapper';
    if (replyMessageData.createdByUid === currentUser.uid) {
        replyMsgWrapper.classList.add('sent');
    }
    if (replyMessageData.type === 'image') {
        replyMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.createdByName}</div>
            <div class="thread-message ${replyMessageData.createdByUid === currentUser.uid ? 'sent' : ''} message-image">
                <img src="${replyMessageData.imageUrl}" alt="Image" style="max-width: 100%; border-radius: 8px;">
            </div>
        `;
    } else {
        replyMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.createdByName}</div>
            <div class="thread-message ${replyMessageData.createdByUid === currentUser.uid ? 'sent' : ''}">${linkifyText(replyMessageData.message)}</div>
        `;
    }
    
    threadContainer.appendChild(originalMsgWrapper);
    threadContainer.appendChild(replyMsgWrapper);
    threadOverlay.appendChild(threadContainer);
    
    document.body.appendChild(threadOverlay);
    
    chatMessages.classList.add('thread-blur');
    
    requestAnimationFrame(() => {
        threadOverlay.classList.add('show');
    });
    
    threadOverlay.addEventListener('click', (e) => {
        hideThreadView();
    });
}

function hideThreadView() {
    const threadOverlay = document.getElementById('threadViewOverlay');
    if (threadOverlay) {
        threadOverlay.classList.remove('show');
        chatMessages.classList.remove('thread-blur');
        setTimeout(() => {
            threadOverlay.remove();
        }, 300);
    }
}




function scrollToBottom() {
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}



// function adjustChatMessagesHeight() {
//     const chatMessages = document.getElementById('chatMessages');
//     const inputContainer = document.getElementById('inputContainer');
    
//     if (!chatMessages || !inputContainer) return;
    
//     const inputHeight = inputContainer.offsetHeight;
//     const windowHeight = window.innerHeight;
    
//     // Set the exact height: full window minus input container height
//     chatMessages.style.height = `${windowHeight - inputHeight}px`;
// }

function adjustChatMessagesHeight() {
    const chatMessages = document.getElementById('chatMessages');
    const inputContainer = document.getElementById('inputContainer');
    
    if (!chatMessages || !inputContainer) return;
    
    const inputHeight = inputContainer.offsetHeight;
    const windowHeight = window.innerHeight;
    
    chatMessages.style.height = `${windowHeight - inputHeight}px`;
}

window.addEventListener('load', adjustChatMessagesHeight);
window.addEventListener('resize', adjustChatMessagesHeight);


if (inputContainer) {
    inputContainer.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    }, { passive: true });
    
    inputContainer.addEventListener('touchmove', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
    
    inputContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
}





function addReplyLineConnector(wrapper, preview) {
    requestAnimationFrame(() => {
        const bubble = preview.querySelector('.reply-bubble');
        const msg = wrapper.querySelector('.message');
        
        if (!bubble || !msg) return;
        
        const bw = bubble.offsetWidth;
        const mw = msg.offsetWidth;
        const sent = wrapper.classList.contains('sent');
        
        const L = document.createElement('i');
        L.className = 'fa-solid fa-l reply-icon';
        
        const longer = bw > mw;
        
        if (sent) {
            L.style.transform = longer ? 'translateY(-50%)' : 'scaleY(-1) translateY(50%)';
        } else {
            L.style.transform = longer ? 'scaleX(-1) translateY(-50%)' : 'scale(-1, -1) translateY(50%)';
        }
        
        L.style.position = 'absolute';
        L.style.top = '50%';
        
        if (longer) {
            L.style[sent ? 'left' : 'right'] = '-25px';
            msg.style.position = 'relative';
            msg.appendChild(L);
        } else {
            L.style[sent ? 'left' : 'right'] = '-25px';
            bubble.style.position = 'relative';
            bubble.appendChild(L);
        }
    });
}




function linkifyText(text) {
    const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
    
    return text.replace(urlPattern, (url) => {
        let href = url.startsWith('http') ? url : 'https://' + url;
        
        return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
    });
}

function formatDateSeparator(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Reset times to compare just dates
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    const messageDate = new Date(date);
    messageDate.setHours(0, 0, 0, 0);
    
    if (messageDate.getTime() === today.getTime()) {
        return 'Today';
    } else if (messageDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else {
        const options = { month: 'long', day: 'numeric', year: 'numeric' };
        return messageDate.toLocaleDateString('en-US', options);
    }
}

function getMessageDateKey(timestamp) {
    if (!timestamp) return null;
    const date = timestamp.toDate();
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

document.getElementById('deleteOptionButton')?.addEventListener('click', async () => {
    if (!selectedMessageForOptions) return;
    
    document.getElementById('messageOptionsModal').style.opacity = '0';
    document.getElementById('messageOptionsModal').style.pointerEvents = 'none';
    
    const confirmed = await showAppConfirm("Delete this message?");
    
    if (!confirmed) {
        document.getElementById('messageOptionsModal').style.opacity = '1';
        document.getElementById('messageOptionsModal').style.pointerEvents = 'all';
        return;
    }
    
    const msgRef = doc(db, "clubs", clubId, "messages", selectedMessageForOptions.id);
    const messagesRef = collection(db, "clubs", clubId, "messages");
    const batch = writeBatch(db);
    batch.update(msgRef, { deleted: true, message: "This message was deleted", type: "text", reactions: [] });

    const repliesQuery = query(messagesRef, where("replyTo.messageId", "==", selectedMessageForOptions.id));
    const repliesSnap = await getDocs(repliesQuery);
    repliesSnap.forEach(replyDoc => {
        batch.update(replyDoc.ref, { "replyTo.text": "This message was deleted" });
    });

    await batch.commit();
    hideMessageOptions();
});








async function toggleReaction(messageId, emoji) {
    if (!currentUser || !clubId) return;
    const msgRef = doc(db, "clubs", clubId, "messages", messageId);
    const entry = { emoji, uid: currentUser.uid };

    const currentReactions = selectedMessageForOptions?.id === messageId
        ? (selectedMessageForOptions.data.reactions || [])
        : [];
    
    const alreadyReacted = currentReactions.some(r => r.emoji === emoji && r.uid === currentUser.uid)
        || !!chatMessages.querySelector(`[data-message-id="${messageId}"] .reaction-chip[data-emoji="${emoji}"].mine`);

    if (alreadyReacted) {
        await updateDoc(msgRef, { reactions: arrayRemove(entry) });
    } else {
        await updateDoc(msgRef, { reactions: arrayUnion(entry) });
    }
}

function renderReactions(messageWrapper, reactions) {
    messageWrapper.querySelector('.message-reactions')?.remove();
    if (!reactions || reactions.length === 0) return;

    const order = [];
    const groups = {};
    for (const r of reactions) {
        if (!groups[r.emoji]) {
            groups[r.emoji] = [];
            order.push(r.emoji);
        }
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
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleReaction(msgId, emoji);
        });
        row.appendChild(chip);
    }

    const bubble = messageWrapper.querySelector('.message');
    (bubble || messageWrapper).appendChild(row);
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


// I am interested in technology, computers, and creative fields. My long term goal is to work in technology and design. I am passionate about technology and computers, like how they can be used as tools for creative expression. Although I am open to many different career paths, I think it would be interesting to build a career developing products and/or websites that can be useful for many people. 


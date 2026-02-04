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
        
        for (let i = 0; i < reversedDocs.length; i++) {
            const docSnap = reversedDocs[i];
            const messageData = docSnap.data();
            const messageId = docSnap.id;
            loadedMessageIds.add(messageId);
            
            const showSenderName = previousSenderId !== messageData.createdByUid;
            await displayMessage(messageId, messageData, showSenderName);
            previousSenderId = messageData.createdByUid;
        }
        
        scrollToBottom();


    } catch (error) {
        console.error("Error:", error);
    } finally {
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollToBottom();
                chatMessages.classList.add('loaded');
            });
        });
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
                    scrollToBottom();
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

        replyBubble.appendChild(replyText);
        replyBubbleContainer.appendChild(replyName);
        replyBubbleContainer.appendChild(replyBubble);
        replyPreview.appendChild(replyBubbleContainer);

        
        replyBubbleContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            showThreadView(messageId, messageData);
        });
        
        messageWrapper.appendChild(replyPreview);
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
        messageDiv.textContent = messageData.message;
        if (messageData.createdByUid === currentUser.uid) {
            messageDiv.classList.add('sent');
        }
        
        
        
        messageWrapper.appendChild(messageDiv);
        messageContent = messageDiv; 
    }
    let pressTimer;

    messageContent.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            pressTimer = setTimeout(() => {
                showMessageOptions(messageId, messageData, messageWrapper);
            }, 500);
        }
    });

    messageContent.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
            navigator.vibrate && navigator.vibrate(50);
            showMessageOptions(messageId, messageData, messageWrapper);
        }, 500);
    });

    messageContent.addEventListener('touchend', () => {
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('touchmove', () => {
        clearTimeout(pressTimer);
    });

    messageContent.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageOptions(messageId, messageData, messageWrapper);
    });
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
            imageUrl: replyingToMessage.imageUrl || null
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
    selectedMessageForOptions = {
        id: messageId,
        data: messageData,
        element: messageElement
    };
    
    document.getElementById('modalSenderName').textContent = messageData.createdByName || "Anonymous";
    
    const modalMessageContainer = document.getElementById('modalMessageContainer');
    modalMessageContainer.innerHTML = '';
    
    const messageContent = messageElement.querySelector('.message');
    if (messageContent) {
        const messageClone = messageContent.cloneNode(true);
        modalMessageContainer.appendChild(messageClone);
    }
    
    chatMessages.classList.add('blur-background');
    document.getElementById('messageOptionsOverlay').classList.add('show');
}

function hideMessageOptions() {
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
        imageUrl: messageData.imageUrl || null
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
    const threadOverlay = document.createElement('div');
    threadOverlay.className = 'thread-view-overlay';
    threadOverlay.id = 'threadViewOverlay';
    
    const threadContainer = document.createElement('div');
    threadContainer.className = 'thread-view-container';
    
    const originalMsgWrapper = document.createElement('div');
    originalMsgWrapper.className = 'thread-message-wrapper';
    if (replyMessageData.replyTo.type === 'image') {
        originalMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.replyTo.senderName}</div>
            <div class="thread-message message-image">
                <img src="${replyMessageData.replyTo.imageUrl}" alt="Image" style="max-width: 100%; border-radius: 8px;">
            </div>
        `;
    } else {
        originalMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.replyTo.senderName}</div>
            <div class="thread-message">${replyMessageData.replyTo.text}</div>
        `;
    }
    
    const replyMsgWrapper = document.createElement('div');
    replyMsgWrapper.className = 'thread-message-wrapper';
    if (replyMessageData.type === 'image') {
        replyMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.createdByName}</div>
            <div class="thread-message message-image">
                <img src="${replyMessageData.imageUrl}" alt="Image" style="max-width: 100%; border-radius: 8px;">
            </div>
        `;
    } else {
        replyMsgWrapper.innerHTML = `
            <div class="thread-sender-name">${replyMessageData.createdByName}</div>
            <div class="thread-message">${replyMessageData.message}</div>
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
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}
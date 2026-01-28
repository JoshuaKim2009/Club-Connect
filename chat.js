import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, writeBatch, doc, getDoc, collection, setDoc, serverTimestamp, query, onSnapshot, orderBy, getDocs, limit, startAfter } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

let unsubscribeMessages = null;

const PAGE_SIZE = 20;
let oldestDoc = null;
let hasMoreMessages = true;
let isLoadingOlder = false;
let newestTimestamp = null;
let previousSenderId = null;
let loadedMessageIds = new Set();

const chatInput = document.getElementById('chatInput');
const inputContainer = document.getElementById('inputContainer');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById("back-button");

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
    console.time('Auth callback');
    
    if (user) {
        currentUser = user;
        isLoggedIn = true;
        userName = user.displayName || "";
        userEmail = user.email || "";

        console.log("Logged in:", userEmail);

        if (clubId) {
            if (chatMessages) {
                chatMessages.classList.remove('loading');
            }
            
            console.time('Parallel loading');
            
            const rolePromise = getMemberRoleForClub(clubId, currentUser.uid);
            const messagesPromise = loadInitialMessages();
            
            [role] = await Promise.all([rolePromise, messagesPromise]);
            
            console.timeEnd('Parallel loading');
            
            startRealtimeListener();
        }
    } else {
        window.location.href = 'login.html';
    }
    
    console.timeEnd('Auth callback');
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
            newestTimestamp = messageDocs[0].data().createdAt;
            
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
        console.error("Error loading initial messages:", error);
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
            tempFragment.appendChild(messageElement);
            tempPreviousSenderId = messageData.createdByUid;

            messageCount+=1;
            console.log(messageCount);
            
            if (messageData.createdByUid !== currentUser.uid) {
                markAsRead(messageId);
            }
        }
        
        if (tempFragment.children.length > 0) {
            const existingFirstWrapper = chatMessages.querySelector('.message-wrapper');
            if (existingFirstWrapper) {
                const lastLoadedSenderId = tempPreviousSenderId;
                const existingFirstSenderId = existingFirstWrapper.dataset.senderId;
                
                if (lastLoadedSenderId === existingFirstSenderId) {
                    const existingSenderName = existingFirstWrapper.querySelector('.sender-name');
                    if (existingSenderName) {
                        existingSenderName.remove();
                    }
                } else if (!existingFirstWrapper.querySelector('.sender-name')) {
                    const senderName = document.createElement('div');
                    senderName.className = 'sender-name';
                    const firstMessageId = existingFirstWrapper.dataset.messageId;
                    const firstMessageDoc = await getDoc(doc(db, "clubs", clubId, "messages", firstMessageId));
                    if (firstMessageDoc.exists()) {
                        senderName.textContent = firstMessageDoc.data().createdByName || "Anonymous";
                        existingFirstWrapper.insertBefore(senderName, existingFirstWrapper.firstChild);
                    }
                }
            }
            
            chatMessages.insertBefore(tempFragment, chatMessages.firstChild);
            
            const newScrollHeight = chatMessages.scrollHeight;
            chatMessages.scrollTop = chatMessages.scrollTop + (newScrollHeight - previousScrollHeight);
        }
    } catch (error) {
        console.error("Error loading older messages:", error);
    } finally {
        isLoadingOlder = false;
    }
}

function startRealtimeListener() {
    if (!clubId || !currentUser || unsubscribeMessages) return;
    
    const messagesRef = collection(db, "clubs", clubId, "messages");
    
    let q;
    if (newestTimestamp) {
        q = query(messagesRef, orderBy("createdAt", "asc"), startAfter(newestTimestamp));
    } else {
        q = query(messagesRef, orderBy("createdAt", "asc"));
    }
    
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
                    newestTimestamp = messageData.createdAt;
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

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.textContent = messageData.message;
    if (messageData.createdByUid === currentUser.uid) {
        messageDiv.classList.add('sent');
    }
    messageWrapper.appendChild(messageDiv);
    
    return messageWrapper;
}

async function displayMessage(messageId, messageData, showSenderName) {
    if (!messageData) return;
    
    const messageElement = createMessageElement(messageId, messageData, showSenderName);
    chatMessages.appendChild(messageElement);
    messageCount+=1;
    
    console.log(messageCount);
    
    if (messageData.createdByUid !== currentUser.uid) {
        markAsRead(messageId);
    }
}

function updateMessage(messageId, messageData) {
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
        createdAt: serverTimestamp() 
    };

    batch.set(newMessageRef, messageData);

    const readStatusRef = doc(db, "clubs", clubId, "messages", newMessageRef.id, "readBy", currentUser.uid);
    batch.set(readStatusRef, {
        userId: currentUser.uid,
        userName: currentUser.displayName || "Anonymous",
        readAt: serverTimestamp()
    });

    try {
        await batch.commit();
        chatInput.value = "";
    } catch (error) {
        console.error("Failed to send message:", error);
    }
}

if (sendButton) {
    sendButton.addEventListener('click', saveMessage);
}

if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveMessage();
        }
    });
}

if (chatMessages) {
    chatMessages.addEventListener('scroll', () => {
        if (chatMessages.scrollTop < 500 && hasMoreMessages && !isLoadingOlder) {
            loadOlderMessages();
        }
    });
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

async function markAsRead(ID) {
    if (!currentUser || !clubId) {
        console.warn("User not logged in or clubId missing.");
        return;
    }

    const userUid = currentUser.uid;
    const userName = currentUser.displayName || "Anonymous User";
    
    const readByRef = collection(db, "clubs", clubId, "messages", ID, "readBy");
    const userReadDocRef = doc(readByRef, userUid); 

    const userReadSnap = await getDoc(userReadDocRef);

    if (!userReadSnap.exists()) {
        await setDoc(userReadDocRef, {
            userId: currentUser.uid,
            userName: currentUser.displayName || "Anonymous",
            readAt: serverTimestamp()
        });
    }
}
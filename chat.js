import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, writeBatch, doc, getDoc, collection, setDoc, serverTimestamp, query, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
let clubId = null;
let currentUser = null;

let unsubscribeMessages = null;


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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        isLoggedIn = true;
        userName = user.displayName || "";
        userEmail = user.email || "";

        console.log("Logged in:", userEmail);

    if (clubId) {
        role = await getMemberRoleForClub(clubId, currentUser.uid);
        console.log(`User ${currentUser.uid} role for club ${clubId}: ${role}`);
    }


    } else {
        currentUser = null;
        isLoggedIn = false;
        userName = "";
        userEmail = "";
        role = null;

        console.log("User signed out");
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

if (clubId) {
    unsubscribeMessages = listenToMessages();
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

function listenToMessages() {
    const messagesRef = collection(db, "clubs", clubId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const messageData = change.doc.data();
            const messageId = change.doc.id;
            
            if (change.type === "added") {
                displayMessage(messageId, messageData);
            }
            if (change.type === "modified") {
                updateMessage(messageId, messageData);
            }
            if (change.type === "removed") {
                removeMessage(messageId);
            }
        });
    }, (error) => {
        console.error("Error:", error);
    });
    
    return unsubscribe;
}

function displayMessage(messageId, messageData) {
    if (!messageData) return;
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    if (messageData.createdByUid === currentUser.uid) {
        messageWrapper.classList.add('sent');
    }
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.textContent = messageData.message;
    if (messageData.createdByUid === currentUser.uid) {
        messageDiv.classList.add('sent');
    }
    messageWrapper.appendChild(messageDiv);
    chatMessages.appendChild(messageWrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    console.log("New message:", messageId, messageData);
}

function updateMessage(messageId, messageData) {
    console.log("Updated message:", messageId, messageData);
}

function removeMessage(messageId) {
    console.log("Removed message:", messageId);
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

window.addEventListener('load', () => {
    setTimeout(() => {
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }, 100);
});

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
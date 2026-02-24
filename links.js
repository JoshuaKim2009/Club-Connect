import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    collection,
    query,
    orderBy,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);


let currentUser     = null;
let clubId          = null;
let currentUserRole = null;
let isEditing       = false;


const resourcesContainer = document.getElementById('resourcesContainer');
const noResourcesMessage  = document.getElementById('noResourcesMessage');
const addCategoryButton    = document.getElementById('add-category-button');
const categoryCreationModal = document.getElementById('category-creation-modal');
const categoryOverlay = document.getElementById('popup-overlay');



function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    const memberSnap = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberSnap.exists()) return memberSnap.data().role || 'member';
    const clubSnap = await getDoc(doc(db, "clubs", clubId));
    return clubSnap.data()?.managerUid === uid ? 'manager' : 'member';
}


window.goToClubPage = function () {
    const returnToPage = getUrlParameter('returnTo');
    if (clubId) {
        if (returnToPage === 'manager') {
            window.location.href = `club_page_manager.html?id=${clubId}`;
        } else if (returnToPage === 'member') {
            window.location.href = `club_page_member.html?id=${clubId}`;
        } else {
            window.location.href = `club_page_manager.html?id=${clubId}`;
        }
    } else {
        window.location.href = 'your_clubs.html';
    }
};


onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user) {
        if (clubId) {
            const clubSnap = await getDoc(doc(db, "clubs", clubId));
            if (clubSnap.exists()) {
                currentUserRole = await getMemberRoleForClub(clubId, user.uid);

                if (currentUserRole === 'manager' || currentUserRole === 'admin') {
                    if (addCategoryButton) {
                        addCategoryButton.style.display = 'block';
                        addCategoryButton.removeEventListener('click', handleAddCategory);
                        addCategoryButton.addEventListener('click', handleAddCategory);
                    }
                }

                await fetchAndDisplayCategories();
            }
        }
    } else {
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    }
});


function handleAddCategory() {
    categoryOverlay.style.display = 'block';
    categoryCreationModal.style.display = 'block';
    document.body.classList.add('no-scroll');
}

function hideCategoryModal() {
    categoryCreationModal.style.display = 'none';
    categoryOverlay.style.display = 'none';
    document.body.classList.remove('no-scroll');
}

function resetCategoryModal() {
    document.getElementById('category-title-input').value = '';
}

document.getElementById('post-category-button').addEventListener('click', async () => {
    const saved = await saveCategory();
    if (saved) {
        resetCategoryModal();
        hideCategoryModal();
    }
});

document.getElementById('cancel-category-button').addEventListener('click', () => {
    resetCategoryModal();
    hideCategoryModal();
});

async function fetchAndDisplayCategories() {
    // TODO
}

async function saveCategory() {
    if (!currentUser || !clubId) {
        await showAppAlert("You must be logged in to create a category.");
        return false;
    }

    const title = document.getElementById('category-title-input').value.trim();

    if (!title) {
        await showAppAlert("Category name is required!");
        return false;
    }

    try {
        const categoriesRef = collection(db, "clubs", clubId, "resourceCategories");
        await addDoc(categoriesRef, {
            title,
            links: [],
            createdAt: serverTimestamp(),
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId
        });

        await showAppAlert("Category created successfully!");
        await fetchAndDisplayCategories();
        return true;

    } catch (error) {
        console.error("Error creating category:", error);
        await showAppAlert("Failed to create category: " + error.message);
        return false;
    }
}
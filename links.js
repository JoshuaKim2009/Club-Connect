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
let editingCategory = null;
let categoriesCache = [];
let sortableInstance = null;


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
    const categoriesQuery = query(collection(db, "clubs", clubId, "resourceSections"), orderBy("createdAt", "asc"));
    const categorySnapshots = await getDocs(categoriesQuery);
    categoriesCache = [];
    categorySnapshots.forEach((docSnap, i) => {
        const data = docSnap.data();
        categoriesCache.push({
            id: docSnap.id,
            title: data.title,
            createdAt: data.createdAt,
            createdByUid: data.createdByUid,
            createdByName: data.createdByName,
            links: data.links || [],
            order: data.order ?? i
        });
    });

    categoriesCache.sort((a, b) => a.order - b.order);

    resourcesContainer.innerHTML = '';
    if (categoriesCache.length === 0) {
        noResourcesMessage.style.display = 'block';
        return;
    } else {
        noResourcesMessage.style.display = 'none';
    }

    categoriesCache.forEach(category => {
        const el = createCategoryElement(category);
        el.dataset.id = category.id;
        resourcesContainer.appendChild(el);
    });

    if (currentUserRole === 'manager' || currentUserRole === 'admin') {
        sortableInstance = window.Sortable.create(resourcesContainer, {
            animation: 150,
            forceFallback: true,
            // handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onStart: (evt) => {
                const style = document.createElement('style');
                style.id = 'drag-cursor-style';
                style.innerHTML = '* { cursor: grabbing !important; }';
                document.head.appendChild(style);
                const width = evt.item.offsetWidth;
                document.querySelector('.sortable-fallback')?.style.setProperty('width', width + 'px', 'important');
            },
            onEnd: async () => {
                document.getElementById('drag-cursor-style')?.remove();
                const items = resourcesContainer.querySelectorAll('.category');
                const updates = [];
                items.forEach((el, index) => {
                    const id = el.dataset.id;
                    updates.push(updateDoc(doc(db, "clubs", clubId, "resourceSections", id), { order: index }));
                });
                await Promise.all(updates);
            }
        });
    }
}

function createCategoryElement(category) {
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    categoryDiv.innerHTML = `
        <div class="category-header">
            <h3>${category.title}</h3>
            ${(currentUserRole === 'manager' || currentUserRole === 'admin') ? `<button class="edit-category-button" data-category-id="${category.id}"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
        </div>
        <div class="links-container" id="links-${category.id}">
            ${category.links.map(link => {
                const url = link.url.startsWith('http') ? link.url : 'https://' + link.url;
                return `
                    <div class="link-item">
                        <a href="${url}" target="_blank">${link.title}</a>
                    </div>
                `;
            }).join('')}
            ${(currentUserRole === 'manager' || currentUserRole === 'admin') ? `
                <button class="add-link-button" data-category-id="${category.id}">+ Add Link</button>
            ` : ''}
        </div>
    `;
    if (currentUserRole === 'manager' || currentUserRole === 'admin') {
        const editButton = categoryDiv.querySelector('.edit-category-button');
        editButton.addEventListener('click', async () => {
            openEditCategoryModal(category);
        });
        const addLinkBtn = categoryDiv.querySelector('.add-link-button');
        if (addLinkBtn) {
            addLinkBtn.addEventListener('click', () => openAddLinkModal(category));
        }
    }
    return categoryDiv;
}

function openEditCategoryModal(category) {
    editingCategory = category;
    document.getElementById('edit-category-title-input').value = category.title;

    const linksList = document.getElementById('edit-category-links-list');
    linksList.innerHTML = '';

    category.links.forEach((link, index) => {
        const row = document.createElement('div');
        row.className = 'edit-link-row';
        row.innerHTML = `
            <input class="edit-link-title-input" type="text" value="${link.title}" data-index="${index}" />
            <button class="delete-link-btn" data-index="${index}"><i class="fa-solid fa-trash"></i></button>
        `;
        row.querySelector('.delete-link-btn').addEventListener('click', async () => {
            // const confirmed = await showAppConfirm(`Delete "${link.title}"?`);
            // if (!confirmed) return;
            const updatedLinks = [...editingCategory.links];
            updatedLinks.splice(index, 1);
            editingCategory = { ...editingCategory, links: updatedLinks };
            openEditCategoryModal(editingCategory); 
        });

        linksList.appendChild(row);
    });

    categoryOverlay.style.display = 'block';
    document.getElementById('edit-category-modal').style.display = 'flex';
    document.body.classList.add('no-scroll');
}

function hideEditCategoryModal() {
    document.getElementById('edit-category-modal').style.display = 'none';
    categoryOverlay.style.display = 'none';
    document.body.classList.remove('no-scroll');
    editingCategory = null;
}

document.getElementById('cancel-edit-category-button').addEventListener('click', hideEditCategoryModal);

document.getElementById('save-edit-category-button').addEventListener('click', async () => {
    const newTitle = document.getElementById('edit-category-title-input').value.trim();
    if (!newTitle) { await showAppAlert("Title can't be empty!"); return; }

    const updatedLinks = editingCategory.links.map((link, index) => {
        const input = document.querySelector(`.edit-link-title-input[data-index="${index}"]`);
        return { ...link, title: input ? input.value.trim() || link.title : link.title };
    });

    const sectionRef = doc(db, "clubs", clubId, "resourceSections", editingCategory.id);
    await updateDoc(sectionRef, { title: newTitle, links: updatedLinks });
    hideEditCategoryModal();
    await fetchAndDisplayCategories();
});

document.getElementById('delete-category-button').addEventListener('click', async () => {
    const confirmed = await showAppConfirm(`Delete the entire "${editingCategory.title}" category?`);
    if (!confirmed) return;
    const sectionRef = doc(db, "clubs", clubId, "resourceSections", editingCategory.id);
    await deleteDoc(sectionRef);
    hideEditCategoryModal();
    await fetchAndDisplayCategories();
});

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
        const categoriesRef = collection(db, "clubs", clubId, "resourceSections");
        await addDoc(categoriesRef, {
            title,
            links: [],
            order: categoriesCache.length,
            createdAt: serverTimestamp(),
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId
        });

        // await showAppAlert("Category created successfully!");
        await fetchAndDisplayCategories();
        return true;

    } catch (error) {
        await showAppAlert("Failed to create category: " + error.message);
        return false;
    }
}


const addLinkModal = document.getElementById('add-link-modal');
let activeLinkCategoryId = null;

function openAddLinkModal(category) {
    activeLinkCategoryId = category.id;
    document.getElementById('link-title-input').value = '';
    document.getElementById('link-url-input').value = '';
    categoryOverlay.style.display = 'block';
    addLinkModal.style.display = 'flex';
    document.body.classList.add('no-scroll');
}

function hideAddLinkModal() {
    addLinkModal.style.display = 'none';
    categoryOverlay.style.display = 'none';
    document.body.classList.remove('no-scroll');
    activeLinkCategoryId = null;
}

document.getElementById('cancel-link-button').addEventListener('click', hideAddLinkModal);

document.getElementById('save-link-button').addEventListener('click', async () => {
    const title = document.getElementById('link-title-input').value.trim();
    const url = document.getElementById('link-url-input').value.trim();

    if (!title || !url) {
        await showAppAlert("Both a title and URL are required!");
        return;
    }

    try {
        const sectionRef = doc(db, "clubs", clubId, "resourceSections", activeLinkCategoryId);
        const sectionSnap = await getDoc(sectionRef);
        const existingLinks = sectionSnap.data().links || [];

        await updateDoc(sectionRef, {
            links: [...existingLinks, { title, url }]
        });

        hideAddLinkModal();
        await fetchAndDisplayCategories();
    } catch (error) {
        await showAppAlert("Failed to save link: " + error.message);
    }
});
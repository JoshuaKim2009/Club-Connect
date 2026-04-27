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
let editingCategory = null;
let categoriesCache = [];
let sortableInstance = null;
let reorderMode = false;

const resourcesContainer    = document.getElementById('resourcesContainer');
const noResourcesMessage    = document.getElementById('noResourcesMessage');
const addCategoryButton     = document.getElementById('add-category-button');
const categoryCreationModal = document.getElementById('category-creation-modal');
const categoryOverlay       = document.getElementById('popup-overlay');



function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

async function getMemberRoleForClub(cid, uid) {
    if (!cid || !uid) return null;
    const memberSnap = await getDoc(doc(db, "clubs", cid, "members", uid));
    if (memberSnap.exists()) return memberSnap.data().role || 'member';
    const clubSnap = await getDoc(doc(db, "clubs", cid));
    return clubSnap.data()?.managerUid === uid ? 'manager' : 'member';
}

function isAdmin() {
    return currentUserRole === 'manager' || currentUserRole === 'admin';
}

function showOverlay()  { categoryOverlay.style.display = 'block'; document.body.classList.add('no-scroll'); }
function hideOverlay()  { categoryOverlay.style.display = 'none';  document.body.classList.remove('no-scroll'); }



window.goToClubPage = function () {
    const returnTo = getUrlParameter('returnTo');
    if (clubId) {
        window.location.href = returnTo === 'member'
            ? `club_page_member.html?id=${clubId}`
            : `club_page_manager.html?id=${clubId}`;
    } else {
        window.location.href = 'your_clubs.html';
    }
};



onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (user && clubId) {
        const clubSnap = await getDoc(doc(db, "clubs", clubId));
        if (clubSnap.exists()) {
            currentUserRole = await getMemberRoleForClub(clubId, user.uid);
            if (isAdmin()) {
                addCategoryButton.style.display = 'block';
                addCategoryButton.addEventListener('click', handleAddCategory);
            }
            await fetchAndDisplayCategories();
        }
    } else if (!user) {
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    }
});



function handleAddCategory() {
    if (reorderMode) { showAppAlert("Finish reordering first!"); return; }
    showOverlay();
    categoryCreationModal.style.display = 'flex';
}

function hideCategoryModal() {
    categoryCreationModal.style.display = 'none';
    hideOverlay();
    document.getElementById('category-title-input').value = '';
}

document.getElementById('cancel-category-button').addEventListener('click', hideCategoryModal);

document.getElementById('post-category-button').addEventListener('click', async () => {
    const title = document.getElementById('category-title-input').value.trim();
    if (!title) { await showAppAlert("Category name is required!"); return; }
    try {
        await addDoc(collection(db, "clubs", clubId, "resourceSections"), {
            title, links: [], order: categoriesCache.length,
            createdAt: serverTimestamp(),
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId
        });
        hideCategoryModal();
        await fetchAndDisplayCategories();
    } catch (e) {
        await showAppAlert("Failed to create category: " + e.message);
    }
});



async function fetchAndDisplayCategories() {
    const snap = await getDocs(
        query(collection(db, "clubs", clubId, "resourceSections"), orderBy("createdAt", "asc"))
    );
    categoriesCache = [];
    snap.forEach((d, i) => {
        const data = d.data();
        categoriesCache.push({ id: d.id, title: data.title, links: data.links || [], order: data.order ?? i });
    });
    categoriesCache.sort((a, b) => a.order - b.order);

    resourcesContainer.innerHTML = '';

    if (categoriesCache.length === 0) {
        noResourcesMessage.style.display = isAdmin() ? 'none' : 'block';
        return;
    }
    noResourcesMessage.style.display = 'none';

    categoriesCache.forEach((cat, i) => {
        const el = createCategoryElement(cat);
        el.dataset.id = cat.id;
        resourcesContainer.appendChild(el);
        animateCardIn(el, i);
    });

    if (isAdmin()) setupReorder();
}

function createCategoryElement(category) {
    const div = document.createElement('div');
    div.className = 'category';
    div.innerHTML = `
        <div class="category-header">
            <h3>${category.title}</h3>
            ${isAdmin() ? `<button class="edit-category-button" title="Edit category"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
        </div>
        <div class="links-container" id="links-${category.id}">
            ${category.links.map(link => {
                const url = link.url.startsWith('http') ? link.url : 'https://' + link.url;
                return `<div class="link-item"><a href="${url}" target="_blank">${link.title}</a></div>`;
            }).join('')}
            ${isAdmin() ? `<button class="add-link-button" data-category-id="${category.id}">+ Add Link</button>` : ''}
        </div>
    `;
    if (isAdmin()) {
        div.querySelector('.edit-category-button').addEventListener('click', () => openEditCategoryModal(category));
        div.querySelector('.add-link-button').addEventListener('click', () => openAddLinkModal(category));
    }
    return div;
}

function setupReorder() {
    const reorderButton = document.getElementById('reorder-button');
    reorderButton.style.display = categoriesCache.length >= 2 ? 'block' : 'none';
    reorderButton.textContent = 'REORDER CATEGORIES';
    reorderButton.classList.remove('save-mode');
    reorderMode = false;
    reorderButton.style.width = reorderButton.offsetWidth + 'px';

    sortableInstance = window.Sortable.create(resourcesContainer, {
        animation: 150, forceFallback: true,
        ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
        disabled: true,
        onStart: (evt) => {
            const s = document.createElement('style');
            s.id = 'drag-cursor-style';
            s.innerHTML = '* { cursor: grabbing !important; }';
            document.head.appendChild(s);
            const w = evt.item.offsetWidth;
            document.querySelector('.sortable-fallback')?.style.setProperty('width', w + 'px', 'important');
        },
        onEnd: () => document.getElementById('drag-cursor-style')?.remove()
    });

    reorderButton.onclick = async () => {
        if (!reorderMode) {
            reorderMode = true;
            sortableInstance.option('disabled', false);
            reorderButton.textContent = 'SAVE ORDER';
            reorderButton.classList.add('save-mode');
            resourcesContainer.classList.add('reorder-mode');
        } else {
            reorderMode = false;
            sortableInstance.option('disabled', true);
            reorderButton.textContent = 'REORDER CATEGORIES';
            reorderButton.classList.remove('save-mode');
            resourcesContainer.classList.remove('reorder-mode');
            const updates = [];
            resourcesContainer.querySelectorAll('.category').forEach((el, i) => {
                updates.push(updateDoc(doc(db, "clubs", clubId, "resourceSections", el.dataset.id), { order: i }));
            });
            await Promise.all(updates);
        }
    };
}



function openEditCategoryModal(category) {
    editingCategory = { ...category, links: category.links.map(l => ({ ...l })) };
    document.getElementById('edit-category-title-input').value = category.title;
    renderEditLinkRows();
    showOverlay();
    document.getElementById('edit-category-modal').style.display = 'flex';
}

function hideEditCategoryModal() {
    document.getElementById('edit-category-modal').style.display = 'none';
    hideOverlay();
    editingCategory = null;
}

document.getElementById('cancel-edit-category-button').addEventListener('click', hideEditCategoryModal);

function renderEditLinkRows() {
    const list = document.getElementById('edit-category-links-list');
    list.innerHTML = '';
    if (editingCategory.links.length === 0) return;

    const heading = document.createElement('span');
    heading.className = 'edit-links-heading';
    heading.textContent = 'Links';
    list.appendChild(heading);

    editingCategory.links.forEach((link, index) => {
        list.appendChild(buildLinkRow(link, index));
    });
}


function buildLinkRow(link, index) {
    const row = document.createElement('div');
    row.className = 'edit-link-row';

    /* ── top bar ── */
    const top = document.createElement('div');
    top.className = 'edit-link-row-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'edit-link-name';
    nameSpan.textContent = link.title;

    const actions = document.createElement('div');
    actions.className = 'edit-link-actions';

    /* pencil button */
    const pencilBtn = document.createElement('button');
    pencilBtn.className = 'edit-link-icon-btn';
    pencilBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    pencilBtn.title = 'Edit';

    /* trash button */
    const trashBtn = document.createElement('button');
    trashBtn.className = 'edit-link-icon-btn';
    trashBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    trashBtn.title = 'Delete';

    actions.appendChild(pencilBtn);
    actions.appendChild(trashBtn);
    top.appendChild(nameSpan);
    top.appendChild(actions);
    row.appendChild(top);

    /* ── edit panel (hidden by default) ── */
    const panel = document.createElement('div');
    panel.className = 'edit-link-panel';
    panel.style.display = 'none';

    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = link.title;

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = link.url;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'edit-link-panel-save';
    saveBtn.textContent = 'SAVE';

    panel.appendChild(titleLabel);
    panel.appendChild(titleInput);
    panel.appendChild(urlLabel);
    panel.appendChild(urlInput);
    panel.appendChild(saveBtn);
    row.appendChild(panel);

    pencilBtn.addEventListener('click', () => {
        const isOpen = panel.style.display !== 'none';
        if (isOpen) {
            panel.style.display = 'none';
        } else {
            document.querySelectorAll('.edit-link-panel').forEach(p => { p.style.display = 'none'; });
            panel.style.display = 'flex';
            panel.style.flexDirection = 'column';
            titleInput.focus();
        }
    });

    saveBtn.addEventListener('click', () => {
        const newTitle = titleInput.value.trim();
        const newUrl   = urlInput.value.trim();
        if (!newTitle || !newUrl) { showAppAlert("Both title and URL are required!"); return; }
        editingCategory.links[index].title = newTitle;
        editingCategory.links[index].url   = newUrl;
        nameSpan.textContent = newTitle;
        panel.style.display = 'none';
    });

    trashBtn.addEventListener('click', () => {
        editingCategory.links.splice(index, 1);
        renderEditLinkRows();
    });

    return row;
}

document.getElementById('save-edit-category-button').addEventListener('click', async () => {
    const newTitle = document.getElementById('edit-category-title-input').value.trim();
    if (!newTitle) { await showAppAlert("Title can't be empty!"); return; }
    try {
        await updateDoc(doc(db, "clubs", clubId, "resourceSections", editingCategory.id), {
            title: newTitle,
            links: editingCategory.links
        });
        hideEditCategoryModal();
        await fetchAndDisplayCategories();
    } catch (e) {
        await showAppAlert("Failed to save: " + e.message);
    }
});

document.getElementById('delete-category-button').addEventListener('click', async () => {
    const confirmed = await showAppConfirm(`Delete the entire "${editingCategory.title}" category?`);
    if (!confirmed) return;
    try {
        await deleteDoc(doc(db, "clubs", clubId, "resourceSections", editingCategory.id));
        hideEditCategoryModal();
        await fetchAndDisplayCategories();
    } catch (e) {
        await showAppAlert("Failed to delete: " + e.message);
    }
});



const addLinkModal = document.getElementById('add-link-modal');
let activeLinkCategoryId = null;

function openAddLinkModal(category) {
    activeLinkCategoryId = category.id;
    document.getElementById('link-title-input').value = '';
    document.getElementById('link-url-input').value   = '';
    showOverlay();
    addLinkModal.style.display = 'flex';
}

function hideAddLinkModal() {
    addLinkModal.style.display = 'none';
    hideOverlay();
    activeLinkCategoryId = null;
}

document.getElementById('cancel-link-button').addEventListener('click', hideAddLinkModal);

document.getElementById('save-link-button').addEventListener('click', async () => {
    const title = document.getElementById('link-title-input').value.trim();
    const url   = document.getElementById('link-url-input').value.trim();
    if (!title || !url) { await showAppAlert("Both a title and URL are required!"); return; }
    try {
        const sectionRef  = doc(db, "clubs", clubId, "resourceSections", activeLinkCategoryId);
        const sectionSnap = await getDoc(sectionRef);
        const existing    = sectionSnap.data().links || [];
        await updateDoc(sectionRef, { links: [...existing, { title, url }] });
        hideAddLinkModal();
        await fetchAndDisplayCategories();
    } catch (e) {
        await showAppAlert("Failed to save link: " + e.message);
    }
});



function animateCardIn(card, index = 0) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    card.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }, index * 80);
}
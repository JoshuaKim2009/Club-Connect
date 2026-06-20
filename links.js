import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
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
const db   = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

let currentUser     = null;
let clubId          = null;
let currentUserRole = null;
let categoriesCache = [];
let sortableInstance = null;
let reorderMode     = false;

const resourcesContainer    = document.getElementById('resourcesContainer');
const noResourcesMessage    = document.getElementById('noResourcesMessage');
const addCategoryButton     = document.getElementById('add-category-button');
const categoryCreationModal = document.getElementById('category-creation-modal');
const categoryOverlay       = document.getElementById('popup-overlay');

document.body.classList.add('no-scroll');

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

function showOverlay() { categoryOverlay.style.display = 'block'; document.body.classList.add('no-scroll'); }
function hideOverlay() { categoryOverlay.style.display = 'none';  document.body.classList.remove('no-scroll'); }



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
            await fetchCategoryData();
            hideLoadingScreen();
            requestAnimationFrame(() => requestAnimationFrame(() => renderAllCategories()));
        } else {
            hideLoadingScreen();
        }
    } else if (user && !clubId) {
        hideLoadingScreen();
    } else {
        hideLoadingScreen();
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



async function fetchCategoryData() {
    const snap = await getDocs(
        query(collection(db, "clubs", clubId, "resourceSections"), orderBy("createdAt", "asc"))
    );
    categoriesCache = [];
    snap.forEach((d, i) => {
        const data = d.data();
        categoriesCache.push({ id: d.id, title: data.title, links: data.links || [], order: data.order ?? i });
    });
    categoriesCache.sort((a, b) => a.order - b.order);
}

function renderAllCategories() {
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

async function fetchAndDisplayCategories() {
    await fetchCategoryData();
    renderAllCategories();
}

function hideLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    } else {
        document.body.classList.remove('no-scroll');
    }
    if (content) {
        content.style.display = 'block';
        Array.from(content.querySelectorAll(':scope > *')).forEach((item, i) => {
            const reorderButton = document.getElementById('reorder-button');

            if (item === resourcesContainer || item === addCategoryButton || item === reorderButton) {
                item.classList.add('revealed-child');
            } else {
                setTimeout(() => item.classList.add('revealed-child'), i * 200);
            }
        });
    }
}
function createCategoryElement(category) {
    const div = document.createElement('div');
    div.className = 'category';
    div.dataset.id = category.id;
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
        div.querySelector('.edit-category-button').addEventListener('click', () => {
            openEditingCard(category, div);
        });
        div.querySelector('.add-link-button').addEventListener('click', () => openAddLinkModal(category));
    }
    return div;
}



function openEditingCard(category, existingCard) {
    const editingCategory = { ...category, links: category.links.map(l => ({ ...l })) };

    const editCard = document.createElement('div');
    editCard.className = 'editing-category-card';
    editCard.dataset.id = category.id;

    const titleSection = document.createElement('div');
    titleSection.className = 'edit-card-section';

    const titleLabel = document.createElement('span');
    titleLabel.className = 'edit-card-section-label';
    titleLabel.textContent = 'Category Name';

    const titleInput = document.createElement('textarea');
    titleInput.className = 'edit-card-title-input';
    titleInput.rows = 1;
    titleInput.value = category.title;

    titleSection.appendChild(titleLabel);
    titleSection.appendChild(titleInput);
    editCard.appendChild(titleSection);

    /* ── Links section (only if there are links) ── */
    let linksSection = null;

    function buildLinksSection() {
        if (linksSection) linksSection.remove();
        if (editingCategory.links.length === 0) { linksSection = null; return; }

        linksSection = document.createElement('div');
        linksSection.className = 'edit-card-section';

        const linksLabel = document.createElement('span');
        linksLabel.className = 'edit-card-section-label';
        linksLabel.textContent = 'Links';
        linksSection.appendChild(linksLabel);

        editingCategory.links.forEach((link, index) => {
            linksSection.appendChild(buildLinkRow(link, index, editingCategory, buildLinksSection, editCard, actionsRow));
        });

        // Insert before actionsRow
        editCard.insertBefore(linksSection, actionsRow);
    }

    /* ── Bottom action row ── */
    const actionsRow = document.createElement('div');
    actionsRow.className = 'edit-card-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'fancy-button';
    saveBtn.textContent = 'SAVE';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'fancy-button';
    cancelBtn.textContent = 'CANCEL';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'edit-card-delete-btn';
    deleteBtn.textContent = 'DELETE';

    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);
    actionsRow.appendChild(deleteBtn);
    editCard.appendChild(actionsRow);

    buildLinksSection();

    saveBtn.addEventListener('click', async () => {
        const newTitle = titleInput.value.trim();
        if (!newTitle) { await showAppAlert("Title can't be empty!"); return; }

        // Commit any open panel before saving
        const openPanel = editCard.querySelector('.edit-link-panel[style*="flex"]');
        if (openPanel) {
            const idx = parseInt(openPanel.dataset.index);
            const t = openPanel.querySelector('input[data-field="title"]').value.trim();
            const u = openPanel.querySelector('input[data-field="url"]').value.trim();
            if (t) editingCategory.links[idx].title = t;
            if (u) editingCategory.links[idx].url   = u;
        }

        try {
            await updateDoc(doc(db, "clubs", clubId, "resourceSections", category.id), {
                title: newTitle,
                links: editingCategory.links
            });
            await fetchAndDisplayCategories();
        } catch (e) {
            await showAppAlert("Failed to save: " + e.message);
        }
    });

    cancelBtn.addEventListener('click', () => {
        editCard.replaceWith(existingCard);
    });

    deleteBtn.addEventListener('click', async () => {
        const confirmed = await showAppConfirm(`Delete the entire "${category.title}" category?`);
        if (!confirmed) return;
        try {
            await deleteDoc(doc(db, "clubs", clubId, "resourceSections", category.id));
            await fetchAndDisplayCategories();
        } catch (e) {
            await showAppAlert("Failed to delete: " + e.message);
        }
    });

    // Swap in
    existingCard.replaceWith(editCard);
}



function buildLinkRow(link, index, editingCategory, rebuildLinks, editCard, actionsRow) {
    const row = document.createElement('div');
    row.className = 'edit-link-row';

    /* Top: name + buttons */
    const top = document.createElement('div');
    top.className = 'edit-link-row-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'edit-link-name';
    nameSpan.textContent = link.title;

    const actions = document.createElement('div');
    actions.className = 'edit-link-actions';

    const pencilBtn = document.createElement('button');
    pencilBtn.className = 'edit-link-icon-btn';
    pencilBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    pencilBtn.title = 'Edit';

    const trashBtn = document.createElement('button');
    trashBtn.className = 'edit-link-icon-btn';
    trashBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    trashBtn.title = 'Delete';

    actions.appendChild(pencilBtn);
    actions.appendChild(trashBtn);
    top.appendChild(nameSpan);
    top.appendChild(actions);
    row.appendChild(top);

    /* Inline edit panel */
    const panel = document.createElement('div');
    panel.className = 'edit-link-panel';
    panel.dataset.index = index;
    panel.style.display = 'none';

    const tLabel = document.createElement('label');
    tLabel.textContent = 'Title';
    const tInput = document.createElement('input');
    tInput.type = 'text';
    tInput.value = link.title;
    tInput.dataset.field = 'title';

    const uLabel = document.createElement('label');
    uLabel.textContent = 'URL';
    const uInput = document.createElement('input');
    uInput.type = 'text';
    uInput.value = link.url;
    uInput.dataset.field = 'url';

    const panelSave = document.createElement('button');
    panelSave.className = 'edit-link-panel-save';
    panelSave.textContent = 'SAVE';

    panel.appendChild(tLabel);
    panel.appendChild(tInput);
    panel.appendChild(uLabel);
    panel.appendChild(uInput);
    panel.appendChild(panelSave);
    row.appendChild(panel);

    pencilBtn.addEventListener('click', () => {
        const isOpen = panel.style.display !== 'none';
        if (isOpen) {
            panel.style.display = 'none';
        } else {
            editCard.querySelectorAll('.edit-link-panel').forEach(p => { p.style.display = 'none'; });
            panel.style.display = 'flex';
            tInput.focus();
        }
    });

    panelSave.addEventListener('click', () => {
        const newTitle = tInput.value.trim();
        const newUrl   = uInput.value.trim();
        if (!newTitle || !newUrl) { showAppAlert("Both title and URL are required!"); return; }
        editingCategory.links[index].title = newTitle;
        editingCategory.links[index].url   = newUrl;
        nameSpan.textContent = newTitle;
        panel.style.display = 'none';
    });

    trashBtn.addEventListener('click', () => {
        editingCategory.links.splice(index, 1);
        rebuildLinks();
    });

    return row;
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
            resourcesContainer.querySelectorAll('.category, .editing-category-card').forEach((el, i) => {
                updates.push(updateDoc(doc(db, "clubs", clubId, "resourceSections", el.dataset.id), { order: i }));
            });
            await Promise.all(updates);
        }
    };
}


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
// school-cache-utils.js

function cacheKey(uid) {
    return `cc-school-info:${uid}`;
}

export function getSchoolInfoCache(uid) {
    if (!uid) return null;
    try {
        const raw = localStorage.getItem(cacheKey(uid));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.error("Could not read school info cache:", e);
        return null;
    }
}

export function setSchoolInfoCache(uid, { state, county, school }) {
    if (!uid) return;
    try {
        localStorage.setItem(cacheKey(uid), JSON.stringify({ state, county, school }));
    } catch (e) {
        console.error("Could not write school info cache:", e);
    }
}
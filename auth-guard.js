export function handleUserSwitch(user) {
    if (!user) {
        sessionStorage.clear();
        return false;
    }
    const lastUid = sessionStorage.getItem('lastUid');
    if (lastUid && lastUid !== user.uid) {
        sessionStorage.clear();
        sessionStorage.setItem('lastUid', user.uid);
        window.location.reload();
        return false;
    }
    sessionStorage.setItem('lastUid', user.uid);
    return true;
}
export const ROLE_LABELS = {
    manager: "President",
    admin: "Officer", 
    member: "Member"
};

export function getRoleLabel(role) {
    return ROLE_LABELS[role] || role;
}

export function getArticle(role) {
    const label = ROLE_LABELS[role] || role;
    return /^[aeiou]/i.test(label) ? 'an' : 'a';
}
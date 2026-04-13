(function() {
    const saved = localStorage.getItem('cc-theme');
    const map = {
        default: ['#131b30','#405aa0','#3498db'],
        forest:  ['#0f2318','#2d6a4f','#52b788'],
        crimson: ['#4e1818','#a53131','#f85c69'],
        slate:   ['#0f0f0f','#21213f','#9b9bc4']
    };
    const c = map[saved] || map.default;
    const r = document.documentElement;
    r.style.setProperty('--bg-dark',   c[0]);
    r.style.setProperty('--bg-accent', c[1]);
    r.style.setProperty('--bg-light',  c[2]);
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', c[0]);
})();


const THEMES = {
    default: {
        name: 'Midnight Blue',
        dark: '#131b30',
        accent: '#405aa0',
        light: '#3498db'
    },
    forest: {
        name: 'Forest',
        dark: '#0f2318',
        accent: '#2d6a4f',
        light: '#52b788'
    },
    crimson: {
        name: 'Crimson',
        dark: '#4e1818',
        accent: '#a53131',
        light: '#f85c69'
    },
    slate: {
        name: 'Slate',
        dark: '#0f0f0f',
        accent: '#21213f',
        light: '#9b9bc4'
    }
};

function applyTheme(themeKey) {
    const theme = THEMES[themeKey] || THEMES.default;
    const root = document.documentElement;
    root.style.setProperty('--bg-dark', theme.dark);
    root.style.setProperty('--bg-accent', theme.accent);
    root.style.setProperty('--bg-light', theme.light);
    const metaThemeColor = document.getElementById('theme-color-meta');
    if (metaThemeColor) metaThemeColor.setAttribute('content', theme.dark);
}

function getSavedTheme() {
    return localStorage.getItem('cc-theme') || 'default';
}

function saveTheme(themeKey) {
    localStorage.setItem('cc-theme', themeKey);
    applyTheme(themeKey);
}

applyTheme(getSavedTheme());

window.THEMES = THEMES;
window.saveTheme = saveTheme;
window.getSavedTheme = getSavedTheme;
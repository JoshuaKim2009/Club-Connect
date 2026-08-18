// tag-input.js

export function initTagInput(boxEl, options = {}) {
    const { initialTags = [] } = options;

    boxEl.innerHTML = `
        <p class="topics-caption">Add one-word tags that help describe what your club is about.</p>
        <div class="tag-row">
            <span class="ghost-pill">
                <span class="prefix">+</span>
                <input placeholder="Add topic" maxlength="20" autocomplete="off">
            </span>
        </div>
    `;

    const row = boxEl.querySelector('.tag-row');
    const pill = boxEl.querySelector('.ghost-pill');
    const input = boxEl.querySelector('input');

    let tags = [...initialTags];
    let isDisabled = false;

    function render() {
        Array.from(row.querySelectorAll('.tag-chip')).forEach(c => c.remove());
        tags.forEach((t, i) => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.textContent = '#' + t + ' ';
            const x = document.createElement('button');
            x.type = 'button';
            x.textContent = '\u00D7';
            x.setAttribute('aria-label', 'Remove ' + t);
            x.disabled = isDisabled;
            x.onclick = () => { tags.splice(i, 1); render(); };
            chip.appendChild(x);
            row.insertBefore(chip, pill);
        });
    }

    function shake() {
        pill.classList.remove('input-error');
        void pill.offsetWidth;
        pill.classList.add('input-error');
    }

    function commit() {
        const raw = input.value.trim().toLowerCase();
        if (!raw) return;
        if (tags.includes(raw)) { shake(); input.value = ''; return; }
        tags.push(raw);
        input.value = '';
        render();
    }

    input.addEventListener('input', () => {
        if (input.value.includes('#')) {
            input.value = input.value.replace(/#/g, '');
        }
        if (input.value.includes(' ')) {
            input.value = input.value.replace(/\s+/g, '');
            commit();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Backspace' && input.value === '' && tags.length) {
            tags.pop();
            render();
        }
    });

    render();

    return {
        getTags: () => [...tags],
        setTags: (newTags) => { tags = [...newTags]; render(); },
        setDisabled: (value) => {
            isDisabled = value;
            input.disabled = value;
            render();
        }
    };
}
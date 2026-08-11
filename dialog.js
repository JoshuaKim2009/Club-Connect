// A queue so showAppAlert/showAppConfirm never stack — if one is already open,
// the next call waits for it to close before mounting its own overlay.
let dialogQueue = Promise.resolve();

function enqueueDialog(showFn) {
    const run = () => showFn();
    const result = dialogQueue.then(run, run);
    dialogQueue = result.catch(() => {});
    return result;
}

/**
 * Displays a custom HTML alert dialog.
 *
 * @param {string} message The text content to display in the message box.
 * @param {string} [title='Notification'] An optional title for the message box.
 * @returns {Promise<void>} Resolves when the custom alert dialog is closed.
 */
export async function showAppAlert(message, title = 'Notification') {
    return enqueueDialog(() => new Promise(resolve => {
        const body = document.body;

        body.classList.add('no-scroll');

        // --- Create Overlay ---
        const overlay = document.createElement("div");
        overlay.className = "custom-dialog-overlay";
        body.appendChild(overlay);

        // --- Create Dialog Panel ---
        const panel = document.createElement("div");
        panel.className = "msgBox"; // Assumes your CSS for .msgBox
        body.appendChild(panel);

        // --- Title ---
        const msgTitle = document.createElement("h3");
        msgTitle.textContent = title;
        panel.appendChild(msgTitle);

        // --- Message Content ---
        const msg = document.createElement("p");
        msg.textContent = message;
        panel.appendChild(msg);

        // --- OK Button ---
        const okBtn = document.createElement("button");
        okBtn.textContent = "OK";
        okBtn.className = "fancy-button"; // Assuming your button style
        panel.appendChild(okBtn);

        // --- Close Logic ---
        const closeDialog = () => {
            if (body.contains(overlay)) body.removeChild(overlay);
            if (body.contains(panel)) body.removeChild(panel);
            okBtn.removeEventListener("click", closeDialog); // Clean up
            body.classList.remove('no-scroll');
            resolve(); // Resolve the promise when dialog is closed
        };

        okBtn.addEventListener("click", closeDialog);

        panel.style.display = 'flex';
        overlay.style.display = 'block';
    }));
}

// This function creates and manages your custom HTML confirm dialog
/**
 * Displays a custom HTML confirm dialog.
 *
 * @param {string} message The text content to display in the message box.
 * @param {string} [title='Confirm Action'] An optional title for the message box.
 * @returns {Promise<boolean>} Resolves with `true` if OK, `false` if Cancel.
 */
export async function showAppConfirm(message, title = 'Confirm Action') {
    return enqueueDialog(() => new Promise(resolve => {
        const body = document.body;

        body.classList.add('no-scroll');

        // --- Create Overlay ---
        const overlay = document.createElement("div");
        overlay.className = "custom-dialog-overlay";
        body.appendChild(overlay);

        // --- Create Dialog Panel ---
        const panel = document.createElement("div");
        panel.className = "msgBox"; 
        body.appendChild(panel);

        // --- Title ---
        const msgTitle = document.createElement("h3");
        msgTitle.textContent = title;
        panel.appendChild(msgTitle);

        // --- Message Content ---
        const msg = document.createElement("p");
        msg.textContent = message;
        panel.appendChild(msg);

        // --- Yes/No Buttons ---
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '15px'; // Adjust gap between buttons
        buttonContainer.style.marginTop = '20px'; // Space above buttons
        
        const yesBtn = document.createElement("button");
        yesBtn.textContent = "Yes";
        yesBtn.className = "fancy-button"; 
        buttonContainer.appendChild(yesBtn);

        const noBtn = document.createElement("button");
        noBtn.textContent = "No";
        noBtn.className = "fancy-button"; 
        buttonContainer.appendChild(noBtn);

        panel.appendChild(buttonContainer);

        // --- Close Logic ---
        const closeDialog = (result) => {
            if (body.contains(overlay)) body.removeChild(overlay);
            if (body.contains(panel)) body.removeChild(panel);
            yesBtn.removeEventListener("click", handleYes); 
            noBtn.removeEventListener("click", handleNo);
            body.classList.remove('no-scroll');
            resolve(result); 
        };

        const handleYes = () => closeDialog(true);
        const handleNo = () => closeDialog(false);

        yesBtn.addEventListener("click", handleYes);
        noBtn.addEventListener("click", handleNo);

        panel.style.display = 'flex';
        overlay.style.display = 'block';
    }));
}
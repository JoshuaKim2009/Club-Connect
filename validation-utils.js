// validation_utils.js
import { showAppAlert } from './dialog.js';

export async function validateRequiredFields(fields) {
    const missing = fields.filter(f => !f.value).map(f => f.label);

    if (missing.length === 0) return true;

    if (missing.length === 1) {
        await showAppAlert(`Please fill in the "${missing[0]}" field.`);
    } else {
        await showAppAlert("Please fill in all details.");
    }

    return false;
}
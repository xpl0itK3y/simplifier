document.addEventListener('DOMContentLoaded', () => {
    // 0. Auth Guard: Check if user is logged in
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
            alert("Доступ запрещен. Пожалуйста, войдите в систему через расширение.");
            window.close(); // Close the settings tab
            return;
        }

        // Continue with loading settings if authorized
        initSettingsUI();
    });
});

function initSettingsUI() {
    const autoScroll = document.getElementById('auto-scroll');
    const defaultMode = document.getElementById('default-mode');
    const saveBtn = document.getElementById('save-btn');
    const statusMsg = document.getElementById('status-msg');

    // Load existing settings (only if elements exist)
    chrome.storage.local.get(['autoScroll', 'defaultMode'], (result) => {
        if (autoScroll && result.autoScroll !== undefined) {
            autoScroll.checked = result.autoScroll;
        }
        if (defaultMode && result.defaultMode) {
            defaultMode.value = result.defaultMode;
        }
    });

    // Save functionality
    if (saveBtn) {
        saveBtn.onclick = () => {
            chrome.storage.local.set({
                autoScroll: autoScroll ? autoScroll.checked : true,
                defaultMode: defaultMode ? defaultMode.value : 'simple'
            }, () => {
                if (statusMsg) {
                    statusMsg.textContent = 'Настройки сохранены!';
                    setTimeout(() => {
                        statusMsg.textContent = '';
                    }, 3000);
                }
            });
        };
    }
}

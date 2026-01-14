// Background Service Worker

// Load translations
let translations = null;

async function loadTranslations() {
    if (translations) return translations;
    try {
        const url = chrome.runtime.getURL('translations.json');
        const response = await fetch(url);
        translations = await response.json();
    } catch (e) {
        console.error("Failed to load translations:", e);
    }
    return translations;
}

function getTranslation(key, lang) {
    if (!translations) return "Упростить: \"%s\""; // Default fallback
    const langData = translations[lang] || translations['ru'];
    return langData[key] || translations['ru'][key] || key;
}

async function updateContextMenu() {
    await loadTranslations();
    chrome.storage.local.get('language', (data) => {
        const lang = data.language || 'ru';
        const title = getTranslation('context.simplify', lang);

        // Update existing item
        chrome.contextMenus.update('simplify-text', {
            title: title
        }, () => {
            if (chrome.runtime.lastError) {
                // If item doesn't exist (should not happen if installed), ignore
                console.log("Menu item update error (might not exist yet):", chrome.runtime.lastError);
            }
        });
    });
}

// Initialize Context Menu
chrome.runtime.onInstalled.addListener(async () => {
    await loadTranslations();
    chrome.storage.local.get('language', (data) => {
        const lang = data.language || 'ru';

        chrome.contextMenus.create({
            id: "simplify-text",
            title: getTranslation('context.simplify', lang),
            contexts: ["selection"]
        });
    });
});

// Listen for language changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.language) {
        updateContextMenu();
    }
});

// Handle Context Menu Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "simplify-text" && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
            action: "OPEN_MODAL_FROM_CONTEXT",
            text: info.selectionText
        }).catch(err => console.error("Could not send message to tab:", err));
    }
});

// Handle API calls from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'CHECK_AUTH') {
        chrome.identity.getAuthToken({ interactive: false }, async (token) => {
            if (chrome.runtime.lastError || !token) {
                sendResponse({ isAuthenticated: false });
            } else {
                try {
                    const response = await fetch('http://127.0.0.1:8000/me', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                        const profile = await response.json();
                        // Cache the plan for instant UI updates
                        chrome.storage.local.set({ 'user_plan': profile.plan_id });

                        sendResponse({
                            isAuthenticated: true,
                            plan_id: profile.plan_id
                        });
                    } else {
                        chrome.storage.local.remove('user_plan');
                        sendResponse({ isAuthenticated: false });
                    }
                } catch (e) {
                    chrome.storage.local.remove('user_plan');
                    sendResponse({ isAuthenticated: false });
                }
            }
        });
        return true;
    }

    if (request.action === 'SIMPLIFY_TEXT') {
        const { text, mode, url } = request;
        handleStreamingSimplification({ text, mode, url }, sender.tab.id);
        sendResponse({ status: 'started' });
        return true;
    }

    if (request.action === 'OPEN_SETTINGS') {
        const url = chrome.runtime.getURL('settings/settings.html#tab-subscriptions');
        chrome.tabs.create({ url: url });
        return true;
    }
});

// Helper to get Google Token with retry
async function getAuthToken(forceRefresh = false) {
    return new Promise((resolve, reject) => {
        if (forceRefresh) {
            // First get old token to remove it
            chrome.identity.getAuthToken({ interactive: false }, (oldToken) => {
                if (oldToken) {
                    chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
                        // Now get fresh token
                        chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(newToken);
                            }
                        });
                    });
                } else {
                    // No old token, just get new one
                    chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(newToken);
                        }
                    });
                }
            });
        } else {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(token);
                }
            });
        }
    });
}

// Helper function to send message to tab safely
async function sendMessageToTab(tabId, message) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
            throw new Error('Tab does not exist');
        }
        await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
        console.log('Could not send message to tab:', error.message);
    }
}

async function isLanguageSet() {
    return new Promise((resolve) => {
        chrome.storage.local.get('language', (data) => {
            resolve(data.language || 'ru');
        });
    });
}

async function handleStreamingSimplification({ text, mode, url }, tabId, retryCount = 0) {
    try {
        // 1. Get Token
        const token = await getAuthToken(retryCount > 0).catch(err => {
            throw new Error("AUTH_REQUIRED");
        });

        const language = await isLanguageSet(); // Helper to get lang

        const response = await fetch('http://127.0.0.1:8000/simplify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Extension-Id': chrome.runtime.id
            },
            body: JSON.stringify({
                text: text,
                mode: mode,
                url: url,
                language: language
            })
        });

        if (!response.ok) {
            let errorText = "Ошибка сервера";
            try {
                const errorData = await response.json();
                errorText = errorData.detail || errorText;
            } catch (e) {
                const rawText = await response.text();
                errorText = rawText || errorText;
            }

            if (response.status === 402) {
                throw new Error("CREDITS_EXHAUSTED:" + errorText);
            }
            if (response.status === 401 && retryCount === 0) {
                // Token expired, retry once with fresh token
                console.log('Token expired, retrying with fresh token...');
                return await handleStreamingSimplification({ text, mode, url }, tabId, 1);
            }
            throw new Error(errorText);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        // Signal start
        await sendMessageToTab(tabId, { action: 'STREAM_START' });

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            await sendMessageToTab(tabId, {
                action: 'STREAM_CHUNK',
                chunk: chunk
            });
        }

        // Signal end
        await sendMessageToTab(tabId, { action: 'STREAM_COMPLETE' });

    } catch (error) {
        console.error('Simplification error:', error);

        // Send specific error codes to UI
        let userMessage = error.message || 'Ошибка подключения.';
        let errorCode = null;

        if (error.message === 'AUTH_REQUIRED') {
            errorCode = 'LOGIN_REQUIRED';
            userMessage = 'LOGIN_REQUIRED';
        } else if (error.message.startsWith('CREDITS_EXHAUSTED:')) {
            errorCode = 'CREDITS_EXHAUSTED';
            userMessage = error.message.split('CREDITS_EXHAUSTED:')[1];
        }

        await sendMessageToTab(tabId, {
            action: 'STREAM_ERROR',
            error: userMessage,
            errorCode: errorCode
        });
    }
}
// Background Service Worker

// Initialize Context Menu
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "simplify-text",
        title: "Упростить: \"%s\"",
        contexts: ["selection"]
    });
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
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError) {
                sendResponse({ isAuthenticated: false });
            } else {
                sendResponse({ isAuthenticated: !!token });
            }
        });
        return true;
    }

    if (request.action === 'SIMPLIFY_TEXT') {
        handleStreamingSimplification(request, sender.tab.id);
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

async function handleStreamingSimplification({ text, mode }, tabId, retryCount = 0) {
    try {
        // 1. Get Token
        const token = await getAuthToken(retryCount > 0).catch(err => {
            throw new Error("AUTH_REQUIRED");
        });

        const response = await fetch('http://127.0.0.1:8000/simplify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Extension-Id': chrome.runtime.id
            },
            body: JSON.stringify({
                text: text,
                mode: mode
            })
        });

        if (!response.ok) {
            if (response.status === 402) {
                throw new Error("CREDITS_EXHAUSTED");
            }
            if (response.status === 401 && retryCount === 0) {
                // Token expired, retry once with fresh token
                console.log('Token expired, retrying with fresh token...');
                return await handleStreamingSimplification({ text, mode }, tabId, 1);
            }
            if (response.status === 429) {
                throw new Error("Слишком быстро! Подождите пару секунд.");
            }

            const errText = await response.text();
            throw new Error(`Server Error: ${response.status} - ${errText}`);
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
        let userMessage = 'Ошибка подключения.';
        if (error.message === 'AUTH_REQUIRED') {
            userMessage = 'LOGIN_REQUIRED';
        } else if (error.message === 'CREDITS_EXHAUSTED') {
            userMessage = 'CREDITS_EXHAUSTED';
        } else {
            userMessage = error.message;
        }

        await sendMessageToTab(tabId, {
            action: 'STREAM_ERROR',
            error: userMessage
        });
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const serverStatus = document.getElementById('server-status');
    const serverDot = document.getElementById('server-dot');

    const loggedOutView = document.getElementById('logged-out-view');
    const loggedInView = document.getElementById('logged-in-view');
    const userEmailSpan = document.getElementById('user-email');

    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // 1. Check Backend Health
    try {
        const response = await fetch('http://127.0.0.1:8000/health');
        if (response.ok) {
            serverStatus.textContent = 'Backend is running';
            serverDot.className = 'status-dot online';
        } else {
            throw new Error();
        }
    } catch (e) {
        serverStatus.textContent = 'Backend is offline';
        serverDot.className = 'status-dot offline';
    }

    // 2. Check Login Status
    checkAuthStatus();

    // Login Handler
    loginBtn.onclick = () => {
        setLoading(loginBtn, true);
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            setLoading(loginBtn, false);
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                return;
            }
            // Success
            checkAuthStatus();
        });
    };

    // Logout Handler
    logoutBtn.onclick = () => {
        setLoading(logoutBtn, true);
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (token) {
                // 1. Revoke Token on Google Server (Optional, but good for security)
                const revokeUrl = 'https://accounts.google.com/o/oauth2/revoke?token=' + token;
                window.fetch(revokeUrl)
                    .finally(() => {
                        // 2. Remove from Chrome Cache
                        chrome.identity.removeCachedAuthToken({ token: token }, () => {
                            // 3. Update UI
                            checkAuthStatus();
                            setLoading(logoutBtn, false);
                        });
                    });
            } else {
                checkAuthStatus();
                setLoading(logoutBtn, false);
            }
        });
    };

    function setLoading(btn, isLoading) {
        if (isLoading) {
            btn.classList.add('loading');
        } else {
            btn.classList.remove('loading');
        }
    }

    function checkAuthStatus() {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError || !token) {
                // Logged Out
                loggedOutView.classList.remove('hidden');
                loggedInView.classList.add('hidden');
            } else {
                // Logged In
                loggedOutView.classList.add('hidden');
                loggedInView.classList.remove('hidden');

                // Optional: Get Profile Info (requires UserInfo scope)
                fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.email) userEmailSpan.textContent = data.email;
                    })
                    .catch(() => userEmailSpan.textContent = 'User');
            }
        });
    }
});

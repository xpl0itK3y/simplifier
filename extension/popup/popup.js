document.addEventListener("DOMContentLoaded", async () => {
  const serverStatus = document.getElementById("server-status");
  const serverDot = document.getElementById("server-dot");

  const loggedOutView = document.getElementById("logged-out-view");
  const loggedInView = document.getElementById("logged-in-view");

  const userNameEl = document.getElementById("user-name");
  const userEmailEl = document.getElementById("user-email");
  const userAvatarEl = document.getElementById("user-avatar");

  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const settingsBtn = document.getElementById("settings-btn");

  // Navigation to settings
  settingsBtn.onclick = () => {
    if (settingsBtn.classList.contains("disabled")) return;
    chrome.tabs.create({
      url: chrome.runtime.getURL("settings/settings.html"),
    });
  };

  // Check Backend Health
  checkBackendHealth();

  // Check Login Status
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
      checkAuthStatus();
    });
  };

  // Logout Handler
  logoutBtn.onclick = () => {
    setLoading(logoutBtn, true);
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        const revokeUrl =
          "https://accounts.google.com/o/oauth2/revoke?token=" + token;
        fetch(revokeUrl).finally(() => {
          chrome.identity.removeCachedAuthToken({ token: token }, () => {
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

  // Check backend health
  async function checkBackendHealth() {
    try {
      const response = await fetch("http://127.0.0.1:8000/health");
      if (response.ok) {
        serverStatus.textContent = "Backend готов";
        serverDot.className = "dot online";
      } else {
        throw new Error();
      }
    } catch (e) {
      serverStatus.textContent = "Backend offline";
      serverDot.className = "dot offline";
    }
  }

  // Set loading state
  function setLoading(btn, isLoading) {
    if (isLoading) {
      btn.classList.add("loading");
    } else {
      btn.classList.remove("loading");
    }
  }


  // Load subscription info from backend
  async function loadSubscriptionData(token) {
    const planNameEl = document.getElementById("plan-name");
    const requestsRemainingEl = document.getElementById("requests-remaining");

    try {
      const response = await fetch("http://127.0.0.1:8000/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Extension-ID": chrome.runtime.id,
        },
      });

      if (response.ok) {
        const sub = await response.json();
        if (planNameEl) planNameEl.textContent = sub.plan_name;
        if (requestsRemainingEl) {
          const remaining = sub.max_requests - sub.requests_used;
          requestsRemainingEl.textContent = remaining;
        }
      }
    } catch (e) {
      console.error("Failed to load subscription info:", e);
    }
  }

  // Check authentication status
  function checkAuthStatus() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        // Logged Out
        loggedOutView.classList.remove("hidden");
        loggedInView.classList.add("hidden");
        settingsBtn.classList.add("disabled");
      } else {
        // Logged In
        loggedOutView.classList.add("hidden");
        loggedInView.classList.remove("hidden");
        settingsBtn.classList.remove("disabled");

        // Load subscription data
        loadSubscriptionData(token);

        // Get Profile Info
        fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.name) {
              userNameEl.textContent = data.name;
            } else {
              userNameEl.textContent = "Пользователь";
            }

            if (data.email) {
              userEmailEl.textContent = data.email;
            } else {
              userEmailEl.textContent = "";
            }

            if (data.picture) {
              userAvatarEl.src = data.picture;
            } else {
              // Fallback avatar with first letter
              const firstLetter = data.name ? data.name[0].toUpperCase() : "?";
              userAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstLetter)}&background=667eea&color=fff&size=96`;
            }
          })
          .catch(() => {
            userNameEl.textContent = "Пользователь";
            userEmailEl.textContent = "";
            userAvatarEl.src =
              "https://ui-avatars.com/api/?name=?&background=667eea&color=fff&size=96";
          });
      }
    });
  }
});

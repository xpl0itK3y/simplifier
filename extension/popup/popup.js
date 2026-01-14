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

  // Initialize language
  const lang = await window.i18n.getCurrentLang();
  window.i18n.setCachedLang(lang);
  window.i18n.applyI18n(document);

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
    const t = window.i18n.t;
    try {
      const response = await fetch("http://127.0.0.1:8000/health");
      if (response.ok) {
        serverStatus.textContent = t('popup.server_ready');
        serverDot.className = "dot online";
      } else {
        throw new Error();
      }
    } catch (e) {
      serverStatus.textContent = t('popup.server_offline');
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
        const subData = {
          plan_name: sub.plan_name,
          plan_id: sub.plan_id, // Ensure we store plan_id
          requests_remaining: sub.max_requests - sub.requests_used
        };

        // Cache for next time
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ lastSubscriptionData: subData });
        }

        // Update UI
        updateSubscriptionUI(subData);
      }
    } catch (e) {
      console.error("Failed to load subscription info:", e);
    }
  }

  function updateSubscriptionUI(data) {
    if (!data) return;
    const planNameEl = document.getElementById("plan-name");
    const requestsRemainingEl = document.getElementById("requests-remaining");

    if (planNameEl) {
      if (data.plan_id) {
        const planKey = 'subs.' + (data.plan_id === 'go_pro_plus' ? 'go_pro' : data.plan_id);
        const planName = window.i18n.t(planKey) !== planKey ? window.i18n.t(planKey) : data.plan_name;
        planNameEl.textContent = planName;
      } else {
        planNameEl.textContent = data.plan_name;
      }
    }

    if (requestsRemainingEl) requestsRemainingEl.textContent = data.requests_remaining;
  }

  function updateProfileUI(data) {
    if (!data) return;
    if (data.name) userNameEl.textContent = data.name;
    if (data.email) userEmailEl.textContent = data.email;
    if (data.picture) userAvatarEl.src = data.picture;
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

        // 1. Try to load from cache FIRST for instant UI
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(["lastSubscriptionData", "lastProfileData"], (result) => {
            if (result.lastSubscriptionData) {
              updateSubscriptionUI(result.lastSubscriptionData);
            }
            if (result.lastProfileData) {
              updateProfileUI(result.lastProfileData);
            }
          });
        } else {
          console.warn("chrome.storage.local is undefined. Please reload the extension in chrome://extensions");
        }

        // 2. Load fresh subscription data
        loadSubscriptionData(token);

        // 3. Get fresh Profile Info
        fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then((data) => {
            const defaultName = window.i18n.t('popup.user');
            const profileData = {
              name: data.name || defaultName,
              email: data.email || "",
              picture: data.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name || "?")}&background=667eea&color=fff&size=96`
            };

            // Cache for next time
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ lastProfileData: profileData });
            }

            // Update UI
            updateProfileUI(profileData);
          })
          .catch(() => {
            // Only update if no cached data
            if (userNameEl.textContent === window.i18n.t('account.loading') || userNameEl.textContent === "Загрузка...") {
              userNameEl.textContent = window.i18n.t('popup.user');
              userEmailEl.textContent = "";
              userAvatarEl.src = "https://ui-avatars.com/api/?name=?&background=667eea&color=fff&size=96";
            }
          });
      }
    });
  }
});

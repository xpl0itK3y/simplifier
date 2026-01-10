document.addEventListener("DOMContentLoaded", () => {
  console.log("Settings page loaded");

  // Initialize navigation first
  initNavigation();

  // Handle deep linking via hash (e.g., #tab-subscriptions)
  if (location.hash) {
    const tabName = location.hash.replace("#tab-", "");
    const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (navItem) {
      navItem.click();
    }
  }

  // Then check auth
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (chrome.runtime.lastError || !token) {
      alert("Доступ запрещен. Пожалуйста, войдите в систему через расширение.");
      window.close();
      return;
    }

    console.log("User authenticated");
    loadUserData(token);
    initSettings();

    // Запускаем периодическую проверку авторизации
    startAuthCheck();
  });
});

// Периодическая проверка авторизации
function startAuthCheck() {
  // Функция проверки
  function checkAuth() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        // Пользователь вышел - закрываем страницу настроек
        alert("Сессия завершена. Страница настроек будет закрыта.");
        window.close();
      }
    });
  }

  // Проверка каждые 2 секунды
  setInterval(checkAuth, 2000);

  // Проверка при возврате на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAuth();
    }
  });
}

// Navigation between tabs
function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item:not(.nav-logout)");
  const indicator = document.querySelector(".nav-indicator");

  function moveIndicator(element) {
    if (!element || !indicator) return;
    indicator.style.top = element.offsetTop + "px";
    indicator.style.height = element.offsetHeight + "px";
  }

  navItems.forEach((item) => {
    item.addEventListener("click", function () {
      const tabId = this.getAttribute("data-tab");

      // Handle logout separately
      if (tabId === "logout") {
        handleLogout();
        return;
      }

      // Remove active from all nav items
      document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));

      // Remove active from all tabs
      document.querySelectorAll(".content-tab").forEach((tab) => {
        tab.classList.remove("active");
      });

      // Set active nav item
      this.classList.add("active");
      moveIndicator(this);

      // Show selected tab
      const targetTab = document.getElementById("tab-" + tabId);
      if (targetTab) {
        targetTab.classList.add("active");
        console.log("Switched to tab:", tabId);
      }
    });
  });

  // Initial position
  const activeItem = document.querySelector(".nav-item.active");
  if (activeItem) {
    // Small delay to ensure styles are applied
    setTimeout(() => moveIndicator(activeItem), 50);
  }

  // Handle window resize to keep indicator in place
  window.addEventListener('resize', () => {
    const currentActive = document.querySelector(".nav-item.active");
    if (currentActive) moveIndicator(currentActive);
  });

  console.log("Navigation initialized");
}

// Update User Profile UI
function updateProfileUI(data) {
  if (!data) return;
  if (data.email) {
    document.getElementById("user-email").textContent = data.email;
  }
}

// Load user profile
async function loadUserData(token) {
  // 1. Check cache first
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("lastProfileData", (result) => {
      if (result.lastProfileData) {
        updateProfileUI(result.lastProfileData);
      }
    });
  }

  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.email) {
      const profileData = { email: data.email };
      updateProfileUI(profileData);

      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ lastProfileData: profileData });
      }
    }
  } catch (e) {
    console.warn("Failed to refresh user profile:", e);
  }

  loadSubscriptionData(token);
}

// Update Subscription UI
function updateSubscriptionUI(sub) {
  if (!sub) return;

  const statusBadge = document.getElementById("subscription-status");
  const requestsUsed = document.getElementById("requests-used");
  const requestsLimit = document.getElementById("requests-limit");
  const progressFill = document.getElementById("progress-fill");

  if (statusBadge) {
    statusBadge.textContent = sub.plan_name;
    statusBadge.className =
      sub.plan_id === "free" ? "badge badge-free" : "badge badge-premium";
  }

  if (requestsUsed) requestsUsed.textContent = sub.requests_used;
  if (requestsLimit) requestsLimit.textContent = sub.max_requests;

  if (progressFill) {
    const percentage = (sub.requests_used / sub.max_requests) * 100;
    progressFill.style.width = percentage + "%";
  }

  // Lock/Unlock AI settings
  const locks = document.querySelectorAll(".premium-lock");
  if (sub.ai_settings_enabled) {
    locks.forEach((lock) => lock.classList.add("hidden"));
  } else {
    locks.forEach((lock) => lock.classList.remove("hidden"));
  }

  // Update plan cards (current plan UI)
  updatePlanCardsUI(sub.plan_id);
}

// Load subscription data from backend
async function loadSubscriptionData(token) {
  // 1. Check cache first
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("lastSubscriptionData", (result) => {
      if (result.lastSubscriptionData) {
        updateSubscriptionUI(result.lastSubscriptionData);
      }
    });
  }

  try {
    const res = await fetch("http://127.0.0.1:8000/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Extension-ID": chrome.runtime.id,
      },
    });
    const sub = await res.json();

    // Update UI and Cache
    updateSubscriptionUI(sub);

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lastSubscriptionData: sub });
    }

  } catch (e) {
    console.error("Failed to load subscription data:", e);
  }
}

function updatePlanCardsUI(currentPlanId) {
  const allPlanCards = document.querySelectorAll(".plan-card");

  allPlanCards.forEach(card => {
    const btn = card.querySelector(".btn-plan");
    const planId = card.getAttribute("data-plan") || card.id.replace("plan-", "");

    if (planId === currentPlanId) {
      btn.textContent = "Текущий план";
      btn.classList.add("current");
      btn.classList.remove("upgrade");
      btn.disabled = true;
    } else {
      btn.classList.remove("current");
      btn.classList.add("upgrade");
      btn.disabled = false;

      // Keep original text if it was set, or default to generic upgrade
      if (planId === 'free') {
        btn.textContent = "Базовый план";
      } else {
        // Find if button already has specific text from HTML
        const originalText = btn.getAttribute("data-original-text") || btn.textContent.trim();
        if (!btn.getAttribute("data-original-text")) {
          btn.setAttribute("data-original-text", originalText);
        }
        btn.textContent = originalText;
      }
    }
  });
}

// Update AI Settings UI
function updateAISettingsUI(settings) {
  if (!settings) return;
  const simpleLevel = document.getElementById("simple-level");
  const shortLevel = document.getElementById("short-level");
  const pointsCount = document.getElementById("points-count");
  const examplesCount = document.getElementById("examples-count");

  if (simpleLevel) simpleLevel.value = settings.simple_level || 5;
  if (shortLevel) shortLevel.value = settings.short_level || 5;
  if (pointsCount) pointsCount.value = settings.points_count || 5;
  if (examplesCount) examplesCount.value = settings.examples_count || 2;
}

// Initialize settings handlers
function initSettings() {
  // Load AI settings from backend
  chrome.identity.getAuthToken({ interactive: false }, async (token) => {
    if (!token) return;

    // 1. Check cache first
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get("lastAISettings", (result) => {
        if (result.lastAISettings) {
          updateAISettingsUI(result.lastAISettings);
        }
      });
    }

    try {
      const res = await fetch("http://127.0.0.1:8000/settings", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Extension-ID": chrome.runtime.id
        }
      });
      if (res.ok) {
        const settings = await res.json();
        updateAISettingsUI(settings);

        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ lastAISettings: settings });
        }
      }
    } catch (e) {
      console.error("Failed to load AI settings:", e);
    }
  });

  // Apply AI settings
  document.getElementById("apply-ai-settings").onclick = () => {
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (!token) {
        alert("Пожалуйста, авторизуйтесь");
        return;
      }

      const settings = {
        simple_level: parseInt(document.getElementById("simple-level").value),
        short_level: parseInt(document.getElementById("short-level").value),
        points_count: parseInt(document.getElementById("points-count").value),
        examples_count: parseInt(document.getElementById("examples-count").value),
      };

      const msg = document.getElementById("ai-status-msg");
      msg.textContent = "Сохранение...";

      try {
        const res = await fetch("http://127.0.0.1:8000/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Extension-ID": chrome.runtime.id
          },
          body: JSON.stringify(settings)
        });

        if (res.ok) {
          msg.textContent = "Настройки сохранены!";
          msg.style.color = "#4caf50";

          // Update cache
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ lastAISettings: settings });
          }
        } else if (res.status === 403) {
          msg.textContent = "Требуется подписка GO";
          msg.style.color = "#f44336";
        } else {
          msg.textContent = "Ошибка сохранения";
          msg.style.color = "#f44336";
        }
      } catch (e) {
        msg.textContent = "Ошибка сети";
        msg.style.color = "#f44336";
      }

      setTimeout(() => (msg.textContent = ""), 3000);
    });
  };

  // Feedback button
  document.getElementById("feedback-btn").onclick = () => {
    window.open(
      "mailto:support@textsimplifier.com?subject=Обратная связь",
      "_blank",
    );
  };

  // Universal Upgrade Button Handler
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-plan.upgrade');
    if (!btn) return;

    const planId = btn.getAttribute('data-plan');
    if (!planId) return;

    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (!token) {
        alert("Пожалуйста, авторизуйтесь");
        return;
      }

      try {
        const res = await fetch("http://127.0.0.1:8000/upgrade", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Extension-ID": chrome.runtime.id
          },
          body: JSON.stringify({ plan_id: planId })
        });

        if (res.ok) {
          alert(`Поздравляем! Вы успешно перешли на новый план.`);
          loadSubscriptionData(token); // Refresh UI
        } else {
          alert("Ошибка при обновлении плана.");
        }
      } catch (e) {
        console.error("Upgrade failed:", e);
      }
    });
  });
}

// Handle logout
function handleLogout() {
  if (confirm("Вы уверены, что хотите выйти?")) {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        const revokeUrl =
          "https://accounts.google.com/o/oauth2/revoke?token=" + token;
        fetch(revokeUrl).finally(() => {
          chrome.identity.removeCachedAuthToken({ token: token }, () => {
            alert("Вы вышли из аккаунта");
            window.close();
          });
        });
      } else {
        window.close();
      }
    });
  }
}

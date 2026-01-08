document.addEventListener("DOMContentLoaded", () => {
  console.log("Settings page loaded");

  // Initialize navigation first
  initNavigation();

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
  const navItems = document.querySelectorAll(".nav-item");

  navItems.forEach((item) => {
    item.addEventListener("click", function () {
      const tabId = this.getAttribute("data-tab");

      // Handle logout
      if (tabId === "logout") {
        handleLogout();
        return;
      }

      // Remove active from all nav items
      navItems.forEach((nav) => nav.classList.remove("active"));

      // Remove active from all tabs
      document.querySelectorAll(".content-tab").forEach((tab) => {
        tab.classList.remove("active");
      });

      // Set active nav item
      this.classList.add("active");

      // Show selected tab
      const targetTab = document.getElementById("tab-" + tabId);
      if (targetTab) {
        targetTab.classList.add("active");
        console.log("Switched to tab:", tabId);
      }
    });
  });

  console.log("Navigation initialized");
}

// Load user profile
async function loadUserData(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.email) {
      document.getElementById("user-email").textContent = data.email;
    }
  } catch (e) {
    document.getElementById("user-email").textContent = "Не удалось загрузить";
  }

  loadSubscriptionData(token);
}

// Load subscription data from backend
async function loadSubscriptionData(token) {
  try {
    const res = await fetch("http://127.0.0.1:8000/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Extension-ID": chrome.runtime.id,
      },
    });
    const sub = await res.json();

    const statusBadge = document.getElementById("subscription-status");
    const requestsUsed = document.getElementById("requests-used");
    const requestsLimit = document.getElementById("requests-limit");
    const progressFill = document.getElementById("progress-fill");

    statusBadge.textContent = sub.plan_name;
    statusBadge.className =
      sub.plan_id === "free" ? "badge badge-free" : "badge badge-premium";

    const used = sub.requests_used;
    requestsUsed.textContent = used;
    requestsLimit.textContent = sub.max_requests;

    const percentage = (used / sub.max_requests) * 100;
    progressFill.style.width = percentage + "%";

    // Lock/Unlock AI settings
    const locks = document.querySelectorAll(".premium-lock");
    if (sub.ai_settings_enabled) {
      locks.forEach((lock) => lock.classList.add("hidden"));
    } else {
      locks.forEach((lock) => lock.classList.remove("hidden"));
    }

    // Update plan cards (current plan UI)
    updatePlanCardsUI(sub.plan_id);

  } catch (e) {
    console.error("Failed to load subscription data:", e);
  }
}

function updatePlanCardsUI(currentPlanId) {
  const planFree = document.getElementById("plan-free");
  const planGo = document.getElementById("plan-go");

  if (currentPlanId === 'free') {
    planFree.querySelector(".btn-plan").textContent = "Текущий план";
    planFree.querySelector(".btn-plan").classList.add("current");

    const upgradeBtn = planGo.querySelector(".btn-plan");
    upgradeBtn.textContent = "Подключить GO";
    upgradeBtn.classList.remove("current");
    upgradeBtn.classList.add("upgrade");
  } else {
    planFree.querySelector(".btn-plan").textContent = "Базовый план";
    planFree.querySelector(".btn-plan").classList.remove("current");

    planGo.querySelector(".btn-plan").textContent = "Текущий план";
    planGo.querySelector(".btn-plan").classList.remove("upgrade");
    planGo.querySelector(".btn-plan").classList.add("current");
  }
}

// Initialize settings handlers
function initSettings() {
  // Load AI settings from backend
  chrome.identity.getAuthToken({ interactive: false }, async (token) => {
    if (!token) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/settings", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Extension-ID": chrome.runtime.id
        }
      });
      if (res.ok) {
        const settings = await res.json();
        document.getElementById("simple-level").value = settings.simple_level || 5;
        document.getElementById("short-level").value = settings.short_level || 5;
        document.getElementById("points-count").value = settings.points_count || 5;
        document.getElementById("examples-count").value = settings.examples_count || 2;
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

  // Donate button
  document.getElementById("donate-btn").onclick = () => {
    window.open("https://www.buymeacoffee.com/yourusername", "_blank");
  };

  // Upgrade button (Mock implementation)
  document.getElementById("upgrade-btn").onclick = async () => {
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (!token) return;

      try {
        const res = await fetch("http://127.0.0.1:8000/upgrade", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Extension-ID": chrome.runtime.id
          },
          body: JSON.stringify({ plan_id: "go" })
        });

        if (res.ok) {
          alert("Поздравляем! Вы успешно перешли на план GO");
          loadSubscriptionData(token); // Refresh UI
        } else {
          alert("Ошибка при обновлении плана.");
        }
      } catch (e) {
        console.error("Upgrade failed:", e);
      }
    });
  };
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

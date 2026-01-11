document.addEventListener("DOMContentLoaded", () => {
  console.log("Settings page loaded");

  window.currentHistory = []; // Global store for delegation

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
    initHistoryModal();

    // Запускаем периодическую проверку авторизации
    startAuthCheck();
  });
});

// Периодическая проверка данных (авторизация + лимиты)
function startAuthCheck() {
  function refreshData() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        // Пользователь вышел - закрываем страницу настроек
        console.log("Auth lost, closing settings");
        window.close();
        return;
      }

      // Обновляем данные о подписке, если вкладка активна
      if (document.visibilityState === 'visible') {
        loadSubscriptionData(token);
      }
    });
  }

  // Проверка каждые 5 секунд
  setInterval(refreshData, 5000);

  // Проверка при возврате на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshData();
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

        // Load history data when switching to history tab
        if (tabId === "history") {
          chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (token) loadHistory(token);
          });
        }
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

  // Fix for CSP: history locking button
  const upgradeBtn = document.getElementById('upgrade-plan-history-btn');
  if (upgradeBtn) {
    upgradeBtn.onclick = () => {
      const subTab = document.querySelector('.nav-item[data-tab="subscriptions"]');
      if (subTab) subTab.click();
    };
  }

  // Handle source link clicks for highlighting feature
  document.addEventListener('click', (e) => {
    const sourceLink = e.target.closest('.source-cell a, #detail-source');
    if (!sourceLink) return;

    let url = sourceLink.href;
    if (!url || url === '#' || url.startsWith('javascript:')) return;

    // Normalize URL: remove hash and trailing slash
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      url = urlObj.toString().replace(/\/$/, "");
    } catch (e) {
      console.error("URL normalization failed", e);
    }

    // Find the original text
    let originalText = '';
    const historyRow = sourceLink.closest('tr');
    if (historyRow && historyRow.dataset.index) {
      const item = window.currentHistory[historyRow.dataset.index];
      if (item) originalText = item.original_text;
    } else if (sourceLink.id === 'detail-source') {
      originalText = document.getElementById('detail-original').textContent;
    }

    if (originalText && originalText.trim()) {
      console.log("Saving session highlight for:", url);
      chrome.storage.local.set({
        'pending_highlight': {
          url: url,
          text: originalText.trim(),
          timestamp: Date.now()
        }
      });
    }
  });
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

  // History Access Control
  const historyLock = document.getElementById("history-premium-lock");
  const historyContainer = document.getElementById("history-container");
  if (['free', 'go'].includes(sub.plan_id)) {
    if (historyLock) historyLock.classList.remove("hidden");
    if (historyContainer) historyContainer.classList.add("hidden");
  } else {
    if (historyLock) historyLock.classList.add("hidden");
    if (historyContainer) historyContainer.classList.remove("hidden");
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

function initHistoryModal() {
  const modal = document.getElementById('history-modal');
  const closeBtn = document.getElementById('close-history-modal');
  const copyBtn = document.getElementById('copy-history-result');

  if (!modal || !closeBtn) return;

  // Delegation for history table clicks
  const historyList = document.getElementById('history-list');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const previewCell = e.target.closest('.text-preview');
      if (previewCell) {
        const index = previewCell.closest('tr').dataset.index;
        if (window.currentHistory[index]) {
          showHistoryDetail(window.currentHistory[index]);
        }
      }
    });
  }

  function closeModal() {
    modal.classList.add('closing');
    modal.addEventListener('animationend', () => {
      modal.classList.add('hidden');
      modal.classList.remove('closing');
    }, { once: true });
  }

  closeBtn.onclick = closeModal;

  window.onclick = (event) => {
    if (event.target === modal) closeModal();
  };

  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = document.getElementById('detail-simplified').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Скопировано! ✓';
        setTimeout(() => copyBtn.textContent = originalText, 2000);
      });
    };
  }
}

function showHistoryDetail(item) {
  const modal = document.getElementById('history-modal');
  if (!modal) return;

  const date = new Date(item.timestamp).toLocaleString('ru-RU');
  const modeMap = {
    'simple': 'Просто',
    'short': 'Кратко',
    'key_points': 'Тезисно',
    'examples': 'С примером'
  };

  document.getElementById('detail-date').textContent = date;
  document.getElementById('detail-mode').textContent = modeMap[item.mode] || item.mode;

  const sourceLink = document.getElementById('detail-source');
  sourceLink.href = item.source_url || '#';
  if (item.source_url && item.source_url.startsWith('http')) {
    try {
      sourceLink.textContent = new URL(item.source_url).hostname;
    } catch (e) {
      sourceLink.textContent = 'Открыть источник';
    }
  } else {
    sourceLink.textContent = '—';
  }

  document.getElementById('detail-original').textContent = item.original_text;
  document.getElementById('detail-simplified').textContent = item.simplified_text;

  modal.classList.remove('hidden');
}

// Load History
async function loadHistory(token) {
  const historyList = document.getElementById("history-list");

  // 1. Instant load from cache
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("lastHistoryData", (result) => {
      if (result.lastHistoryData) {
        console.log("Loading history from cache...");
        renderHistory(result.lastHistoryData);
      } else if (historyList) {
        historyList.innerHTML = '<tr><td colspan="4" class="text-center">Загрузка...</td></tr>';
      }
    });
  } else if (historyList) {
    historyList.innerHTML = '<tr><td colspan="4" class="text-center">Загрузка...</td></tr>';
  }

  // 2. Refresh from backend
  try {
    const res = await fetch("http://127.0.0.1:8000/history", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Extension-ID": chrome.runtime.id
      }
    });

    if (res.ok) {
      const data = await res.json();
      renderHistory(data);

      // Update cache
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ lastHistoryData: data });
      }
    }
  } catch (e) {
    console.error("Failed to refresh history:", e);
    // If cache was empty and fetch failed
    if (historyList && !historyList.querySelector('td:not(.text-center)')) {
      historyList.innerHTML = '<tr><td colspan="4" class="text-center">Ошибка загрузки (проверьте сеть)</td></tr>';
    }
  }
}

function renderHistory(items) {
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");

  if (!historyList) return;

  window.currentHistory = items || [];

  if (!items || items.length === 0) {
    historyList.innerHTML = "";
    if (historyEmpty) historyEmpty.classList.remove("hidden");
    return;
  }

  if (historyEmpty) historyEmpty.classList.add("hidden");

  historyList.innerHTML = ""; // Clear existing

  items.forEach((item, index) => {
    const date = new Date(item.timestamp).toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Clean mode name
    const modeMap = {
      'simple': 'Просто',
      'short': 'Кратко',
      'key_points': 'Тезисно',
      'examples': 'С примером'
    };
    const modeName = modeMap[item.mode] || item.mode;

    let sourceLabel = '—';
    if (item.source_url && item.source_url.startsWith('http')) {
      try {
        sourceLabel = new URL(item.source_url).hostname;
      } catch (e) {
        sourceLabel = 'Источник';
      }
    }

    const row = document.createElement('tr');
    row.dataset.index = index;
    row.innerHTML = `
        <td>${date}</td>
        <td class="mode-cell">${modeName}</td>
        <td class="source-cell">
          <a href="${item.source_url || '#'}" target="_blank" title="${item.source_url || ''}">
            ${sourceLabel}
          </a>
        </td>
        <td class="text-preview">
          <strong>Оригинал:</strong> ${item.original_text.substring(0, 50)}...<br>
          <strong>Итог:</strong> ${item.simplified_text.substring(0, 50)}...
        </td>
    `;

    historyList.appendChild(row);
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

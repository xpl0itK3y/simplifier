// Text Simplifier Content Script

let shadowHost = null;
let shadowRoot = null;
let currentSelectionText = '';
let authCheckInterval = null;

// Initialize Shadow DOM
function initShadowDOM() {
  if (shadowHost) return;

  shadowHost = document.createElement('div');
  shadowHost.id = 'text-simplifier-host';
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // Inject Styles
  const link = document.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', chrome.runtime.getURL('content/style.css'));
  shadowRoot.appendChild(link);
}

// 0. CHECK FOR HIGHLIGHTS FROM HISTORY
function checkForHighlights() {
  chrome.storage.local.get('pending_highlight', (result) => {
    const hl = result.pending_highlight;
    if (!hl) return;

    const now = Date.now();
    // If the highlight is older than 5 minutes, it's probably from a previous session
    if (now - hl.timestamp > 300000) {
      chrome.storage.local.remove('pending_highlight');
      return;
    }

    // Check if the URL matches (at least partially)
    const currentUrl = window.location.href;
    if (!isUrlMatch(currentUrl, hl.url)) {
      return;
    }

    // Inject highlight styles into the main document to ensure visibility
    if (!document.getElementById('simplifier-highlight-styles')) {
      const style = document.createElement('style');
      style.id = 'simplifier-highlight-styles';
      style.textContent = `
        mark.simplifier-highlighted-text {
            background-color: #00ff00 !important; /* Neon Green */
            color: #000 !important;
            padding: 2px 0 !important;
            margin: 0 !important;
            border-radius: 3px !important;
            box-shadow: 0 0 15px rgba(0, 255, 0, 0.8) !important;
            animation: simplifierPulse 1.5s infinite alternate !important;
            position: relative !important;
            z-index: 999999 !important;
            display: inline !important;
        }
        @keyframes simplifierPulse {
            from { box-shadow: 0 0 5px rgba(0, 255, 0, 0.5); background-color: #00ff00; }
            to { box-shadow: 0 0 20px rgba(0, 255, 0, 1); background-color: #b2ff59; }
        }
      `;
      document.head.appendChild(style);
    }

    console.log("Match found! Attempting to locate text:", hl.text);

    // Try highlighting with retries
    let attempts = 0;
    const maxAttempts = 10;

    const tryHighlight = () => {
      attempts++;
      if (findAndHighlightText(hl.text)) {
        console.log("Text highlighted on attempt " + attempts);
        chrome.storage.local.remove('pending_highlight');
      } else if (attempts < maxAttempts) {
        setTimeout(tryHighlight, 1000);
      } else {
        // Keep it for a bit more in case of slow loads, but ultimately give up
        if (attempts === maxAttempts) {
          chrome.storage.local.remove('pending_highlight');
        }
      }
    };

    tryHighlight();
  });
}

function isUrlMatch(url1, url2) {
  const norm = (u) => {
    try {
      if (!u) return '';
      const obj = new URL(u);
      // Remove hash and trailing slash from path
      let path = obj.host + obj.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      // Keep search but ignore protocol and www
      return (path + obj.search).replace(/^www\./, "");
    } catch (e) { return u; }
  };
  return norm(url1) === norm(url2);
}

function findAndHighlightText(targetText) {
  if (!targetText || !targetText.trim()) return false;

  // 1. Prepare target
  // Handle &nbsp; and multiple spaces
  const searchTarget = targetText.replace(/[\s\u00A0]+/g, ' ').trim().toLowerCase();
  console.log("Searching for normalized text:", searchTarget);

  // 2. Build DOM text map
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      const badTags = ['script', 'style', 'noscript', 'textarea', 'option', 'canvas', 'svg', 'iframe'];
      if (badTags.includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);

  let combinedText = "";
  let map = []; // Array of { node, offset } for every character in combinedText

  let node;
  while (node = walker.nextNode()) {
    // Normalize &nbsp; in DOM text too
    const text = node.nodeValue.replace(/\u00A0/g, ' ');
    for (let i = 0; i < text.length; i++) {
      combinedText += text[i];
      map.push({ node, offset: i });
    }
    // Force a space between nodes to prevent merging words from different elements
    combinedText += " ";
    map.push(null);
  }

  // 3. Find match in combined text, ignoring whitespace differences
  let collapsedText = "";
  let collapsedToOriginalMap = [];

  for (let i = 0; i < combinedText.length; i++) {
    const char = combinedText[i];
    if (/\s/.test(char)) {
      if (collapsedText[collapsedText.length - 1] !== ' ') {
        collapsedText += ' ';
        collapsedToOriginalMap.push(i);
      }
    } else {
      collapsedText += char;
      collapsedToOriginalMap.push(i);
    }
  }

  const matchIdx = collapsedText.toLowerCase().indexOf(searchTarget);

  if (matchIdx !== -1) {
    console.log("Text match found in DOM map at index:", matchIdx);

    const startOrigIdx = collapsedToOriginalMap[matchIdx];
    const endOrigIdx = collapsedToOriginalMap[matchIdx + searchTarget.length - 1];

    const start = map[startOrigIdx];
    const end = map[endOrigIdx];

    if (start && end) {
      try {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset + 1);

        // Check visibility
        const rects = range.getClientRects();
        if (rects.length === 0) {
          // Try to scroll into view anyway or show where it is?
          console.warn("Text found but seems hidden (no rects).");
        }

        highlightRange(range);
        console.log("Highlight applied successfully.");

        // Extra scroll attempt in next tick
        setTimeout(() => {
          const el = document.querySelector('mark.simplifier-highlighted-text');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        return true;
      } catch (e) {
        console.error("Critical error while creating range/highlight:", e);
      }
    }
  }

  console.log("Could not find text in the page content. Make sure the page is fully loaded or the text exists.");
  return false;
}

// Safe, non-destructive highlighting for complex DOMs like Wikipedia
function highlightRange(range) {
  const nodes = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        if (range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_REJECT;
      }
    },
    false
  );

  let firstMark = null;
  let curr;
  while (curr = walker.nextNode()) nodes.push(curr);

  nodes.forEach(node => {
    const mark = document.createElement('mark');
    mark.className = 'simplifier-highlighted-text';

    const nodeRange = document.createRange();

    // Set start
    if (node === range.startContainer) {
      nodeRange.setStart(node, range.startOffset);
    } else {
      nodeRange.setStart(node, 0);
    }

    // Set end
    if (node === range.endContainer) {
      nodeRange.setEnd(node, range.endOffset);
    } else {
      nodeRange.setEnd(node, node.nodeValue.length);
    }

    try {
      nodeRange.surroundContents(mark);
      if (!firstMark) firstMark = mark;
    } catch (e) {
      // If surroundContents fails (shouldn't happen with text nodes), skip or log
      console.warn("Could not wrap text node safely:", e);
    }
  });

  // Smooth scroll to the first marked segment
  if (firstMark) {
    firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Run check
if (document.readyState === 'complete') {
  checkForHighlights();
} else {
  window.addEventListener('load', checkForHighlights);
}

// Global Message Listener (Handles Context Menu & Stream)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // 1. Open Modal
  if (request.action === "OPEN_MODAL_FROM_CONTEXT") {
    currentSelectionText = request.text;
    initShadowDOM();
    showModal();
  }

  // 2. Stream Handling
  const resultContent = shadowRoot?.querySelector('#result-content');

  if (resultContent) {
    if (request.action === 'STREAM_START') {
      // Do nothing! Wait for actual text to arrive to avoid white flash.
    }

    if (request.action === 'STREAM_CHUNK') {
      const loadingEl = resultContent.querySelector('.loading');
      const instructionEl = resultContent.querySelector('.instruction-text');

      // Если это ПЕРВЫЙ чанк (есть спиннер ИЛИ текст инструкции), заменяем всё на чистый контейнер
      if (loadingEl || instructionEl || !resultContent.querySelector('.result-text')) {
        resultContent.innerHTML = '<div class="result-text"></div>';
      }

      const resultText = resultContent.querySelector('.result-text');
      if (resultText) {
        resultText.textContent += request.chunk;
        // Auto-scroll to bottom
        const container = shadowRoot.querySelector('.modal-body');
        if (container) container.scrollTop = container.scrollHeight;
      }
    }

    if (request.action === 'STREAM_ERROR') {
      const { error, errorCode } = request;

      if (errorCode === 'LOGIN_REQUIRED' || error === 'LOGIN_REQUIRED') {
        showLoginPrompt(modal); // Helper we already have
      } else if (errorCode === 'CREDITS_EXHAUSTED') {
        fetchTemplate('content/components/credits.html', resultContent).then(() => {
          const titleEl = shadowRoot.querySelector('.limits-title');
          const textEl = shadowRoot.querySelector('.limits-text');
          if (titleEl && error) titleEl.textContent = error;
          if (textEl) textEl.innerHTML = "Пожалуйста, обновите подписку в настройках, чтобы продолжить использование этого режима или увеличить лимит символов.";

          const upgradeBtn = shadowRoot.querySelector('#upgrade-limits-btn');
          if (upgradeBtn) {
            upgradeBtn.onclick = () => {
              chrome.runtime.sendMessage({ action: "OPEN_SETTINGS" });
            };
          }
        });
      } else {
        // Generic Error with "Upgrade" context if it looks like a limit
        const lowerErr = error.toLowerCase();
        const isLimitError = lowerErr.includes('лимит') ||
          lowerErr.includes('план') ||
          lowerErr.includes('макс') ||
          lowerErr.includes('длинный');

        resultContent.innerHTML = `
          <div class="error-container" style="text-align: center; padding: 20px;">
            <span class="error-msg" style="display: block; margin-bottom: 15px;">${error}</span>
            ${isLimitError ? `
              <button class="action-btn active" id="error-upgrade-btn" style="margin: 0 auto;">Улучшить план</button>
            ` : ''}
          </div>
        `;

        const upgradeBtn = resultContent.querySelector('#error-upgrade-btn');
        if (upgradeBtn) {
          upgradeBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: "OPEN_SETTINGS" });
          };
        }
      }
    }
  }
});


// Show Result Modal
async function showModal() {
  // Очистка старого интервала если есть
  if (authCheckInterval) {
    clearInterval(authCheckInterval);
    authCheckInterval = null;
  }

  // Remove existing modal and backdrop
  const existingModal = shadowRoot.querySelector('.simplifier-modal');
  if (existingModal) existingModal.remove();
  const existingBackdrop = shadowRoot.querySelector('.modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  // Create Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'simplifier-modal';

  try {
    // Fetch HTML template for Modal using cache
    const htmlText = await fetchTemplate('content/modal.html');
    modal.innerHTML = htmlText;

    // Inject dynamic content (Selection Preview)
    const previewEl = modal.querySelector('#selection-preview');
    if (previewEl) {
      previewEl.textContent = `${currentSelectionText.substring(0, 100)}${currentSelectionText.length > 100 ? '...' : ''}`;
    }

    // 1. Check Cache first for instant UI
    chrome.storage.local.get('user_plan', (data) => {
      if (data.user_plan) {
        updateModalUI(modal, true, data.user_plan);
      }

      // 2. Check Auth Status immediately (and update plan)
      chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }, (response) => {
        const isAuthenticated = response && response.isAuthenticated;
        updateModalUI(modal, isAuthenticated, response?.plan_id);

        // Запускаем периодическую проверку авторизации (для входа И выхода)
        startAuthCheck(modal);
      });
    });

    // Event Listeners
    const closeBtn = modal.querySelector('.close-btn');

    function closeModal() {
      if (authCheckInterval) clearInterval(authCheckInterval);

      modal.classList.add('closing');
      backdrop.classList.add('closing');

      modal.addEventListener('animationend', () => {
        modal.remove();
        backdrop.remove();
      }, { once: true });
    }

    if (closeBtn) {
      closeBtn.onclick = closeModal;
    }

    backdrop.onclick = closeModal;

    // Make Draggable
    const header = modal.querySelector('.modal-header');
    if (header) makeDraggable(modal, header);

    const buttons = modal.querySelectorAll('.action-btn');
    buttons.forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('premium-locked')) {
          chrome.runtime.sendMessage({ action: "OPEN_SETTINGS" });
          return;
        }

        // UI Update
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        await startSimplification(currentSelectionText, btn.dataset.mode, modal);
      };
    });

    shadowRoot.appendChild(backdrop);
    shadowRoot.appendChild(modal);

  } catch (error) {
    console.error('Failed to load modal template:', error);
  }
}

// Периодическая проверка авторизации (вход И выход)
let wasAuthenticated = null; // Отслеживаем предыдущее состояние

function startAuthCheck(modal) {
  authCheckInterval = setInterval(() => {
    // Безопасная проверка: если расширение было обновлено/выгружено, runtime.id исчезнет
    if (!chrome.runtime?.id) {
      console.log("Extension context invalidated, stopping background checks.");
      if (authCheckInterval) clearInterval(authCheckInterval);
      return;
    }

    chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }, (response) => {
      const isAuthenticated = response && response.isAuthenticated;

      // Если состояние изменилось (или это первая проверка в интервале)
      if (wasAuthenticated !== isAuthenticated) {
        wasAuthenticated = isAuthenticated;
        updateModalUI(modal, isAuthenticated, response?.plan_id);
      }
    });
  }, 2000);
}

function updateModalUI(modal, isAuthenticated, planId) {
  const buttons = modal.querySelectorAll('.actions .action-btn');
  const resultDiv = modal.querySelector('#result-content');

  if (isAuthenticated) {
    // Пользователь ВОШЕЛ
    const premiumModes = ['key_points', 'examples'];

    buttons.forEach(b => {
      const mode = b.dataset.mode;
      const isPremium = premiumModes.includes(mode);

      if (isPremium && planId === 'free') {
        b.style.display = 'none';
      } else {
        b.style.display = 'inline-block'; // Or however they are styled
        b.style.opacity = '1';
        b.style.pointerEvents = 'auto';
        b.style.cursor = 'pointer';

        if (mode === 'key_points') b.title = "Главные мысли в виде списка";
        if (mode === 'examples') b.title = "Объяснение с примером из жизни";
      }
    });

    // Показываем инструкцию только если там сейчас не результат и не спиннер
    if (resultDiv && !resultDiv.querySelector('.result-text') && !resultDiv.querySelector('.loading')) {
      fetchTemplate('content/components/instruction.html', resultDiv).then(() => {
        const previewEl = resultDiv.querySelector('#selection-preview');
        if (previewEl) {
          previewEl.textContent = `${currentSelectionText.substring(0, 100)}${currentSelectionText.length > 100 ? '...' : ''}`;
        }
      });
    }
  } else {
    // Пользователь ВЫШЕЛ
    showLoginPrompt(modal);
  }
}

function makeDraggable(element, handle) {
  let startX, startY;

  const onMouseMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const rect = element.getBoundingClientRect();
    let newLeft = rect.left + dx;
    let newTop = rect.top + dy;

    // Boundary Checks
    const maxLeft = window.innerWidth - element.offsetWidth;
    const maxTop = window.innerHeight - element.offsetHeight;

    if (newLeft < 0) newLeft = 0;
    if (newTop < 0) newTop = 0;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop > maxTop) newTop = maxTop;

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;

    startX = e.clientX;
    startY = e.clientY;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', (e) => {
    // Get current position
    const rect = element.getBoundingClientRect();

    // Switch from translate: -50% -50% to fixed pixels coordinates
    element.style.translate = 'none';
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.margin = '0';

    startX = e.clientX;
    startY = e.clientY;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    e.preventDefault(); // Prevent text selection
  });
}

async function startSimplification(text, mode, modalContainer) {
  const resultDiv = modalContainer.querySelector('#result-content');
  // Show loading with spinner and WAIT for it
  await fetchTemplate('content/components/loading.html', resultDiv);

  chrome.runtime.sendMessage({
    action: 'SIMPLIFY_TEXT',
    text: text,
    mode: mode,
    url: window.location.href
  });
}

function showLoginPrompt(modal) {
  const resultDiv = modal.querySelector('#result-content');
  if (!resultDiv) return;

  fetchTemplate('content/components/login.html', resultDiv);

  // Disable mode buttons
  const buttons = modal.querySelectorAll('.actions .action-btn');
  buttons.forEach(b => {
    b.style.opacity = '0.5';
    b.style.pointerEvents = 'none';
    b.style.cursor = 'not-allowed';
  });
}

const templateCache = {};

// Helper to fetch and inject template
async function fetchTemplate(path, container) {
  try {
    let html = '';

    if (templateCache[path]) {
      html = templateCache[path];
    } else {
      const url = chrome.runtime.getURL(path);
      const response = await fetch(url);
      html = await response.text();

      // Resolve relative paths for CSS and Images in the template
      const baseURL = chrome.runtime.getURL('content/');
      html = html.replace(/href="content\//g, `href="${baseURL}`);
      html = html.replace(/src="content\//g, `src="${baseURL}`);

      templateCache[path] = html;
    }

    if (container) {
      container.innerHTML = html;
    }
    return html;
  } catch (e) {
    console.error('Failed to load template:', path, e);
    if (container) {
      container.innerHTML = `<span class="error-msg">Error loading UI</span>`;
    }
  }
}
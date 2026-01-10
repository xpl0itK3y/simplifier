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
      if (request.error === 'LOGIN_REQUIRED') {
        fetchTemplate('content/components/login.html', resultContent).then(() => {
          const loginBtn = shadowRoot.querySelector('#login-inline-btn');
          if (loginBtn) {
            loginBtn.onclick = () => {
              alert("Пожалуйста, нажмите на расширение еще раз, чтобы авторизоваться.");
            };
          }
        });
      } else if (request.error === 'CREDITS_EXHAUSTED') {
        fetchTemplate('content/components/credits.html', resultContent).then(() => {
          const upgradeBtn = shadowRoot.querySelector('#upgrade-limits-btn');
          if (upgradeBtn) {
            upgradeBtn.onclick = () => {
              chrome.runtime.sendMessage({ action: "OPEN_SETTINGS" });
            };
          }
        });
      } else {
        const errorSpan = document.createElement('span');
        errorSpan.className = 'error-msg';
        errorSpan.textContent = request.error;
        resultContent.innerHTML = '';
        resultContent.appendChild(errorSpan);
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
  // Close on backdrop click
  backdrop.onclick = () => {
    if (authCheckInterval) clearInterval(authCheckInterval);
    if (shadowRoot.querySelector('.simplifier-modal')) shadowRoot.querySelector('.simplifier-modal').remove();
    backdrop.remove();
  };

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

    // Check Auth Status immediately
    chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }, (response) => {
      if (!response || !response.isAuthenticated) {
        // User is NOT logged in
        showLoginPrompt(modal);
      }

      // Запускаем периодическую проверку авторизации (для входа И выхода)
      startAuthCheck(modal);
    });

    // Event Listeners
    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        if (authCheckInterval) clearInterval(authCheckInterval);
        modal.remove();
        backdrop.remove();
      };
    }

    // Make Draggable
    const header = modal.querySelector('.modal-header');
    if (header) makeDraggable(modal, header);

    const buttons = modal.querySelectorAll('.action-btn');
    buttons.forEach(btn => {
      btn.onclick = async () => {
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
    chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }, (response) => {
      const isAuthenticated = response && response.isAuthenticated;

      // Если состояние изменилось
      if (wasAuthenticated !== isAuthenticated) {
        wasAuthenticated = isAuthenticated;

        const buttons = modal.querySelectorAll('.actions .action-btn');
        const resultDiv = modal.querySelector('#result-content');

        if (isAuthenticated) {
          // Пользователь ВОШЕЛ
          buttons.forEach(b => {
            b.style.opacity = '1';
            b.style.pointerEvents = 'auto';
            b.style.cursor = 'pointer';
          });

          if (resultDiv) {
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
    });
  }, 2000); // Проверка каждые 2 секунды
}

function makeDraggable(element, handle) {
  let isDragging = false;
  let startX, startY;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;

    // Get current position
    const rect = element.getBoundingClientRect();

    // Switch from translate(-50%, -50%) to fixed pixels coordinates
    element.style.transform = 'none';
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.margin = '0'; // Reset any margins

    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    e.preventDefault(); // Prevent text selection

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const currentLeft = parseFloat(element.style.left);
    const currentTop = parseFloat(element.style.top);

    let newLeft = currentLeft + dx;
    let newTop = currentTop + dy;

    // Boundary Checks
    const maxLeft = window.innerWidth - element.offsetWidth;
    const maxTop = window.innerHeight - element.offsetHeight;

    // Clamp values
    if (newLeft < 0) newLeft = 0;
    if (newTop < 0) newTop = 0;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop > maxTop) newTop = maxTop;

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;

    startX = e.clientX;
    startY = e.clientY;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

async function startSimplification(text, mode, modalContainer) {
  const resultDiv = modalContainer.querySelector('#result-content');
  // Show loading with spinner and WAIT for it
  await fetchTemplate('content/components/loading.html', resultDiv);

  chrome.runtime.sendMessage({
    action: 'SIMPLIFY_TEXT',
    text: text,
    mode: mode
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
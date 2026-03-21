/**
 * RASI Agent Chat Widget
 * Drop-in embeddable chat bubble for any website.
 *
 * Usage:
 *   <script
 *     src="https://rasi-synthetic-hr.vercel.app/widget.js"
 *     data-agent-id="YOUR_AGENT_ID"
 *     data-api-key="sk_YOUR_KEY"
 *     data-title="Ask me anything"
 *     data-theme="dark"
 *     data-api-url="https://rasi-synthetic-hr-production.up.railway.app"
 *   ></script>
 */
(function () {
  'use strict';

  // ── Config from script tag attributes ──────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var agentId  = script.getAttribute('data-agent-id') || '';
  var apiKey   = script.getAttribute('data-api-key') || '';
  var title    = script.getAttribute('data-title') || 'Chat with us';
  var theme    = script.getAttribute('data-theme') || 'dark';
  var apiBase  = (script.getAttribute('data-api-url') || 'https://rasi-synthetic-hr-production.up.railway.app').replace(/\/$/, '');

  if (!agentId || !apiKey) {
    console.warn('[RASI Widget] data-agent-id and data-api-key are required.');
    return;
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  var isDark = theme !== 'light';
  var colors = isDark ? {
    bg: '#0f1117',
    panel: '#1a1d27',
    border: '#2a2d3a',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    bubble: '#14b8a6',
    bubbleText: '#ffffff',
    userMsg: '#14b8a6',
    userMsgText: '#ffffff',
    agentMsg: '#2a2d3a',
    agentMsgText: '#e2e8f0',
    input: '#252836',
    inputText: '#e2e8f0',
    inputBorder: '#374151',
    header: '#111827',
    sendBtn: '#14b8a6',
    sendBtnHover: '#0d9488',
  } : {
    bg: '#ffffff',
    panel: '#ffffff',
    border: '#e5e7eb',
    text: '#111827',
    textMuted: '#6b7280',
    bubble: '#14b8a6',
    bubbleText: '#ffffff',
    userMsg: '#14b8a6',
    userMsgText: '#ffffff',
    agentMsg: '#f3f4f6',
    agentMsgText: '#111827',
    input: '#f9fafb',
    inputText: '#111827',
    inputBorder: '#d1d5db',
    header: '#f9fafb',
    sendBtn: '#14b8a6',
    sendBtnHover: '#0d9488',
  };

  // ── Inject styles ──────────────────────────────────────────────────────────
  var styleId = 'rasi-widget-styles';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#rasi-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:' + colors.bubble + ';cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .2s,box-shadow .2s;border:none;outline:none;}',
      '#rasi-bubble:hover{transform:scale(1.08);box-shadow:0 6px 32px rgba(0,0,0,0.4);}',
      '#rasi-bubble svg{width:26px;height:26px;fill:none;stroke:' + colors.bubbleText + ';stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '#rasi-panel{position:fixed;bottom:92px;right:24px;width:360px;height:500px;border-radius:16px;background:' + colors.panel + ';box-shadow:0 8px 40px rgba(0,0,0,0.35);display:none;flex-direction:column;z-index:2147483645;overflow:hidden;border:1px solid ' + colors.border + ';font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '#rasi-panel.open{display:flex;}',
      '#rasi-header{background:' + colors.header + ';padding:16px 16px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ' + colors.border + ';}',
      '#rasi-header-left{display:flex;align-items:center;gap:10px;}',
      '#rasi-avatar{width:32px;height:32px;border-radius:50%;background:' + colors.bubble + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '#rasi-avatar svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '#rasi-title{font-size:14px;font-weight:600;color:' + colors.text + ';}',
      '#rasi-status{font-size:11px;color:#22c55e;display:flex;align-items:center;gap:4px;}',
      '#rasi-status-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;}',
      '#rasi-close{background:none;border:none;cursor:pointer;color:' + colors.textMuted + ';padding:4px;display:flex;align-items:center;border-radius:6px;transition:background .15s;}',
      '#rasi-close:hover{background:' + colors.border + ';}',
      '#rasi-close svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '#rasi-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;}',
      '#rasi-messages::-webkit-scrollbar{width:4px;}',
      '#rasi-messages::-webkit-scrollbar-track{background:transparent;}',
      '#rasi-messages::-webkit-scrollbar-thumb{background:' + colors.border + ';border-radius:4px;}',
      '.rasi-msg{max-width:80%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word;}',
      '.rasi-msg.user{background:' + colors.userMsg + ';color:' + colors.userMsgText + ';align-self:flex-end;border-bottom-right-radius:4px;}',
      '.rasi-msg.agent{background:' + colors.agentMsg + ';color:' + colors.agentMsgText + ';align-self:flex-start;border-bottom-left-radius:4px;}',
      '.rasi-msg.typing{opacity:0.7;}',
      '.rasi-typing-dots{display:inline-flex;gap:4px;align-items:center;}',
      '.rasi-typing-dots span{width:6px;height:6px;border-radius:50%;background:' + colors.textMuted + ';animation:rasi-bounce .8s infinite;}',
      '.rasi-typing-dots span:nth-child(2){animation-delay:.15s;}',
      '.rasi-typing-dots span:nth-child(3){animation-delay:.3s;}',
      '@keyframes rasi-bounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-6px);}}',
      '#rasi-footer{padding:12px;border-top:1px solid ' + colors.border + ';display:flex;gap:8px;align-items:flex-end;}',
      '#rasi-input{flex:1;background:' + colors.input + ';border:1px solid ' + colors.inputBorder + ';border-radius:10px;padding:10px 12px;font-size:13px;color:' + colors.inputText + ';resize:none;max-height:100px;min-height:40px;outline:none;font-family:inherit;line-height:1.4;transition:border-color .15s;}',
      '#rasi-input:focus{border-color:' + colors.bubble + ';}',
      '#rasi-input::placeholder{color:' + colors.textMuted + ';}',
      '#rasi-send{width:36px;height:36px;border-radius:10px;background:' + colors.sendBtn + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s;margin-bottom:2px;}',
      '#rasi-send:hover:not(:disabled){background:' + colors.sendBtnHover + ';}',
      '#rasi-send:disabled{opacity:0.5;cursor:not-allowed;}',
      '#rasi-send svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '@media(max-width:420px){#rasi-panel{width:calc(100vw - 16px);right:8px;bottom:80px;height:calc(100vh - 120px);}}',
    ].join('');
    document.head.appendChild(style);
  }

  // ── Chat bubble button ─────────────────────────────────────────────────────
  var bubble = document.createElement('button');
  bubble.id = 'rasi-bubble';
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  document.body.appendChild(bubble);

  // ── Chat panel ─────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = 'rasi-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  panel.innerHTML = [
    '<div id="rasi-header">',
    '  <div id="rasi-header-left">',
    '    <div id="rasi-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>',
    '    <div>',
    '      <div id="rasi-title">' + escapeHtml(title) + '</div>',
    '      <div id="rasi-status"><span id="rasi-status-dot"></span>Online</div>',
    '    </div>',
    '  </div>',
    '  <button id="rasi-close" aria-label="Close chat"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '</div>',
    '<div id="rasi-messages" role="log" aria-live="polite"></div>',
    '<div id="rasi-footer">',
    '  <textarea id="rasi-input" rows="1" placeholder="Type a message..." aria-label="Message input"></textarea>',
    '  <button id="rasi-send" aria-label="Send"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  var messagesEl = document.getElementById('rasi-messages');
  var inputEl    = document.getElementById('rasi-input');
  var sendBtn    = document.getElementById('rasi-send');
  var closeBtn   = document.getElementById('rasi-close');
  var isOpen     = false;
  var isBusy     = false;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addMessage(role, text) {
    var el = document.createElement('div');
    el.className = 'rasi-msg ' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addTyping() {
    var el = document.createElement('div');
    el.className = 'rasi-msg agent typing';
    el.innerHTML = '<div class="rasi-typing-dots"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function setLoading(busy) {
    isBusy = busy;
    sendBtn.disabled = busy;
    inputEl.disabled = busy;
  }

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add('open');
      inputEl.focus();
      if (messagesEl.children.length === 0) {
        addMessage('agent', 'Hi! How can I help you today?');
      }
    } else {
      panel.classList.remove('open');
    }
  }

  async function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isBusy) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    addMessage('user', text);
    setLoading(true);
    var typingEl = addTyping();

    try {
      var response = await fetch(apiBase + '/v1/agents/' + encodeURIComponent(agentId) + '/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({ message: text }),
      });

      typingEl.remove();

      if (!response.ok) {
        var errData = {};
        try { errData = await response.json(); } catch (e) {}
        addMessage('agent', errData.error || 'Something went wrong. Please try again.');
      } else {
        var data = await response.json();
        addMessage('agent', data.reply || 'No response received.');
      }
    } catch (err) {
      typingEl.remove();
      addMessage('agent', 'Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
      inputEl.focus();
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  bubble.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // Close on outside click
  document.addEventListener('click', function (e) {
    if (isOpen && !panel.contains(e.target) && e.target !== bubble) {
      togglePanel();
    }
  });
})();

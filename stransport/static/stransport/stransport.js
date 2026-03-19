// Dummy connectRealtime to prevent ReferenceError if not defined elsewhere
function connectRealtime() {}
// Stub so openOffersModal or any caller never hits "loadPublishedOffers is not defined" (e.g. cached script)
if (typeof window !== 'undefined') window.loadPublishedOffers = function () {};
// כפתור "פרסום נסיעות" בדף הבית:
// * מתנדב – גלילה לפאנל שלו ופתיחת טופס פרסום (כמו שהיה)
// * מטופל – מודל עם נסיעות שפורסמו
document.addEventListener('DOMContentLoaded', function() {
  var aiLaunch = document.getElementById('ai-mode-launch');
  var aiModal = document.getElementById('ai-mode-modal');
  var aiCancel = document.getElementById('ai_cancel');
  var aiOffersContainer = document.getElementById('ai-offers-container');
  // used below (avoid ReferenceError that breaks all JS)
  var role = window.currentUserRole || '';
  var publishBtnDefaultText = (aiLaunch && aiLaunch.textContent ? aiLaunch.textContent : 'פרסם נסיעה').trim();

  // AI Agent modal (patient only)
  var aiAgentLaunch = document.getElementById('ai-agent-launch');
  var aiAgentLaunchFooter = document.getElementById('ai-agent-launch-footer');
  var aiAgentModal = document.getElementById('ai-agent-modal');
  var aiAgentClose = document.getElementById('ai-agent-close');
  var aiAgentSend = document.getElementById('ai-agent-send');
  var aiAgentInput = document.getElementById('ai-agent-input');
  var aiAgentResults = document.getElementById('ai-agent-results');
  var aiAgentError = document.getElementById('ai-agent-error');

  // AI Agent modal (volunteer)
  var aiVolAgentLaunch = document.getElementById('ai-vol-agent-launch');
  var aiVolAgentLaunchFooter = document.getElementById('ai-vol-agent-launch-footer');
  var aiVolAgentModal = document.getElementById('ai-vol-agent-modal');
  var aiVolAgentClose = document.getElementById('ai-vol-agent-close');
  var aiVolAgentSend = document.getElementById('ai-vol-agent-send');
  var aiVolAgentInput = document.getElementById('ai-vol-agent-input');
  var aiVolAgentResults = document.getElementById('ai-vol-agent-results');
  var aiVolAgentError = document.getElementById('ai-vol-agent-error');

  function openAiAgentModal() {
    if (!aiAgentModal) return;
    aiAgentModal.style.display = 'block';
    if (aiAgentError) aiAgentError.textContent = '';
    if (aiAgentResults) aiAgentResults.innerHTML = '';

    // show initial assistant message immediately (no typing required)
    if (aiAgentHistory && !aiAgentHistory.length) {
      aiAgentHistory.push({ role: 'assistant', content: 'היי, ספר מה אתה צריך (מוצא, יעד, תאריך/שעה). אם חסר משהו אשאל.' });
      if (aiAgentResults) {
        appendAiAgentBubble('assistant', aiAgentHistory[0].content);
      }
    }

    if (aiAgentInput) aiAgentInput.focus();
  }

  function closeAiAgentModal() {
    if (!aiAgentModal) return;
    aiAgentModal.style.display = 'none';
  }

  function appendAiAgentBubble(role, text) {
    if (!aiAgentResults) return;
    const safe = String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const align = role === 'user' ? 'flex-start' : 'flex-end';
    const bg = role === 'user' ? '#f1f5f9' : '#dbeafe';
    const color = '#0f172a';
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.justifyContent = align;
    wrap.style.marginTop = '8px';
    wrap.innerHTML = `<div style="max-width:85%; padding:10px 12px; border-radius:14px; background:${bg}; color:${color}; border:1px solid #e2e8f0; white-space:pre-wrap;">${safe}</div>`;
    aiAgentResults.appendChild(wrap);
    aiAgentResults.scrollTop = aiAgentResults.scrollHeight;
  }

  function renderAiAgentMatches(matches) {
    if (!aiAgentResults) return;
    if (!matches || !matches.length) return;
    const title = document.createElement('div');
    title.style.cssText = 'margin-top:10px;font-weight:900;color:#0f172a;';
    title.textContent = 'התאמות אפשריות:';
    aiAgentResults.appendChild(title);
    matches.forEach(function(m) {
      const text = (m.raw_text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const who = m.volunteer_username ? ('מתנדב: ' + m.volunteer_username) : '';
      const joinBtnHtml = window.guestMode
        ? '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;opacity:0.6;cursor:not-allowed;" disabled>הצטרף</button>'
        : '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;" onclick="window.joinOffer && window.joinOffer(' + m.id + ', this)">הצטרף</button>';
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;box-shadow:0 1px 2px rgba(15,23,42,0.04);';
      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
          '<div style="font-weight:900;color:#0f172a;">נסיעה מתנדב</div>' +
          joinBtnHtml +
        '</div>' +
        '<div style="color:#111827;">' + text + '</div>' +
        (who ? '<div style="margin-top:6px;font-size:0.85rem;color:#6b7280;">' + who + '</div>' : '');
      aiAgentResults.appendChild(card);
    });
    aiAgentResults.scrollTop = aiAgentResults.scrollHeight;
  }

  const aiAgentHistory = [];

  async function sendAiAgentMessage() {
    if (!aiAgentInput || !aiAgentResults) return;
    if (window.guestMode) {
      if (aiAgentError) aiAgentError.textContent = 'דמו אורח: הסוכן לא מבצע שליחה ללא כניסה.';
      return;
    }
    if (aiAgentError) aiAgentError.textContent = '';
    const raw_text = (aiAgentInput.value || '').trim();
    if (!raw_text) {
      if (aiAgentError) aiAgentError.textContent = 'כתוב מה אתה צריך.';
      return;
    }
    if (!aiAgentHistory.length) {
      aiAgentHistory.push({ role: 'assistant', content: 'היי, ספר מה אתה צריך (מוצא, יעד, תאריך/שעה). אם חסר משהו אשאל.' });
      if (aiAgentResults) {
        appendAiAgentBubble('assistant', aiAgentHistory[0].content);
      }
    }
    aiAgentHistory.push({ role: 'user', content: raw_text });
    appendAiAgentBubble('user', raw_text);
    aiAgentInput.value = '';
    aiAgentResults.appendChild(Object.assign(document.createElement('div'), { innerHTML: '<div class="field-hint" style="margin-top:8px;">Grok חושב...</div>' }));
    try {
      const res = await fetch('/api/ai/grok/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ messages: aiAgentHistory }),
      });
      const json = await safeJson(res);
      if (json.__error || json.error) {
        // remove "thinking"
        try { aiAgentResults.lastChild && aiAgentResults.removeChild(aiAgentResults.lastChild); } catch (e) {}
        if (aiAgentError) aiAgentError.textContent = json.error || 'שגיאה.';
        return;
      }
      // remove "thinking"
      try { aiAgentResults.lastChild && aiAgentResults.removeChild(aiAgentResults.lastChild); } catch (e) {}
      const reply = json.reply || '';
      aiAgentHistory.push({ role: 'assistant', content: reply });
      appendAiAgentBubble('assistant', reply);
      const matches = Array.isArray(json.matches) ? json.matches : [];
      if (matches.length) {
        renderAiAgentMatches(matches);
      }
    } catch (e) {
      try { aiAgentResults.lastChild && aiAgentResults.removeChild(aiAgentResults.lastChild); } catch (e2) {}
      if (aiAgentError) aiAgentError.textContent = 'שגיאה ברשת.';
    }
  }

  function openAiVolAgentModal() {
    if (!aiVolAgentModal) return;
    aiVolAgentModal.style.display = 'block';
    if (aiVolAgentError) aiVolAgentError.textContent = '';
    if (aiVolAgentResults) aiVolAgentResults.innerHTML = '';
    if (aiVolAgentInput) aiVolAgentInput.value = '';

    // initial assistant text shown immediately (before the user types)
    if (aiVolHistory && !aiVolHistory.length && aiVolAgentResults) {
      aiVolHistory.push({ role: 'assistant', content: 'היי, ספר מה אתה צריך (מתי אתה יוצא, מאיפה ולאן וכמה מקומות יש). אם חסר משהו אשאל.' });
      appendAiVolBubble('assistant', aiVolHistory[0].content);
    }

    if (aiVolAgentInput) aiVolAgentInput.focus();
  }

  function closeAiVolAgentModal() {
    if (!aiVolAgentModal) return;
    aiVolAgentModal.style.display = 'none';
  }

  function appendAiVolBubble(role, text) {
    if (!aiVolAgentResults) return;
    const safe = String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const align = role === 'user' ? 'flex-start' : 'flex-end';
    const bg = role === 'user' ? '#f1f5f9' : '#fee2e2';
    const color = '#0f172a';
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.justifyContent = align;
    wrap.style.marginTop = '8px';
    wrap.innerHTML = `<div style="max-width:85%; padding:10px 12px; border-radius:14px; background:${bg}; color:${color}; border:1px solid #e2e8f0; white-space:pre-wrap;">${safe}</div>`;
    aiVolAgentResults.appendChild(wrap);
    aiVolAgentResults.scrollTop = aiVolAgentResults.scrollHeight;
  }

  function renderAiVolMatches(matches) {
    if (!aiVolAgentResults) return;
    if (!matches || !matches.length) return;
    const title = document.createElement('div');
    title.style.cssText = 'margin-top:10px;font-weight:900;color:#0f172a;';
    title.textContent = 'מטופלים מתאימים:';
    aiVolAgentResults.appendChild(title);
    matches.forEach(function(r) {
      const pickup = r.pickup || '';
      const destination = r.destination || '';
      const isRtl = (document.documentElement.dir || '').toLowerCase() === 'rtl';
      const arrow = isRtl ? '←' : '→';
      const route = `${pickup}${pickup && destination ? ' ' : ''}${arrow}${destination ? ' ' + destination : ''}`.trim();
      const time = r.requested_time || '';
      const notes = r.notes || '-';
      const phone = r.phone || '-';
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;box-shadow:0 1px 2px rgba(15,23,42,0.04);';
      const acceptBtnHtml = window.guestMode
        ? '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;opacity:0.6;cursor:not-allowed;" disabled data-request-id="' + r.id + '">אשר</button>'
        : '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;" data-request-id="' + r.id + '">אשר</button>';
      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
          '<div style="font-weight:900;color:#0f172a;">בקשת מטופל</div>' +
          acceptBtnHtml +
        '</div>' +
        '<div style="color:#111827;">' + route + '</div>' +
        '<div style="margin-top:4px;color:#475569;font-weight:700;">' + time + '</div>' +
        '<div style="margin-top:6px;color:#111827;">הערות: ' + notes + '</div>' +
        '<div style="margin-top:6px;color:#111827;">טלפון מטופל: ' + phone + '</div>';
      const btn = card.querySelector('button[data-request-id]');
      if (btn) {
        btn.onclick = async function() {
          if (window.guestMode) return;
          const id = btn.dataset.requestId;
          try {
            const res = await fetch(`/api/requests/accept/${id}/`, {
              method: 'POST',
              headers: { 'X-CSRFToken': getCookie('csrftoken') },
            });
            const json = await safeJson(res);
            if (json.error) {
              alert(json.error);
              return;
            }
            btn.disabled = true;
            btn.textContent = 'אושרה';
            // refresh lists
            try { await loadOpenRequests(); } catch (e) {}
            try { await loadAcceptedRequests(true); } catch (e) {}
          } catch (e) {
            alert('שגיאה באישור בקשה.');
          }
        };
      }
      aiVolAgentResults.appendChild(card);
    });
    aiVolAgentResults.scrollTop = aiVolAgentResults.scrollHeight;
  }

  const aiVolHistory = [];

  async function sendAiVolAgentMessage() {
    if (!aiVolAgentInput || !aiVolAgentResults) return;
    if (window.guestMode) {
      if (aiVolAgentError) aiVolAgentError.textContent = 'דמו אורח: הסוכן לא מבצע שליחה ללא כניסה.';
      return;
    }
    if (aiVolAgentError) aiVolAgentError.textContent = '';
    const raw_text = (aiVolAgentInput.value || '').trim();
    if (!raw_text) {
      if (aiVolAgentError) aiVolAgentError.textContent = 'כתוב מתי אתה יוצא, מאיפה ולאן.';
      return;
    }
    if (!aiVolHistory.length) {
      aiVolHistory.push({ role: 'assistant', content: 'שלום מתנדב, ספר בקצרה מתי אתה יוצא, מאיפה ולאן וכמה מקומות יש.' });
      aiVolAgentResults.innerHTML = '';
      appendAiVolBubble('assistant', aiVolHistory[0].content);
    }
    aiVolHistory.push({ role: 'user', content: raw_text });
    appendAiVolBubble('user', raw_text);
    aiVolAgentInput.value = '';
    aiVolAgentResults.appendChild(Object.assign(document.createElement('div'), { innerHTML: '<div class="field-hint" style="margin-top:8px;">GROQ חושב...</div>' }));
    try {
      const res = await fetch('/api/ai/grok/volunteer/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ messages: aiVolHistory }),
      });
      const json = await safeJson(res);
      try { aiVolAgentResults.lastChild && aiVolAgentResults.removeChild(aiVolAgentResults.lastChild); } catch (e) {}
      if (json.__error || json.error) {
        if (aiVolAgentError) aiVolAgentError.textContent = json.error || 'שגיאה.';
        return;
      }
      const reply = json.reply || '';
      aiVolHistory.push({ role: 'assistant', content: reply });
      appendAiVolBubble('assistant', reply);
      const matches = Array.isArray(json.matches) ? json.matches : [];
      if (matches.length) {
        renderAiVolMatches(matches);
      }
    } catch (e) {
      try { aiVolAgentResults.lastChild && aiVolAgentResults.removeChild(aiVolAgentResults.lastChild); } catch (e2) {}
      if (aiVolAgentError) aiVolAgentError.textContent = 'שגיאה ברשת.';
    }
  }
  if (role === 'sick') {
    [aiAgentLaunch, aiAgentLaunchFooter].forEach(function(el) {
      if (!el) return;
      el.addEventListener('click', function(e) {
        e.preventDefault();
        openAiAgentModal();
      });
    });
  }
  if (aiAgentClose) {
    aiAgentClose.addEventListener('click', function(e) {
      e.preventDefault();
      closeAiAgentModal();
    });
  }
  if (aiAgentSend) {
    aiAgentSend.addEventListener('click', function(e) {
      e.preventDefault();
      sendAiAgentMessage();
    });
  }
  if (aiAgentInput) {
    aiAgentInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendAiAgentMessage();
      }
      if (e.key === 'Escape') {
        closeAiAgentModal();
      }
    });
  }

  if (role === 'volunteer') {
    [aiVolAgentLaunch, aiVolAgentLaunchFooter].forEach(function(el) {
      if (!el) return;
      el.addEventListener('click', function(e) {
        e.preventDefault();
        openAiVolAgentModal();
      });
    });
  }
  if (aiVolAgentClose) {
    aiVolAgentClose.addEventListener('click', function(e) {
      e.preventDefault();
      closeAiVolAgentModal();
    });
  }
  if (aiVolAgentSend) {
    aiVolAgentSend.addEventListener('click', function(e) {
      e.preventDefault();
      sendAiVolAgentMessage();
    });
  }
  if (aiVolAgentInput) {
    aiVolAgentInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendAiVolAgentMessage();
      }
      if (e.key === 'Escape') {
        closeAiVolAgentModal();
      }
    });
  }

  // סוכן AI אוטומטי: Poll למעלה להתאמות שנמצאו בין מטופל למתנדב
  // כשיש התאמה חדשה — קופץ לבד למודל הנכון ומציג כפתורי "הצטרף"/"אשר".
  let autoAiKeyStorageKey = null;
  let lastAutoAiKey = '';
  try {
    const uid = window.currentUserId || '';
    autoAiKeyStorageKey = 'autoAiLastKey:' + uid + ':' + role;
    lastAutoAiKey = localStorage.getItem(autoAiKeyStorageKey) || '';
  } catch (e) {}
  async function pollAutoAiSuggestions() {
    try {
      if (!role) return;
      const res = await fetch('/api/ai/auto-suggestions/', {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const json = await safeJson(res);
      if (json.__error || json.error) return;

      if (role === 'sick') {
        const key = json.suggestion_key || '';
        const offers = Array.isArray(json.offers) ? json.offers : [];
        if (!key || !offers.length) return;
        if (key === lastAutoAiKey) return;
        lastAutoAiKey = key;
        try { if (autoAiKeyStorageKey) localStorage.setItem(autoAiKeyStorageKey, lastAutoAiKey); } catch (e) {}

        // reset conversation history so the initial message appears
        try { aiAgentHistory.length = 0; } catch (e) {}
        openAiAgentModal();
        renderAiAgentMatches(offers);
      } else if (role === 'volunteer') {
        const key = json.suggestion_key || '';
        const requests = Array.isArray(json.requests) ? json.requests : [];
        if (!key || !requests.length) return;
        if (key === lastAutoAiKey) return;
        lastAutoAiKey = key;
        try { if (autoAiKeyStorageKey) localStorage.setItem(autoAiKeyStorageKey, lastAutoAiKey); } catch (e) {}

        try { aiVolHistory.length = 0; } catch (e) {}
        openAiVolAgentModal();
        renderAiVolMatches(requests);
      }
    } catch (e) {
      // ignore network/polling errors
    }
  }

  // Poll only when modals exist on the page (and only for real users)
  if (!window.guestMode && ((role === 'sick' && aiAgentModal) || (role === 'volunteer' && aiVolAgentModal))) {
    pollAutoAiSuggestions();
    setInterval(pollAutoAiSuggestions, 10000);
  }

  function openOffersModal() {
    if (!aiModal) return;
    aiModal.style.display = 'block';
    if (aiOffersContainer && !aiOffersContainer.dataset.loaded) {
      // נטען כאן ישירות מהשרת כדי לא להיות תלויים בפונקציות אחרות
      aiOffersContainer.innerHTML = '<div class="field-hint">טוען נסיעות שפורסמו...</div>';
      fetch('/api/ai/offers/' + (window.guestMode ? '?guest=1' : ''), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(safeJson)
        .then(function(json) {
          if (json.__error || json.error) {
            aiOffersContainer.innerHTML = '<div class="field-error">שגיאה בטעינת נסיעות שפורסמו.</div>';
            return;
          }
          var offers = Array.isArray(json.offers) ? json.offers : [];
          if (!offers.length) {
            aiOffersContainer.innerHTML = '<div class="field-hint">אין כרגע נסיעות מתנדבים שפורסמו.</div>';
            return;
          }
          var cardsHtml = offers.map(function(o) {
            var text = o.raw_text || '';
            var who = o.volunteer_username ? ('מתנדב: ' + o.volunteer_username) : '';
            var joinBtnHtml = window.guestMode
              ? '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;opacity:0.6;cursor:not-allowed;" disabled>הצטרף</button>'
              : '<button type="button" class="btn-primary" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;" onclick="window.joinOffer && window.joinOffer(' + o.id + ', this)">הצטרף</button>';
            return (
              '<div class="card" data-offer-id="' + o.id + '" style="margin-bottom:10px;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;box-shadow:0 1px 2px rgba(15,23,42,0.04);">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                  '<div style="font-weight:700;color:#0f172a;font-size:0.98rem;">נסיעה מתנדב</div>' +
                  joinBtnHtml +
                '</div>' +
                '<div style="margin-bottom:4px;color:#111827;font-size:0.95rem;">' + text + '</div>' +
                '<div style="font-size:0.85rem;color:#6b7280;">' + who + '</div>' +
              '</div>'
            );
          }).join('');
          aiOffersContainer.innerHTML = cardsHtml;
          aiOffersContainer.dataset.loaded = '1';
        })
        .catch(function() {
          aiOffersContainer.innerHTML = '<div class="field-error">שגיאה ברשת בעת טעינת נסיעות שפורסמו.</div>';
        });
    }
  }

  function closeOffersModal() {
    if (aiModal) {
      aiModal.style.display = 'none';
    }
  }

  function handleRidePublishClick(e) {
    if (e) e.preventDefault();
    var role = window.currentUserRole || '';

    // מתנדב: גלילה לפאנל ולפתוח את הטופס הפנימי
    if (role === 'volunteer') {
      var vPanel = document.getElementById('volunteer-panel');
      var offerWrap = document.getElementById('vol-offer-wrap');
      if (offerWrap) {
        var isHidden = offerWrap.style.display === 'none' || !offerWrap.style.display;
        offerWrap.style.display = isHidden ? 'block' : 'none';
        // Update button text to match state
        try {
          if (aiLaunch) {
            aiLaunch.textContent = isHidden ? 'הסתר טופס' : publishBtnDefaultText;
          }
          if (footerRideLink) {
            footerRideLink.textContent = isHidden ? 'הסתר טופס' : publishBtnDefaultText;
          }
        } catch (e) {}
      }
      if (vPanel) {
        vPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // מטופל: מודל הצגת נסיעות שפורסמו
    if (role === 'sick' && aiModal) {
      var isOpen = aiModal.style.display === 'block';
      if (isOpen) {
        closeOffersModal();
      } else {
        openOffersModal();
      }
      return;
    }

    // ברירת מחדל – גלילה לראש הדף
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (aiLaunch) {
    aiLaunch.addEventListener('click', handleRidePublishClick);
  }

  // Sync initial label on load for volunteers (in case form is already open)
  if (role === 'volunteer') {
    try {
      var offerWrapInit = document.getElementById('vol-offer-wrap');
      var isOpen = offerWrapInit && offerWrapInit.style.display === 'block';
      if (aiLaunch) aiLaunch.textContent = isOpen ? 'הסתר טופס' : publishBtnDefaultText;
    } catch (e) {}
  }

  if (aiCancel) {
    aiCancel.addEventListener('click', function(e) {
      e.preventDefault();
      closeOffersModal();
    });
  }

  // למטופל יש טוגל נפרד לטופס "יצירת בקשה" בתוך הפאנל.

  // כפתור "הצג התאמות" (Agents demo)
  var showBtn = document.getElementById('show-agent-matches');
  if (showBtn) {
    showBtn.addEventListener('click', function() {
      window.location.href = '/agents/demo';
    });
  }

  // הצטרפות לנסיעה שפורסמה – יוצר בקשה ומסמן אצל המתנדב כנסיעה מאושרת
  if (typeof window !== 'undefined') {
    async function cancelJoinedRequest(requestId) {
      const res = await fetch(`/api/requests/cancel/${requestId}/`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const json = await safeJson(res);
      if (json.__error || json.error) {
        throw new Error(json.error || 'שגיאה בביטול נסיעה.');
      }
      return json;
    }

    window.joinOffer = async function(offerId, buttonEl) {
      try {
        if (window.guestMode) {
          alert('דמו אורח: אין אפשרות להצטרף לנסיעה ללא כניסה.');
          return;
        }
        const res = await fetch(`/api/ai/offers/${offerId}/join/`, {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const json = await safeJson(res);
        if (json.__error || json.error) {
          alert(json.error || 'שגיאה בהצטרפות לנסיעה.');
          return;
        }

        // Update the UI on the clicked button (map popup / card) immediately
        let joinedEl = null;
        try {
          if (buttonEl && buttonEl.parentNode) {
            buttonEl.style.display = 'none';
            joinedEl = document.createElement('div');
            joinedEl.style.cssText = 'margin-top:6px;font-weight:700;color:#059669;';
            joinedEl.textContent = 'הצטרפת לנסיעה';
            buttonEl.parentNode.appendChild(joinedEl);
          }
        } catch (e) {}
        // הסרת הנסיעה מהרשימה למעלה (מודל/כרטיסיות), כדי שלא תופיע שוב למטופל
        try {
          const container = document.getElementById('ai-offers-container');
          if (container) {
            const card = container.querySelector('.card[data-offer-id="' + offerId + '"]');
            if (card) {
              card.remove();
            }
            if (!container.querySelector('.card')) {
              container.innerHTML = '<div class="field-hint">אין כרגע נסיעות מתנדבים שפורסמו.</div>';
            }
          }
        } catch (e) {
          // אם יש בעיה ב־DOM לא מפילים את התהליך
        }
        const requestId = json.request_id;
        // No popup/modal. Inline cancel button instead.
        try {
          if (buttonEl && buttonEl.parentNode && requestId) {
            const parent = buttonEl.parentNode;
            const cancelInline = document.createElement('button');
            cancelInline.type = 'button';
            cancelInline.className = 'button';
            cancelInline.style.cssText = 'margin-top:8px;background:#ef4444;color:#fff;border:none;padding:6px 10px;border-radius:999px;cursor:pointer;font-weight:700;font-size:0.9rem;';
            cancelInline.textContent = 'בטל נסיעה';
            cancelInline.onclick = async () => {
              cancelInline.disabled = true;
              try {
                await cancelJoinedRequest(requestId);
                // Restore the join button inside the popup/card
                try {
                  joinedEl && joinedEl.remove();
                  cancelInline && cancelInline.remove();
                  buttonEl.style.display = 'inline-block';
                  buttonEl.textContent = 'הצטרף';
                } catch (e2) {}

                // Reload list/cards and refresh markers
                try {
                  if (aiOffersContainer) {
                    aiOffersContainer.dataset.loaded = '';
                    openOffersModal();
                  }
                } catch (e3) {}
                try { if (window.refreshOfferMarkers) window.refreshOfferMarkers(); } catch (e4) {}
                try { if (window.loadVolunteerOffers) window.loadVolunteerOffers(); } catch (e5) {}
              } catch (e2) {
                cancelInline.disabled = false;
                alert(e2 && e2.message ? e2.message : 'שגיאה בביטול נסיעה.');
              }
            };
            parent.appendChild(cancelInline);
          }
        } catch (e) {}

        // Refresh map markers so matched offer disappears immediately
        try {
          if (window.refreshOfferMarkers) window.refreshOfferMarkers();
        } catch (e) {}
      } catch (e) {
        alert('שגיאה ברשת בעת הצטרפות לנסיעה.');
      }
    };

    window.cancelOffer = async function(offerId) {
      if (window.guestMode) {
        alert('דמו אורח: אין אפשרות לבטל פרסום נסיעה ללא כניסה.');
        return;
      }
      if (!confirm('לבטל את פרסום הנסיעה הזו?')) return;
      try {
        const res = await fetch(`/api/ai/offer/${offerId}/cancel/`, {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const json = await safeJson(res);
        if (json.__error || json.error) {
          alert(json.error || 'שגיאה בביטול פרסום הנסיעה.');
          return;
        }
        try {
          if (window.loadVolunteerOffers) window.loadVolunteerOffers();
        } catch (e) {}
      } catch (e) {
        alert('שגיאה ברשת בעת ביטול פרסום הנסיעה.');
      }
    };
  }
});

// רשימת "הנסיעות שפרסמת" למתנדב (לא מוצג במפה, רק ברשימה)
document.addEventListener('DOMContentLoaded', function() {
  var role = window.currentUserRole || '';
  var volunteerOffersContainer = document.getElementById('volunteer-offers-container');
  var toggleMyOffersBtn = document.getElementById('toggle-my-offers-btn');
  if (role !== 'volunteer' || !volunteerOffersContainer) return;

  async function loadVolunteerOffers() {
    volunteerOffersContainer.innerHTML = '<div class="field-hint">טוען נסיעות שפרסמת...</div>';
    try {
      const res = await fetch('/api/ai/my-offers/' + (window.guestMode ? '?guest=1' : ''), {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const json = await safeJson(res);
      if (json.__error || json.error) {
        volunteerOffersContainer.innerHTML = '<div class="field-error">שגיאה בטעינת נסיעות שפרסמת.</div>';
        return;
      }
      const offers = Array.isArray(json.offers) ? json.offers : [];
      if (!offers.length) {
        volunteerOffersContainer.innerHTML = '<div class="field-hint">עדיין לא פרסמת נסיעות.</div>';
        return;
      }
      const cards = offers.map(function(o) {
        const sub = (o.from && o.to)
          ? ('<div style="font-weight:800;color:#0f172a;margin-bottom:4px;">' + 'מ־' + o.from + ' אל ' + o.to + '</div>')
          : '';
        const text = o.raw_text || '';
        const canCancel = o.status === 'open';
        // keep only useful details (date/time/notes/phone) without duplicating the route line
        let details = text;
        if (sub) {
          const m = details.match(/^נסיעה עתידית מ-(.+?)\s+אל\s+(.+?)\s+בתאריך\s+(\d{4}-\d{2}-\d{2})\s+בשעה\s+(\d{2}:\d{2})([\s\S]*)$/);
          if (m) {
            const suffix = (m[5] || '').trim();
            details = `בתאריך ${m[3]} בשעה ${m[4]}` + (suffix ? ` ${suffix}` : '');
          }
        }
        return (
          '<div class="card" data-my-offer-id="' + o.id + '" style="margin-bottom:10px;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;box-shadow:0 1px 2px rgba(15,23,42,0.04);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
              '<div style="font-weight:900;color:#0f172a;">נסיעה שפרסמת</div>' +
              (canCancel ? '<button type="button" class="button" style="padding:4px 10px;font-size:0.85rem;border-radius:999px;" onclick="window.cancelOffer && window.cancelOffer(' + o.id + ')">בטל פרסום</button>' : '') +
            '</div>' +
            (sub || '') +
            ('<div style="margin-top:6px;color:#111827;">' + details + '</div>') +
          '</div>'
        );
      }).join('');
      volunteerOffersContainer.innerHTML = cards;
    } catch (e) {
      volunteerOffersContainer.innerHTML = '<div class="field-error">שגיאה ברשת בעת טעינת נסיעות שפרסמת.</div>';
    }
  }

  if (typeof window !== 'undefined') {
    window.loadVolunteerOffers = loadVolunteerOffers;
  }

  if (toggleMyOffersBtn) {
    // initial state: hidden (button shows "הנסיעות שפרסמת")
    toggleMyOffersBtn.textContent = '🚗 נסיעות שפרסמת';
    toggleMyOffersBtn.addEventListener('click', function(e) {
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      try { toggleMyOffersBtn.blur(); } catch (err) {}

      const isHidden = volunteerOffersContainer.style.display === 'none' || !volunteerOffersContainer.style.display;
      volunteerOffersContainer.style.display = isHidden ? 'block' : 'none';
      toggleMyOffersBtn.textContent = isHidden ? 'הסתר נסיעות' : '🚗 נסיעות שפרסמת';
      if (isHidden) {
        // Load content only when opening
        loadVolunteerOffers()
          .catch(function() {})
          .finally(function() {
            // Don't force scroll positions; RTL can make scrollX behave oddly.
          });
      } else {
        // Don't force scroll positions; keep layout stable.
      }
    });
  }
});

// טופס פרסום נסיעה למתנדב בתוך volunteer-panel
document.addEventListener('DOMContentLoaded', function() {
  var form = document.getElementById('volunteer-publish-form');
  if (!form) return;
  var fromInput = document.getElementById('vol-offer-from');
  var fromWrap = document.getElementById('vol-offer-from-autocomplete');
  var fromLat = document.getElementById('vol-offer-from-lat');
  var fromLng = document.getElementById('vol-offer-from-lng');
  var fromErr = document.getElementById('vol-offer-from-error');

  var toInput = document.getElementById('vol-offer-to');
  var toWrap = document.getElementById('vol-offer-to-autocomplete');
  var toLat = document.getElementById('vol-offer-to-lat');
  var toLng = document.getElementById('vol-offer-to-lng');
  var toErr = document.getElementById('vol-offer-to-error');

  var dateEl = document.getElementById('vol-offer-date');
  var timeEl = document.getElementById('vol-offer-time');
  var notesEl = document.getElementById('vol-offer-notes');
  var phoneEl = document.getElementById('vol-offer-phone');
  var errorEl = document.getElementById('vol-offer-error');
  var successEl = document.getElementById('vol-offer-success');
  var submitBtn = document.getElementById('vol-offer-submit');

  // Google Places מחובר דרך setupPlaces/placesRetry – לא מחברים כאן שוב

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (window.guestMode) {
      if (errorEl) errorEl.textContent = 'דמו אורח: אין אפשרות לפרסם נסיעה בלי כניסה.';
      return;
    }
    if (errorEl) errorEl.textContent = '';
    if (successEl) { successEl.style.display = 'none'; successEl.textContent = ''; }

    var from = (fromInput && fromInput.value || '').trim();
    var to = (toInput && toInput.value || '').trim();
    var date = dateEl && dateEl.value;
    var time = timeEl && timeEl.value;
    var notes = (notesEl && notesEl.value || '').trim();
    var phone = (phoneEl && phoneEl.value || '').trim();

    if (!from || !to || !date || !time) {
      if (errorEl) errorEl.textContent = 'יש למלא מוצא, יעד, תאריך ושעה.';
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    fetch('/api/ai/offer/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify({
        from: from,
        to: to,
        date: date,
        time: time,
        notes: notes,
        phone: phone,
        from_lat: fromLat && fromLat.value,
        from_lng: fromLng && fromLng.value,
        to_lat: toLat && toLat.value,
        to_lng: toLng && toLng.value,
      }),
    })
      .then(safeJson)
      .then(function(json) {
        if (json.__error || json.error) {
          if (errorEl) errorEl.textContent = json.error || 'שגיאה בפרסום הנסיעה.';
          return;
        }
        if (successEl) {
          successEl.textContent = json.message || 'הנסיעה פורסמה בהצלחה.';
          successEl.style.display = 'block';
        }
        // ניקוי השדות
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        // Clear Google Places autocomplete widget too (it hides the original input)
        if (fromInput && fromInput.__placesElement && typeof fromInput.__placesElement.value !== 'undefined') {
          fromInput.__placesElement.value = '';
        }
        if (toInput && toInput.__placesElement && typeof toInput.__placesElement.value !== 'undefined') {
          toInput.__placesElement.value = '';
        }
        // remove placeholder text so fields look truly empty
        if (fromInput) fromInput.placeholder = '';
        if (toInput) toInput.placeholder = '';
        if (dateEl) dateEl.value = '';
        if (timeEl) timeEl.value = '';
        if (notesEl) notesEl.value = '';
        if (phoneEl) phoneEl.value = '';
        if (fromLat) fromLat.value = '';
        if (fromLng) fromLng.value = '';
        if (toLat) toLat.value = '';
        if (toLng) toLng.value = '';
        if (fromErr) fromErr.textContent = '';
        if (toErr) toErr.textContent = '';
        if (errorEl) errorEl.textContent = '';
        try {
          if (window.loadVolunteerOffers) window.loadVolunteerOffers();
        } catch (e) {}
      })
      .catch(function() {
        if (errorEl) errorEl.textContent = 'שגיאה ברשת בעת פרסום הנסיעה.';
      })
      .finally(function() {
        if (submitBtn) submitBtn.disabled = false;
      });
  });
});
// Suggest route for selected requests
async function suggestRoute() {
    // Track requests missing pickup/destination coordinates
    const missingPickup = [];
    const missingDest = [];
    const validRequestIds = [];
    // Read mode safely (fallback to pickup_then_dropoff)
    const mode = (typeof routeModeSelect !== 'undefined' && routeModeSelect && routeModeSelect.value)
      ? routeModeSelect.value
      : 'pickup_then_dropoff';
    // Parse start coordinates defensively: empty strings should not coerce to 0
    const parseCoord = (el) => {
      if (!el || typeof el.value === 'undefined' || el.value === null) return null;
      const v = String(el.value).trim();
      if (v === '') return null;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const startLat = parseCoord(routeStartLat);
    const startLng = parseCoord(routeStartLng);

    selectedRouteIds.forEach(id => {
      const meta = requestMeta.get(id) || {};
      if (!meta.hasPickupCoords) {
        missingPickup.push(id);
        return;
      }
      if (mode === 'pickup_then_dropoff' && !meta.hasDestCoords) {
        missingDest.push(id);
        return;
      }
      validRequestIds.push(id);
    });

    if (missingPickup.length > 0) {
      setRouteNotice('');
      setFieldError(routeError, 'יש בקשות ללא נקודת איסוף.');
      return;
    }
    if (missingDest.length > 0) {
      setRouteNotice('');
      setFieldError(routeError, 'יש בקשות ללא יעד. החלף למצב איסופים בלבד או עדכן כתובות.');
      return;
    }
    if (validRequestIds.length === 0) {
      setRouteNotice('');
      setFieldError(routeError, 'אין בקשות תקינות למסלול.');
      return;
    }
    routeSuggestBtn.disabled = true;
    setFieldError(routeError, '');
    if (routeResults) routeResults.innerHTML = '...מחשב מסלול';

    try {
      const res = await fetch('/api/route/suggest/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({
          start_lat: startLat,
          start_lng: startLng,
          request_ids: validRequestIds,
          mode,
        }),
      });
      const json = await safeJson(res);
      if (json.__error || !json.success) {
        const message = json.error || 'נכשל לחשב מסלול.';
        setFieldError(routeError, message);
        if (routeResults) routeResults.innerHTML = '';
        if (routeNavBtn) { routeNavBtn.disabled = true; routeNavBtn.removeAttribute('data-url'); }
        const _wb = document.getElementById('route-nav-waze-btn');
        if (_wb) { _wb.disabled = true; _wb.removeAttribute('data-url'); }
        return;
      }

      if (routeResults) {
        routeResults.innerHTML = '';

        if (!json.stops || json.stops.length === 0) {
          setFieldError(routeError, '');
          setRouteNotice(json.warning || 'אין בקשות עם קואורדינטות למסלול.');
          if (routeNavBtn) { routeNavBtn.disabled = true; routeNavBtn.removeAttribute('data-url'); }
          const _wb2 = document.getElementById('route-nav-waze-btn');
          if (_wb2) { _wb2.disabled = true; _wb2.removeAttribute('data-url'); }
          return;
        }

        const summary = document.createElement('div');
        // Defensive: ensure numeric totals exist before computing/formatting
        const totalMeters = Number.isFinite(Number(json.total_distance_m)) ? Number(json.total_distance_m) : 0;
        const totalSeconds = Number.isFinite(Number(json.total_duration_s)) ? Number(json.total_duration_s) : 0;
        const km = (totalMeters / 1000).toFixed(1);
        const mins = Math.round(totalSeconds / 60);
        const matrixSource = json.matrix_source || '';
        summary.className = 'route-stop';
        summary.textContent = `סה"כ: ${km} ק"מ · ${mins} דק' (${matrixSource})`;
        routeResults.appendChild(summary);

        if (json.warning) {
          setFieldError(routeError, '');
          setRouteNotice(json.warning);
        } else if (Array.isArray(json.skipped) && json.skipped.length > 0) {
          setFieldError(routeError, '');
          setRouteNotice(`דילוג על ${json.skipped.length} בקשות ללא קואורדינטות.`);
        } else {
          setFieldError(routeError, '');
          setRouteNotice('');
        }

        json.stops.forEach((stop, index) => {
          const item = document.createElement('div');
          item.className = 'route-stop';
          const typeLabel = stop.type === 'pickup' ? 'איסוף' : 'יעד';
          item.textContent = `${index + 1}. ${typeLabel} (#${stop.request_id}) - ${stop.label}`;
          routeResults.appendChild(item);
        });

        const linksRes = await fetch('/api/route/links/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify({
            start: { lat: startLat, lng: startLng },
            stops: json.stops.map(stop => ({ lat: stop.lat, lng: stop.lng })),
          }),
        });
        const linksJson = await safeJson(linksRes);
        if (!linksJson.__error && linksJson.google_full_route) {
          const fullBtn = document.createElement('a');
          fullBtn.href = linksJson.google_full_route;
          fullBtn.target = '_blank';
          fullBtn.rel = 'noopener';
          fullBtn.className = 'button';
          fullBtn.textContent = 'Open full route in Google Maps';
          routeResults.appendChild(fullBtn);

          if (linksJson.warning) {
            setFieldError(routeError, linksJson.warning);
          }

          const list = document.createElement('div');
          list.style.marginTop = '8px';
          // Defensive: ensure arrays exist before iterating and lengths match
          const googleLegs = Array.isArray(linksJson.google_legs) ? linksJson.google_legs : [];
          const wazeLegs = Array.isArray(linksJson.waze_legs) ? linksJson.waze_legs : [];
          googleLegs.forEach((url, idx) => {
            const row = document.createElement('div');
            row.className = 'route-stop';
            const googleLink = document.createElement('a');
            googleLink.href = url;
            googleLink.target = '_blank';
            googleLink.rel = 'noopener';
            googleLink.textContent = `Google ${idx + 1}`;
            googleLink.className = 'button';
            const wazeLink = document.createElement('a');
            wazeLink.href = wazeLegs[idx] || '#';
            wazeLink.target = '_blank';
            wazeLink.rel = 'noopener';
            wazeLink.textContent = `Waze ${idx + 1}`;
            wazeLink.className = 'button';
            row.appendChild(googleLink);
            row.appendChild(wazeLink);
            list.appendChild(row);
          });
          routeResults.appendChild(list);
        }
      }

      if (map) {
        if (routeLine) {
          map.removeLayer(routeLine);
        }
        if (routeStartMarker) {
          map.removeLayer(routeStartMarker);
        }
        // Build coords defensively and only add valid numeric coordinate pairs
        const stopsCoords = Array.isArray(json.stops) ? json.stops.map(stop => [Number(stop.lat), Number(stop.lng)]) : [];
        const startCoord = (Number.isFinite(startLat) && Number.isFinite(startLng)) ? [[startLat, startLng]] : [];
        const coords = [...startCoord, ...stopsCoords].filter(pair =>
          Array.isArray(pair) && pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
        );

        if (coords.length > 0) {
          routeLine = L.polyline(coords, { color: '#f97316', weight: 4 }).addTo(map);
          if (startCoord.length > 0) {
            routeStartMarker = L.circleMarker([startLat, startLng], {
              radius: 6,
              color: '#0f172a',
              fillColor: '#f97316',
              fillOpacity: 1,
            }).addTo(map);
          }
          // Only call fitBounds when polyline has valid bounds
          try {
            const bounds = routeLine.getBounds();
            if (bounds && bounds.isValid && bounds.isValid()) {
              map.fitBounds(bounds, { padding: [24, 24] });
            } else {
              map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });
            }
          } catch (_) {
            // ignore map errors
          }
        }
      }

      if (routeNavBtn) {
        if (!json.stops || json.stops.length === 0) {
          routeNavBtn.disabled = true;
          routeNavBtn.removeAttribute('data-url');
          const wazeBtn = document.getElementById('route-nav-waze-btn');
          if (wazeBtn) { wazeBtn.disabled = true; wazeBtn.removeAttribute('data-url'); }
          return;
        }
        const dest = json.stops[json.stops.length - 1];
        const waypoints = json.stops
          .slice(0, -1)
          .map(stop => `${stop.lat},${stop.lng}`)
          .join('|');
        const url = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${dest.lat},${dest.lng}` +
          (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '');
        routeNavBtn.disabled = false;
        routeNavBtn.dataset.url = url;
        const firstStop = json.stops[0];
        const wazeUrl = `https://waze.com/ul?ll=${firstStop.lat},${firstStop.lng}&navigate=yes`;
        const wazeBtn = document.getElementById('route-nav-waze-btn');
        if (wazeBtn) { wazeBtn.disabled = false; wazeBtn.dataset.url = wazeUrl; }
      }
    } catch (err) {
      setFieldError(routeError, 'בעיה בחישוב המסלול.');
      if (routeResults) routeResults.innerHTML = '';
      const wazeBtn = document.getElementById('route-nav-waze-btn');
      if (wazeBtn) { wazeBtn.disabled = true; wazeBtn.removeAttribute('data-url'); }
    } finally {
      updateRouteButtonState();
      // Focus and bound map to Israel
      if (window.map && window.map.fitBounds) {
        window.map.fitBounds([
          [ISRAEL_BOUNDS.south, ISRAEL_BOUNDS.west],
          [ISRAEL_BOUNDS.north, ISRAEL_BOUNDS.east]
        ]);
      }
      if (window.map && window.map.setMaxBounds) {
        window.map.setMaxBounds([
          [ISRAEL_BOUNDS.south, ISRAEL_BOUNDS.west],
          [ISRAEL_BOUNDS.north, ISRAEL_BOUNDS.east]
        ]);
      }
    }
}
// CSRF helper
function getCookie(name) {
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? v.pop() : '';
}

async function safeJson(res) {
  const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json') && !contentType.includes('text/html')) {
    const text = await res.text();
    return { __error: true, status: res.status, text };
  }

  try {
    return await res.json();
  } catch (err) {
    return { __error: true, status: res.status, text: String(err) };
  }
}

// אל תאפס __placesReady/__placesInit כאן – layout.html כבר מאתחל, ואיפוס אחרי טעינת Google יבטל את החיפוש
if (typeof window.__placesReady === 'undefined') window.__placesReady = false;
if (typeof window.__placesInit === 'undefined') window.__placesInit = null;

window.initPlaces = function initPlaces() {
  window.__placesReady = true;
  if (typeof window.__placesInit === 'function') {
    window.__placesInit();
  }
};

function setFieldError(el, message) {
  if (!el) return;
  el.textContent = message || '';
}

const ISRAEL_BOUNDS = {
  north: 33.3327,
  south: 29.4533,
  west: 34.2085,
  east: 35.8950,
};

function applyIsraelRestriction(element) {
  if (!element) return;
    if (element.setComponentRestrictions) {
      element.setComponentRestrictions({ country: 'IL' });
    }
    if (element.setBounds) {
      element.setBounds({
        north: ISRAEL_BOUNDS.north,
        south: ISRAEL_BOUNDS.south,
        west: ISRAEL_BOUNDS.west,
        east: ISRAEL_BOUNDS.east,
      });
    }
    // If using Leaflet or Google Maps directly, restrict map view as well
    if (window.map && window.map.setMaxBounds) {
      window.map.setMaxBounds([
        [ISRAEL_BOUNDS.south, ISRAEL_BOUNDS.west],
        [ISRAEL_BOUNDS.north, ISRAEL_BOUNDS.east]
      ]);
    }
  try {
    element.setAttribute('componentRestrictions', JSON.stringify({ country: 'il' }));
    element.setAttribute('locationRestriction', JSON.stringify(ISRAEL_BOUNDS));
    element.setAttribute('locationBias', JSON.stringify(ISRAEL_BOUNDS));
  } catch (_) {
    // Ignore attribute errors for older builds.
  }

// --- Error tracker: שולח שגיאות דפדפן לשרת (errors.log) ---
(function initErrorTracker() {
  try {
    const originalError = window.console && window.console.error ? window.console.error.bind(window.console) : null;
    const originalWarn = window.console && window.console.warn ? window.console.warn.bind(window.console) : null;

    const sent = new Map(); // key -> lastSentMs
    function shouldSend(key) {
      const now = Date.now();
      const last = sent.get(key) || 0;
      if (now - last < 3000) return false; // debounce duplicates
      sent.set(key, now);
      return true;
    }

    function baseExtra() {
      return {
        user_id: window.currentUserId || '',
        username: window.currentUserUsername || '',
        role: window.currentUserRole || '',
        user_agent: navigator.userAgent,
        path: window.location.pathname,
        href: window.location.href,
      };
    }

    function sendError(payload) {
      try {
        const body = JSON.stringify({
          ...payload,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          kind: "client",
          extra: {
            ...baseExtra(),
            ...(payload.extra || {}),
          },
        });

        // Prefer sendBeacon for reliability (on unload)
        if (navigator.sendBeacon) {
          const ok = navigator.sendBeacon("/api/errors/", new Blob([body], { type: "application/json" }));
          if (ok) return;
        }

        fetch("/api/errors/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch (_e) {
        // ignore
      }
    }

    window.addEventListener("error", function (event) {
      try {
        const message = event.message || String(event.error || "");
        const stack = event.error && event.error.stack ? String(event.error.stack) : "";
        const source = event.filename || "";
        const line = event.lineno;
        const column = event.colno;
        const key = `error:${message}:${source}:${line}:${column}`;
        if (!shouldSend(key)) return;
        sendError({ message, stack, source, line, column });
      } catch (_e) {}
    });

    window.addEventListener("unhandledrejection", function (event) {
      try {
        const reason = event && event.reason;
        const message = reason && reason.message ? String(reason.message) : String(reason || "Unhandled promise rejection");
        const stack = reason && reason.stack ? String(reason.stack) : "";
        const key = `rejection:${message}`;
        if (!shouldSend(key)) return;
        sendError({ message, stack, source: "unhandledrejection" });
      } catch (_e) {}
    });

    window.console.error = function (...args) {
      try {
        const message = args.map(a => (a instanceof Error ? (a.message || String(a)) : String(a))).join(" ");
        const key = `console.error:${message}`;
        if (shouldSend(key)) {
          const err = args.find(a => a instanceof Error);
          sendError({ message, stack: err && err.stack ? String(err.stack) : "", source: "console.error" });
        }
      } catch (_e) {}
      if (originalError) originalError(...args);
    };

    // Optional: warn helps catch “role is not defined” precursors
    window.console.warn = function (...args) {
      try {
        const message = args.map(String).join(" ");
        const key = `console.warn:${message}`;
        if (shouldSend(key)) {
          sendError({ message, stack: "", source: "console.warn" });
        }
      } catch (_e) {}
      if (originalWarn) originalWarn(...args);
    };
  } catch (_e) {}
})();
}

function normalizeIsraeliPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  let stripped = digits;

  if (stripped.startsWith('972')) {
    stripped = stripped.slice(3);
  }
  if (stripped.startsWith('0')) {
    stripped = stripped.slice(1);
  }

  const isValid = stripped.length === 8 || stripped.length === 9;
  const validPrefix = stripped.length > 0 && /[2345789]/.test(stripped[0]);

  if (!isValid || !validPrefix) {
    return { valid: false, normalized: '' };
  }

  return { valid: true, normalized: `+972${stripped}` };
}

function isIsraelAddress(result) {
  const components = (result && result.address_components) || [];
  const country = components.find(c => Array.isArray(c.types) && c.types.includes('country'));
  if (country) {
    return country.short_name === 'IL' || country.long_name === 'Israel' || country.long_name === 'ישראל';
  }
  const loc = result && result.geometry && result.geometry.location;
  const lat = loc && (typeof loc.lat === 'function' ? loc.lat() : loc.lat);
  const lng = loc && (typeof loc.lng === 'function' ? loc.lng() : loc.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return lat >= ISRAEL_BOUNDS.south && lat <= ISRAEL_BOUNDS.north && lng >= ISRAEL_BOUNDS.west && lng <= ISRAEL_BOUNDS.east;
  }
  return false;
}

function geocodeAddress(address) {
  return new Promise(resolve => {
    if (!address || !window.google || !google.maps || !google.maps.Geocoder) {
      console.error('geocodeAddress: חסר address או google.maps.Geocoder', { address, google });
      resolve(null);
      return;
    }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address, region: 'IL' }, (results, status) => {
      console.log('geocodeAddress:', { address, status, results });
      if (status === 'OK' && results && results[0] && results[0].geometry && results[0].geometry.location) {
        if (!isIsraelAddress(results[0])) {
          console.warn('geocodeAddress: לא בישראל', results[0]);
          resolve(null);
          return;
        }
        const loc = results[0].geometry.location;
        console.log('geocodeAddress: נמצא מיקום', { lat: loc.lat(), lng: loc.lng(), formatted: results[0].formatted_address });
        resolve({ lat: loc.lat(), lng: loc.lng(), formatted: results[0].formatted_address });
        return;
      }
      console.error('geocodeAddress: נכשל', { address, status, results });
      resolve(null);
	  });
  });
}

function reverseGeocode(lat, lng) {
  return new Promise(resolve => {
    if (!window.google || !google.maps || !google.maps.Geocoder) {
      console.warn('reverseGeocode: Geocoder not available');
      window.__lastReverseGeocode = { status: 'NO_GEOCODER', results: null };
      resolve(null);
      return;
    }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      console.warn('reverseGeocode status:', status, 'results:', results && results[0]);
      window.__lastReverseGeocode = { status, results: results && results[0] };
      if (status === 'OK' && results && results[0] && results[0].formatted_address) {
        resolve(results[0].formatted_address);
        return;
      }
      console.warn('reverseGeocode: no address');
      resolve(null);
	  }); // closes forEach
  });
}

function attachPlacesAutocomplete(input, container, onPlaceSelected) {
  if (!input || !window.google || !google.maps || !google.maps.places) {
    return;
  }
  if (input.__placesElement) return;
  if (google.maps.places.PlaceAutocompleteElement && container) {
    const element = new google.maps.places.PlaceAutocompleteElement();
    // --- ISRAEL-ONLY SUGGESTIONS FILTER ---
    const origRender = element.renderSuggestions;
    element.renderSuggestions = function(suggestions) {
      if (Array.isArray(suggestions)) {
        suggestions = suggestions.filter(s => {
          if (s && s.place && s.place.addressComponents) {
            return s.place.addressComponents.some(c => c && c.types && c.types.includes('country') && c.shortName === 'IL');
          }
          if (s && s.place && s.place.formattedAddress) {
            return /ישראל|Israel|IL/.test(s.place.formattedAddress);
          }
          if (s && s.description) {
            return /ישראל|Israel|IL/.test(s.description);
          }
          return false;
        });
      }
      if (origRender) return origRender.call(this, suggestions);
    };
    let ignoreUntil = 0;
    let selectedDisplayValue = '';
    let lastSelectedAt = 0;
    let lastObservedValue = '';
    element.classList.add('place-autocomplete');
    element.setAttribute('placeholder', input.getAttribute('placeholder') || '');
    element.setAttribute('fields', 'formattedAddress,location');
    // element.setAttribute('types', 'address'); // Removed: not supported in this API version
    applyIsraelRestriction(element);
    container.innerHTML = '';
    container.appendChild(element);
    input.style.display = 'none';
    input.__placesElement = element;

        const handlePlace = async place => {
          let errorEl = null;
          if (input.id && input.id.includes('pickup')) {
            errorEl = document.getElementById('pickup-error');
          } else if (input.id && input.id.includes('destination')) {
            errorEl = document.getElementById('destination-error');
          }

          if (!place) {
            onPlaceSelected(null);
            setFieldError(errorEl, 'לא נבחרה כתובת מהרשימה.');
            return;
          }

          try {
            if (typeof place.fetchFields === 'function') {
              await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
            }

            const address = place.formattedAddress || place.name || input.value;
            const location = place.location;

            console.log('handlePlace:', { address, location });

            if (!address) {
              setFieldError(errorEl, 'שגיאה: לא התקבלה כתובת.');
              onPlaceSelected(null);
              return;
            }

            if (!location) {
              const geo = await geocodeAddress(address);
              if (geo && geo.lat && geo.lng) {
                input.value = address;
                onPlaceSelected({ address, lat: geo.lat, lng: geo.lng });
              } else {
                setFieldError(errorEl, 'שגיאה: לא ניתן לאתר קואורדינטות.');
                onPlaceSelected(null);
              }
              return;
            }

            const lat = typeof location.lat === 'function' ? location.lat() : Number(location.lat);
            const lng = typeof location.lng === 'function' ? location.lng() : Number(location.lng);

            if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
              const geo = await geocodeAddress(address);
              if (geo && geo.lat && geo.lng) {
                input.value = address;
                onPlaceSelected({ address, lat: geo.lat, lng: geo.lng });
              } else {
                setFieldError(errorEl, 'שגיאה: קואורדינטות לא תקינות.');
                onPlaceSelected(null);
              }
              return;
            }

            input.value = address;
            input.__lastSelectedAt = Date.now();
            onPlaceSelected({ address, lat, lng });

          } catch (err) {
            console.error('handlePlace error:', err);
            setFieldError(errorEl, 'שגיאה פנימית בבחירת כתובת.');
            onPlaceSelected(null);
          }
        };

    element.addEventListener('gmp-placeselect', async event => {
      let place = null;

      if (event.placePrediction && typeof event.placePrediction.toPlace === 'function') {
        place = event.placePrediction.toPlace();
      } else if (event.mh && typeof event.mh.toPlace === 'function') {
        place = event.mh.toPlace();
      } else {
        place = event.place || (event.detail && event.detail.place);
      }

      if (place && typeof place.fetchFields === 'function') {
        try {
          await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
        } catch (err) {
          console.warn('fetchFields failed', err);
        }
      }

// לחשוף ל-scripts חיצוניים (למשל מודל פרסום נסיעות ב-layout)
if (typeof window !== 'undefined') {
  window.attachPlacesAutocomplete = attachPlacesAutocomplete;
}

      await handlePlace(place);
    }); // closes forEach

    element.addEventListener('gmp-select', async event => {
      console.log('gmp-select event:', event);
      let place = null;

      // API חדש — placePrediction
      if (event.placePrediction && typeof event.placePrediction.toPlace === 'function') {
        place = event.placePrediction.toPlace();
        console.log('place from placePrediction.toPlace():', place);
      }
      // API ישן — mh
      else if (event.mh && typeof event.mh.toPlace === 'function') {
        place = event.mh.toPlace();
        console.log('place from mh.toPlace():', place);
      }
      // fallback רגיל
      else {
        place = event.place || (event.detail && event.detail.place);
      }

      if (place && typeof place.fetchFields === 'function') {
        try {
          await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
          console.log('after fetchFields:', {
            formattedAddress: place.formattedAddress,
            location: place.location,
          });
        } catch (err) {
          console.warn('fetchFields failed', err);
        }
      }

      await handlePlace(place);
    });

    function evaluateCurrentValue() {
      // Basic validation for address input
      const value = element.value;
      let errorEl = null;
      if (element.id && element.id.includes('pickup')) {
        errorEl = document.getElementById('pickup-error');
      } else if (element.id && element.id.includes('destination')) {
        errorEl = document.getElementById('destination-error');
      }
      if (!value || value.length < 3) {
        setFieldError && setFieldError(errorEl, 'יש להזין כתובת תקינה');
        return;
      }
      setFieldError && setFieldError(errorEl, '');
      // No onPlaceSelected(null) here
    }
    element.addEventListener('input', () => {
      // אל תאפס אם זה input שמגיע מיד אחרי בחירה מהרשימה
      if (Date.now() - lastSelectedAt < 1500) return;
      evaluateCurrentValue();
    });
    element.addEventListener('change', () => {
      if (Date.now() - lastSelectedAt < 1500) return;
      evaluateCurrentValue();
    });
      lastSelectedAt = Date.now();
      lastSelectedAt = Date.now();
      // Removed poller
      return;
    }
}

function runAppInit() {
  const israelCenter = [
    (ISRAEL_BOUNDS.south + ISRAEL_BOUNDS.north) / 2,
    (ISRAEL_BOUNDS.west + ISRAEL_BOUNDS.east) / 2
  ];
  const israelBounds = [
    [ISRAEL_BOUNDS.south, ISRAEL_BOUNDS.west],
    [ISRAEL_BOUNDS.north, ISRAEL_BOUNDS.east]
  ];

  const requestsContainer = document.getElementById('requests-container');
  const closedContainer = document.getElementById('closed-requests-container');
  const acceptedContainer = document.getElementById('accepted-requests-container');
  const createForm = document.getElementById('create-request-form');
  const createRequestWrap = document.getElementById('create-request-wrap');
  const toggleCreateRequestBtn = document.getElementById('toggle-create-request-btn');
  const showClosedBtn = document.getElementById('show-closed-btn');
  const showAcceptedBtn = document.getElementById('show-accepted-btn');
  const showOpenBtns = document.querySelectorAll('#show-open-btn');
  const role = window.currentUserRole || '';
  const guestMode = window.guestMode === true;
  const guestSimpleQuery = guestMode ? '?guest=1' : '';
  const guestRequestsQuery = guestMode ? '?guest=1&role=' + encodeURIComponent(role) : '';
  const mapEl = document.getElementById('requests-map');
  const patientMapEl = document.getElementById('patient-map');
  const toggleVolunteerMapBtn = document.getElementById('toggle-volunteer-map');
  const toggleVolunteerMapTopBtn = document.getElementById('toggle-volunteer-map-top');
  const volunteerMapWrap = document.getElementById('volunteer-map-wrap');
  const toggleRoutePlanBtn = document.getElementById('toggle-route-plan-btn');
  const routePlanningWrap = document.getElementById('route-planning-wrap');
  const togglePatientMapBtn = document.getElementById('toggle-patient-map');
  const togglePatientMapTopBtn = document.getElementById('toggle-patient-map-top');
  const routeStartLat = document.getElementById('route-start-lat');
  const routeStartLng = document.getElementById('route-start-lng');
  const routeStartInput = document.getElementById('route-start-input');
  const routeStartAutocomplete = document.getElementById('route-start-autocomplete');
  const routeUseLocationBtn = document.getElementById('route-use-location');
  const routeSuggestBtn = document.getElementById('route-suggest-btn');
  const routeNavBtn = document.getElementById('route-nav-btn');
  const routeNavWazeBtn = document.getElementById('route-nav-waze-btn');
  const routeModeSelect = document.getElementById('route-mode');
  const routeResults = document.getElementById('route-results');
  const routeError = document.getElementById('route-error');
  const routeNotice = document.getElementById('route-notice');
  // זה הבאדום
  let map = null;
  let markersLayer = null;
  let offersLayer = null;
  let patientMap = null;
  let patientOffersLayer = null;
  let patientPickupMarker = null;
  let patientDestMarker = null;
  let patientVolunteerMarker = null;
  let routeLine = null;
  let routeStartMarker = null;
  const selectedRouteIds = new Set();
  const requestMeta = new Map();
  let patientLiveInterval = null;
  let patientLiveSetupTimer = null;
  let volunteerWatchId = null;
  let volunteerActiveRequestId = null;
  let volunteerPickupLat = null;
  let volunteerPickupLng = null;
  let volunteerLiveTimer = null;
  let volunteerSharingEnabled = false;

  // אם הוספנו כפתור למעלה - נסתיר את הכפתור הקטן למטה.
  try {
    if (toggleVolunteerMapTopBtn && toggleVolunteerMapBtn) toggleVolunteerMapBtn.style.display = 'none';
    if (togglePatientMapTopBtn && togglePatientMapBtn) togglePatientMapBtn.style.display = 'none';
  } catch (e) {}

  // למטופל: טוגל נפרד ל"יצירת בקשה" (פותח/סוגר רק את הטופס)
  if (toggleCreateRequestBtn && createRequestWrap) {
    function isCreateHidden() {
      return createRequestWrap.style.display === 'none' || !createRequestWrap.style.display;
    }

    function syncToggleLabel() {
      toggleCreateRequestBtn.textContent = isCreateHidden() ? '✚ יצירת בקשה' : '✖ הסתר יצירת בקשה';
    }

    syncToggleLabel();

    toggleCreateRequestBtn.addEventListener('click', () => {
      const hidden = isCreateHidden();
      createRequestWrap.style.display = hidden ? 'block' : 'none';
      syncToggleLabel();
      if (!hidden) {
        // מרגיש טבעי: גלילה קטנה ליצירת בקשה כשהיא נפתחת
        try { createRequestWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      }
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function isInsideIsrael(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= ISRAEL_BOUNDS.south &&
      lat <= ISRAEL_BOUNDS.north &&
      lng >= ISRAEL_BOUNDS.west &&
      lng <= ISRAEL_BOUNDS.east
    );
  }

  const pickupInput = document.getElementById('pickup-input');
  const pickupAutocomplete = document.getElementById('pickup-autocomplete');
  const destinationInput = document.getElementById('destination-input');
  const destinationAutocomplete = document.getElementById('destination-autocomplete');
  const pickupLatInput = document.getElementById('pickup-lat');
  const pickupLngInput = document.getElementById('pickup-lng');
  const destLatInput = document.getElementById('dest-lat');
  const destLngInput = document.getElementById('dest-lng');
  const pickupError = document.getElementById('pickup-error');
  const destinationError = document.getElementById('destination-error');
  const phoneInput = document.getElementById('phone-input');
  const phoneError = document.getElementById('phone-error');
  const dateInput = createForm ? createForm.querySelector('input[name="date"]') : null;
  const timeInput = createForm ? createForm.querySelector('input[name="time"]') : null;
  const createTimeError = document.getElementById('create-time-error');
  let createFormError = document.getElementById('create-form-error');
  let createFormNotice = document.getElementById('create-form-notice');

  const editModal = document.getElementById('edit-modal');
  const editForm = document.getElementById('edit-request-form');
  const editRequestId = document.getElementById('edit-request-id');
  const editPickupInput = document.getElementById('edit-pickup-input');
  const editPickupAutocomplete = document.getElementById('edit-pickup-autocomplete');
  const editDestinationInput = document.getElementById('edit-destination-input');
  const editDestinationAutocomplete = document.getElementById('edit-destination-autocomplete');
  const editPickupLat = document.getElementById('edit-pickup-lat');
  const editPickupLng = document.getElementById('edit-pickup-lng');
  const editDestLat = document.getElementById('edit-dest-lat');
  const editDestLng = document.getElementById('edit-dest-lng');
  const editTimeInput = document.getElementById('edit-time-input');
  const editNotesInput = document.getElementById('edit-notes-input');
  const editPickupError = document.getElementById('edit-pickup-error');
  const editDestinationError = document.getElementById('edit-destination-error');
  const editTimeError = document.getElementById('edit-time-error');
  const editSubmitBtn = document.getElementById('edit-submit-btn');

  // שדות טופס פרסום נסיעה למתנדב
  const volOfferFromInput = document.getElementById('vol-offer-from');
  const volOfferFromAutocomplete = document.getElementById('vol-offer-from-autocomplete');
  const volOfferFromLat = document.getElementById('vol-offer-from-lat');
  const volOfferFromLng = document.getElementById('vol-offer-from-lng');
  const volOfferFromError = document.getElementById('vol-offer-from-error');

  const volOfferToInput = document.getElementById('vol-offer-to');
  const volOfferToAutocomplete = document.getElementById('vol-offer-to-autocomplete');
  const volOfferToLat = document.getElementById('vol-offer-to-lat');
  const volOfferToLng = document.getElementById('vol-offer-to-lng');
  const volOfferToError = document.getElementById('vol-offer-to-error');

  const createState = {
    pickupValid: false,
    destinationValid: false,
    phoneValid: false,
    timeValid: false,
  };

  const editState = {
    pickupValid: false,
    destinationValid: false,
    timeValid: true,
  };

  // בכוונה אין כאן "נסיעות מתנדבים" למתנדב.

  async function loadPublishedOffers(target) {
    const container = target || publishedOffersContainer;
    if (!container) return;
    container.innerHTML = '<div class="field-hint">טוען נסיעות שפורסמו...</div>';
    try {
      const res = await fetch('/api/ai/offers/', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const json = await safeJson(res);
      if (json.__error || json.error) {
        container.innerHTML = '<div class="field-error">שגיאה בטעינת נסיעות שפורסמו.</div>';
        return;
      }
      const offers = Array.isArray(json.offers) ? json.offers : [];
      if (!offers.length) {
        container.innerHTML = '<div class="field-hint">אין כרגע נסיעות מתנדבים שפורסמו.</div>';
        return;
      }
      const cardsHtml = offers.map(o => {
        const text = o.raw_text || '';
        const who = o.volunteer_username ? `מתנדב: ${o.volunteer_username}` : '';
        return `
          <div class="card" style="margin-bottom:8px;padding:8px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;">
            <div style="font-weight:600;margin-bottom:4px;">${text}</div>
            <div style="font-size:0.9em;color:#6b7280;">${who}</div>
          </div>
        `;
      }).join('');
      container.innerHTML = cardsHtml;
      container.dataset.loaded = '1';
    } catch (e) {
      console.error('loadPublishedOffers error', e);
      container.innerHTML = '<div class="field-error">שגיאה ברשת בעת טעינת נסיעות שפורסמו.</div>';
    }
  }

  // לחשוף לפונקציות למעלה (כפתור המודל בדף הבית)
  if (typeof window !== 'undefined') {
    window.loadPublishedOffers = loadPublishedOffers;
  }

  function isDateTimeInPast(val) {
    if (!val || typeof val !== 'string') return false;
    const d = new Date(val.replace(' ', 'T'));
    return !isNaN(d.getTime()) && d.getTime() < Date.now();
  }

  function isRequestExpired(r) {
    if (r.expired === true) return true;
    if (r.requested_time) {
      const s = String(r.requested_time).replace(' ', 'T');
      return isDateTimeInPast(s);
    }
    return false;
  }

  // סוגר את מודאל העריכה (ביטול / X) – בלי קפיצת גלילה
  function closeEditModal() {
    if (!editModal) return;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    editModal.classList.remove('open');
    editModal.setAttribute('aria-hidden', 'true');
  }

  // פותח את מודאל העריכה וממלא את השדות (מטופל)
  function openEditModal(request) {
    if (!editModal || !editForm) {
      console.error('editModal or editForm missing');
      return;
    }

    if (editRequestId) editRequestId.value = request.id || '';
    const pickupText = (request.pickup || request.pickup_address || '').trim();
    const destText = (request.destination || request.dest || '').trim();

    if (editPickupInput) {
      editPickupInput.value = pickupText;
      if (editPickupInput.__placesElement && editPickupInput.__placesElement.value !== undefined) {
        editPickupInput.__placesElement.value = pickupText;
      }
    }
    if (editPickupLat) editPickupLat.value = request.pickup_lat ?? '';
    if (editPickupLng) editPickupLng.value = request.pickup_lng ?? '';
    if (editDestinationInput) {
      editDestinationInput.value = destText;
      if (editDestinationInput.__placesElement && editDestinationInput.__placesElement.value !== undefined) {
        editDestinationInput.__placesElement.value = destText;
      }
    }
    if (editDestLat) editDestLat.value = request.dest_lat ?? '';
    if (editDestLng) editDestLng.value = request.dest_lng ?? '';
    if (editTimeInput && request.requested_time) {
      editTimeInput.value = String(request.requested_time).replace(' ', 'T');
    }
    if (editNotesInput) editNotesInput.value = request.notes || '';

    if (editPickupError) editPickupError.textContent = '';
    if (editDestinationError) editDestinationError.textContent = '';
    if (editTimeError) editTimeError.textContent = '';

    editState.pickupValid = Boolean(pickupText && request.pickup_lat != null && request.pickup_lng != null);
    editState.destinationValid = Boolean(destText && request.dest_lat != null && request.dest_lng != null);
    const editTimeVal = editTimeInput ? editTimeInput.value : '';
    const editTimeInPast = editTimeVal && isDateTimeInPast(editTimeVal);
    editState.timeValid = Boolean(editTimeVal) && !editTimeInPast;
    if (editTimeError) editTimeError.textContent = editTimeInPast ? 'התאריך חלף' : '';
    updateEditSubmitState();

    editModal.classList.add('open');
    editModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (editModal && editModal.classList.contains('open')) {
        editModal.focus({ preventScroll: true });
      }
    });
  }

  function formatRoute(pickup, destination) {
    const isRtl = (document.documentElement.dir || '').toLowerCase() === 'rtl';
    const arrow = isRtl ? '←' : '→';
    return `${pickup} ${arrow} ${destination}`;
  }

  function updateRouteButtonState() {
    if (!routeSuggestBtn) return;
    const lat = Number(routeStartLat && routeStartLat.value);
    const lng = Number(routeStartLng && routeStartLng.value);
    const hasCoords = isInsideIsrael(lat, lng);
    const hasAddress = Boolean(routeStartInput && routeStartInput.value);
    const hasStart = hasCoords || hasAddress;
    // Guest demo is read-only: disable route planning actions.
    routeSuggestBtn.disabled = guestMode || !hasStart || selectedRouteIds.size === 0;
  }

  function setRouteNotice(message) {
    if (!routeNotice) return;
    routeNotice.textContent = message || '';
  }

  function clearRouteUI() {
    if (routeResults) {
      routeResults.innerHTML = '';
    }
    if (routeNavBtn) {
      routeNavBtn.disabled = true;
      routeNavBtn.removeAttribute('data-url');
    }
    if (routeNavWazeBtn) {
      routeNavWazeBtn.disabled = true;
      routeNavWazeBtn.removeAttribute('data-url');
    }
    if (routeLine && map) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    if (routeStartMarker && map) {
      map.removeLayer(routeStartMarker);
      routeStartMarker = null;
    }
  }

  function showPanel(el) {
  if (!el) return;
  el.style.display = "block"; // נשאר block תמיד
  el.classList.remove("panel-hidden");
  el.classList.add("panel-visible");
}

function hidePanel(el) {
  if (!el) return;
  el.style.display = "block"; // ❌ לא לשים none
  el.classList.remove("panel-visible");
  el.classList.add("panel-hidden");
}


  showPanel(requestsContainer);
  hidePanel(closedContainer);
  hidePanel(acceptedContainer);

  updateCreateSubmitState();

  initPatientMap();
  updatePatientMap();

  if (patientMap && patientOffersLayer) {
    loadOfferMarkers(patientMap, patientOffersLayer);
  }

  // Patient: load open requests immediately (otherwise user must click "open requests" first).
  if (role === 'sick' && !guestMode) {
    try { loadOpenRequests(); } catch (e) {}
  }
  // expose refresh hook so joinOffer can hide matched offers immediately
  if (typeof window !== 'undefined') {
    window.refreshOfferMarkers = function() {
      try {
        if (patientMap && patientOffersLayer) loadOfferMarkers(patientMap, patientOffersLayer);
      } catch (e) {}
    };
  }
  // Guest: show offers, but do not poll live locations (read-only experience)
  if (!guestMode) {
    setupPatientLiveLocation();
    schedulePatientLiveLocationCheck();
  }

  if (mapEl && volunteerMapWrap) {
    const volunteerToggles = [toggleVolunteerMapBtn, toggleVolunteerMapTopBtn].filter(Boolean);
    if (volunteerToggles.length) {
      const stored = localStorage.getItem('volunteerMapHidden') === 'true';

      function setVolunteerHidden(hidden) {
        if (hidden) {
          volunteerMapWrap.classList.add('map-hidden');
        } else {
          volunteerMapWrap.classList.remove('map-hidden');
        }
        volunteerToggles.forEach(btn => {
          btn.textContent = hidden ? '🗺️ הצג מפה' : '🗺️ הסתר מפה';
        });
        localStorage.setItem('volunteerMapHidden', String(hidden));
      }

      setVolunteerHidden(stored);

      volunteerToggles.forEach(btn => {
        btn.addEventListener('click', () => {
          const currentlyHidden = volunteerMapWrap.classList.contains('map-hidden');
          const nextHidden = !currentlyHidden;
          setVolunteerHidden(nextHidden);
          if (!nextHidden) {
            setTimeout(() => {
              try {
                if (map) {
                  map.invalidateSize(true);
                  map.fitBounds(israelBounds);
                }
              } catch (e) {}
            }, 200);
          }
        });
      });
    }
  }

  // מתג: הצג/הסתר "תכנון מסלול" (רק למתנדב)
  if (toggleRoutePlanBtn && routePlanningWrap) {
    function getRouteHidden() {
      return routePlanningWrap.style.display === 'none' || !routePlanningWrap.style.display;
    }
    function updateRouteToggleLabel() {
      const isHidden = getRouteHidden();
      toggleRoutePlanBtn.textContent = isHidden ? 'תכנון מסלול' : 'הסתר תכנון מסלול';
    }
    updateRouteToggleLabel();

    toggleRoutePlanBtn.addEventListener('click', () => {
      const isHidden = getRouteHidden();
      routePlanningWrap.style.display = isHidden ? 'block' : 'none';
      updateRouteToggleLabel();

      // Leaflet לפעמים צריך re-measure כשמשנים גובה/תצוגה.
      try {
        if (map && volunteerMapWrap && !volunteerMapWrap.classList.contains('map-hidden')) {
          setTimeout(() => {
            try { map.invalidateSize(true); } catch (e) {}
            try { map.fitBounds(israelBounds); } catch (e) {}
          }, 150);
        }
      } catch (e) {}
    });
  }

  if (patientMapEl) {
    const patientToggles = [togglePatientMapBtn, togglePatientMapTopBtn].filter(Boolean);
    if (patientToggles.length) {
      const stored = localStorage.getItem('patientMapHidden') === 'true';

      function setPatientHidden(hidden) {
        if (hidden) {
          patientMapEl.classList.add('map-hidden');
        } else {
          patientMapEl.classList.remove('map-hidden');
        }
        patientToggles.forEach(btn => {
          btn.textContent = hidden ? '🗺️ הצג מפה' : '🗺️ הסתר מפה';
        });
        localStorage.setItem('patientMapHidden', String(hidden));
      }

      setPatientHidden(stored);

      patientToggles.forEach(btn => {
        btn.addEventListener('click', () => {
          const currentlyHidden = patientMapEl.classList.contains('map-hidden');
          const nextHidden = !currentlyHidden;
          setPatientHidden(nextHidden);
          if (!nextHidden) {
            setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 200);
          }
        });
      });
    }
  }

  if (pickupInput && destinationInput) {
    setTimeout(() => {
      const placesReady = window.__placesReady && window.google && google.maps && google.maps.places;
      if (!placesReady) {
        setFieldError(pickupError, 'חסר חיבור ל-Google Places. יש להגדיר GOOGLE_PLACES_API_KEY.');
        setFieldError(destinationError, 'חסר חיבור ל-Google Places. יש להגדיר GOOGLE_PLACES_API_KEY.');
      } else {
        setFieldError(pickupError, '');
        setFieldError(destinationError, '');
      }
    }, 1500);
  }

  if (routeStartLat && routeStartLng) {
    routeStartLat.addEventListener('input', updateRouteButtonState);
    routeStartLng.addEventListener('input', updateRouteButtonState);
  }

  if (routeStartInput) {
    routeStartInput.addEventListener('input', () => {
      if (routeStartLat) routeStartLat.value = '';
      if (routeStartLng) routeStartLng.value = '';
      updateRouteButtonState();
    });
  }

  if (routeUseLocationBtn) {
    // Guest volunteer demo is read-only: block using "my location" in route planning.
    if (guestMode && role === 'volunteer') {
      routeUseLocationBtn.disabled = true;
      routeUseLocationBtn.style.opacity = '0.6';
      routeUseLocationBtn.style.cursor = 'not-allowed';
    }
    routeUseLocationBtn.addEventListener('click', () => {
      if (guestMode && role === 'volunteer') {
        return;
      }
      if (!navigator.geolocation) {
        setFieldError(routeError, 'Geolocation לא נתמך בדפדפן.');
        return;
      }
      if (window.isSecureContext === false) {
        setFieldError(routeError, 'מיקום עובד רק ב-HTTPS או ב-localhost. פתח דרך http://localhost:8000/.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          if (routeStartLat) routeStartLat.value = lat.toFixed(6);
          if (routeStartLng) routeStartLng.value = lng.toFixed(6);
          if (routeStartInput) {
            const address = await reverseGeocode(lat, lng);
            if (address) {
              routeStartInput.value = address;
              if (routeStartInput.__placesElement) {
                routeStartInput.__placesElement.value = address;
              }
              setFieldError(routeError, '');
              setRouteNotice('');
            } else {
              const coordsLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
              routeStartInput.value = `מיקום נוכחי (${coordsLabel})`;
              if (routeStartInput.__placesElement) {
                routeStartInput.__placesElement.value = routeStartInput.value;
              }
              setRouteNotice('לא נמצאה כתובת, משתמשים בקואורדינטות.');
            }
          }
          updateRouteButtonState();
        },
        err => {
          // Provide actionable error message (permission/timeout/unavailable)
          const code = err && typeof err.code === 'number' ? err.code : null;
          let message = 'לא ניתן לקבל מיקום.';
          if (code === 1) {
            message = 'נחסמה הרשאת מיקום בדפדפן. אשר Location לאתר ונסה שוב.';
          } else if (code === 2) {
            message = 'המיקום לא זמין כרגע (GPS/רשת). נסה שוב או הזן כתובת ידנית.';
          } else if (code === 3) {
            message = 'פג הזמן לקבלת מיקום. נסה שוב.';
          }
          setFieldError(routeError, message);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  window.__placesInit = setupPlaces;
  if (window.__placesReady) {
    setupPlaces();
  }

  function ensureCreateFormError() {
    if (!createForm || createFormError) return;
    createFormError = document.createElement('div');
    createFormError.id = 'create-form-error';
    createFormError.className = 'field-error';
    createFormError.textContent = '';
    createForm.prepend(createFormError);
  }

  function ensureCreateFormNotice() {
    if (!createForm || createFormNotice) return;
    createFormNotice = document.createElement('div');
    createFormNotice.id = 'create-form-notice';
    createFormNotice.className = 'field-error';
    createFormNotice.textContent = '';
    createForm.prepend(createFormNotice);
  }

  function setCreateFormError(message) {
    if (!createForm) return;
    ensureCreateFormError();
    if (createFormError) {
      createFormError.textContent = message || '';
    }
  }

  function setCreateFormNotice(message) {
    if (!createForm) return;
    ensureCreateFormNotice();
    if (createFormNotice) {
      createFormNotice.textContent = message || '';
    }
  }

  function updateCreateSubmitState() {
    if (!createForm) return;
    const submitBtn = createForm.querySelector('button[type="submit"]');
    const pickupLat = Number(pickupLatInput && pickupLatInput.value);
    const pickupLng = Number(pickupLngInput && pickupLngInput.value);
    const destLat = Number(destLatInput && destLatInput.value);
    const destLng = Number(destLngInput && destLngInput.value);

    // Guest patient demo is read-only: keep submit button locked always.
    if (submitBtn && window.guestMode && role === 'sick') {
      submitBtn.disabled = true;
      return;
    }

    const hasPickupText = Boolean(pickupInput && pickupInput.value);
    const hasDestText = Boolean(destinationInput && destinationInput.value);
    const hasPickupCoords = Boolean(pickupLatInput && pickupLatInput.value) && Number.isFinite(pickupLat) && pickupLat !== 0;
    const hasDestCoords = Boolean(destLatInput && destLatInput.value) && Number.isFinite(destLat) && destLat !== 0;

    if (!hasPickupText) {
      if (pickupLatInput) pickupLatInput.value = '';
      if (pickupLngInput) pickupLngInput.value = '';
    }
    if (!hasDestText) {
      if (destLatInput) destLatInput.value = '';
      if (destLngInput) destLngInput.value = '';
    }

    createState.pickupValid = hasPickupText && hasPickupCoords;
    createState.destinationValid = hasDestText && hasDestCoords;

    const hasDate = Boolean(dateInput && dateInput.value);
    const hasTime = Boolean(timeInput && timeInput.value);
    const combinedTime = (hasDate && hasTime) ? `${dateInput.value}T${timeInput.value}` : '';
    const timeInPast = combinedTime ? isDateTimeInPast(combinedTime) : false;
    createState.timeValid = hasDate && hasTime && !timeInPast;
    if (createTimeError) createTimeError.textContent = timeInPast ? 'התאריך חלף' : '';

    if (phoneInput) {
      const phoneCheck = normalizeIsraeliPhone(phoneInput.value);
      createState.phoneValid = phoneCheck.valid;
    }

    if (pickupInput && pickupInput.value && !hasPickupCoords) {
      setFieldError(pickupError, 'כתובת לא נבחרה מהרשימה, ייתכן שאין קואורדינטות.');
      createState.pickupValid = false;
    } else if (pickupInput && !pickupInput.value) {
      setFieldError(pickupError, '');
    } else if (hasPickupCoords) {
      setFieldError(pickupError, '');
    }
    if (destinationInput && destinationInput.value && !hasDestCoords) {
      setFieldError(destinationError, 'כתובת לא נבחרה מהרשימה, ייתכן שאין קואורדינטות.');
      createState.destinationValid = false;
    } else if (destinationInput && !destinationInput.value) {
      setFieldError(destinationError, '');
    } else if (hasDestCoords) {
      setFieldError(destinationError, '');
    }
    if (phoneInput && phoneInput.value && !createState.phoneValid) {
      setFieldError(phoneError, 'מספר טלפון לא תקין.');
    } else if (phoneInput && (!phoneInput.value || createState.phoneValid)) {
      setFieldError(phoneError, '');
    }

    // Debug print for coordinates and state
    console.debug('[updateCreateSubmitState]', {
      pickup: { text: pickupInput && pickupInput.value, lat: pickupLat, lng: pickupLng },
      destination: { text: destinationInput && destinationInput.value, lat: destLat, lng: destLng },
      createState
    });

    const isValid =
      createState.pickupValid &&
      createState.destinationValid &&
      createState.phoneValid &&
      createState.timeValid;
    if (submitBtn) {
      submitBtn.disabled = !isValid;
    }
  }

  function updateEditSubmitState() {
    if (!editSubmitBtn) return;
    const isValid = editState.pickupValid && editState.destinationValid && editState.timeValid;
    editSubmitBtn.disabled = !isValid;
  }

  function clearPlaceValidation(state, errorEl, latInput, lngInput) {
    if (state === 'pickup') {
      createState.pickupValid = false;
    }
    if (state === 'destination') {
      createState.destinationValid = false;
    }
    setFieldError(errorEl, 'בחר כתובת מהרשימה.');
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    if (state === 'pickup' && pickupInput && pickupInput.dataset) {
      delete pickupInput.dataset.lat;
      delete pickupInput.dataset.lng;
    }
    if (state === 'destination' && destinationInput && destinationInput.dataset) {
      delete destinationInput.dataset.lat;
      delete destinationInput.dataset.lng;
    }
    updateCreateSubmitState();
  }

  function clearEditPlaceValidation(state, errorEl, latInput, lngInput) {
    if (state === 'pickup') {
      editState.pickupValid = false;
    }
    if (state === 'destination') {
      editState.destinationValid = false;
    }
    setFieldError(errorEl, 'בחר כתובת מהרשימה.');
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
    updateEditSubmitState();
  }

  function setupPlaces() {
    attachPlacesAutocomplete(routeStartInput, routeStartAutocomplete, place => {
      if (!place) {
        if (routeStartLat) routeStartLat.value = '';
        if (routeStartLng) routeStartLng.value = '';
        updateRouteButtonState();
        return;
      }
      if (routeStartInput) routeStartInput.value = place.address;
      if (routeStartLat) routeStartLat.value = place.lat;
      if (routeStartLng) routeStartLng.value = place.lng;
      setFieldError(routeError, '');
      updateRouteButtonState();
    });

    attachPlacesAutocomplete(pickupInput, pickupAutocomplete, place => {
      if (!place) {
        clearPlaceValidation('pickup', pickupError, pickupLatInput, pickupLngInput);
        return;
      }
      pickupInput.value = place.address;
      // אם אין קואורדינטות, ננסה geocode
      if (typeof place.lat === 'undefined' || typeof place.lng === 'undefined' || !Number.isFinite(Number(place.lat))) {
        setFieldError(pickupError, 'ממלא קואורדינטות אוטומטית...');
        geocodeAddress(place.address).then(geo => {
          if (geo && geo.lat && geo.lng) {
            pickupLatInput.value = geo.lat;
            pickupLngInput.value = geo.lng;
            if (pickupInput && pickupInput.dataset) {
              pickupInput.dataset.lat = String(geo.lat);
              pickupInput.dataset.lng = String(geo.lng);
            }
            createState.pickupValid = true;
            setFieldError(pickupError, '');
            updatePatientMap();
            updateCreateSubmitState();
          } else {
            setFieldError(pickupError, 'שגיאה: לא ניתן לאתר קואורדינטות לכתובת.');
            pickupLatInput.value = '';
            pickupLngInput.value = '';
            if (pickupInput && pickupInput.dataset) {
              delete pickupInput.dataset.lat;
              delete pickupInput.dataset.lng;
            }
            createState.pickupValid = false;
            updateCreateSubmitState();
          }
        });
        return;
      }
      pickupLatInput.value = place.lat;
      pickupLngInput.value = place.lng;
      if (pickupInput && pickupInput.dataset) {
        pickupInput.dataset.lat = String(place.lat);
        pickupInput.dataset.lng = String(place.lng);
      }
      createState.pickupValid = true;
      setFieldError(pickupError, '');
      updatePatientMap();
      updateCreateSubmitState();
    });

    attachPlacesAutocomplete(destinationInput, destinationAutocomplete, place => {
      if (!place) {
        setFieldError(destinationError, 'לא נבחרה כתובת מהרשימה.');
        clearPlaceValidation('destination', destinationError, destLatInput, destLngInput);
        return;
      }
      if (!place.address) {
        setFieldError(destinationError, 'שגיאה: אין כתובת זמינה מהבחירה.');
        clearPlaceValidation('destination', destinationError, destLatInput, destLngInput);
        return;
      }
      destinationInput.value = place.address;
      // אם אין קואורדינטות, ננסה geocode
      if (typeof place.lat === 'undefined' || typeof place.lng === 'undefined' || !Number.isFinite(Number(place.lat)) || Number(place.lat) === 0 || Number(place.lng) === 0) {
        setFieldError(destinationError, 'ממלא קואורדינטות אוטומטית...');
        geocodeAddress(place.address).then(geo => {
          console.log('Geocode result for address:', place.address, geo);
          if (geo && geo.lat && geo.lng) {
            destLatInput.value = geo.lat;
            destLngInput.value = geo.lng;
            if (destinationInput && destinationInput.dataset) {
              destinationInput.dataset.lat = String(geo.lat);
              destinationInput.dataset.lng = String(geo.lng);
            }
            createState.destinationValid = true;
            setFieldError(destinationError, '');
            updatePatientMap();
            updateCreateSubmitState();
          } else {
            setFieldError(destinationError, 'שגיאה: לא ניתן לאתר קואורדינטות לכתובת.');
            destLatInput.value = '';
            destLngInput.value = '';
            if (destinationInput && destinationInput.dataset) {
              delete destinationInput.dataset.lat;
              delete destinationInput.dataset.lng;
            }
            createState.destinationValid = false;
            updateCreateSubmitState();
          }
        });
        return;
      }
      destLatInput.value = place.lat;
      destLngInput.value = place.lng;
      if (destinationInput && destinationInput.dataset) {
        destinationInput.dataset.lat = String(place.lat);
        destinationInput.dataset.lng = String(place.lng);
      }
      createState.destinationValid = true;
      setFieldError(destinationError, '');
      updatePatientMap();
      updateCreateSubmitState();
    });

    attachPlacesAutocomplete(editPickupInput, editPickupAutocomplete, place => {
      if (!place) {
        clearEditPlaceValidation('pickup', editPickupError, editPickupLat, editPickupLng);
        return;
      }
      editPickupInput.value = place.address;
      editPickupLat.value = place.lat;
      editPickupLng.value = place.lng;
      editState.pickupValid = true;
      setFieldError(editPickupError, '');
      updateEditSubmitState();
    });

    attachPlacesAutocomplete(editDestinationInput, editDestinationAutocomplete, place => {
      if (!place) {
        clearEditPlaceValidation('destination', editDestinationError, editDestLat, editDestLng);
        return;
      }
      editDestinationInput.value = place.address;
      editDestLat.value = place.lat;
      editDestLng.value = place.lng;
      editState.destinationValid = true;
      setFieldError(editDestinationError, '');
      updateEditSubmitState();
    });

    // פרסום נסיעה למתנדב: מוצא/יעד עם גוגל, כמו בטופס בקשה
    attachPlacesAutocomplete(volOfferFromInput, volOfferFromAutocomplete, place => {
      if (!place) {
        if (volOfferFromLat) volOfferFromLat.value = '';
        if (volOfferFromLng) volOfferFromLng.value = '';
        setFieldError(volOfferFromError, 'בחר כתובת מהמוצעות.');
        return;
      }
      volOfferFromInput.value = place.address;
      if (typeof place.lat === 'number' && typeof place.lng === 'number') {
        if (volOfferFromLat) volOfferFromLat.value = place.lat;
        if (volOfferFromLng) volOfferFromLng.value = place.lng;
        setFieldError(volOfferFromError, '');
      }
    });

    attachPlacesAutocomplete(volOfferToInput, volOfferToAutocomplete, place => {
      if (!place) {
        if (volOfferToLat) volOfferToLat.value = '';
        if (volOfferToLng) volOfferToLng.value = '';
        setFieldError(volOfferToError, 'בחר כתובת מהמוצעות.');
        return;
      }
      volOfferToInput.value = place.address;
      if (typeof place.lat === 'number' && typeof place.lng === 'number') {
        if (volOfferToLat) volOfferToLat.value = place.lat;
        if (volOfferToLng) volOfferToLng.value = place.lng;
        setFieldError(volOfferToError, '');
      }
    });
  }

  function initMap() {
    if (!mapEl || !window.L || map) return;

    map = L.map(mapEl, {
      center: israelCenter,
      zoom: 8,
      maxBounds: israelBounds,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      tap: false,
    });
    setTimeout(() => {
      try { map.invalidateSize(true); } catch (e) {}
      // Don't fit bounds while the wrapper is hidden (Leaflet will compute wrong zoom).
      const isHidden = volunteerMapWrap && volunteerMapWrap.classList.contains('map-hidden');
      const isVisible = !isHidden && mapEl.offsetWidth > 0 && mapEl.offsetHeight > 0;
      if (isVisible) {
        try { map.fitBounds(israelBounds); } catch (e) {}
      }
    }, 100);
    // Leaflet marker icon via CDN (local static files here are placeholders)
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    offersLayer = L.layerGroup().addTo(map);
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 300);
  }

  function initPatientMap() {
    if (!patientMapEl || !window.L || patientMap) return;

    patientMap = L.map(patientMapEl, {
      center: israelCenter,
      zoom: 8,
      maxBounds: israelBounds,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      tap: false,
    });
    setTimeout(() => {
      patientMap.invalidateSize(true);
      patientMap.fitBounds(israelBounds);
    }, 100);
    // Leaflet marker icon via CDN (local static files here are placeholders)
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(patientMap);
    patientOffersLayer = L.layerGroup().addTo(patientMap);
    setTimeout(() => {
      if (patientMap) patientMap.invalidateSize();
    }, 300);
  }

  function updatePatientMap() {
    if (!patientMap) return;

    // Patient map should NOT show pickup/destination markers (only volunteer rides + live volunteer location).
    if (patientPickupMarker) {
      try { patientMap.removeLayer(patientPickupMarker); } catch (e) {}
      patientPickupMarker = null;
    }
    if (patientDestMarker) {
      try { patientMap.removeLayer(patientDestMarker); } catch (e) {}
      patientDestMarker = null;
    }

    // Keep default view; offers/live-location will adjust view when needed.
    patientMap.fitBounds(israelBounds);
    setTimeout(() => patientMap.invalidateSize(true), 100);
  }

  function setPatientLocationStatus(msg, show) {
    const statusEl = document.getElementById('patient-volunteer-location-status');
    const textEl = document.getElementById('patient-volunteer-location-status-text');
    if (textEl) textEl.textContent = msg || '';
    if (statusEl) statusEl.style.display = show !== false ? 'block' : 'none';
  }

  function clearPatientVolunteerLocationUI() {
    if (patientLiveInterval) { clearInterval(patientLiveInterval); patientLiveInterval = null; }
    setPatientLocationStatus('', false);
    if (patientVolunteerMarker && patientMap) { patientMap.removeLayer(patientVolunteerMarker); patientVolunteerMarker = null; }
    const wrapEl = document.getElementById('patient-volunteer-location-wrap');
    if (wrapEl) wrapEl.style.display = 'none';
  }

  function clearPatientVolunteerMarkerOnly() {
    try {
      if (patientVolunteerMarker && patientMap) {
        patientMap.removeLayer(patientVolunteerMarker);
      }
    } catch (e) {}
    patientVolunteerMarker = null;
  }

  async function pollVolunteerLocationForPatient(requestId) {
    const noLocationMsg = 'המתנדב עדיין לא שיתף מיקום. וודא שהמתנדב פתוח בדף ונתן הרשאת מיקום.';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      let res;
      try {
        res = await fetch(`/api/requests/location/${requestId}/`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      const json = await safeJson(res);
      if (json.__error || res.status === 500) {
        clearPatientVolunteerLocationUI();
        return;
      }
      if (res.status === 404) {
        clearPatientVolunteerLocationUI();
        return;
      }
      if (json.no_location) {
        clearPatientVolunteerMarkerOnly();
        setPatientLocationStatus(noLocationMsg, true);
        return;
      }
      if (json.no_assignment) {
        clearPatientVolunteerMarkerOnly();
        setPatientLocationStatus('אין מינוי מתנדב לבקשה זו.', true);
        return;
      }
      if (res.status === 403 && json.error) {
        clearPatientVolunteerLocationUI();
        return;
      }
      if (json.too_early || json.too_late) {
        clearPatientVolunteerLocationUI();
        return;
      }
      if (json.error) {
        if (json.error === 'no_location') {
          clearPatientVolunteerMarkerOnly();
          setPatientLocationStatus(noLocationMsg, true);
        } else if (json.error === 'no_assignment') {
          clearPatientVolunteerMarkerOnly();
          setPatientLocationStatus('אין מינוי מתנדב לבקשה זו.', true);
        } else {
          setPatientLocationStatus('לא התקבל מיקום. נסה לרענן.', true);
        }
        return;
      }
      if (res.status !== 200 || json.lat == null || json.lng == null) {
        clearPatientVolunteerMarkerOnly();
        setPatientLocationStatus(noLocationMsg, true);
        return;
      }
      const lat = Number(json.lat);
      const lng = Number(json.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setPatientLocationStatus('מיקום לא תקין. נסה שוב.', true);
        return;
      }
      if (!isInsideIsrael(lat, lng)) {
        setPatientLocationStatus('מיקום המתנדב מחוץ לאזור. וודא שהמתנדב בישראל.', true);
        return;
      }
      // Ensure map exists and is visible before adding marker (Leaflet needs container size)
      if (!patientMap) initPatientMap();
      if (!patientMap) {
        setPatientLocationStatus('לא ניתן לטעון את המפה. נסה לרענן.', true);
        return;
      }
      if (patientMapEl && patientMapEl.classList.contains('map-hidden')) {
        patientMapEl.classList.remove('map-hidden');
        const toggleBtn = document.getElementById('toggle-patient-map');
        const toggleTopBtn = document.getElementById('toggle-patient-map-top');
        if (toggleBtn) toggleBtn.textContent = '🗺️ הסתר מפה';
        if (toggleTopBtn) toggleTopBtn.textContent = '🗺️ הסתר מפה';
        try { localStorage.setItem('patientMapHidden', 'false'); } catch (e) {}
        setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 50);
      }

      setPatientLocationStatus('', false);

      if (!patientVolunteerMarker) {
        patientVolunteerMarker = L.circleMarker([lat, lng], {
          radius: 14,
          fillColor: '#16a34a',
          color: '#15803d',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        })
          .bindPopup('מיקום המתנדב')
          .addTo(patientMap);
        if (typeof console !== 'undefined' && console.debug) console.debug('[מיקום מתנדב] נקודה ירוקה נוספה למפה', lat, lng);
      } else {
        patientVolunteerMarker.setLatLng([lat, lng]);
      }

      const bounds = [];
      if (patientPickupMarker) bounds.push(patientPickupMarker.getLatLng());
      if (patientVolunteerMarker) bounds.push(patientVolunteerMarker.getLatLng());
      if (bounds.length > 0) {
        patientMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
      }
      setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 100);
      setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 400);
    } catch (err) {
      console.warn('pollVolunteerLocationForPatient error', err);
      if (err && err.name === 'AbortError') {
        setPatientLocationStatus('החיבור ארך יותר מדי. ' + noLocationMsg, true);
      } else {
        setPatientLocationStatus('שגיאה בקבלת מיקום. נסה לרענן את הדף.', true);
      }
    }
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async function fetchDrivingMinutes(fromLat, fromLng, toLat, toLng) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.code === 'Ok' && json.routes && json.routes[0] && json.routes[0].duration != null) {
        return Math.max(1, Math.round(json.routes[0].duration / 60));
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function pollAllVolunteerLocationsForPatient(upcomingItems) {
    const noLocationMsg = 'המתנדב עדיין לא שיתף מיקום. וודא שהמתנדב פתוח בדף ונתן הרשאת מיקום.';
    const ARRIVED_KM = 0.15;
    if (!upcomingItems || upcomingItems.length === 0) return;
    for (const item of upcomingItems) {
      const requestId = item.id;
      const pickupLat = item.pickup_lat != null ? Number(item.pickup_lat) : NaN;
      const pickupLng = item.pickup_lng != null ? Number(item.pickup_lng) : NaN;
      const hasPickup = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`/api/requests/location/${requestId}/`, { signal: controller.signal }).finally(() => clearTimeout(t));
        const json = await safeJson(res);
        if (json.__error || res.status === 500) {
          clearPatientVolunteerLocationUI();
          return;
        }
        if (json.too_early || json.too_late) {
          clearPatientVolunteerLocationUI();
          return;
        }
        if (json.no_assignment) continue;
        if (json.no_location) continue;
        if (res.status !== 200 || json.lat == null || json.lng == null) continue;
        const lat = Number(json.lat);
        const lng = Number(json.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideIsrael(lat, lng)) continue;

        const pickLat = hasPickup ? pickupLat : (Number(json.pickup_lat) || NaN);
        const pickLng = hasPickup ? pickupLng : (Number(json.pickup_lng) || NaN);
        const arrived = Number.isFinite(pickLat) && Number.isFinite(pickLng) && distanceKm(lat, lng, pickLat, pickLng) < ARRIVED_KM;

        if (arrived) {
          if (patientLiveInterval) { clearInterval(patientLiveInterval); patientLiveInterval = null; }
          setPatientLocationStatus('המתנדב הגיע.', true);
          if (patientVolunteerMarker) patientVolunteerMarker.setPopupContent('המתנדב הגיע');
          if (!patientMap) initPatientMap();
          if (patientMap && patientVolunteerMarker) {
            patientVolunteerMarker.setLatLng([lat, lng]);
            if (!patientVolunteerMarker._map) patientVolunteerMarker.addTo(patientMap);
          }
          return;
        }

        if (!patientMap) initPatientMap();
        if (!patientMap) continue;
        if (patientMapEl && patientMapEl.classList.contains('map-hidden')) {
          patientMapEl.classList.remove('map-hidden');
          const toggleBtn = document.getElementById('toggle-patient-map');
          const toggleTopBtn = document.getElementById('toggle-patient-map-top');
          if (toggleBtn) toggleBtn.textContent = '🗺️ הסתר מפה';
          if (toggleTopBtn) toggleTopBtn.textContent = '🗺️ הסתר מפה';
          try { localStorage.setItem('patientMapHidden', 'false'); } catch (e) {}
          setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 50);
        }
        if (!patientVolunteerMarker) {
          patientVolunteerMarker = L.circleMarker([lat, lng], {
            radius: 14,
            fillColor: '#16a34a',
            color: '#15803d',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
          }).bindPopup('מיקום המתנדב').addTo(patientMap);
        } else {
          patientVolunteerMarker.setLatLng([lat, lng]);
        }
        if (Number.isFinite(pickLat) && Number.isFinite(pickLng)) {
          const mins = await fetchDrivingMinutes(lat, lng, pickLat, pickLng);
          if (mins != null) {
            patientVolunteerMarker.setPopupContent(`מיקום המתנדב · אצלך בעוד כ־${mins} דקות`);
            setPatientLocationStatus(`המתנדב אצלך בעוד כ־${mins} דקות`, true);
          } else {
            patientVolunteerMarker.setPopupContent('מיקום המתנדב');
            setPatientLocationStatus('מיקום המתנדב', true);
          }
        } else {
          patientVolunteerMarker.setPopupContent('מיקום המתנדב');
          setPatientLocationStatus('מיקום המתנדב', true);
        }
        const bounds = [];
        if (patientPickupMarker) bounds.push(patientPickupMarker.getLatLng());
        if (patientVolunteerMarker) bounds.push(patientVolunteerMarker.getLatLng());
        if (bounds.length > 0) patientMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
        setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 100);
        setTimeout(() => { if (patientMap) patientMap.invalidateSize(); }, 400);
        return;
      } catch (e) {
        if (e && e.name !== 'AbortError') console.warn('pollAllVolunteerLocationsForPatient', requestId, e);
      }
    }
    setPatientLocationStatus(noLocationMsg, true);
  }

  async function setupPatientLiveLocation() {
    if (role !== 'sick') return;
    if (!patientMap) initPatientMap();

    try {
      const res = await fetch('/api/requests/closed/' + (guestMode ? guestSimpleQuery : ''));
      const json = await safeJson(res);
      if (json.__error || !Array.isArray(json.requests)) return;

      const now = new Date();
      const upcoming = json.requests
        .filter(r => r.status === 'accepted' && typeof r.requested_time === 'string')
        .map(r => {
          const dt = new Date(r.requested_time.replace(' ', 'T'));
          return { raw: r, date: dt };
        })
        .filter(item => !isNaN(item.date.getTime()) && item.date.getTime() >= now.getTime());

      const wrapEl = document.getElementById('patient-volunteer-location-wrap');
      if (upcoming.length === 0) {
        clearPatientVolunteerLocationUI();
        return;
      }

      upcoming.sort((a, b) => a.date - b.date);
      const next = upcoming[0];
      const eventTime = next.date;
      const diffMinutes = (eventTime.getTime() - now.getTime()) / 60000;

      if (diffMinutes > 45) {
        clearPatientVolunteerLocationUI();
        return;
      }
      if (wrapEl) wrapEl.style.display = 'block';

      const upcomingItems = upcoming.slice(0, 5).map(item => ({
        id: item.raw.id,
        pickup_lat: item.raw.pickup_lat,
        pickup_lng: item.raw.pickup_lng,
      })).filter(x => x.id != null);
      const r = next.raw;
      if (pickupLatInput && pickupLngInput && destLatInput && destLngInput) {
        if (r.pickup_lat && r.pickup_lng) {
          pickupLatInput.value = r.pickup_lat;
          pickupLngInput.value = r.pickup_lng;
        }
        if (r.dest_lat && r.dest_lng) {
          destLatInput.value = r.dest_lat;
          destLngInput.value = r.dest_lng;
        }
        updatePatientMap();
      }

      if (patientLiveInterval) clearInterval(patientLiveInterval);
      patientLiveInterval = setInterval(() => pollAllVolunteerLocationsForPatient(upcomingItems), 8000);
      setPatientLocationStatus('מחפשים מיקום מתנדב... (אם לא מתעדכן – וודא שהמתנדב פתוח בדף ונתן הרשאת מיקום)', true);
      pollAllVolunteerLocationsForPatient(upcomingItems);
    } catch (err) {
      console.warn('setupPatientLiveLocation error', err);
    }
  }

  function schedulePatientLiveLocationCheck() {
    if (role !== 'sick') return;
    if (patientLiveSetupTimer) clearInterval(patientLiveSetupTimer);
    patientLiveSetupTimer = setInterval(setupPatientLiveLocation, 60000);
  }

  const VOLUNTEER_STATUS_DEFAULT = 'שיתוף מיקום כבוי. לחץ "שתף מיקום" כדי להפעיל.';
  function setVolunteerLocationStatus(msg, show) {
    const el = document.getElementById('volunteer-location-status');
    if (!el) return;
    el.textContent = (msg && msg.trim()) ? msg : VOLUNTEER_STATUS_DEFAULT;
    el.style.display = 'block';
  }

  function stopVolunteerLiveLocation() {
    // tell server to clear last location so patient stops seeing marker
    try {
      if (volunteerActiveRequestId) {
        fetch(`/api/requests/location/${volunteerActiveRequestId}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ stop: true }),
        }).catch(() => {});
      }
    } catch (e) {}

    if (volunteerWatchId !== null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(volunteerWatchId);
    }
    volunteerWatchId = null;
    volunteerActiveRequestId = null;
    volunteerPickupLat = null;
    volunteerPickupLng = null;
    volunteerSharingEnabled = false;
    setVolunteerLocationStatus('שיתוף המיקום הופסק.', true);
  }

  async function postVolunteerLocation(requestId, lat, lng) {
    try {
      const res = await fetch(`/api/requests/location/${requestId}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({ lat, lng }),
      });
      const json = await safeJson(res);
      if (!res.ok) {
        if (res.status === 403 && json && json.error === 'not_assigned') {
          stopVolunteerLiveLocation();
          setVolunteerLocationStatus('אין לך מינוי לבקשה זו. שיתוף המיקום הופסק.', true);
        } else {
          setVolunteerLocationStatus('שגיאה בשליחת מיקום לשרת. נסה לרענן.', true);
        }
      } else {
        setVolunteerLocationStatus('שיתוף מיקום פעיל – המטופל רואה אותך. מ־45 דק׳ לפני האיסוף ועד הגעתך למטופל.', true);
      }
    } catch (err) {
      console.warn('postVolunteerLocation error', err);
      setVolunteerLocationStatus('שגיאה בשליחת מיקום. נסה לרענן.', true);
    }
  }

  const VOLUNTEER_ARRIVED_KM = 0.15;

  function startVolunteerLiveLocation(requestId, pickupLat, pickupLng) {
    if (!navigator.geolocation) {
      setVolunteerLocationStatus('הדפדפן לא תומך במיקום.', true);
      return;
    }
    stopVolunteerLiveLocation();
    volunteerActiveRequestId = requestId;
    volunteerPickupLat = pickupLat != null && Number.isFinite(Number(pickupLat)) ? Number(pickupLat) : null;
    volunteerPickupLng = pickupLng != null && Number.isFinite(Number(pickupLng)) ? Number(pickupLng) : null;
    volunteerSharingEnabled = true;
    setVolunteerLocationStatus('מקבל מיקום...', true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (isInsideIsrael(lat, lng)) {
          if (volunteerPickupLat != null && volunteerPickupLng != null && distanceKm(lat, lng, volunteerPickupLat, volunteerPickupLng) < VOLUNTEER_ARRIVED_KM) {
            stopVolunteerLiveLocation();
            setVolunteerLocationStatus('הגעת למטופל – שיתוף המיקום הופסק.', true);
            return;
          }
          postVolunteerLocation(requestId, lat, lng);
        } else {
          setVolunteerLocationStatus('המיקום מחוץ לישראל. המטופל לא יראה מיקום.', true);
        }
      },
      err => {
        setVolunteerLocationStatus('לא התקבל מיקום. אשר הרשאת מיקום לאתר בהגדרות הדפדפן.', true);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 8000 }
    );
    volunteerWatchId = navigator.geolocation.watchPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!isInsideIsrael(lat, lng)) return;
        if (!volunteerActiveRequestId) return;
        if (volunteerPickupLat != null && volunteerPickupLng != null && distanceKm(lat, lng, volunteerPickupLat, volunteerPickupLng) < VOLUNTEER_ARRIVED_KM) {
          stopVolunteerLiveLocation();
          setVolunteerLocationStatus('הגעת למטופל – שיתוף המיקום הופסק.', true);
          return;
        }
        postVolunteerLocation(volunteerActiveRequestId, lat, lng);
      },
      err => {
        console.warn('volunteer watchPosition error', err);
        if (err && err.code === 1) {
          setVolunteerLocationStatus('הרשאת מיקום נחסמה. אשר מיקום בהגדרות האתר.', true);
          stopVolunteerLiveLocation();
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 12000,
      }
    );
  }

  async function checkVolunteerLiveLocation() {
    if (role !== 'volunteer') return;
    if (!volunteerSharingEnabled) return;
    try {
      const res = await fetch('/api/requests/accepted/' + (guestMode ? guestSimpleQuery : ''));
      const json = await safeJson(res);
      if (json.__error || !Array.isArray(json.requests)) return;

      const now = new Date();
      // רק בקשות שנמצאות בחלון השיתוף: מ־45 דקות לפני מועד האיסוף עד 15 דקות אחריו
      const upcoming = json.requests
        .filter(r => typeof r.requested_time === 'string')
        .map(r => {
          const dt = new Date(r.requested_time.replace(' ', 'T'));
          return { raw: r, date: dt };
        })
        .filter(item => !isNaN(item.date.getTime()))
        .filter(item => {
          const diffMin = (item.date.getTime() - now.getTime()) / 60000;
          return diffMin >= -15 && diffMin <= 45;
        });

      if (upcoming.length === 0) {
        stopVolunteerLiveLocation();
        return;
      }

      upcoming.sort((a, b) => a.date - b.date);
      const next = upcoming[0];
      const r = next.raw;
      if (volunteerActiveRequestId !== r.id) {
        startVolunteerLiveLocation(r.id, r.pickup_lat, r.pickup_lng);
      }
    } catch (err) {
      console.warn('checkVolunteerLiveLocation error', err);
    }
  }

  function setupVolunteerLiveLocation() {
    if (role !== 'volunteer') return;
    // don't auto-start sharing; only poll when user enabled it
    checkVolunteerLiveLocation();
    if (volunteerLiveTimer) clearInterval(volunteerLiveTimer);
    volunteerLiveTimer = setInterval(checkVolunteerLiveLocation, 15000);
  }

  function updateMapMarkers(requests) {
    if (!map || !markersLayer) return;

    if (map) map.invalidateSize();
    markersLayer.clearLayers();
    const points = [];

    requests.forEach(r => {
      const lat = Number(r.pickup_lat);
      const lng = Number(r.pickup_lng);
      if (!isInsideIsrael(lat, lng)) return;

      const marker = L.marker([lat, lng]);
      const expired = isRequestExpired(r);
      const route = escapeHtml(formatRoute(r.pickup, r.destination));
      const time = escapeHtml(r.requested_time || '');
      const notes = escapeHtml(r.notes || '-');
      const phone = escapeHtml(r.phone || '-');
      const sickUser = escapeHtml(r.sick_username || '');
      const acceptBtnHtml = (role === 'volunteer' && r.status === 'open' && !expired)
        ? (guestMode
          ? `<button type="button" class="btn-primary" style="margin-top:8px;padding:6px 12px;font-size:0.9rem;border-radius:999px;border:none;background:#2563eb;color:#fff;opacity:0.6;cursor:not-allowed;" disabled>אשר</button>`
          : `<button type="button" class="btn-primary" style="margin-top:8px;padding:6px 12px;font-size:0.9rem;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;" onclick="window.acceptRequestFromMap && window.acceptRequestFromMap(${Number(r.id)})">אשר</button>`)
        : '';
      const expiredHtml = expired ? `<div style="margin-top:6px;color:#b45309;font-weight:700;">התאריך חלף</div>` : '';
      marker.bindPopup(
        `<div style="min-width:220px;">
          <div style="font-weight:800;color:#0f172a;">נסיעת מטופל</div>
          ${sickUser ? `<div style="margin-top:4px;color:#334155;">מטופל: ${sickUser}</div>` : ''}
          <div style="margin-top:6px;color:#111827;">${route}</div>
          <div style="margin-top:4px;color:#475569;font-weight:700;">${time}</div>
          <div style="margin-top:6px;color:#111827;">הערות: ${notes}</div>
          <div style="margin-top:6px;color:#111827;">טלפון: ${phone}</div>
          ${acceptBtnHtml}
          ${expiredHtml}
        </div>`
      );
      marker.addTo(markersLayer);
      points.push([lat, lng]);
    });

    if (points.length > 0) {
      map.fitBounds(points, { padding: [20, 20], maxZoom: 15 });
      setTimeout(() => map.invalidateSize(true), 100);
    } else {
      map.fitBounds(israelBounds);
      setTimeout(() => map.invalidateSize(true), 100);
    }
  }

  async function loadOfferMarkers(targetMap, targetLayer) {
    if (!targetMap || !targetLayer) return;
    try {
      const res = await fetch('/api/ai/offers/' + (guestMode ? '?guest=1' : ''), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const json = await safeJson(res);
      if (json.__error || json.error) return;
      const offers = Array.isArray(json.offers) ? json.offers : [];
      targetLayer.clearLayers();

      for (const o of offers) {
        let lat = Number(o.from_lat);
        let lng = Number(o.from_lng);

        // fallback for old offers without saved coords
        if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && o.parsed_from) {
          const geo = await geocodeAddress(o.parsed_from);
          if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
            lat = geo.lat;
            lng = geo.lng;
          }
        }

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideIsrael(lat, lng)) continue;

        // published future rides: use the same default marker icon as the volunteer map
        const marker = L.marker([lat, lng]);
        const who = o.volunteer_username ? 'מתנדב: ' + o.volunteer_username : '';
        // Show route in a stable visual direction
        const routeLine = ((o.parsed_from || '') && (o.parsed_to || ''))
          ? `${o.parsed_from} → ${o.parsed_to}`
          : '';
        const routeLineHtml = routeLine ? `<span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(routeLine)}</span>` : '';

        // למנוע כפילות: אם יש לנו שורת מסלול, נציג בטקסט רק תאריך/שעה/הערות (בלי "מ-... אל ...")
        let detailsText = (o.raw_text || '').trim();
        if (routeLine) {
          const m = detailsText.match(/^נסיעה עתידית מ-(.+?)\s+אל\s+(.+?)\s+בתאריך\s+(\d{4}-\d{2}-\d{2})\s+בשעה\s+(\d{2}:\d{2})([\s\S]*)$/);
          if (m) {
            const date = m[3];
            const time = m[4];
            const suffix = (m[5] || '').trim();
            detailsText = `בתאריך ${date} בשעה ${time}` + (suffix ? ` ${suffix}` : '');
          }
        }

        const safeText = detailsText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const joinBtn = guestMode
          ? `<button type="button" class="btn-primary" style="margin-top:6px;padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;opacity:0.6;cursor:not-allowed;" disabled>הצטרף</button>`
          : `<button type="button" class="btn-primary" style="margin-top:6px;padding:4px 10px;font-size:0.85rem;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;" onclick="window.joinOffer && window.joinOffer(${o.id}, this)">הצטרף</button>`;
        marker.bindPopup(
          `<strong>נסיעה מתנדב</strong><br>${who}${routeLineHtml ? `<br>${routeLineHtml}` : ''}<br>${safeText}<br>${joinBtn}`
        );
        marker.addTo(targetLayer);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('loadOfferMarkers', e);
    }
  }

  async function loadOpenRequests() {
    if (!requestsContainer) return;
    // Guest sick: no requests should be shown at all (they are not "the logged-in patient").
    if (guestMode && role === 'sick') {
      requestsContainer.innerHTML =
        '<div class="field-hint" style="margin-top:8px;">בדמו אורח-מטופל: אין בקשות להצגה.</div>';
      return;
    }
    try {
      selectedRouteIds.clear();
      requestMeta.clear();
      const res = await fetch('/api/requests/' + (guestMode ? guestRequestsQuery : ''));
      const json = await safeJson(res);
      if (json.__error) {
        requestsContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }

      if (!json.requests) {
        requestsContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות.</p>';
        return;
      }

      const reqs = json.requests.filter(r =>
        role === 'volunteer' ? r.status === 'open' : r.status === 'open' || r.status === 'accepted'
      );

      requestsContainer.innerHTML = '';

      if (reqs.length === 0) {
        requestsContainer.innerHTML = '<p class="no-requests">אין בקשות פתוחות.</p>';
        if (role === 'volunteer') {
          updateMapMarkers([]);
        }
        return;
      }

      reqs.forEach(r => {
        const expired = isRequestExpired(r);
        const card = document.createElement('div');
        card.className = 'request-card ' + (r.status === 'open' ? 'open' : r.status);
        if (expired) card.classList.add('request-expired');

        const hasPickupCoords = isInsideIsrael(Number(r.pickup_lat), Number(r.pickup_lng));
        const hasDestCoords = isInsideIsrael(Number(r.dest_lat), Number(r.dest_lng));
        requestMeta.set(r.id, { hasPickupCoords, hasDestCoords });

        let volHtml = '';
        if (r.volunteer) {
          volHtml = `<div class="volunteer-info">מתנדב: ${r.volunteer.username} — ${r.volunteer.phone || '-'}<\/div>`;
        } else if (r.no_volunteers_available) {
          volHtml = `<div class="volunteer-info no-volunteers">אין מתנדבים זמינים<\/div>`;
        }
        const expiredMsgHtml = expired
          ? '<div class="request-expired-msg">התאריך חלף – הבקשה תימחק למחרת<\/div>'
          : '';

        card.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}<\/div>
            <div class="status">${r.requested_time} · ${r.status_display}<\/div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}<\/div>
            <div style="margin-top:6px">טלפון מטופל: ${r.phone || '-'}<\/div>
            ${volHtml}
            ${expiredMsgHtml}
          <\/div>
        `;

        // מטופל: ביטול + עריכה (חסומים אם התאריך חלף)
        if (role === 'sick' && r.status === 'open' && Number(r.sick_id) === Number(window.currentUserId) && !expired) {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'button';
          cancelBtn.textContent = 'בטל';
          cancelBtn.onclick = async () => {
            if (!confirm('לבטל את הבקשה?')) return;
            const res = await fetch(`/api/requests/cancel/${r.id}/`, {
              method: 'POST',
              headers: { 'X-CSRFToken': getCookie('csrftoken') },
            });
            const json = await res.json().catch(() => ({}));
            if (json.error) alert(json.error);
            loadOpenRequests();
          };

          const editBtn = document.createElement('button');
          editBtn.className = 'button';
          editBtn.textContent = 'ערוך';
          editBtn.onclick = () => openEditModal(r);

          card.appendChild(cancelBtn);
          card.appendChild(editBtn);
        }

        // מתנדב: קבל + דחה + בחירה למסלול (חסומים אם התאריך חלף)
        if (role === 'volunteer' && r.status === 'open') {
          const routeWrap = document.createElement('div');
          routeWrap.style.marginTop = '8px';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'route-select';
          checkbox.dataset.requestId = r.id;
          if (!hasPickupCoords || expired) {
            checkbox.disabled = true;
          }
          checkbox.checked = selectedRouteIds.has(r.id);
          checkbox.addEventListener('change', e => {
            if (e.target.checked) {
              if (selectedRouteIds.size >= 6) {
                e.target.checked = false;
                alert('אפשר לבחור עד 6 בקשות.');
                return;
              }
              selectedRouteIds.add(r.id);
            } else {
              selectedRouteIds.delete(r.id);
            }
            // Selection changed → any previously suggested route is no longer valid
            clearRouteUI();
            updateRouteButtonState();
          });

          const label = document.createElement('label');
          label.style.marginRight = '6px';
          label.textContent = expired ? 'התאריך חלף' : (!hasPickupCoords ? 'חסרות קואורדינטות לאיסוף' : 'בחר למסלול');
          label.prepend(checkbox);
          routeWrap.appendChild(label);
          card.appendChild(routeWrap);

          const acceptBtn = document.createElement('button');
          acceptBtn.className = 'accept-btn';
          acceptBtn.textContent = 'קבל';
          acceptBtn.disabled = guestMode || !!expired;
          acceptBtn.onclick = async () => {
            if (guestMode) return;
            const res = await fetch(`/api/requests/accept/${r.id}/`, {
              method: 'POST',
              headers: { 'X-CSRFToken': getCookie('csrftoken') },
            });
            const json = await res.json().catch(() => ({}));
            if (json.error) alert(json.error);
            loadOpenRequests();
          };

          const rejectBtn = document.createElement('button');
          rejectBtn.className = 'button';
          rejectBtn.textContent = 'דחה';
          rejectBtn.disabled = guestMode || !!expired;
          rejectBtn.onclick = async () => {
            if (guestMode) return;
            const res = await fetch(`/api/requests/reject/${r.id}/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
              body: JSON.stringify({ reason: '' }),
            });
            const json = await res.json().catch(() => ({}));
            if (json.error) alert(json.error);
            loadOpenRequests();
          };
          card.appendChild(acceptBtn);
          card.appendChild(rejectBtn);
        }

        requestsContainer.appendChild(card);
      });

      if (role === 'volunteer') {
        updateMapMarkers(reqs);
      }

    } catch (err) {
      console.error(err);
      requestsContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות.</p>';
    }
    } // סוף loadOpenRequests

    function isVisible(el) {
    return el && !el.classList.contains('panel-hidden');
  }

  // Route suggestion handler (scoped to DOMContentLoaded variables)
  async function suggestRouteHandler() {
    const missingPickup = [];
    const missingDest = [];
    const validRequestIds = [];
    const mode = routeModeSelect ? routeModeSelect.value : 'pickup_then_dropoff';

    let startLat = Number(routeStartLat && routeStartLat.value);
    let startLng = Number(routeStartLng && routeStartLng.value);

    // If user typed address but coords are missing, geocode it client-side.
    if (!isInsideIsrael(startLat, startLng)) {
      const addr = (routeStartInput && routeStartInput.value || '').trim();
      if (addr) {
        setFieldError(routeError, 'מאתר נקודת התחלה...');
        const geo = await geocodeAddress(addr);
        if (geo && isInsideIsrael(Number(geo.lat), Number(geo.lng))) {
          startLat = Number(geo.lat);
          startLng = Number(geo.lng);
          if (routeStartLat) routeStartLat.value = String(startLat);
          if (routeStartLng) routeStartLng.value = String(startLng);
          setFieldError(routeError, '');
        }
      }
    }

    if (!isInsideIsrael(startLat, startLng)) {
      setRouteNotice('');
      setFieldError(routeError, 'בחר נקודת התחלה בישראל (כתובת מהרשימה או "השתמש במיקום שלי").');
      return;
    }

    selectedRouteIds.forEach(id => {
      const meta = requestMeta.get(id) || {};
      if (!meta.hasPickupCoords) {
        missingPickup.push(id);
        return;
      }
      if (mode === 'pickup_then_dropoff' && !meta.hasDestCoords) {
        missingDest.push(id);
        return;
      }
      validRequestIds.push(id);
    });

    if (missingPickup.length > 0) {
      setRouteNotice('');
      setFieldError(routeError, 'יש בקשות ללא נקודת איסוף בישראל.');
      return;
    }
    if (missingDest.length > 0) {
      setRouteNotice('');
      setFieldError(routeError, 'יש בקשות ללא יעד בישראל. החלף למצב איסופים בלבד או עדכן כתובות.');
      return;
    }
    if (validRequestIds.length === 0) {
      setRouteNotice('');
      setFieldError(routeError, 'אין בקשות תקינות למסלול.');
      return;
    }

    routeSuggestBtn.disabled = true;
    setFieldError(routeError, '');
    if (routeResults) routeResults.innerHTML = '...מחשב מסלול';

    try {
      const res = await fetch('/api/route/suggest/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({
          start_lat: startLat,
          start_lng: startLng,
          request_ids: validRequestIds,
          mode,
        }),
      });
      const json = await safeJson(res);
      if (json.__error || !json.success) {
        const message = json.error || 'נכשל לחשב מסלול.';
        setFieldError(routeError, message);
        if (routeResults) routeResults.innerHTML = '';
        if (routeNavBtn) { routeNavBtn.disabled = true; routeNavBtn.removeAttribute('data-url'); }
        const _wb = document.getElementById('route-nav-waze-btn');
        if (_wb) { _wb.disabled = true; _wb.removeAttribute('data-url'); }
        return;
      }

      if (routeResults) {
        routeResults.innerHTML = '';

        if (!json.stops || json.stops.length === 0) {
          setFieldError(routeError, '');
          setRouteNotice(json.warning || 'אין בקשות עם קואורדינטות למסלול.');
          if (routeNavBtn) { routeNavBtn.disabled = true; routeNavBtn.removeAttribute('data-url'); }
          const _wb2 = document.getElementById('route-nav-waze-btn');
          if (_wb2) { _wb2.disabled = true; _wb2.removeAttribute('data-url'); }
          return;
        }

        const summary = document.createElement('div');
        const km = (json.total_distance_m / 1000).toFixed(1);
        const mins = Math.round(json.total_duration_s / 60);
        summary.className = 'route-stop';
        summary.textContent = `סה"כ: ${km} ק"מ · ${mins} דק' (${json.matrix_source})`;
        routeResults.appendChild(summary);

        if (json.warning) {
          setFieldError(routeError, '');
          setRouteNotice(json.warning);
        } else if (Array.isArray(json.skipped) && json.skipped.length > 0) {
          setFieldError(routeError, '');
          setRouteNotice(`דילוג על ${json.skipped.length} בקשות ללא קואורדינטות.`);
        } else {
          setFieldError(routeError, '');
          setRouteNotice('');
        }

        json.stops.forEach((stop, index) => {
          const item = document.createElement('div');
          item.className = 'route-stop';
          const typeLabel = stop.type === 'pickup' ? 'איסוף' : 'יעד';
          item.textContent = `${index + 1}. ${typeLabel} (#${stop.request_id}) - ${stop.label}`;
          routeResults.appendChild(item);
        });
      }

      if (map) {
        if (routeLine) {
          map.removeLayer(routeLine);
        }
        if (routeStartMarker) {
          map.removeLayer(routeStartMarker);
        }
        const coords = [
          [startLat, startLng],
          ...json.stops.map(stop => [stop.lat, stop.lng]),
        ];
        routeLine = L.polyline(coords, { color: '#f97316', weight: 4 }).addTo(map);
        routeStartMarker = L.circleMarker([startLat, startLng], {
          radius: 6,
          color: '#0f172a',
          fillColor: '#f97316',
          fillOpacity: 1,
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });
      }

      if (routeNavBtn && json.stops && json.stops.length > 0) {
        const dest = json.stops[json.stops.length - 1];
        const waypoints = json.stops
          .slice(0, -1)
          .map(stop => `${stop.lat},${stop.lng}`)
          .join('|');
        const url = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${dest.lat},${dest.lng}` +
          (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '');
        routeNavBtn.disabled = false;
        routeNavBtn.dataset.url = url;
        const firstStop = json.stops[0];
        const wazeUrl = `https://waze.com/ul?ll=${firstStop.lat},${firstStop.lng}&navigate=yes`;
        if (routeNavWazeBtn) {
          routeNavWazeBtn.disabled = false;
          routeNavWazeBtn.dataset.url = wazeUrl;
        }
      } else {
        if (routeNavWazeBtn) {
          routeNavWazeBtn.disabled = true;
          routeNavWazeBtn.removeAttribute('data-url');
        }
      }
    } catch (err) {
      setFieldError(routeError, 'בעיה בחישוב המסלול.');
      if (routeResults) routeResults.innerHTML = '';
      if (routeNavWazeBtn) { routeNavWazeBtn.disabled = true; routeNavWazeBtn.removeAttribute('data-url'); }
    } finally {
      updateRouteButtonState();
    }
  }

  async function loadClosedRequests() {
    if (!closedContainer) return;

    showPanel(closedContainer);
    hidePanel(requestsContainer);
    hidePanel(acceptedContainer);

    // Guest sick: show consistent demo message for closed requests too.
    if (guestMode && role === 'sick') {
      closedContainer.innerHTML =
        '<div class="field-hint" style="margin-top:8px;">בדמו אורח-מטופל: אין בקשות להצגה.</div>';
      return;
    }

    closedContainer.innerHTML = '<p>...טוען בקשות סגורות</p>';

    try {
      const res = await fetch('/api/requests/closed/');
      const json = await safeJson(res);
      if (json.__error) {
        closedContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }

      if (!json || !Array.isArray(json.requests)) {
        closedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות סגורות.</p>';
        return;
      }

      const reqs = json.requests;
      closedContainer.innerHTML = '';

      if (reqs.length === 0) {
        closedContainer.innerHTML = '<p class="no-requests">אין בקשות סגורות או מבוטלות.</p>';
        return;
      }

      reqs.forEach(r => {
        const expired = isRequestExpired(r);
        const card = document.createElement('div');
        card.className = 'request-card closed' + (expired ? ' request-expired' : '');
        const volHtml = r.volunteer
          ? `<div class="volunteer-info">מתנדב: ${r.volunteer.username} — ${r.volunteer.phone || '-'}<\/div>`
          : '';
        const expiredMsgHtml = expired
          ? '<div class="request-expired-msg">התאריך חלף – הבקשה תימחק למחרת<\/div>'
          : '';
        card.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}<\/div>
            <div class="status">${r.requested_time} · ${r.status_display}<\/div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}<\/div>
            <div style="margin-top:6px">טלפון מטופל: ${r.phone || '-'}<\/div>
            ${volHtml}
            ${expiredMsgHtml}
          <\/div>
        `;
        closedContainer.appendChild(card);
      });

      if (requestsContainer) hidePanel(requestsContainer);
    } catch (err) {
      console.error(err);
      closedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות סגורות.</p>';
    }
  }

  async function loadAcceptedRequests() {
    if (!acceptedContainer) return;

    const preservePanels = arguments.length > 0 ? !!arguments[0] : false;
    if (!preservePanels) {
      showPanel(acceptedContainer);
      hidePanel(requestsContainer);
      hidePanel(closedContainer);
    }

    acceptedContainer.innerHTML = '<p>...טוען בקשות מאושרות</p>';

    try {
      const res = await fetch('/api/requests/accepted/');
      const json = await safeJson(res);
      if (json.__error) {
        acceptedContainer.innerHTML = '<p class="no-requests">שגיאת שרת. נסה להתחבר מחדש.</p>';
        return;
      }

      const reqs = Array.isArray(json.requests) ? json.requests : [];
      acceptedContainer.innerHTML = '';

      if (reqs.length === 0) {
        acceptedContainer.innerHTML = '<p class="no-requests">אין בקשות מאושרות.</p>';
        return;
      }

      reqs.forEach(r => {
        const hasPickupCoords = isInsideIsrael(Number(r.pickup_lat), Number(r.pickup_lng));
        const hasDestCoords = isInsideIsrael(Number(r.dest_lat), Number(r.dest_lng));
        requestMeta.set(r.id, { hasPickupCoords, hasDestCoords });

        const expired = isRequestExpired(r);
        const card = document.createElement('div');
        card.className = 'request-card accepted' + (expired ? ' request-expired' : '');
        // מתנדב רואה רק את הבקשות שלו – לא צריך להציג "מתנדב: [שם]" כי הוא יודע שזה הוא
        const volHtml = '';
        const expiredMsgHtml = expired
          ? '<div class="request-expired-msg">התאריך חלף – הבקשה תימחק למחרת<\/div>'
          : '';
        card.innerHTML = `
          <div class="request-info">
            <div class="route">${formatRoute(r.pickup, r.destination)}<\/div>
            <div class="status">${r.requested_time} · ${r.status_display}<\/div>
            <div style="margin-top:6px">הערות: ${r.notes || '-'}<\/div>
            <div style="margin-top:6px">טלפון מטופל: ${r.phone || '-'}<\/div>
            ${volHtml}
            ${expiredMsgHtml}
          <\/div>
        `;

        const routeWrap = document.createElement('div');
        routeWrap.style.marginTop = '8px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'route-select';
        checkbox.dataset.requestId = r.id;
        if (!hasPickupCoords || expired) checkbox.disabled = true;
        checkbox.checked = selectedRouteIds.has(r.id);
        checkbox.addEventListener('change', e => {
          if (e.target.checked) {
            if (selectedRouteIds.size >= 6) {
              e.target.checked = false;
              alert('אפשר לבחור עד 6 בקשות.');
              return;
            }
            selectedRouteIds.add(r.id);
          } else {
            selectedRouteIds.delete(r.id);
          }
          // Selection changed → any previously suggested route is no longer valid
          clearRouteUI();
          updateRouteButtonState();
        });
        const label = document.createElement('label');
        label.style.marginRight = '6px';
        label.textContent = expired ? 'התאריך חלף' : (!hasPickupCoords ? 'חסרות קואורדינטות לאיסוף' : 'בחר למסלול');
        label.prepend(checkbox);
        routeWrap.appendChild(label);
        card.appendChild(routeWrap);

        acceptedContainer.appendChild(card);

        // Start volunteer location polling automatically for each accepted request
        if (typeof r.id !== 'undefined' && typeof r.eta !== 'undefined') {
          // eta should be a timestamp in ms, if not, convert from string
          let etaTimestamp = r.eta;
          if (typeof etaTimestamp === 'string') {
            // Try to parse as ISO string
            etaTimestamp = Date.parse(etaTimestamp);
          }
          if (etaTimestamp && !isNaN(etaTimestamp)) {
            startVolunteerLocationPolling(r.id, etaTimestamp);
          }
        }
        // Optionally, stop polling when leaving accepted view (not handled here)
      });
    } catch (err) {
      console.error(err);
      acceptedContainer.innerHTML = '<p class="no-requests">שגיאה בטעינת בקשות מאושרות.</p>';
    }
  }

  showOpenBtns.forEach(b => {
    b.onclick = async () => {
      hidePanel(closedContainer);
      hidePanel(acceptedContainer);

      showOpenBtns.forEach(s => (s.style.display = 'none'));
      if (showClosedBtn) showClosedBtn.style.display = 'inline-block';
      if (showAcceptedBtn) showAcceptedBtn.style.display = 'inline-block';

      showPanel(requestsContainer);
      await loadOpenRequests();
    };
  });

  // Allow accepting directly from map popup without losing current view
  if (typeof window !== 'undefined') {
    window.acceptRequestFromMap = async function(reqId) {
      try {
        if (window.guestMode) {
          alert('דמו אורח: אין אפשרות לאשר נסיעה ללא כניסה.');
          return;
        }
        const res = await fetch(`/api/requests/accept/${reqId}/`, {
          method: 'POST',
          headers: { 'X-CSRFToken': getCookie('csrftoken') },
        });
        const json = await res.json().catch(() => ({}));
        if (json && json.error) {
          alert(json.error);
          return;
        }
        // refresh open requests (cards + markers)
        await loadOpenRequests();
        // if accepted list is currently visible, refresh it in-place (do not switch panels)
        try {
          if (acceptedContainer && isVisible(acceptedContainer)) {
            await loadAcceptedRequests(true);
          }
        } catch (e) {}
      } catch (e) {
        alert('שגיאה ברשת בעת אישור נסיעה.');
      }
    };
  }

  if (showClosedBtn) {
    showClosedBtn.onclick = async () => {
      showOpenBtns.forEach(s => (s.style.display = 'inline-block'));
      if (showAcceptedBtn) showAcceptedBtn.style.display = 'inline-block';
      showClosedBtn.style.display = 'none';
      await loadClosedRequests();
    };
  }

  if (showAcceptedBtn) {
    showAcceptedBtn.onclick = async () => {
      showOpenBtns.forEach(s => (s.style.display = 'inline-block'));
      if (showClosedBtn) showClosedBtn.style.display = 'inline-block';
      showAcceptedBtn.style.display = 'none';
      await loadAcceptedRequests();
    };
  }

  if (createForm) {
    if (pickupInput) {
      pickupInput.addEventListener('input', () => {
        if (pickupInput.__placesElement && Date.now() - (pickupInput.__lastSelectedAt || 0) < 2000) return;
        createState.pickupValid = false;
        if (pickupLatInput) pickupLatInput.value = '';
        if (pickupLngInput) pickupLngInput.value = '';
        if (pickupInput.dataset) {
          delete pickupInput.dataset.lat;
          delete pickupInput.dataset.lng;
        }
        setFieldError(pickupError, 'בחר כתובת מהרשימה.');
        updateCreateSubmitState();
      });
    }

    if (destinationInput) {
      destinationInput.addEventListener('input', () => {
        if (destinationInput.__placesElement && Date.now() - (destinationInput.__lastSelectedAt || 0) < 2000) return;
        createState.destinationValid = false;
        if (destLatInput) destLatInput.value = '';
        if (destLngInput) destLngInput.value = '';
        if (destinationInput.dataset) {
          delete destinationInput.dataset.lat;
          delete destinationInput.dataset.lng;
        }
        setFieldError(destinationError, 'בחר כתובת מהרשימה.');
        updateCreateSubmitState();
      });
    }

    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        const result = normalizeIsraeliPhone(phoneInput.value);
        createState.phoneValid = result.valid;
        if (!result.valid) {
          setFieldError(phoneError, 'מספר טלפון לא תקין.');
        } else {
          setFieldError(phoneError, '');
        }
        updateCreateSubmitState();
      });
    }

    if (dateInput) {
      dateInput.addEventListener('input', () => { updateCreateSubmitState(); });
      dateInput.addEventListener('change', () => { updateCreateSubmitState(); });
    }
    if (timeInput) {
      timeInput.addEventListener('input', () => { updateCreateSubmitState(); });
      timeInput.addEventListener('change', () => { updateCreateSubmitState(); });
    }

    createForm.onsubmit = async e => {
      e.preventDefault();
      if (window.guestMode) {
        try { alert('דמו אורח: אין אפשרות ליצור בקשה בלי כניסה.'); } catch (err) {}
        return false;
      }
      setCreateFormError('');
      setCreateFormNotice('');
      let pickupLatRaw = (pickupLatInput && pickupLatInput.value) || (pickupInput && pickupInput.dataset && pickupInput.dataset.lat) || '';
      let pickupLngRaw = (pickupLngInput && pickupLngInput.value) || (pickupInput && pickupInput.dataset && pickupInput.dataset.lng) || '';
      let destLatRaw = (destLatInput && destLatInput.value) || (destinationInput && destinationInput.dataset && destinationInput.dataset.lat) || '';
      let destLngRaw = (destLngInput && destLngInput.value) || (destinationInput && destinationInput.dataset && destinationInput.dataset.lng) || '';
      if (pickupLatInput && !pickupLatInput.value && pickupLatRaw) {
        pickupLatInput.value = pickupLatRaw;
      }
      if (pickupLngInput && !pickupLngInput.value && pickupLngRaw) {
        pickupLngInput.value = pickupLngRaw;
      }
      if (destLatInput && !destLatInput.value && destLatRaw) {
        destLatInput.value = destLatRaw;
      }
      if (destLngInput && !destLngInput.value && destLngRaw) {
        destLngInput.value = destLngRaw;
      }
      let pickupLat = Number(pickupLatRaw);
      let pickupLng = Number(pickupLngRaw);
      let destLat = Number(destLatRaw);
      let destLng = Number(destLngRaw);
      let hasPickupCoords = Boolean(pickupLatInput && pickupLatInput.value) && Number.isFinite(pickupLat) && pickupLat !== 0;
      let hasDestCoords = Boolean(destLatInput && destLatInput.value) && Number.isFinite(destLat) && destLat !== 0;
      const hasPickupText = Boolean(pickupInput && pickupInput.value);
      const hasDestText = Boolean(destinationInput && destinationInput.value);
      const hasDate = Boolean(dateInput && dateInput.value);
      const hasTime = Boolean(timeInput && timeInput.value);
      const combinedTime = (hasDate && hasTime) ? `${dateInput.value}T${timeInput.value}` : '';

      if (hasPickupText && !hasPickupCoords) {
        const coords = await geocodeAddress(pickupInput.value);
        if (coords) {
          pickupLat = coords.lat;
          pickupLng = coords.lng;
          pickupLatRaw = String(coords.lat);
          pickupLngRaw = String(coords.lng);
          if (pickupLatInput) pickupLatInput.value = pickupLatRaw;
          if (pickupLngInput) pickupLngInput.value = pickupLngRaw;
          if (pickupInput && pickupInput.dataset) {
            pickupInput.dataset.lat = pickupLatRaw;
            pickupInput.dataset.lng = pickupLngRaw;
          }
          hasPickupCoords = true;
        }
      }

      if (hasDestText && !hasDestCoords) {
        const coords = await geocodeAddress(destinationInput.value);
        if (coords) {
          destLat = coords.lat;
          destLng = coords.lng;
          destLatRaw = String(coords.lat);
          destLngRaw = String(coords.lng);
          if (destLatInput) destLatInput.value = destLatRaw;
          if (destLngInput) destLngInput.value = destLngRaw;
          if (destinationInput && destinationInput.dataset) {
            destinationInput.dataset.lat = destLatRaw;
            destinationInput.dataset.lng = destLngRaw;
          }
          hasDestCoords = true;
        }
      }

      if (!hasPickupText || !hasDestText || !hasPickupCoords || !hasDestCoords || !hasDate || !hasTime) {
        createState.pickupValid = hasPickupText && hasPickupCoords;
        createState.destinationValid = hasDestText && hasDestCoords;
        createState.timeValid = hasDate && hasTime && !(combinedTime && isDateTimeInPast(combinedTime));
      }

      // Always recompute time validity from date+time before final submit checks.
      if (hasDate && hasTime && combinedTime) {
        const timeInPast = isDateTimeInPast(combinedTime);
        createState.timeValid = !timeInPast;
        if (createTimeError) createTimeError.textContent = timeInPast ? 'התאריך חלף' : '';
      }

      if (!createState.pickupValid || !createState.destinationValid || !createState.phoneValid || !createState.timeValid) {
        setFieldError(pickupError, createState.pickupValid ? '' : 'בחר כתובת מהרשימה.');
        setFieldError(destinationError, createState.destinationValid ? '' : 'בחר כתובת מהרשימה.');
        if (!createState.phoneValid) {
          setFieldError(phoneError, 'מספר טלפון לא תקין.');
        }
        if (timeInput && !createState.timeValid) {
          timeInput.reportValidity();
        }
        return;
      }

      const phoneResult = normalizeIsraeliPhone(phoneInput.value);
      if (!phoneResult.valid) {
        setFieldError(phoneError, 'מספר טלפון לא תקין.');
        return;
      }

      const payload = {
        pickup: createForm.querySelector('[name=pickup]').value,
        destination: createForm.querySelector('[name=destination]').value,
        time: combinedTime,
        notes: createForm.querySelector('[name=notes]').value,
        phone: phoneResult.normalized,
        pickup_lat: pickupLatRaw,
        pickup_lng: pickupLngRaw,
        dest_lat: destLatRaw,
        dest_lng: destLngRaw,
      };

      try {
        const res = await fetch('/api/requests/create/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify(payload),
        });
        const json = await safeJson(res);
        if (json.__error) {
          setCreateFormError('שגיאת שרת. נסה להתחבר מחדש.');
          return;
        }

        if (json.success) {
          createForm.reset();
          createState.pickupValid = false;
          createState.destinationValid = false;
          createState.phoneValid = false;
          createState.timeValid = false;
          setFieldError(pickupError, '');
          setFieldError(destinationError, '');
          setFieldError(phoneError, '');
          if (pickupInput) {
            pickupInput.value = '';
            if (pickupInput.__placesElement) {
              pickupInput.__placesElement.value = '';
            }
          }
          if (destinationInput) {
            destinationInput.value = '';
            if (destinationInput.__placesElement) {
              destinationInput.__placesElement.value = '';
            }
          }
          if (pickupLatInput) pickupLatInput.value = '';
          if (pickupLngInput) pickupLngInput.value = '';
          if (destLatInput) destLatInput.value = '';
          if (destLngInput) destLngInput.value = '';
          if (pickupInput && pickupInput.dataset) {
            delete pickupInput.dataset.lat;
            delete pickupInput.dataset.lng;
          }
          if (destinationInput && destinationInput.dataset) {
            delete destinationInput.dataset.lat;
            delete destinationInput.dataset.lng;
          }
          if (patientPickupMarker && patientMap) {
            patientMap.removeLayer(patientPickupMarker);
            patientPickupMarker = null;
          }
          if (patientDestMarker && patientMap) {
            patientMap.removeLayer(patientDestMarker);
            patientDestMarker = null;
          }
          if (patientMap) {
            patientMap.setView([32.0853, 34.7818], 11);
          }
          updateCreateSubmitState();
          setCreateFormNotice('הבקשה נשלחה בהצלחה.');
          setTimeout(() => setCreateFormNotice(''), 3500);
          await loadOpenRequests();
        } else {
          const message = json.error || 'נכשל ביצירת בקשה';
          if (message.toLowerCase().includes('pickup address')) {
            setFieldError(pickupError, 'בחר כתובת מהרשימה.');
            createState.pickupValid = false;
            updateCreateSubmitState();
          } else if (message.toLowerCase().includes('destination address')) {
            setFieldError(destinationError, 'בחר כתובת מהרשימה.');
            createState.destinationValid = false;
            updateCreateSubmitState();
          }
          setCreateFormError(message);
        }
      } catch (err) {
        console.error(err);
        setCreateFormError('בעיית תקשורת');
      }
    };
  }

  if (editModal) {
    editModal.addEventListener('click', e => {
      if (e.target && e.target.dataset && e.target.dataset.close === 'true') {
        closeEditModal();
      }
    });
  }

  if (editPickupInput) {
    editPickupInput.addEventListener('input', () => {
      editState.pickupValid = false;
      if (editPickupLat) editPickupLat.value = '';
      if (editPickupLng) editPickupLng.value = '';
      setFieldError(editPickupError, 'בחר כתובת מהרשימה.');
      updateEditSubmitState();
    });
  }

  if (editDestinationInput) {
    editDestinationInput.addEventListener('input', () => {
      editState.destinationValid = false;
      if (editDestLat) editDestLat.value = '';
      if (editDestLng) editDestLng.value = '';
      setFieldError(editDestinationError, 'בחר כתובת מהרשימה.');
      updateEditSubmitState();
    });
  }

  if (editTimeInput) {
    const syncEditTimeValid = () => {
      const v = editTimeInput.value;
      const inPast = v && isDateTimeInPast(v);
      editState.timeValid = Boolean(v) && !inPast;
      if (editTimeError) editTimeError.textContent = inPast ? 'התאריך חלף' : '';
      updateEditSubmitState();
    };
    editTimeInput.addEventListener('input', syncEditTimeValid);
    editTimeInput.addEventListener('change', syncEditTimeValid);
  }

  if (editForm) {
    editForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!editState.pickupValid || !editState.destinationValid || !editState.timeValid) {
        setFieldError(editPickupError, editState.pickupValid ? '' : 'בחר כתובת מהרשימה.');
        setFieldError(editDestinationError, editState.destinationValid ? '' : 'בחר כתובת מהרשימה.');
        if (editTimeError && !editState.timeValid) setFieldError(editTimeError, 'התאריך חלף');
        return;
      }

      const payload = {
        pickup: editPickupInput.value,
        destination: editDestinationInput.value,
        time: editTimeInput.value,
        notes: editNotesInput.value,
        pickup_lat: editPickupLat.value,
        pickup_lng: editPickupLng.value,
        dest_lat: editDestLat.value,
        dest_lng: editDestLng.value,
      };

      try {
        const res = await fetch(`/api/requests/update/${editRequestId.value}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify(payload),
        });
        const json = await safeJson(res);
        if (json.__error) {
          alert('שגיאת שרת. נסה להתחבר מחדש.');
          return;
        }

        if (json.success) {
          closeEditModal();
          await loadOpenRequests();
        } else {
          alert(json.error || 'נכשל בעדכון הבקשה');
        }
      } catch (err) {
        console.error(err);
        alert('בעיית תקשורת');
      }
    });
  }

  if (routeSuggestBtn) {
    routeSuggestBtn.addEventListener('click', suggestRouteHandler);
  }

  if (routeNavBtn) {
    routeNavBtn.addEventListener('click', () => {
      if (routeNavBtn.dataset.url) {
        window.open(routeNavBtn.dataset.url, '_blank', 'noopener');
      }
    });
  }
  if (routeNavWazeBtn) {
    routeNavWazeBtn.addEventListener('click', () => {
      if (routeNavWazeBtn.dataset.url) {
        window.open(routeNavWazeBtn.dataset.url, '_blank', 'noopener');
      }
    });
  }

  if (role === 'volunteer') {
    initMap();
    const shareLocationBtn = document.getElementById('volunteer-share-location-btn');
    const stopLocationBtn = document.getElementById('volunteer-stop-location-btn');

    if (guestMode) {
      // Read-only experience: disable live-location actions.
      if (shareLocationBtn) {
        shareLocationBtn.disabled = true;
        shareLocationBtn.style.opacity = '0.6';
        shareLocationBtn.style.cursor = 'not-allowed';
      }
      if (stopLocationBtn) {
        stopLocationBtn.disabled = true;
        stopLocationBtn.style.opacity = '0.6';
        stopLocationBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (shareLocationBtn) {
        shareLocationBtn.addEventListener('click', async () => {
          try {
            const res = await fetch('/api/requests/accepted/');
            const json = await safeJson(res);
            if (json.__error || !Array.isArray(json.requests)) {
              setVolunteerLocationStatus('שגיאה בטעינת הבקשות. נסה לרענן.', true);
              return;
            }
            const now = new Date();
            const upcoming = json.requests
              .filter(r => typeof r.requested_time === 'string')
              .map(r => ({ raw: r, date: new Date(r.requested_time.replace(' ', 'T')) }))
              .filter(item => !isNaN(item.date.getTime()) && item.date.getTime() >= now.getTime());
            upcoming.sort((a, b) => a.date - b.date);
            const next = upcoming[0];
            if (!next) {
              setVolunteerLocationStatus('אין נסיעה מאושרת בעתיד. אחרי שתאשר נסיעה, לחץ שוב.', true);
              return;
            }
            const diffMinutes = (next.date.getTime() - now.getTime()) / 60000;
            if (diffMinutes > 45) {
              setVolunteerLocationStatus('הנסיעה המאושרת בעוד יותר מ־45 דקות. שיתוף מיקום יתאפשר כ־45 דקות לפני.', true);
              return;
            }
            if (diffMinutes < -15) {
              setVolunteerLocationStatus('הנסיעה כבר עברה.', true);
              return;
            }
            startVolunteerLiveLocation(next.raw.id, next.raw.pickup_lat, next.raw.pickup_lng);
          } catch (e) {
            console.warn(e);
            setVolunteerLocationStatus('שגיאה. נסה לרענן.', true);
          }
        });
      }
      if (stopLocationBtn) {
        stopLocationBtn.addEventListener('click', () => stopVolunteerLiveLocation());
      }
      setupVolunteerLiveLocation();
      connectRealtime();
    }

    // Always show the open requests cards/map (read-only for guests).
    loadOpenRequests();
  } else {
    if (!guestMode) {
      // אם משתמש בפאנל מטופל - קריאות כאן מטופלות לפני סוף runAppInit
    }
  }
} // סוף runAppInit

  // הרצת האתחול: אם הדף כבר נטען (סקריפט עם defer) – להריץ מיד; אחרת להמתין ל-DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAppInit);
  } else {
    runAppInit();
  }

  // גיבוי: אם Google Places נטען אחרי האתחול – לנסות להפעיל חיפוש כתובות אחרי כמה שניות
  (function placesRetry() {
    const maxAttempts = 20;
    let attempts = 0;
    const t = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(t);
        return;
      }
      if (window.google && window.google.maps && window.google.maps.places && typeof window.__placesInit === 'function') {
        const pickupInput = document.getElementById('pickup-input');
        const offerFrom = document.getElementById('offer-from');
        const aiPickup = document.getElementById('ai_pickup');
        if ((pickupInput && !pickupInput.__placesElement) ||
            (offerFrom && !offerFrom.__placesElement) ||
            (aiPickup && !aiPickup.__placesElement)) {
          window.__placesReady = true;
          window.__placesInit();
        }
        clearInterval(t);
      }
    }, 500);
  })();


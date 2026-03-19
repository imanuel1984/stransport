/* =====================
   CSRF
===================== */
function getCookie(name) {
  const v = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return v ? v.pop() : "";
}

/* =====================
   Topic Labels (Hebrew UI)
===================== */
const TOPIC_LABELS_HE = {
  Python: "פייתון",
  JavaScript: "JavaScript",
  History: "היסטוריה",
  Sports: "ספורט",
  Geography: "גאוגרפיה",
};
function labelTopic(t) {
  return TOPIC_LABELS_HE[t] || t;
}

/* =====================
   State
===================== */
const app = document.getElementById("trivia-app");

// no header language toggle (translation UI removed)

let topics = {};
let currentTopic = null;

let questions = []; // active pool

let index = 0;
let answered = false;
let lastAnswerIndex = null;

let currentQuestion = null;

// chat history per question
let chatHistory = [];

// טעויות למשחק (לסיכום בסוף)
let mistakes = []; // [{qText, userText, correctText, qNumber}]

// ✅ NEW: האם המשתמש נעזר בעזרה בכלל (רמז/הסבר/צ'אט)
let usedHelp = false;

/* =====================
   Utils
===================== */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// language UI removed — no setLangUI

/* =====================
   Init
===================== */
document.addEventListener("DOMContentLoaded", () => {
  loadTopics();
});

// Guest mode: read-only; block "hint" semantics and send to AI as regular chat.
const __triviaParams = new URLSearchParams(window.location.search);
const __isGuestTrivia = (__triviaParams.get("guest") === "1");

/* =====================
   Load Topics
===================== */
async function loadTopics() {
  app.innerHTML = `<div class="card">טוען נושאים...</div>`;
  try {
    const res = await fetch("/api/trivia/questions/");
    const json = await res.json();

    topics = json.topics || {};
    const names = Object.keys(topics);

    if (!names.length) {
      app.innerHTML = `<div class="card">אין נושאים זמינים</div>`;
      return;
    }

    renderTopicSelect();
  } catch (e) {
    app.innerHTML = `<div class="card">שגיאה בטעינת נושאים: ${e.message}</div>`;
  }
}

/* =====================
   Topic Select (Custom Dropdown)
===================== */
function renderTopicSelect() {
  // reset game state
  currentTopic = null;
  questions = [];

  index = 0;
  answered = false;
  lastAnswerIndex = null;
  currentQuestion = null;
  chatHistory = [];

  mistakes = [];
  usedHelp = false; // ✅ reset help usage

  // translation UI removed — questions are provided in Hebrew

  const names = Object.keys(topics);
  let selected = names[0];

  app.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">בחר נושא</h3>

      <div class="row">
        <div class="dd" id="topicDD" tabindex="0" role="button" aria-expanded="false">
          <div class="dd-trigger">
            <span class="dd-label" id="topicLabel">${labelTopic(names[0])}</span>
            <span class="dd-caret">▾</span>
          </div>
          <div class="dd-menu" id="topicMenu" role="listbox">
            ${names
              .map(
                t =>
                  `<div class="dd-item" role="option" data-value="${t}">${labelTopic(
                    t
                  )}</div>`
              )
              .join("")}
          </div>
        </div>

        <button class="btn primary" id="startBtn">התחל משחק (10 שאלות)</button>
      </div>

      <p class="muted" style="margin-top:10px;">
        אחרי שתתחיל משחק: רמז/הסבר/צ’אט.
      </p>
    </div>
  `;

  const dd = document.getElementById("topicDD");
  const menu = document.getElementById("topicMenu");
  const label = document.getElementById("topicLabel");
  const startBtn = document.getElementById("startBtn");

  const items = [...menu.querySelectorAll(".dd-item")];
  if (items[0]) items[0].classList.add("active");

  function openDD() {
    dd.classList.add("open");
    dd.setAttribute("aria-expanded", "true");
  }
  function closeDD() {
    dd.classList.remove("open");
    dd.setAttribute("aria-expanded", "false");
  }
  function toggleDD() {
    dd.classList.contains("open") ? closeDD() : openDD();
  }

  dd.addEventListener("click", e => {
    e.stopPropagation();
    toggleDD();
  });

  items.forEach(item => {
    item.addEventListener("click", e => {
      e.stopPropagation();
      selected = item.dataset.value;
      label.textContent = labelTopic(selected);

      items.forEach(x => x.classList.remove("active"));
      item.classList.add("active");

      closeDD();
    });
  });

  document.addEventListener("click", closeDD);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDD();
  });

  startBtn.onclick = () => {
    currentTopic = selected;
    const raw = topics[currentTopic] || [];
    if (!raw.length) {
      app.innerHTML = `<div class="card">אין שאלות לנושא הזה</div>`;
      return;
    }

    questions = shuffle([...raw]).slice(0, 10);

    index = 0;
    mistakes = [];
    usedHelp = false; // ✅ start game reset help usage

    renderQuestion();
  };
}

/* =====================
   Question Screen
===================== */
function renderQuestion() {
  const q = questions[index];
  currentQuestion = q;

  answered = false;
  lastAnswerIndex = null;
  chatHistory = [];

  // single-column question card — keep the select/dropdown unchanged (only shown in renderTopicSelect)
  app.innerHTML = `
    <div class="card">
      <div class="topbar">
        <div class="muted">שאלה ${index + 1} / ${questions.length}</div>
        <div class="muted">נושא: <b>${labelTopic(currentTopic)}</b></div>
      </div>

      <p class="question">${q.question}</p>

      <div id="answers"></div>

      <div class="actions">
        <button class="btn ghost" id="hintBtn">💡 רמז</button>
        <button class="btn ghost" id="explainBtn" disabled>📘 הסבר תשובה</button>
        <button class="btn primary" id="nextBtn" disabled>➡ הבא</button>
        <button class="btn ghost" id="backTopicsBtn">↩ חזרה לנושאים</button>
      </div>

      <div class="ai-box" id="aiBox">כאן יופיע רמז/הסבר</div>

      <div class="hr"></div>

      <h4 style="margin:0 0 8px;">💬 צ’אט</h4>
      <div class="chat-log" id="chatLog">
        <div class="bubble ai">שאל 2 שאלות על השאלה הזו —אני אתן הכוונה.</div>
      </div>

      <div class="chat-row">
        <input id="chatInput" class="chat-input" placeholder="שאל כאן..." />
        <button class="btn primary" id="chatSend">שלח</button>
      </div>
    </div>
  `;

  // Guest mode: "hint" behaves like AI help, but keep the UI label as-is.

  // build answers safely (textContent to avoid <class 'int'> disappearing)
  const answersDiv = document.getElementById("answers");
  q.choices.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.className = "answer";
    btn.dataset.i = i;
    btn.textContent = c;
    btn.onclick = () => selectAnswer(i);
    answersDiv.appendChild(btn);
  });

  // wire buttons
  const hintBtn = document.getElementById("hintBtn");
  const explainBtn = document.getElementById("explainBtn");
  const nextBtn = document.getElementById("nextBtn");
  const backBtn = document.getElementById("backTopicsBtn");

  if (hintBtn) hintBtn.onclick = askHint;
  if (explainBtn) explainBtn.onclick = askExplain;
  if (nextBtn) nextBtn.onclick = nextQuestion;
  if (backBtn) backBtn.onclick = renderTopicSelect;

  // wire chat
  const chatSend = document.getElementById("chatSend");
  const chatInput = document.getElementById("chatInput");

  if (chatSend && chatInput) {
    chatSend.onclick = sendChatMessage;
    chatInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // Guest demo: block ANY AI/Groq actions from both buttons.
  if (__isGuestTrivia) {
    if (hintBtn) {
      hintBtn.disabled = true;
      hintBtn.title = "דמו אורח: אין אפשרות לרמז / AI";
    }
    if (explainBtn) {
      explainBtn.disabled = true;
      explainBtn.title = "דמו אורח: אין אפשרות להסבר / AI";
    }
    if (chatSend) chatSend.disabled = true;
    if (chatInput) {
      chatInput.disabled = true;
      chatInput.placeholder = "דמו אורח: אין אפשרות לשלוח ל-AI";
    }
  }
}

/* =====================
   Answer Logic
===================== */
function selectAnswer(i) {
  if (answered) return;
  answered = true;
  lastAnswerIndex = i;

  const q = questions[index];

  // save mistake only if wrong
  if (i !== q.correctIndex) {
    const userText = q.choices?.[i] ?? "-";
    const correctText = q.choices?.[q.correctIndex] ?? "-";
    mistakes.push({
      qNumber: index + 1,
      qText: q.question,
      userText,
      correctText,
    });
  }

  document.querySelectorAll(".answer").forEach((b, idx) => {
    b.disabled = true;
    if (idx === q.correctIndex) b.classList.add("correct");
    if (idx === i && i !== q.correctIndex) b.classList.add("wrong");
  });

  const explainBtn = document.getElementById("explainBtn");
  const nextBtn = document.getElementById("nextBtn");
  if (explainBtn) explainBtn.disabled = __isGuestTrivia ? true : false;
  if (nextBtn) nextBtn.disabled = false;
}

/* =====================
   AI: Hint / Explain
===================== */
async function askHint() {
  if (__isGuestTrivia) {
    const box = document.getElementById("aiBox");
    if (box) box.textContent = "דמו אורח: אין אפשרות להשתמש ב-AI.";
    return;
  }

  usedHelp = true; // ✅ any hint counts as help

  const box = document.getElementById("aiBox");
  if (!box) return;
  box.textContent = __isGuestTrivia ? "טוען עזרה (AI)..." : "טוען רמז...";

  try {
    const q = questions[index];
    const res = await fetch("/api/trivia/chat/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({
        question: q,
        userMessage: __isGuestTrivia
          ? "עזור לי לפתור בלי לגלות את התשובה."
          : "תן רמז בלי לגלות תשובה",
        history: [],
        isHint: __isGuestTrivia ? false : true  // Guest: treat as regular chat
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      box.textContent = "נכשל: " + (json.details || json.error || "שגיאה");
      return;
    }
    
    // הצג הודעת הגבלה אם נדרש
    if (json.limitReached) {
      box.textContent = json.text;
      return;
    }
    
    box.textContent = json.text || "אין תשובה";
    
    // הצג מונה שימוש (אופציונלי)
    if (json.usageCount && json.maxUsage) {
      box.textContent += `\n\n(רמז ${json.usageCount}/${json.maxUsage})`;
    }
  } catch (e) {
    box.textContent = "שגיאת רשת: " + e.message;
  }
}

async function askExplain() {
  if (__isGuestTrivia) {
    const box = document.getElementById("aiBox");
    if (box) box.textContent = "דמו אורח: אין אפשרות להשתמש ב-AI להסבר.";
    return;
  }
  usedHelp = true; // ✅ explain counts as help

  const box = document.getElementById("aiBox");
  if (!box) return;

  if (lastAnswerIndex === null) {
    box.textContent = "ענה קודם ואז אוכל להסביר.";
    return;
  }

  box.textContent = "טוען הסבר...";

  try {
    const q = questions[index];
    const res = await fetch("/api/trivia/explain/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({
        question: q,
        userAnswerIndex: lastAnswerIndex,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      box.textContent = "נכשל: " + (json.details || json.error || "שגיאה");
      return;
    }
    
    // הצג הודעת הגבלה אם נדרש
    if (json.limitReached) {
      box.textContent = json.text;
      return;
    }
    
    box.textContent = json.text || "אין הסבר";
    
    // הצג מונה שימוש (אופציונלי)
    if (json.usageCount && json.maxUsage) {
      box.textContent += `\n\n(הסבר ${json.usageCount}/${json.maxUsage})`;
    }
  } catch (e) {
    box.textContent = "שגיאת רשת: " + e.message;
  }
}

/* =====================
   Chat (no spoilers)
===================== */
function appendBubble(role, text) {
  const chatLog = document.getElementById("chatLog");
  if (!chatLog) return;

  const div = document.createElement("div");
  div.className = "bubble " + (role === "user" ? "user" : "ai");
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChatMessage() {
  const chatInput = document.getElementById("chatInput");
  const msg = (chatInput?.value || "").trim();
  if (!msg) return;

  if (__isGuestTrivia) {
    appendBubble("ai", "דמו אורח: אין אפשרות להשתמש ב-AI.");
    return;
  }

  if (!currentQuestion) {
    appendBubble("ai", "בחר נושא והתחל משחק כדי לשאול על שאלה.");
    return;
  }

  usedHelp = true; // ✅ chat counts as help

  chatInput.value = "";
  appendBubble("user", msg);

  try {
    const res = await fetch("/api/trivia/chat/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({
        question: currentQuestion,
        userMessage: msg,
        history: chatHistory,
        isHint: false  // ✅ זה צ'אט רגיל, לא רמז
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      appendBubble("ai", "נכשל: " + (json.details || json.error || "שגיאה"));
      return;
    }

    chatHistory = json.history || chatHistory;
    
    // הצג הודעת הגבלה אם נדרש
    if (json.limitReached) {
      appendBubble("ai", json.text);
      return;
    }
    
    let botMsg = json.text || "אין תשובה";
    
    // הצג מונה שימוש (אופציונלי)
    if (json.usageCount && json.maxUsage) {
      botMsg += `\n\n💬 הודעה ${json.usageCount}/${json.maxUsage}`;
    }
    
    appendBubble("ai", botMsg);
  } catch (e) {
    appendBubble("ai", "שגיאת רשת: " + e.message);
  }
}

/* =====================
   Next
===================== */
function nextQuestion() {
  index++;
  if (index >= questions.length) {
    endGame();
    return;
  }
  renderQuestion();
}

/* =====================
   End Game (Score + animations + crown only if NO help)
===================== */
function endGame() {
  currentQuestion = null;
  chatHistory = [];

  const total = questions.length || 10;
  const correct = total - mistakes.length;

  // score bucket
  const perfect = correct === total;
  const perfectNoHelp = perfect && !usedHelp;

  let msg = "";
  let badgeEmoji = "";
  let badgeClass = "";

  if (correct < 6) {
    msg = "לאט לאט ככה מתחילים! 💪";
    badgeEmoji = "🐢";
    badgeClass = "badge badge-low";
  } else if (correct <= 8) {
    msg = "לא רע בכלל! 👏";
    badgeEmoji = "👍";
    badgeClass = "badge badge-mid";
  } else if (correct === total - 1) {
    msg = "טוב! 🔥";
    badgeEmoji = "🚀";
    badgeClass = "badge badge-high";
  } else if (perfect && usedHelp) {
    msg = "מושלם! אבל השתמשת בעזרה 😉 עדיין תותח!";
    badgeEmoji = "⭐";
    badgeClass = "badge badge-perfect-help";
  } else if (perfectNoHelp) {
    msg = "מושלם בלי עזרה! אלוף אמיתי! 👑";
    badgeEmoji = "👑";
    badgeClass = "badge badge-perfect";
  } else {
    msg = "כל הכבוד!";
    badgeEmoji = "✅";
    badgeClass = "badge badge-mid";
  }

  const helpNote = usedHelp
    ? `<div class="muted" style="margin-top:8px;">* השתמשת בעזרה במהלך המשחק</div>`
    : `<div class="muted" style="margin-top:8px;">* לא השתמשת בעזרה במהלך המשחק</div>`;

  const mistakesHtml =
    mistakes.length === 0
      ? `<div class="muted" style="margin-top:10px;">אין טעויות 🎉</div>`
      : `
        <div class="hr"></div>
        <h4 style="margin:0 0 8px;">במה הייתה הטעות?</h4>
        <div class="mistakes">
          ${mistakes
            .map(
              m => `
              <div class="mistake-card">
                <div class="muted">שאלה ${m.qNumber}</div>
                <div class="mistake-q">${m.qText}</div>
                <div class="mistake-a wrong">בחרת: ${m.userText}</div>
                <div class="mistake-a correct">נכון: ${m.correctText}</div>
              </div>
            `
            )
            .join("")}
        </div>
      `;

  app.innerHTML = `
    <div class="card">
      <div class="${badgeClass}" aria-label="score-badge">${badgeEmoji}</div>

      <h3 style="margin-top:0;">🎉 סיימת!</h3>

      <p class="question" style="margin:10px 0;">
        ענית נכון <b>${correct}</b> מתוך <b>${total}</b>
      </p>

      <div class="ai-box">${msg}</div>
      ${helpNote}

      ${mistakesHtml}

      <div class="actions" style="margin-top:14px;">
        <button class="btn primary" id="againBtn">שחק שוב</button>
        <button class="btn ghost" id="topicsBtn">↩ חזרה לנושאים</button>
        <button class="btn ghost" id="homeBtn">⬅ חזרה לבית</button>
      </div>
    </div>
  `;

  const againBtn = document.getElementById("againBtn");
  const homeBtn = document.getElementById("homeBtn");
  const topicsBtn = document.getElementById("topicsBtn");

  if (againBtn) againBtn.onclick = () => renderTopicSelect();
  if (topicsBtn) topicsBtn.onclick = () => renderTopicSelect();
  if (homeBtn) homeBtn.onclick = () => (window.location.href = "/");
}

// Translation toggle removed — questions are provided in Hebrew

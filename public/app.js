// ===== الحالة =====
const state = {
  settings: null,
  currentConvId: null,
  messages: [],
  streaming: false,
  abortController: null
};

const $ = (id) => document.getElementById(id);

// ===== أدوات مساعدة =====
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== محوّل Markdown بسيط وآمن =====
function renderMarkdown(text) {
  let s = escapeHtml(text);

  // كتل الكود
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const label = lang ? `<span class="lang">${lang}</span>` : "";
    return `<pre><button class="copy-btn" data-code="${encodeURIComponent(code)}">نسخ</button><code>${code}</code></pre>`;
  });

  // عناوين
  s = s.replace(/^###### (.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/^##### (.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // اقتباسات
  s = s.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");

  // جداول بسيطة
  s = s.replace(/^\|(.+)\|$/gm, (m, row) => {
    const cells = row.split("|").map((c) => c.trim());
    const isHeader = /^:?-{3,}:?$/.test(cells[1] || "");
    if (isHeader) return "";
    const tag = /^\s*:?-{3,}:?\s*$/.test(row) ? "" : "";
    const type = cells[0] === "" ? "td" : "td";
    return "<tr>" + cells.map((c) => `<${type}>${inlineMd(c)}</${type}>`).join("") + "</tr>";
  });

  // قوائم
  s = s.replace(/^(\s*)[*-] (.*)$/gm, "<ul><li>$2</li></ul>");
  s = s.replace(/^(\s*)\d+\. (.*)$/gm, "<ol><li>$2</li></ol>");
  s = s.replace(/<\/ul>\n<ul>/g, "");
  s = s.replace(/<\/ol>\n<ol>/g, "");

  // أسطر
  const lines = s.split("\n");
  let html = "";
  let listType = null;
  for (const line of lines) {
    if (line.startsWith("<ul>")) {
      if (listType !== "ul") { if (listType) html += `</${listType}>`; html += "<ul>"; listType = "ul"; }
      continue;
    }
    if (line.startsWith("<ol>")) {
      if (listType !== "ol") { if (listType) html += `</${listType}>`; html += "<ol>"; listType = "ol"; }
      continue;
    }
    if (listType && line.trim() === "") { html += `</${listType}>`; listType = null; continue; }
    if (line.trim() === "") { html += ""; continue; }
    if (line.startsWith("<") && !line.startsWith("<li>")) { html += line; continue; }
    html += `<p>${inlineMd(line)}</p>`;
  }
  if (listType) html += `</${listType}>`;

  return html;
}

function inlineMd(s) {
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

// ===== بناء عناصر الرسائل =====
function buildMessage(msg, animateCursor = false) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${msg.role === "user" ? "user" : "ai"}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = msg.role === "user" ? "🧑" : "🤖";

  const body = document.createElement("div");
  body.className = "body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = msg.role === "user" ? escapeHtml(msg.content) : renderMarkdown(msg.content);
  if (animateCursor) {
    const cur = document.createElement("span");
    cur.className = "cursor";
    bubble.appendChild(cur);
  }

  body.appendChild(bubble);

  const actions = document.createElement("div");
  actions.className = "actions";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "نسخ";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(msg.content).then(() => toast("تم النسخ"));
  };
  actions.appendChild(copyBtn);
  if (msg.role === "ai") {
    const regenBtn = document.createElement("button");
    regenBtn.textContent = "إعادة توليد";
    regenBtn.onclick = () => regenerate();
    actions.appendChild(regenBtn);
  }
  body.appendChild(actions);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function renderMessages() {
  const container = $("messages");
  container.innerHTML = "";
  $("welcome").style.display = state.messages.length ? "none" : "flex";
  for (const m of state.messages) {
    container.appendChild(buildMessage(m));
  }
  scrollToBottom();
}

function scrollToBottom() {
  const chat = $("chat");
  chat.scrollTop = chat.scrollHeight;
}

// ===== تحميل القوائم =====
async function loadConversations() {
  const list = $("convList");
  const res = await fetch("/api/conversations");
  const convs = await res.json();
  list.innerHTML = "";
  for (const c of convs) {
    const item = document.createElement("div");
    item.className = "conv-item" + (c.id === state.currentConvId ? " active" : "");
    item.innerHTML = `<span class="title">${escapeHtml(c.title)}</span>`;
    item.onclick = () => { openConversation(c.id); toggleSidebar(false); };

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "🗑";
    del.onclick = (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    };
    item.appendChild(del);
    list.appendChild(item);
  }
}

async function openConversation(id) {
  if (state.streaming) return;
  state.currentConvId = id;
  const res = await fetch(`/api/conversations/${id}`);
  if (res.ok) {
    const c = await res.json();
    state.messages = c.messages || [];
    renderMessages();
    loadConversations();
  }
}

function newConversation() {
  if (state.streaming) return;
  state.currentConvId = null;
  state.messages = [];
  renderMessages();
  loadConversations();
  $("input").focus();
}

async function deleteConversation(id) {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  if (state.currentConvId === id) newConversation();
  loadConversations();
}

async function persistConversation() {
  const body = {
    title: state.messages[0]?.content?.slice(0, 40) || "محادثة جديدة",
    messages: state.messages
  };
  if (state.currentConvId) {
    await fetch(`/api/conversations/${state.currentConvId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, id: null })
    });
    const c = await res.json();
    state.currentConvId = c.id;
  }
  loadConversations();
}

// ===== النماذج =====
async function loadModels() {
  const sel = $("modelSelect");
  const res = await fetch("/api/models");
  const data = await res.json();
  const models = data.models || [];
  sel.innerHTML = "";
  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = state.settings.model || "لم يتم العثور على نماذج — حدد نموذجًا في الإعدادات";
    sel.appendChild(opt);
  } else {
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      opt.selected = m === state.settings.model;
      sel.appendChild(opt);
    }
  }
  if (data.note) toast(data.note);
}

// ===== الإرسال =====
async function sendMessage() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || state.streaming) return;

  input.value = "";
  autoResize();

  state.messages.push({ role: "user", content: text });
  renderMessages();
  $("welcome").style.display = "none";

  const model = $("modelSelect").value || state.settings.model;
  setStatus(`جاري التفكير (${model})…`);

  // رسالة مساعد فارغة للبث
  state.messages.push({ role: "assistant", content: "" });
  renderMessages();
  const aiMsg = state.messages[state.messages.length - 1];

  const bubble = getLastAiBubble();
  state.streaming = true;
  $("sendBtn").disabled = true;

  const controller = new AbortController();
  state.abortController = controller;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.filter((m) => m.role !== "assistant" || m.content),
        model,
        stream: true
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "حدث خطأ");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            aiMsg.content += delta;
            bubble.innerHTML = renderMarkdown(aiMsg.content) + '<span class="cursor"></span>';
            scrollToBottom();
          }
        } catch { /* تجاهل أسطر غير مكتملة */ }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      aiMsg.content = aiMsg.content || `⚠️ ${e.message}`;
      toast(e.message);
    }
  } finally {
    state.streaming = false;
    $("sendBtn").disabled = false;
    setStatus("");
    // إزالة المؤشر
    const b = getLastAiBubble();
    if (b) b.innerHTML = renderMarkdown(aiMsg.content);
    if (aiMsg.content.trim()) {
      await persistConversation();
    } else {
      state.messages.pop();
      renderMessages();
    }
  }
}

function getLastAiBubble() {
  const msgs = document.querySelectorAll(".msg.ai .bubble");
  return msgs[msgs.length - 1] || null;
}

async function regenerate() {
  if (state.streaming || !state.messages.length) return;
  const lastAi = [...state.messages].reverse().find((m) => m.role === "assistant");
  if (!lastAi) return;
  state.messages = state.messages.filter((m) => m !== lastAi);
  const input = $("input");
  // أعد إرسال آخر رسالة مستخدم
  const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) { renderMessages(); return; }
  state.messages = state.messages.filter((m) => m !== lastUser);
  input.value = lastUser.content;
  renderMessages();
  await sendMessage();
}

function setStatus(txt) {
  $("status").textContent = txt;
}

function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

// ===== الإعدادات =====
async function loadSettings() {
  const res = await fetch("/api/settings");
  state.settings = await res.json();
  $("setBaseUrl").value = state.settings.baseUrl;
  $("setApiKey").value = state.settings.apiKey;
  $("setModel").value = state.settings.model;
  $("setSystemPrompt").value = state.settings.systemPrompt;
  $("setTemperature").value = state.settings.temperature;
  $("tempVal").textContent = state.settings.temperature;
  $("setMaxTokens").value = state.settings.maxTokens;
  $("setTopP").value = state.settings.topP;
  $("topPVal").textContent = state.settings.topP;
  $("setStream").checked = state.settings.stream;
}

async function saveSettings() {
  const body = {
    baseUrl: $("setBaseUrl").value.trim(),
    apiKey: $("setApiKey").value.trim(),
    model: $("setModel").value.trim(),
    systemPrompt: $("setSystemPrompt").value,
    temperature: parseFloat($("setTemperature").value),
    maxTokens: parseInt($("setMaxTokens").value, 10),
    topP: parseFloat($("setTopP").value),
    stream: $("setStream").checked
  };
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  state.settings = { ...state.settings, ...body };
  closeSettings();
  loadModels();
  toast("تم حفظ الإعدادات");
}

function openSettings() {
  $("settingsModal").classList.add("open");
}
function closeSettings() {
  $("settingsModal").classList.remove("open");
}

// ===== التصدير =====
function exportConversation() {
  if (!state.messages.length) return toast("لا توجد محادثة للتصدير");
  const title = state.currentConvId || "محادثة";
  const md = state.messages
    .map((m) => `## ${m.role === "user" ? "👤 المستخدم" : "🤖 المساعد"}\n\n${m.content}`)
    .join("\n\n---\n\n");
  const blob = new Blob([`# ${title}\n\n${md}`], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast("تم تصدير المحادثة");
}

// ===== الإدخال التلقائي =====
function autoResize() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

// ===== الشريط الجانبي =====
function toggleSidebar(force) {
  const sb = $("sidebar");
  const bd = $("sidebarBackdrop");
  const open = force !== undefined ? force : sb.classList.contains("collapsed");
  sb.classList.toggle("collapsed", !open);
  bd.classList.toggle("show", open);
}

// ===== التهيئة =====
async function init() {
  await loadSettings();
  await loadModels();

  $("newChatBtn").onclick = () => { newConversation(); toggleSidebar(false); };
  $("sendBtn").onclick = sendMessage;
  $("menuBtn").onclick = () => toggleSidebar();
  $("sidebarBackdrop").onclick = () => toggleSidebar(false);
  $("settingsBtn").onclick = openSettings;
  $("closeSettings").onclick = closeSettings;
  $("cancelSettings").onclick = closeSettings;
  $("saveSettings").onclick = saveSettings;
  $("exportBtn").onclick = exportConversation;
  $("refreshModels").onclick = loadModels;

  $("setTemperature").oninput = (e) => ($("tempVal").textContent = e.target.value);
  $("setTopP").oninput = (e) => ($("topPVal").textContent = e.target.value);

  // أزرار اختيار المزوّد
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.onclick = () => {
      $("setBaseUrl").value = btn.dataset.base;
      document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  $("themeBtn").onclick = () => {
    document.body.classList.toggle("light");
    $("themeLabel").textContent = document.body.classList.contains("light") ? "الوضع الداكن" : "الوضع الفاتح";
  };

  const input = $("input");
  input.addEventListener("input", autoResize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // اقتراحات
  document.querySelectorAll(".suggestion").forEach((btn) => {
    btn.onclick = () => {
      input.value = btn.textContent;
      sendMessage();
    };
  });

  // نسخ الأكواد (تفويض)
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("copy-btn")) {
      const code = decodeURIComponent(e.target.dataset.code);
      navigator.clipboard.writeText(code).then(() => toast("تم نسخ الكود"));
    }
  });

  // إغلاق النافذة بالنقر خارجها
  $("settingsModal").addEventListener("click", (e) => {
    if (e.target === $("settingsModal")) closeSettings();
  });

  // إيقاف التوليد بزر Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.streaming) stopStreaming();
  });

  // تحميل آخر محادثة
  const convs = await fetch("/api/conversations").then((r) => r.json());
  if (convs.length) {
    openConversation(convs[0].id);
  } else {
    renderMessages();
  }
  loadConversations();
}

init();

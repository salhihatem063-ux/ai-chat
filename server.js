import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SETTINGS_FILE = path.join(__dirname, "settings.json");
const CONVERSATIONS_DIR = path.join(__dirname, "conversations");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------- التخزين ----------
const defaultSettings = {
  baseUrl: process.env.AI_BASE_URL || "http://localhost:11434/v1",
  apiKey: process.env.AI_API_KEY || "",
  model: process.env.AI_MODEL || "dolphin-llama3",
  systemPrompt: "أنت مساعد ذكاء اصطناعي مفيد ودقيق.",
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  stream: true
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), "utf8");
}

function convPath(id) {
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "");
}

function listConversations() {
  try {
    if (!fs.existsSync(CONVERSATIONS_DIR)) return [];
    return fs
      .readdirSync(CONVERSATIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), "utf8"));
          return { id: c.id, title: c.title || "محادثة", updatedAt: c.updatedAt || 0 };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadConversation(id) {
  try {
    return JSON.parse(fs.readFileSync(convPath(id), "utf8"));
  } catch {
    return null;
  }
}

function saveConversation(c) {
  if (!fs.existsSync(CONVERSATIONS_DIR)) fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  fs.writeFileSync(convPath(c.id), JSON.stringify(c, null, 2), "utf8");
}

// ---------- المسارات ----------
app.get("/api/settings", (_req, res) => res.json(loadSettings()));

app.post("/api/settings", (req, res) => {
  const s = loadSettings();
  const allowed = ["baseUrl", "apiKey", "model", "systemPrompt", "temperature", "maxTokens", "topP", "stream"];
  for (const k of allowed) {
    if (k in req.body) s[k] = req.body[k];
  }
  saveSettings(s);
  res.json(s);
});

app.get("/api/conversations", (_req, res) => res.json(listConversations()));

app.get("/api/conversations/:id", (req, res) => {
  const c = loadConversation(safeId(req.params.id));
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(c);
});

app.post("/api/conversations", (req, res) => {
  const c = {
    id: req.body.id || `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: req.body.title || "محادثة جديدة",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: req.body.messages || []
  };
  saveConversation(c);
  res.json(c);
});

app.put("/api/conversations/:id", (req, res) => {
  const id = safeId(req.params.id);
  const existing = loadConversation(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const updated = {
    ...existing,
    ...(req.body.title !== undefined ? { title: req.body.title } : {}),
    ...(req.body.messages !== undefined ? { messages: req.body.messages } : {}),
    updatedAt: Date.now()
  };
  saveConversation(updated);
  res.json(updated);
});

app.delete("/api/conversations/:id", (req, res) => {
  const id = safeId(req.params.id);
  try {
    fs.unlinkSync(convPath(id));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

// ---------- جلب قائمة النماذج من الخادم الخلفي ----------
app.get("/api/models", async (_req, res) => {
  const s = loadSettings();
  const base = s.baseUrl.replace(/\/+$/, "");
  try {
    // OpenAI-compatible: GET {base}/models
    const r = await fetch(`${base}/models`, {
      headers: s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}
    });
    if (r.ok) {
      const data = await r.json();
      const models = (data.data || []).map((m) => m.id || m.name).filter(Boolean);
      return res.json({ models });
    }
  } catch { /* تجاهل */ }

  // Ollama native: GET {origin}/api/tags
  try {
    const origin = base.replace(/\/v1\/?$/, "");
    const r = await fetch(`${origin}/api/tags`);
    if (r.ok) {
      const data = await r.json();
      const models = (data.models || []).map((m) => m.name).filter(Boolean);
      return res.json({ models });
    }
  } catch { /* تجاهل */ }

  res.json({ models: [], note: "تعذّر الاتصال بالخادم الخلفي. تحقق من الإعدادات." });
});

// ---------- المحادثة (بثّ لحظي) ----------
app.post("/api/chat", async (req, res) => {
  const s = loadSettings();
  const { messages, temperature, maxTokens, topP, model, systemPrompt, stream } = req.body;

  const base = (s.baseUrl || defaultSettings.baseUrl).replace(/\/+$/, "");
  const useStream = stream ?? s.stream;

  const fullMessages = [
    { role: "system", content: systemPrompt ?? s.systemPrompt },
    ...(messages || [])
  ];

  const payload = {
    model: model || s.model,
    messages: fullMessages,
    temperature: temperature ?? s.temperature,
    max_tokens: maxTokens ?? s.maxTokens,
    top_p: topP ?? s.topP,
    stream: !!useStream
  };

  const headers = {
    "Content-Type": "application/json",
    ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {})
  };

  if (!payload.model) {
    return res.status(400).json({ error: "لم يتم تحديد نموذج. اذهب إلى الإعدادات واختر نموذجًا." });
  }

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `خطأ من الخادم الخلفي (${upstream.status}): ${text.slice(0, 500)}` });
    }

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              res.write(`data: ${line.slice(6)}\n\n`);
            }
          }
        }
        res.write("data: [DONE]\n\n");
      } catch (e) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(e.message) })}\n\n`);
      }
      res.end();
    } else {
      const data = await upstream.json();
      const content = data?.choices?.[0]?.message?.content || "";
      res.json({ content, raw: data });
    }
  } catch (e) {
    res.status(502).json({ error: `تعذّر الاتصال بالخادم الخلفي: ${e.message}` });
  }
});

// ---------- الملفات الثابتة ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 AI Chat يعمل على http://0.0.0.0:${PORT}`);
});

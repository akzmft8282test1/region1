/**
 * server/index.js
 *
 * 개선판:
 * - friendly routes 추가 (/quiz/:slug -> public/quiz/template.html 등)
 * - API 응답 JSON 일관성 유지
 * - CORS 출처 제어 (환경변수 ALLOWED_ORIGINS)
 * - Supabase client는 anon 키만 사용 (.env)
 * - /config.js 제공 → 클라이언트에서 window.__SUPABASE_URL__ 읽을 수 있음
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

console.log("DEBUG .env:", {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY ? "(set)" : "(missing)",
  PORT: process.env.PORT,
});

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT ? Number(process.env.PORT) : 1030;

// Supabase 초기화 — 반드시 anon(public) 키 사용
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL or SUPABASE_KEY not set in .env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// JWT 시크릿키
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";

// CORS 설정
let corsOptions = {};
if (process.env.ALLOWED_ORIGINS) {
  const origins = process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  corsOptions = {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
  };
} else {
  corsOptions = { origin: true }; // 개발 중 허용
}

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 정적 파일
app.use(express.static(path.join(__dirname, "..", "public")));

// ✅ 클라이언트에 Supabase 값 제공
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(`
    window.__SUPABASE_URL__ = "${SUPABASE_URL}";
    window.__SUPABASE_KEY__ = "${SUPABASE_KEY}";
    window.__QUIZ_BUCKET__ = "${process.env.QUIZ_BUCKET || "quiz-assets"}";
  `);
});

/* ------------------------------
   Utility
------------------------------ */
function slugify(name) {
  return name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}
function sendFileResponse(res, relPath) {
  return res.sendFile(path.join(__dirname, "..", "public", relPath));
}

/* ------------------------------
   Middleware: JWT 인증
------------------------------ */
function requireAuth(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth) return res.status(401).json({ error: "No authorization header" });

  const token = auth.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid auth header" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { username, admin }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.admin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/* ------------------------------
   Friendly routes
------------------------------ */
app.get("/", (req, res) => sendFileResponse(res, "quizmaker.html"));
app.get("/quizmaker", (req, res) => sendFileResponse(res, "quizmaker.html"));
app.get("/quizmaker/make", (req, res) =>
  sendFileResponse(res, "quizmaker/make.html"),
);
app.get("/quizmaker/my/:slug", (req, res) =>
  sendFileResponse(res, "quizmaker/my/template.html"),
);
app.get("/host/:slug", (req, res) =>
  sendFileResponse(res, "host/template.html"),
);
app.get("/quiz/:slug/leaderboard", (req, res) =>
  sendFileResponse(res, "quiz/leaderboard.html"),
);
app.get("/quiz/:slug", (req, res) =>
  sendFileResponse(res, "quiz/template.html"),
);

// ✅ 로그인 / 회원가입 페이지 라우팅
app.get("/login", (req, res) => sendFileResponse(res, "login.html"));
app.get("/register", (req, res) => sendFileResponse(res, "register.html"));

/* ------------------------------
   Auth Routes (회원가입 / 로그인)
------------------------------ */
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username & password required" });

    const hash = await bcrypt.hash(password, 10);

    // ⚠️ 일반 사용자는 무조건 admin = false
    const { error } = await supabase.from("accounts").insert([
      {
        username,
        password: hash,
        admin: false,
      },
    ]);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username & password required" });

    const { data: account, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;
    if (!account) return res.status(400).json({ error: "invalid credentials" });

    const valid = await bcrypt.compare(password, account.password);
    if (!valid) return res.status(400).json({ error: "invalid credentials" });

    const token = jwt.sign(
      { username: account.username, admin: account.admin },
      JWT_SECRET,
      { expiresIn: "6h" },
    );

    // ✅ admin 정보를 응답에 포함시킴
    res.json({ success: true, token, admin: account.admin });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

/* ------------------------------
   API: 퀴즈 생성 / 조회 / 문제 추가
------------------------------ */
app.post("/api/quizzes", async (req, res) => {
  try {
    const { name, settings } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${uuidv4().slice(0, 6)}`;

    const { data, error } = await supabase
      .from("quizzes")
      .insert([{ name, slug, settings: settings || {} }])
      .select("*")
      .single();

    if (error) throw error;
    res.json({ success: true, quiz: data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

app.get("/api/quizzes/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: quiz, error } = await supabase
      .from("quizzes")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!quiz) return res.status(404).json({ error: "quiz not found" });

    const { data: questions } = await supabase
      .from("questions")
      .select("*, answers(*)")
      .eq("quiz_id", quiz.id)
      .order("ord");
    quiz.questions = questions || [];

    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

app.post("/api/quizzes/:slug/questions", async (req, res) => {
  try {
    const { slug } = req.params;
    const { text, image_url, timeout, double_points, answers } = req.body;

    const { data: quiz } = await supabase
      .from("quizzes")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!quiz) return res.status(404).json({ error: "quiz not found" });

    const { count } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quiz.id);
    const ord = count || 0;

    const { data: question, error: qerr } = await supabase
      .from("questions")
      .insert([
        {
          quiz_id: quiz.id,
          ord,
          text: text || "",
          image_url: image_url || null,
          timeout: timeout || 30,
          double_points: !!double_points,
        },
      ])
      .select("*")
      .single();
    if (qerr) throw qerr;

    if (Array.isArray(answers)) {
      const inserts = answers.map((a, idx) => ({
        question_id: question.id,
        ord: idx,
        text: a.text || "",
        image_url: a.image_url || null,
        is_correct: !!a.is_correct,
      }));
      await supabase.from("answers").insert(inserts);
    }

    res.json({ success: true, question });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

/* ------------------------------
   Slug 관리 라우트 (Admin 전용)
------------------------------ */
app.get("/supa/slug/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("quizzes")
      .select("id,slug")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "quiz not found" });
    res.json({ success: true, quiz: data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

app.put("/supa/slug/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { slug } = req.body;
    if (!slug) return res.status(400).json({ error: "slug required" });
    const { data, error } = await supabase
      .from("quizzes")
      .update({ slug })
      .eq("id", id)
      .select("id,slug")
      .single();
    if (error) throw error;
    res.json({ success: true, quiz: data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

/* ------------------------------
   Healthcheck
------------------------------ */
app.get("/api/ping", (req, res) =>
  res.json({ pong: true, time: new Date().toISOString() }),
);

/* ------------------------------
   404 처리
------------------------------ */
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API not found" });
  }
  if (req.path.endsWith(".js") || req.path.endsWith(".css")) {
    return res.status(404).send("File not found");
  }
  return sendFileResponse(res, "quizmaker.html");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ QuizMaker server running on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Access it via: http://quiz.64bit.kr:${PORT}`);
});

수정된 app.js,make.html, my/template.html, quiz/template.html, host/template.html 전체코드를 한 파일씩 나누어서 수정된 전체코드 제공

app.js

/* public/app.js
   공용 프론트엔드 로직 (퀴즈 목록 불러오기, 공유, 이동)
   - 모든 HTML에서 공통으로 사용됩니다.
   - quizmaker.html 에서 로드됩니다.
*/

/* ------------------------
   Supabase 초기화
   ------------------------ */
// ✅ /config.js 에서 window.__SUPABASE_URL__, window.__SUPABASE_KEY__ 주입됨
if (!window.supabase || !window.supabase.createClient) {
  console.error(
    "❌ Supabase JS not loaded. Add <script src='https://unpkg.com/@supabase/supabase-js'></script> before app.js",
  );
}

// ✅ supabase client 단일 생성 (중복 방지)
if (!window.supabaseClient && window.supabase) {
  window.supabaseClient = window.supabase.createClient(
    window.__SUPABASE_URL__,
    window.__SUPABASE_KEY__,
  );
  console.log("✅ Supabase client initialized");
}

// local alias → db 로 명확히 변경
const db = window.supabaseClient;

/* ------------------------
   유틸리티
   ------------------------ */
function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.log("ALERT:", msg);
  }
}

function buildQuizUrl(slug) {
  return `${window.location.origin}/quiz/${slug}`;
}

function buildHostUrl(slug) {
  return `${window.location.origin}/host/${slug}`;
}

async function uploadImage(file, path, bucket = "quiz-assets") {
  try {
    const { error } = await db.storage
      .from(bucket)
      .upload(path, file, { upsert: true });
    if (error) throw error;

    const { data: pub } = await db.storage.from(bucket).getPublicUrl(path);
    return pub.publicUrl;
  } catch (err) {
    console.error("uploadImage err", err);
    return null;
  }
}

/* ------------------------
   퀴즈 목록 불러오기 (내 퀴즈)
   - 호출: quizmaker.html 에서 DOMContentLoaded 시
   ------------------------ */
const quizListEl =
  document.getElementById && document.getElementById("quizList");

async function loadMyQuizzes() {
  if (!db) {
    console.error("❌ Supabase not initialized");
    if (quizListEl) {
      quizListEl.innerHTML = "<li>⚠️ 서버 설정 오류: Supabase 초기화 실패</li>";
    }
    return;
  }
  try {
    const { data, error } = await db
      .from("quizzes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      if (quizListEl) {
        quizListEl.innerHTML = "<li>아직 만든 퀴즈가 없습니다.</li>";
      }
      return;
    }

    if (quizListEl) {
      quizListEl.innerHTML = "";
      data.forEach((quiz) => {
        const li = document.createElement("li");
        li.className = "quiz-item";

        const title = document.createElement("span");
        title.textContent = quiz.name;

        if (quiz.settings?.image) {
          const img = document.createElement("img");
          img.src = quiz.settings.image;
          img.alt = `${quiz.name} 대표 이미지`;
          img.style.maxWidth = "40px";
          img.style.maxHeight = "40px";
          img.style.borderRadius = "6px";
          img.style.marginRight = "0.5rem";
          li.insertBefore(img, title);
        }

        // 버튼 그룹
        const btnBox = document.createElement("div");
        btnBox.className = "btn-box";

        const shareBtn = document.createElement("button");
        shareBtn.className = "small-btn";
        shareBtn.textContent = "공유 🔗";
        shareBtn.setAttribute("aria-label", `공유 ${quiz.name}`);
        shareBtn.onclick = async () => {
          const url = buildQuizUrl(quiz.slug);
          try {
            await navigator.clipboard.writeText(url);
            safeAlert("공유 링크가 복사되었습니다:\n" + url);
          } catch (e) {
            safeAlert("클립보드 복사 실패 — 링크를 직접 복사하세요:\n" + url);
          }
        };

        const hostBtn = document.createElement("button");
        hostBtn.className = "small-btn host";
        hostBtn.textContent = "호스트 🎤";
        hostBtn.setAttribute("aria-label", `호스트 ${quiz.name}`);
        hostBtn.onclick = () => {
          window.location.href = buildHostUrl(quiz.slug);
        };

        const manageBtn = document.createElement("button");
        manageBtn.className = "small-btn secondary";
        manageBtn.textContent = "관리 ✏️";
        manageBtn.setAttribute("aria-label", `관리 ${quiz.name}`);
        manageBtn.onclick = () => {
          window.location.href = `/quizmaker/my/${quiz.slug}`;
        };

        btnBox.appendChild(shareBtn);
        btnBox.appendChild(hostBtn);
        btnBox.appendChild(manageBtn);

        li.appendChild(title);
        li.appendChild(btnBox);
        quizListEl.appendChild(li);
      });
    }
  } catch (err) {
    console.error("loadMyQuizzes error", err);
    if (quizListEl) {
      quizListEl.innerHTML = "<li>퀴즈 목록을 불러오지 못했습니다.</li>";
    }
  }
}

/* ------------------------
   DOMContentLoaded hook
   ------------------------ */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (quizListEl) {
      loadMyQuizzes();
    } else {
      console.log("ℹ️ quizListEl not found: skipping quiz list load");
    }
  });
} else {
  if (quizListEl) {
    loadMyQuizzes();
  } else {
    console.log("ℹ️ quizListEl not found: skipping quiz list load");
  }
}
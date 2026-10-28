"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { exercises, catalog, findExercise } = require("./content.cjs");
const { MaterialLibrary } = require('./materials.cjs');

const MAX_COUNT = 10000;
const limitations = [
  "Chỉ thống kê nguồn chính thức trong phần chính; bài mẫu chính thức cũng không phải đề đầy đủ và không quy đổi thành điểm TOEIC.",
  "Bài AI/TTS và tài liệu người dùng cung cấp được thống kê riêng; xác nhận của người dùng không phải chứng nhận của nhà xuất bản.",
  "Bài hiện tại dùng file WAV TTS tạo sẵn; lịch sử cũ có thể dùng TTS trình duyệt. Xem nguồn audio của từng lượt. TTS không phải bản thu người thật hay audio thi ETS.",
  "Nguồn chính thức có định danh câu ổn định; làm lại hoặc đổi phiên bản của cùng câu không thành nội dung mới. Vài câu mẫu không đủ kết luận tiến bộ trên đề chưa gặp.",
  "Số lượt phát, lượt nghe hết, giọng và tốc độ do trình duyệt báo lại; máy chủ chấm đáp án nhưng không xác minh người học thực sự nghe.",
  "Thời gian làm bài tính từ lúc máy chủ tạo lượt đến khi nhận bài nộp, có thể bao gồm thời gian nghỉ hoặc đóng trang."
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  throw error;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function accuracy(correct, answered) { return answered ? Math.round(correct / answered * 1000) / 10 : 0; }
function stats() { return { attempts: 0, answered: 0, correct: 0, accuracy: 0, firstAnswered: 0, firstCorrect: 0, firstAccuracy: 0 }; }
function finishStats(value) {
  value.accuracy = accuracy(value.correct, value.answered);
  value.firstAccuracy = accuracy(value.firstCorrect, value.firstAnswered);
  return value;
}
function addStats(value, attempt) {
  value.attempts += 1;
  value.answered += attempt.questions.length;
  value.correct += attempt.questions.filter((question) => question.correct).length;
  value.firstAnswered += attempt.questions.filter((question) => question.firstAttempt).length;
  value.firstCorrect += attempt.questions.filter((question) => question.firstAttempt && question.correct).length;
}

class Store {
  constructor({ dbPath, timezone = "Asia/Bangkok" } = {}) {
    if (typeof dbPath !== "string" || !dbPath) fail("Thiếu đường dẫn cơ sở dữ liệu.");
    this.timezone = timezone;
    this.dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        exercise_id TEXT NOT NULL,
        version TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        run_id TEXT UNIQUE NOT NULL REFERENCES runs(id),
        exercise_id TEXT NOT NULL,
        version TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attempts_user_date ON attempts(user_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
    this.materials = new MaterialLibrary(this.db);
  }

  listExercises(userId) { return [...catalog,...this.materials.list(userId)]; }
  getExercise(userId,id) { return this.materials.find(userId,id) || findExercise(id); }

  day(timestamp) {
    const parts = Object.fromEntries(this.dateFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  startRun(userId, exerciseId, unitId) {
    const exercise = this.getExercise(userId,exerciseId);
    if (!exercise) fail("Không tìm thấy bộ bài.", 404);
    const unit = exercise.units.find((item) => item.id === unitId);
    if (!unit) fail("Không tìm thấy đoạn luyện nghe.", 404);
    const result = { id: randomUUID(), exerciseId: exercise.id, version: exercise.version, unitId: unit.id, startedAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO runs(id,user_id,exercise_id,version,unit_id,started_at) VALUES(?,?,?,?,?,?)")
      .run(result.id, userId, result.exerciseId, result.version, result.unitId, result.startedAt);
    return result;
  }

  submitAttempt(userId, payload) {
    if (!payload || typeof payload !== "object" || typeof payload.runId !== "string" || payload.runId.length > 128) fail("Mã lượt làm không hợp lệ.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT snapshot_json FROM attempts WHERE run_id=? AND user_id=?").get(payload.runId, userId);
      if (existing) {
        this.db.exec("COMMIT");
        return JSON.parse(existing.snapshot_json);
      }
      const run = this.db.prepare("SELECT * FROM runs WHERE id=? AND user_id=?").get(payload.runId, userId);
      if (!run) fail("Không tìm thấy lượt làm.", 404);
      const exercise = this.getExercise(userId,run.exercise_id);
      if (!exercise || exercise.version !== run.version) fail("Phiên bản bài đã thay đổi. Hãy bắt đầu lượt mới.", 409);
      const unit = exercise.units.find((item) => item.id === run.unit_id);
      if (!unit) fail("Đoạn luyện nghe không còn tồn tại.", 409);
      const answers = payload.answers;
      if (!Array.isArray(answers) || answers.length !== unit.questions.length) fail("Cần trả lời đủ và đúng số câu của đoạn luyện nghe.");
      const answerMap = new Map();
      for (const answer of answers) {
        if (!answer || typeof answer.questionId !== "string" || answerMap.has(answer.questionId)) fail("Câu trả lời bị thiếu hoặc trùng mã câu hỏi.");
        const item = unit.questions.find((question) => question.id === answer.questionId);
        if (!item) fail("Mã câu hỏi không thuộc lượt làm này.");
        if (!Number.isInteger(answer.choice) || answer.choice < 0 || answer.choice >= item.options.length) fail("Lựa chọn đáp án không hợp lệ.");
        answerMap.set(answer.questionId, answer.choice);
      }
      const playback = this.validatePlayback(payload.playback);
      let clientDurationMs = null;
      if (payload.clientDurationMs !== undefined && payload.clientDurationMs !== null) {
        if (!Number.isSafeInteger(payload.clientDurationMs) || payload.clientDurationMs < 0 || payload.clientDurationMs > 31 * 86400000) fail("Thời gian trình duyệt gửi không hợp lệ.");
        clientDurationMs = payload.clientDurationMs;
      }
      const prior = this.allAttempts(userId);
      const previouslyAnswered = new Set(prior.flatMap(attempt=>attempt.questions.map(question=>question.materialKey || `${attempt.exerciseId}/${attempt.version}/${question.questionId}`)));
      const submittedAt = new Date().toISOString();
      const questions = unit.questions.map((item) => ({
        questionId: item.id,
        number: item.number || item.id,
        materialKey: item.materialKey || `${exercise.id}/${exercise.version}/${item.id}`,
        prompt: item.prompt,
        options: clone(item.options),
        correctChoice: item.answer,
        selectedChoice: answerMap.get(item.id),
        correct: answerMap.get(item.id) === item.answer,
        firstAttempt: !previouslyAnswered.has(item.materialKey || `${exercise.id}/${exercise.version}/${item.id}`),
        explanation: item.explanation,
        translation: item.translation,
        vocabulary: clone(item.vocabulary || []),
        topic: item.topic,
        skill: item.skill,
        evidence: clone(item.evidence || [])
      }));
      const firstCount = questions.filter((question) => question.firstAttempt).length;
      const correct = questions.filter((question) => question.correct).length;
      const attempt = {
        id: randomUUID(), userId, runId: run.id,
        exerciseId: exercise.id, version: exercise.version, part: exercise.part,
        exerciseTitle: exercise.title, unitId: unit.id, unitTitle: unit.title,
        original: exercise.original !== false, source: {...clone(exercise.source || {kind:'ai',name:'Listen Lab — AI tự soạn',materialType:'ai-authored-tts'}),questionNumbers:unit.questions.map(question=>question.number||question.id),questionCount:unit.questions.length}, audio: clone(unit.audio || exercise.audio), context: unit.context, transcript: clone(unit.transcript || []),
        startedAt: run.started_at, submittedAt,
        durationMs: Math.max(0, Date.parse(submittedAt) - Date.parse(run.started_at)), clientDurationMs,
        playback, answered: questions.length, total: questions.length, correct, score: correct,
        accuracy: accuracy(correct, questions.length),
        firstAnswered: firstCount, firstCorrect: questions.filter((question) => question.firstAttempt && question.correct).length,
        attemptKind: firstCount === questions.length ? "first" : firstCount === 0 ? "retry" : "mixed",
        questions
      };
      this.db.prepare("INSERT INTO attempts(id,user_id,run_id,exercise_id,version,unit_id,started_at,submitted_at,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(attempt.id, userId, run.id, exercise.id, exercise.version, unit.id, run.started_at, submittedAt, JSON.stringify(attempt));
      this.db.exec("COMMIT");
      return attempt;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  validatePlayback(value) {
    if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) fail("Thông tin lượt nghe không hợp lệ.");
    const source = value || {};
    const result = { plays: 0, replays: 0, completedPlays: 0, rate: 1, voice: "" };
    for (const key of ["plays", "replays", "completedPlays"]) {
      const item = source[key] ?? 0;
      if (!Number.isInteger(item) || item < 0 || item > MAX_COUNT) fail(`Thông tin ${key} không hợp lệ.`);
      result[key] = item;
    }
    if (result.replays > result.plays || result.completedPlays > result.plays) fail("Số lượt nghe lại/nghe hết không được vượt số lượt phát.");
    const rate = source.rate ?? 1;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.5 || rate > 2) fail("Tốc độ đọc phải từ 0.5 đến 2.");
    const voice = source.voice ?? "";
    if (typeof voice !== "string" || voice.length > 240) fail("Tên giọng đọc không hợp lệ.");
    result.rate = rate;
    result.voice = voice;
    return result;
  }

  allAttempts(userId) {
    return this.db.prepare("SELECT snapshot_json FROM attempts WHERE user_id=? ORDER BY submitted_at DESC,rowid DESC")
      .all(userId).map((row) => JSON.parse(row.snapshot_json));
  }

  getAttempt(userId, id) {
    if (typeof id !== "string" || id.length > 128) fail("Mã bài nộp không hợp lệ.");
    const row = this.db.prepare("SELECT snapshot_json FROM attempts WHERE id=? AND user_id=?").get(id, userId);
    if (!row) fail("Không tìm thấy kết quả.", 404);
    return JSON.parse(row.snapshot_json);
  }

  validateDate(value, name) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1970) fail(`${name} phải là ngày YYYY-MM-DD hợp lệ.`);
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) fail(`${name} phải là ngày YYYY-MM-DD hợp lệ.`);
    return value;
  }

  listAttempts(userId, { page = 1, pageSize = 10, from, to, part } = {}) {
    const numberPage = Number(page);
    const numberSize = Number(pageSize);
    if (!Number.isSafeInteger(numberPage) || numberPage < 1 || !Number.isInteger(numberSize) || numberSize < 1 || numberSize > 100) fail("Phân trang không hợp lệ; pageSize từ 1 đến 100.");
    const fromDate = this.validateDate(from, "Từ ngày");
    const toDate = this.validateDate(to, "Đến ngày");
    if (fromDate && toDate && fromDate > toDate) fail("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
    let partNumber = null;
    if (part !== undefined && part !== null && part !== "") {
      partNumber = Number(part);
      if (![2, 3, 4].includes(partNumber)) fail("Part phải là 2, 3 hoặc 4.");
    }
    const rows = this.allAttempts(userId).filter((attempt) => {
      const date = this.day(attempt.submittedAt);
      return (!fromDate || date >= fromDate) && (!toDate || date <= toDate) && (partNumber === null || attempt.part === partNumber);
    });
    const start = (numberPage - 1) * numberSize;
    return { items: rows.slice(start, start + numberSize), total: rows.length, page: numberPage, pageSize: numberSize, pages: Math.ceil(rows.length / numberSize) };
  }

  getProgress(userId, { category='official' }={}) {
    if(!['official','ai','user','all'].includes(category))fail('category phải là official, ai hoặc user.');
    const allAttempts=this.allAttempts(userId);
    const attempts = category==='all'?allAttempts:allAttempts.filter(attempt=>(attempt.source?.kind || 'ai')===category);
    const bySource=Object.fromEntries(['official','ai','user'].map(kind=>{const value=stats();allAttempts.filter(attempt=>(attempt.source?.kind||'ai')===kind).forEach(attempt=>addStats(value,attempt));return [kind,finishStats(value)];}));
    const overall = stats();
    const byPart = [2, 3, 4].map((part) => ({ part, ...stats() }));
    const daily = new Map();
    const reviews = new Map();
    for (const attempt of attempts) {
      addStats(overall, attempt);
      addStats(byPart.find((item) => item.part === attempt.part), attempt);
      const date = this.day(attempt.submittedAt);
      if (!daily.has(date)) daily.set(date, { date, ...stats() });
      addStats(daily.get(date), attempt);
      for (const question of attempt.questions) {
        const key = `${attempt.exerciseId}/${attempt.version}/${question.questionId}`;
        if (!reviews.has(key)) reviews.set(key, {
          questionId: question.questionId, exerciseId: attempt.exerciseId, version: attempt.version,
          prompt: question.prompt, part: attempt.part, skill: question.skill, topic: question.topic,
          wrongCount: 0, latestCorrect: question.correct, lastSubmittedAt: attempt.submittedAt
        });
        if (!question.correct) reviews.get(key).wrongCount += 1;
      }
    }
    finishStats(overall);
    byPart.forEach(finishStats);
    const review = [...reviews.values()].filter((item) => item.wrongCount > 0)
      .sort((a, b) => b.wrongCount - a.wrongCount || b.lastSubmittedAt.localeCompare(a.lastSubmittedAt));
    const nextSteps = [];
    if (!overall.answered) nextSteps.push("Hoàn thành một đoạn luyện nghe để tạo mốc ban đầu.");
    else {
      const weakest = byPart.filter((item) => item.firstAnswered > 0).sort((a, b) => a.firstAccuracy - b.firstAccuracy)[0];
      if (weakest) nextSteps.push(`Ưu tiên Part ${weakest.part}: độ chính xác lượt đầu ${weakest.firstAccuracy}% trên ${weakest.firstAnswered} câu.`);
      if (review.length) nextSteps.push(`Ôn ${review.filter((item) => !item.latestCorrect).length} câu sai chưa sửa ở lượt gần nhất; chú ý dạng “${review[0].skill}”.`);
      nextSteps.push("Nghe lại câu sai, đối chiếu lời thoại và ghi lại từ mới; sau đó thử một nội dung chưa từng làm để kiểm tra khả năng chuyển sang bài mới.");
    }
    return {
      timezone: this.timezone, category, bySource, overall, byPart,
      coverage:{uniqueQuestions:overall.firstAnswered,repeatedAnswers:overall.answered-overall.firstAnswered,limitedSample:category==='official'&&overall.firstAnswered<30,note:'Chỉ đếm lần đầu của câu có định danh nguồn ổn định. Điểm tăng khi làm lại không chứng minh tiến bộ trên bài mới.'},
      daily: [...daily.values()].sort((a, b) => b.date.localeCompare(a.date)).map(finishStats),
      review, limitations: [...limitations], nextSteps
    };
  }

  getReport(userId) {
    const progress = this.getProgress(userId);
    return {
      generatedAt: new Date().toISOString(), timezone: this.timezone,
      progress, recentAttempts: this.listAttempts(userId, { pageSize: 20 }).items,
      separatedProgress:{official:progress,ai:this.getProgress(userId,{category:'ai'}),user:this.getProgress(userId,{category:'user'})},
      limitations: [...limitations], nextSteps: [...progress.nextSteps]
    };
  }

  close() { this.db.close(); }
}

function reportMarkdown(report) {
  const progress = report.progress;
  const overall = progress.overall;
  const lines = [
    "# Báo cáo luyện nghe Listen Lab", "",
    `Tạo lúc: ${report.generatedAt} | Múi giờ nhóm ngày: ${report.timezone}`,
    "Nguồn chính thức, AI/TTS và tài liệu cá nhân được tách riêng. Không quy đổi bài mẫu thành điểm TOEIC.", "",
    "## Tiến trình — chỉ nguồn chính thức",
    `- ${overall.attempts} lượt nộp, ${overall.correct}/${overall.answered} câu đúng (${overall.accuracy}%).`,
    `- Lượt đầu theo từng câu/phiên bản: ${overall.firstCorrect}/${overall.firstAnswered} đúng (${overall.firstAccuracy}%).`,
    ...progress.byPart.map((item) => `- Part ${item.part}: ${item.correct}/${item.answered} đúng; lượt đầu ${item.firstCorrect}/${item.firstAnswered} (${item.firstAccuracy}%).`),
    ...['ai','user'].map(kind=>{const value=report.separatedProgress?.[kind]?.overall;return value?`- Thống kê RIÊNG ${kind==='ai'?'AI/TTS':'tài liệu người dùng'}: ${value.attempts} lượt, ${value.firstCorrect}/${value.firstAnswered} câu lần đầu. Không cộng vào nguồn chính thức.`:'';}),
    "", "## Theo ngày",
    ...progress.daily.map((item) => `- ${item.date}: ${item.correct}/${item.answered} (${item.accuracy}%); lượt đầu ${item.firstCorrect}/${item.firstAnswered} (${item.firstAccuracy}%).`),
    "", "## Câu cần ôn",
    ...(progress.review.length ? progress.review.map((item) => `- ${item.questionId} | Part ${item.part} | ${item.skill}: ${item.prompt} — sai ${item.wrongCount} lần, lượt gần nhất ${item.latestCorrect ? "đúng" : "sai"}.`) : ["Chưa có câu sai được ghi nhận."]),
    "", "## 20 lượt gần nhất (mới nhất trước)"
  ];
  for (const attempt of report.recentAttempts) {
    lines.push("", `### ${attempt.unitTitle} · Part ${attempt.part} · ${attempt.correct}/${attempt.answered}`,
      `Mã: ${attempt.id} | Bộ: ${attempt.exerciseId}@${attempt.version} | Kiểu: ${attempt.attemptKind}`,
      `Nguồn: ${attempt.source?.name || 'Listen Lab — AI tự soạn (lượt cũ)'} | Loại: ${attempt.source?.materialType || 'ai-authored-tts'} | URL/sách: ${attempt.source?.url || attempt.source?.book || 'nội dung AI tự soạn'} | Test: ${attempt.source?.test || attempt.exerciseTitle} | Câu: ${(attempt.source?.questionNumbers || attempt.questions.map(q=>q.number||q.questionId)).join(', ')}`,
      `Bắt đầu: ${attempt.startedAt} | Nộp: ${attempt.submittedAt} | Thời gian máy chủ: ${attempt.durationMs} ms`,
      `Nguồn audio: ${attempt.audio?.kind || "không báo"} · ${attempt.audio?.source || "không báo"}`,
      `Nghe: ${attempt.playback.plays} lần; nghe lại ${attempt.playback.replays}; nghe hết ${attempt.playback.completedPlays}; tốc độ ${attempt.playback.rate}×; giọng ${attempt.playback.voice || "không báo"}.`);
    for (const question of attempt.questions) {
      lines.push(`- ${question.questionId}. ${question.prompt}`,
        ...question.options.map((option, index) => `  ${String.fromCharCode(65 + index)}. ${option}`),
        `  Chọn ${String.fromCharCode(65 + question.selectedChoice)}, đúng ${String.fromCharCode(65 + question.correctChoice)}; ${question.correct ? "ĐÚNG" : "SAI"}; ${question.firstAttempt ? "lượt đầu" : "làm lại"}.`,
        `  ${question.explanation}`,...(question.evidence||[]).map(item=>`  Dẫn chứng [lượt thoại ${item.turn+1}]: “${item.quote}”`));
    }
  }
  lines.push("", "## Giới hạn", ...report.limitations.map((item) => `- ${item}`),
    "", "## Gợi ý tiếp theo", ...report.nextSteps.map((item) => `- ${item}`),
    "", "## Yêu cầu gửi ChatGPT",
    "Hãy nhận xét tiến trình học nghe của tôi bằng tiếng Việt, tách lượt đầu và lượt làm lại; xét điểm, loại câu sai và thông tin lượt nghe. Nếu chưa đủ dữ liệu thì nói rõ. Gợi ý từ vựng cần học và buổi luyện tiếp theo. Không suy ra điểm TOEIC hay trình độ chỉ từ bộ bài này.");
  return lines.join("\n");
}

module.exports = { Store, reportMarkdown };

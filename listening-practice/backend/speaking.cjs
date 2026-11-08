'use strict';
const crypto=require('node:crypto');
const {lessons,profile}=require('./speaking-lessons.cjs');
const {SpeakingClaude,validateWav,failure}=require('./speaking-claude.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const limits={turns:5,retriesPerTurn:2,audioBytes:2*1024*1024,textCharacters:1200,sessionApiCalls:40};
const requestId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(value))throw failure('Mã yêu cầu chưa hợp lệ. Hãy thử lại.');return value;};
const content=value=>{if(typeof value!=='string'||!value.trim()||value.length>limits.textCharacters)throw failure(`Nhập câu trả lời từ 1 đến ${limits.textCharacters} ký tự.`);return value.trim();};

class SpeakingPractice{
  constructor({store,config={},provider}={}){
    this.store=store;this.db=store.db;this.provider=provider||new SpeakingClaude(config);
    this.maxSeconds=Number.isInteger(config.maxSeconds)?Math.max(15,Math.min(60,config.maxSeconds)):60;
    this.dailyLimit=Number.isInteger(config.dailyLimit)?Math.max(1,Math.min(200,config.dailyLimit)):80;
    this.active=new Set();this.cache=new Map();
    this.db.exec(`CREATE TABLE IF NOT EXISTS speaking_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL,lesson_version TEXT NOT NULL,lesson_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,draft_json TEXT,summary_json TEXT);
      CREATE TABLE IF NOT EXISTS speaking_turns(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT NOT NULL REFERENCES speaking_sessions(id),sequence INTEGER NOT NULL,main_number INTEGER NOT NULL,kind TEXT NOT NULL,parent_turn_id TEXT,question TEXT NOT NULL,recognized_transcript TEXT,transcript TEXT NOT NULL,input_type TEXT NOT NULL,feedback_json TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,request_id),UNIQUE(session_id,sequence));
      CREATE TABLE IF NOT EXISTS speaking_usage(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT NOT NULL REFERENCES speaking_sessions(id),kind TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT,day TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS speaking_sessions_user ON speaking_sessions(user_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS speaking_turns_session ON speaking_turns(session_id,sequence);
      CREATE INDEX IF NOT EXISTS speaking_usage_day ON speaking_usage(user_id,day);
      CREATE INDEX IF NOT EXISTS speaking_usage_request ON speaking_usage(user_id,kind,request_id);`);
  }
  status(userId){const today=this.store.day(new Date().toISOString()),used=Number(this.db.prepare('SELECT COUNT(*) n FROM speaking_usage WHERE user_id=? AND day=? AND kind=?').get(userId,today,'feedback').n);return {configured:this.provider.configured,models:this.provider.models,voice:this.provider.voice,limits:{...limits,maxAudioSeconds:this.maxSeconds,dailyApiCalls:this.dailyLimit},usedToday:used,busy:this.active.has(userId),audioStorage:'Audio chỉ xử lý tạm thời; không lưu trong SQLite hoặc file trên server.',notice:this.provider.configured?'Nhận xét dùng Claude API; nhận dạng giọng nói chạy trên máy bằng Whisper; giọng đọc dùng trình duyệt.':'Chưa cấu hình Claude API. Vẫn thu âm, nhận dạng trên máy, nghe giọng đọc trình duyệt và lưu bản nháp.'};}
  catalog(){return {lessons,profile,authorship:'Nội dung luyện tập do AI biên soạn.'};}
  raw(userId,id){if(typeof id!=='string'||id.length>100)throw failure('Mã bài luyện nói không hợp lệ.');const row=this.db.prepare('SELECT * FROM speaking_sessions WHERE id=? AND user_id=?').get(id,userId);if(!row)throw failure('Không tìm thấy bài luyện nói của tài khoản này.',404);return row;}
  get(userId,id){
    const row=this.raw(userId,id),lesson=JSON.parse(row.lesson_json);
    const turns=this.db.prepare('SELECT * FROM speaking_turns WHERE session_id=? AND user_id=? ORDER BY sequence').all(id,userId).map(turn=>({id:turn.id,sequence:turn.sequence,mainNumber:turn.main_number,kind:turn.kind,parentTurnId:turn.parent_turn_id,question:turn.question,recognizedTranscript:turn.recognized_transcript,transcript:turn.transcript,inputType:turn.input_type,feedback:JSON.parse(turn.feedback_json),createdAt:turn.created_at}));
    const mainCount=turns.filter(turn=>turn.kind==='response').length;
    return {id:row.id,lesson,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,mainCount,turns,currentQuestion:row.status==='active'?(turns.at(-1)?.feedback.nextQuestion||lesson.opening):null,draft:row.draft_json?JSON.parse(row.draft_json):null,summary:row.summary_json?JSON.parse(row.summary_json):null};
  }
  start(userId,{lessonId,requestId:key}={}){
    key=requestId(key);const lesson=lessons.find(item=>item.id===lessonId);if(!lesson)throw failure('Chọn bài luyện nói có sẵn.',404);
    // One retry of a start request must not create duplicate sessions.
    const id='sp-'+hash(userId+':'+key).slice(0,40),existing=this.db.prepare('SELECT lesson_id FROM speaking_sessions WHERE id=? AND user_id=?').get(id,userId);
    if(existing){if(existing.lesson_id!==lessonId)throw failure('Mã bắt đầu đã được dùng cho bài khác.',409);return this.get(userId,id);}
    const recent=this.db.prepare('SELECT COUNT(*) n FROM speaking_sessions WHERE user_id=? AND created_at>?').get(userId,new Date(Date.now()-3600000).toISOString());if(recent.n>=20)throw failure('Đã mở nhiều bài trong một giờ. Hãy tiếp tục bài đang có trong lịch sử.',429);
    const now=new Date().toISOString();this.db.prepare('INSERT INTO speaking_sessions(id,user_id,lesson_id,lesson_version,lesson_json,created_at,updated_at,status) VALUES(?,?,?,?,?,?,?,?)').run(id,userId,lesson.id,lesson.version,JSON.stringify(lesson),now,now,'active');return this.get(userId,id);
  }
  question(session,input){
    if(input.revision!==session.revision)throw failure('Bài đã thay đổi ở một tab khác. Tải lại bài trước khi gửi.',409);
    const mode=input.mode||'response';
    if(mode==='response'){if(session.status!=='active'||session.mainCount>=limits.turns)throw failure('Bài đã kết thúc. Mở lượt luyện mới nếu muốn tiếp tục.',409);return {question:session.currentQuestion,parent:null,mainNumber:session.mainCount+1,mode};}
    if(mode!=='retry')throw failure('Chế độ trả lời không hợp lệ.');
    const parent=session.turns.filter(turn=>turn.kind==='response').at(-1);
    if(!parent||parent.id!==input.targetTurnId)throw failure('Chỉ thu lại câu vừa nhận xét trong bài này.');
    if(session.turns.filter(turn=>turn.parentTurnId===parent.id).length>=limits.retriesPerTurn)throw failure('Đã nhận xét hai lần thu lại cho câu này. Bạn có thể tự đọc lại hoặc tiếp tục câu kế tiếp.',429);
    return {question:parent.question,parent:parent.id,mainNumber:parent.mainNumber,mode};
  }
  saveDraft(userId,id,input){
    const session=this.get(userId,id);this.question(session,input);
    if(typeof input.transcript!=='string'||input.transcript.length>limits.textCharacters)throw failure('Bản nháp vượt giới hạn ký tự.');
    const draft={transcript:input.transcript,mode:input.mode||'response',targetTurnId:input.targetTurnId||null,transcriptionId:typeof input.transcriptionId==='string'?input.transcriptionId:null,revision:session.revision};
    this.db.prepare('UPDATE speaking_sessions SET draft_json=?,updated_at=? WHERE id=? AND user_id=? AND revision=?').run(JSON.stringify(draft),new Date().toISOString(),id,userId,session.revision);return {saved:true};
  }
  reserve(userId,sessionId,kind,key,payload){
    const digest=hash(JSON.stringify(payload));this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=this.db.prepare('SELECT * FROM speaking_usage WHERE user_id=? AND kind=? AND request_id=? ORDER BY rowid DESC LIMIT 1').get(userId,kind,key);
      if(previous&&(previous.payload_hash!==digest||previous.session_id!==sessionId))throw failure('Mã yêu cầu đã được dùng cho dữ liệu khác.',409);
      if(previous?.status==='done'&&kind!=='speech'){this.db.exec('COMMIT');return {cached:JSON.parse(previous.result_json)};}
      if(kind==='feedback')this.provider.requireKey();
      const now=new Date().toISOString(),day=this.store.day(now),cutoff=new Date(Date.now()-120000).toISOString();
      if(this.db.prepare("SELECT id FROM speaking_usage WHERE user_id=? AND status='pending' AND created_at>? LIMIT 1").get(userId,cutoff))throw failure('Một yêu cầu Speaking đang xử lý. Hãy đợi rồi thử lại; nếu server vừa khởi động lại, chờ tối đa hai phút.',409);
      const daily=this.db.prepare('SELECT COUNT(*) n FROM speaking_usage WHERE user_id=? AND day=? AND kind=?').get(userId,day,'feedback').n;
      const perSession=this.db.prepare('SELECT COUNT(*) n FROM speaking_usage WHERE user_id=? AND session_id=? AND kind=?').get(userId,sessionId,'feedback').n;
      if(daily>=this.dailyLimit)throw failure('Đã đạt giới hạn API Speaking trong ngày. Bạn vẫn có thể xem bài, đọc câu mẫu và nghe bản đã tải.',429);
      if(perSession>=limits.sessionApiCalls)throw failure('Bài này đã đạt giới hạn gọi API. Kết quả cũ vẫn được giữ.',429);
      const id=crypto.randomUUID();this.db.prepare('INSERT INTO speaking_usage(id,user_id,session_id,kind,request_id,payload_hash,status,day,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,userId,sessionId,kind,key,digest,'pending',day,now);this.db.exec('COMMIT');return {id};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async operation(userId,sessionId,kind,key,payload,work){
    key=requestId(key);if(this.active.has(userId))throw failure('Speaking đang xử lý yêu cầu trước. Hãy đợi một chút.',409);
    const reserved=this.reserve(userId,sessionId,kind,key,payload);if(reserved.cached)return reserved.cached;
    this.active.add(userId);
    try{const result=await work(reserved.id);this.db.prepare("UPDATE speaking_usage SET status='done',result_json=? WHERE id=?").run(JSON.stringify(kind==='speech'?{generated:true}:result),reserved.id);return result;}
    catch(error){this.db.prepare("UPDATE speaking_usage SET status='failed' WHERE id=?").run(reserved.id);throw error;}
    finally{this.active.delete(userId);}
  }
  async transcribe(userId,id,input){
    const session=this.get(userId,id),question=this.question(session,input),key=requestId(input.requestId),wav=validateWav(input.wavBase64,this.maxSeconds);
    return this.operation(userId,id,'transcribe',key,{revision:session.revision,mode:question.mode,parent:question.parent,audio:hash(wav.bytes)},async transcriptionId=>({transcript:await this.provider.transcribe(wav.bytes),transcriptionId,revision:session.revision,durationSeconds:wav.seconds}));
  }
  async review(userId,id,input){
    const answer=content(input.transcript),key=requestId(input.requestId),old=this.db.prepare('SELECT * FROM speaking_turns WHERE user_id=? AND request_id=?').get(userId,key);
    if(old){if(old.session_id!==id||old.transcript!==answer||(input.mode||'response')!==old.kind||(input.targetTurnId||null)!==old.parent_turn_id)throw failure('Mã gửi đã dùng cho một câu khác.',409);return this.get(userId,id);}
    const session=this.get(userId,id),question=this.question(session,input);let recognized=null;
    if(input.transcriptionId){const row=this.db.prepare("SELECT result_json FROM speaking_usage WHERE id=? AND user_id=? AND session_id=? AND kind='transcribe' AND status='done'").get(input.transcriptionId,userId,id);if(!row)throw failure('Không tìm thấy bản nhận dạng thuộc bài này. Hãy nhận dạng lại hoặc dùng ô nhập chữ.');const original=JSON.parse(row.result_json);if(original.revision!==session.revision)throw failure('Bản nhận dạng thuộc câu trước. Hãy thu lại câu hiện tại.',409);recognized=original.transcript;}
    return this.operation(userId,id,'feedback',key,{answer,revision:session.revision,mode:question.mode,parent:question.parent,transcriptionId:input.transcriptionId||null},async()=>{
      const feedback=await this.provider.feedback({learner:profile,lesson:{situation:session.lesson.situation,objective:session.lesson.objective,criteria:session.lesson.criteria},question:question.question,answer,isRetry:question.mode==='retry',mainTurn:question.mainNumber,maxTurns:limits.turns,history:session.turns.slice(-8).map(turn=>({question:turn.question,answer:turn.transcript,corrected:turn.feedback.corrected,difficulty:turn.feedback.difficulty}))});
      this.db.exec('BEGIN IMMEDIATE');
      try{
        if(this.raw(userId,id).revision!==session.revision)throw failure('Bài đã đổi trước khi nhận xét xong. Tải lại để xem dữ liệu đã lưu.',409);
        this.db.prepare('INSERT INTO speaking_turns(id,user_id,session_id,sequence,main_number,kind,parent_turn_id,question,recognized_transcript,transcript,input_type,feedback_json,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),userId,id,session.turns.length+1,question.mainNumber,question.mode,question.parent,question.question,recognized,answer,recognized?'audio':'text',JSON.stringify(feedback),key,new Date().toISOString());
        this.db.prepare('UPDATE speaking_sessions SET revision=revision+1,draft_json=NULL,updated_at=? WHERE id=? AND user_id=?').run(new Date().toISOString(),id,userId);
        let updated=this.get(userId,id);if(updated.mainCount>=limits.turns||updated.status==='completed')this.complete(userId,id,updated);
        this.db.exec('COMMIT');return this.get(userId,id);
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    });
  }
  complete(userId,id,session){
    const categories=new Map(),words=new Map(),strengths=new Set();for(const turn of session.turns){for(const issue of turn.feedback.issues)categories.set(issue.category,(categories.get(issue.category)||0)+1);for(const word of turn.feedback.reviewWords)words.set(word.phrase.toLowerCase(),word);for(const strength of turn.feedback.strengths)strengths.add(strength);}
    const summary={mainTurns:session.mainCount,retries:session.turns.length-session.mainCount,elapsedSeconds:Math.max(0,Math.round((Date.now()-Date.parse(session.createdAt))/1000)),strengths:[...strengths].slice(-4),focus:[...categories].sort((a,b)=>b[1]-a[1]).map(([category,count])=>({category,count})),reviewWords:[...words.values()].slice(-15),nextStep:'Đọc lại câu đã sửa, tự nói lại một lần, rồi áp dụng cụm từ đã ôn vào tình huống khác.',limitation:'Tổng kết từ transcript và nhận xét đã lưu; không đánh giá phát âm hay quy đổi thành điểm Speaking/TOEIC/IELTS.'};
    this.db.prepare("UPDATE speaking_sessions SET status='completed',summary_json=?,updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(summary),new Date().toISOString(),id,userId);
  }
  finish(userId,id,input){const session=this.get(userId,id);if(session.status==='completed')return session;if(input.revision!==session.revision)throw failure('Bài đã đổi. Hãy tải lại trước khi kết thúc.',409);if(this.active.has(userId))throw failure('Chờ nhận xét đang xử lý trước khi kết thúc.',409);this.complete(userId,id,session);this.db.prepare('UPDATE speaking_sessions SET revision=revision+1 WHERE id=? AND user_id=?').run(id,userId);return this.get(userId,id);}
  async speech(userId,id,input){
    const session=this.get(userId,id),kind=input.kind||'question';let text;
    if(kind==='question')text=input.turnId?session.turns.find(turn=>turn.id===input.turnId)?.question:session.currentQuestion||session.turns.at(-1)?.question||session.lesson.opening;
    else if(kind==='sample')text=session.lesson.sample;
    else if(['corrected','natural'].includes(kind)){const turn=session.turns.find(item=>item.id===input.turnId);text=turn?.feedback[kind];}
    if(!text||text.length>1000)throw failure('Chọn câu hỏi, câu mẫu hoặc câu đã sửa thuộc bài này.');
    const cacheKey=hash(userId+this.provider.models.speech+this.provider.voice+text),cached=this.cache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.bytes;
    const result=await this.operation(userId,id,'speech',input.requestId,{text},async()=>{
      const bytes=await this.provider.speech(text);for(const [key,value]of this.cache)if(value.expires<Date.now())this.cache.delete(key);if(this.cache.size>=20)this.cache.delete(this.cache.keys().next().value);this.cache.set(cacheKey,{bytes,expires:Date.now()+10*60000});return bytes;
    });return result;
  }
  history(userId,{page=1}={}){page=Number(page);if(!Number.isInteger(page)||page<1||page>100000)throw failure('Trang lịch sử Speaking không hợp lệ.');const total=Number(this.db.prepare('SELECT COUNT(*) n FROM speaking_sessions WHERE user_id=?').get(userId).n);const items=this.db.prepare('SELECT id,lesson_json,status,created_at,updated_at,summary_json FROM speaking_sessions WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10 OFFSET ?').all(userId,(page-1)*10).map(row=>({id:row.id,lessonTitle:JSON.parse(row.lesson_json).title,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,summary:row.summary_json?JSON.parse(row.summary_json):null,turnCount:Number(this.db.prepare("SELECT COUNT(*) n FROM speaking_turns WHERE session_id=? AND kind='response'").get(row.id).n)}));return {items,total,page,pages:Math.max(1,Math.ceil(total/10))};}
  progress(userId){const rows=this.db.prepare('SELECT id,status,lesson_id FROM speaking_sessions WHERE user_id=?').all(userId);const turns=this.db.prepare('SELECT transcript,kind,feedback_json FROM speaking_turns WHERE user_id=?').all(userId),words=new Map();for(const turn of turns)for(const word of JSON.parse(turn.feedback_json).reviewWords)words.set(word.phrase.toLowerCase(),word);return {sessions:rows.length,completed:rows.filter(row=>row.status==='completed').length,mainTurns:turns.filter(turn=>turn.kind==='response').length,retries:turns.filter(turn=>turn.kind==='retry').length,lessonsPracticed:new Set(rows.filter(row=>this.db.prepare('SELECT id FROM speaking_turns WHERE session_id=? LIMIT 1').get(row.id)).map(row=>row.lesson_id)).size,reviewWords:[...words.values()].slice(-30),notice:'Thống kê luyện giao tiếp, tách khỏi kết quả Listening và điểm thi chính thức.'};}
  close(){this.provider.close();this.cache.clear();}
}
module.exports={SpeakingPractice,limits};

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, reportMarkdown } = require('./backend/data.cjs');
const { exercises, findExercise, publicExercise, audioFilename, audioMetadata } = require('./backend/content.cjs');
const { createMcpHandler } = require('./backend/mcp.cjs');
const { Tutor } = require('./backend/tutor.cjs');
const { DraftGenerator, validateManifest } = require('./backend/drafts.cjs');
const { closeTranscriber } = require('./backend/transcribe.cjs');
const { SpeakingPractice } = require('./backend/speaking.cjs');

const ROOT = __dirname;
const SESSION_COOKIE = 'listenlab_session';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const loopback = host => ['127.0.0.1', '::1', '[::1]', 'localhost', '::ffff:127.0.0.1'].includes(host);

function loadConfig(overrides = {}) {
  return {
    host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 4173),
    dbPath: process.env.DATA_DIR ? path.join(path.resolve(process.env.DATA_DIR), 'listenlab.sqlite') : path.join(ROOT, '.data', 'listenlab.sqlite'),
    publicOrigin: process.env.PUBLIC_ORIGIN || '', timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok',
    mcpLocalToken: process.env.MCP_LOCAL_TOKEN || '', oauthIssuer: process.env.OAUTH_ISSUER || '',
    oauthAudience: process.env.OAUTH_AUDIENCE || '', oauthJwksUri: process.env.OAUTH_JWKS_URI || '',
    oauthSubject: process.env.OAUTH_SUBJECT || '', oauthScope: process.env.OAUTH_SCOPE || 'progress:read',
    mcpAllowedOrigins: (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
    speakingMaxSeconds:Number(process.env.SPEAKING_MAX_AUDIO_SECONDS||60),
    speakingDailyLimit:Number(process.env.SPEAKING_DAILY_API_LIMIT||80),
    ...overrides
  };
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('PORT không hợp lệ.');
  if (config.publicOrigin) {
    const origin = new URL(config.publicOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.publicOrigin || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN phải là origin http(s), không có đường dẫn hoặc secret.');
    if (origin.protocol !== 'https:' && !loopback(origin.hostname)) throw new Error('PUBLIC_ORIGIN ngoài máy phải dùng HTTPS.');
  }
  if (!loopback(config.host) && !config.publicOrigin.startsWith('https://')) throw new Error('Khi bind ra mạng phải cấu hình PUBLIC_ORIGIN HTTPS và reverse proxy.');
  if (config.mcpLocalToken && config.mcpLocalToken.length < 32) throw new Error('MCP_LOCAL_TOKEN phải có ít nhất 32 ký tự ngẫu nhiên.');
  if (config.mcpLocalToken && !loopback(config.host)) throw new Error('MCP_LOCAL_TOKEN chỉ dùng kiểm thử loopback; remote phải dùng OAuth.');
  const store = new Store({ dbPath: config.dbPath, timezone: config.timezone });
  const tutor = new Tutor({ store, config, ...(overrides.tutorOptions || {}) });
  const drafts = new DraftGenerator({tutor,cacheDir:path.join(config.dbPath===':memory:'?path.join(ROOT,'.data'):path.dirname(config.dbPath),'models'),...(overrides.draftOptions||{})});
  const speaking=new SpeakingPractice({store,config:{maxSeconds:config.speakingMaxSeconds,dailyLimit:config.speakingDailyLimit,cacheDir:path.join(config.dbPath===':memory:'?path.join(ROOT,'.data'):path.dirname(config.dbPath),'models')},...(overrides.speakingOptions||{})});
  const loginLimits = new Map();
  let mcpHandler;

  function send(res, status, value, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
  }
  function fail(status, message) { throw Object.assign(new Error(message), { status }); }

  async function body(req, limit = 65536) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Dữ liệu phải có Content-Type: application/json.');
    const bytes = await new Promise((resolve, reject) => {
      let size = 0, rejected = false;
      const chunks = [];
      req.on('data', chunk => {
        if (rejected) return;
        size += chunk.length;
        if (size > limit) {
          rejected = true; chunks.length = 0;
          reject(Object.assign(new Error('Nội dung yêu cầu quá lớn.'), { status: 413 }));
        } else chunks.push(chunk);
      });
      req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
      req.on('error', reject);
      req.on('aborted', () => reject(Object.assign(new Error('Yêu cầu bị ngắt.'), { status: 400 })));
    });
    let result;
    try { result = JSON.parse(bytes.toString('utf8')); }
    catch { fail(400, 'JSON không hợp lệ.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'Nội dung phải là một JSON object.');
    return result;
  }

  function cookieToken(req) {
    const match = (req.headers.cookie || '').split(';').map(entry => entry.trim()).find(entry => entry.startsWith(`${SESSION_COOKIE}=`));
    const token = match?.slice(SESSION_COOKIE.length + 1) || '';
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  }
  function currentUser(req) {
    const token = cookieToken(req);
    if (!token) return null;
    const session = store.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash(token), new Date().toISOString());
    return session ? store.db.prepare('SELECT id, username FROM users WHERE id = ?').get(session.user_id) : null;
  }
  function requireUser(req) { const user = currentUser(req); if (!user) fail(401, 'Vui lòng đăng nhập.'); return user; }
  function setSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    store.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    store.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hash(token), userId, expiresAt);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${config.publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
  }
  function checkMutationOrigin(req) {
    if (req.headers.origin && req.headers.origin !== config.publicOrigin) fail(403, 'Origin không được phép.');
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Không chấp nhận yêu cầu từ trang khác.');
  }
  function validCredentials(value) {
    return typeof value.username === 'string' && /^[\p{L}\p{N}_.-]{3,40}$/u.test(value.username) && typeof value.password === 'string' && value.password.length >= 12 && value.password.length <= 256;
  }
  function checkLoginLimit(req) {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [address, value] of loginLimits) if (value.until <= now) loginLimits.delete(address);
    const entry = loginLimits.get(key) || { count: 0, until: now + 10 * 60000 };
    if (entry.count >= 10) fail(429, 'Đã thử quá nhiều lần. Hãy đợi 10 phút.');
    entry.count += 1;
    loginLimits.set(key, entry);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.publicOrigin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const expectedHost = new URL(config.publicOrigin).host;
      if (req.headers.host !== expectedHost) fail(403, 'Host không được phép. Hãy dùng địa chỉ đã cấu hình.');
      const url = new URL(req.url, config.publicOrigin);
      if (await mcpHandler(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, features: ['general-listening','ai-tutor','material-drafts','speaking'] });
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) checkMutationOrigin(req);
      if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        const user = currentUser(req);
        return send(res, 200, { configured: Boolean(store.db.prepare('SELECT id FROM users LIMIT 1').get()), authenticated: Boolean(user), username: user?.username || null });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/setup') {
        checkLoginLimit(req);
        if (!loopback(req.socket.remoteAddress) || !loopback(new URL(config.publicOrigin).hostname)) fail(403, 'Tạo tài khoản lần đầu bằng địa chỉ loopback trên máy chạy server trước khi hosting.');
        if (store.db.prepare('SELECT id FROM users LIMIT 1').get()) fail(409, 'Tài khoản đã được tạo. Hãy đăng nhập.');
        const input = await body(req);
        if (!validCredentials(input)) fail(400, 'Tên đăng nhập 3–40 chữ/số hoặc _ . -; mật khẩu 12–256 ký tự.');
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = crypto.scryptSync(input.password, salt, 64).toString('hex');
        store.db.prepare('INSERT INTO users (id,username,password_salt,password_hash) VALUES (?,?,?,?)').run('owner', input.username, salt, passwordHash);
        setSession(res, 'owner');
        return send(res, 201, { authenticated: true, username: input.username });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        checkLoginLimit(req);
        const input = await body(req);
        if (typeof input.username !== 'string' || input.username.length > 40 || typeof input.password !== 'string' || input.password.length > 256) fail(400, 'Thông tin đăng nhập không hợp lệ.');
        const user = store.db.prepare('SELECT * FROM users WHERE username = ?').get(input.username);
        const candidate = crypto.scryptSync(input.password, user?.password_salt || 'missing-user-salt', 64);
        const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
        if (!user || candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) fail(401, 'Tên đăng nhập hoặc mật khẩu chưa đúng.');
        loginLimits.delete(req.socket.remoteAddress || 'unknown');
        setSession(res, user.id);
        return send(res, 200, { authenticated: true, username: user.username });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const current = requireUser(req);
        tutor.cancel(current.id);
        const token = cookieToken(req);
        if (token) store.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
        return send(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/audio/') && ['GET','HEAD'].includes(req.method)) {
        requireUser(req);
        const recording = exercises.flatMap(exercise => exercise.units.map(unit => ({ exercise, unit, filename: audioFilename(exercise,unit) }))).find(item => url.pathname === `/audio/${item.filename}`);
        if (!recording || !audioMetadata(recording.exercise,recording.unit).ready) fail(404, 'File audio chưa sẵn sàng.');
        const audioPath = path.join(ROOT,'audio',recording.filename),size = fs.statSync(audioPath).size;
        let start=0,end=size-1,status=200;
        if (req.headers.range) {
          const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || (!range[1]&&!range[2])) { res.writeHead(416,{'Content-Range':`bytes */${size}`}); return res.end(); }
          if (!range[1]) { start=Math.max(0,size-Number(range[2])); }
          else { start=Number(range[1]); if(range[2])end=Math.min(size-1,Number(range[2])); }
          if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size) { res.writeHead(416,{'Content-Range':`bytes */${size}`}); return res.end(); }
          status=206;
        }
        res.writeHead(status,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'private, no-store',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
        if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(audioPath,{start,end});
        stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      if (url.pathname.startsWith('/api/')) {
        const user = requireUser(req);
        if(url.pathname.startsWith('/api/speaking/')){
          if(req.method==='GET'&&url.pathname==='/api/speaking/status')return send(res,200,speaking.status(user.id));
          if(req.method==='GET'&&url.pathname==='/api/speaking/lessons')return send(res,200,speaking.catalog());
          if(req.method==='GET'&&url.pathname==='/api/speaking/progress')return send(res,200,speaking.progress(user.id));
          if(req.method==='GET'&&url.pathname==='/api/speaking/sessions')return send(res,200,speaking.history(user.id,{page:url.searchParams.get('page')||1}));
          if(req.method==='POST'&&url.pathname==='/api/speaking/sessions')return send(res,201,speaking.start(user.id,await body(req,4096)));
          const match=url.pathname.match(/^\/api\/speaking\/sessions\/([a-zA-Z0-9_-]{1,100})(?:\/(draft|transcriptions|turns|finish|speech))?$/);
          if(match){
            if(req.method==='GET'&&!match[2])return send(res,200,speaking.get(user.id,match[1]));
            if(req.method==='POST'){
              const input=await body(req,match[2]==='transcriptions'?3*1024*1024:16384);
              if(match[2]==='draft')return send(res,200,speaking.saveDraft(user.id,match[1],input));
              if(match[2]==='transcriptions')return send(res,200,await speaking.transcribe(user.id,match[1],input));
              if(match[2]==='turns')return send(res,200,await speaking.review(user.id,match[1],input));
              if(match[2]==='finish')return send(res,200,speaking.finish(user.id,match[1],input));
              if(match[2]==='speech'){const bytes=await speaking.speech(user.id,match[1],input);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length,'Cache-Control':'private, no-store'});return res.end(bytes);}
            }
          }
        }
        if(req.method==='POST'&&url.pathname==='/api/material-drafts')return send(res,200,await drafts.generate(user.id,await body(req,72*1024*1024)));
        if(req.method==='POST'&&url.pathname==='/api/material-drafts/validate')return send(res,200,validateManifest((await body(req,1024*1024)).manifest));
        if (url.pathname.startsWith('/api/tutor/')) {
          if (req.method === 'GET' && url.pathname === '/api/tutor/status') return send(res,200,tutor.status());
          if (req.method === 'POST' && url.pathname === '/api/tutor/connect') return send(res,200,await tutor.connect(user.id,await body(req)));
          if (req.method === 'POST' && url.pathname === '/api/tutor/select') return send(res,200,tutor.select((await body(req)).profileId));
          if (req.method === 'POST' && url.pathname === '/api/tutor/disconnect') { await body(req);return send(res,200,await tutor.disconnect()); }
          if (req.method === 'GET' && url.pathname === '/api/tutor/models') return send(res,200,{items:await tutor.models()});
          if (req.method === 'GET' && url.pathname === '/api/tutor/history') return send(res,200,tutor.history(user.id,url.searchParams.get('attemptId'),url.searchParams.get('questionId')));
          if (req.method === 'POST' && url.pathname === '/api/tutor/messages') return send(res,200,await tutor.chat(user.id,await body(req)));
          return send(res,404,{error:'Không tìm thấy API gia sư.'});
        }
        if (req.method === 'GET' && url.pathname === '/api/exercises') return send(res, 200, { items: store.listExercises(user.id).map(exercise => ({ id: exercise.id, version: exercise.version, title: exercise.title, description: exercise.description, part: exercise.part, original: exercise.original !== false, canDelete:exercise.id.startsWith('personal-'), source:exercise.source, audio: exercise.audio, units: exercise.units.map(unit => ({ id: unit.id, title: unit.title, questionCount: unit.questions.length, audio:audioMetadata(exercise,unit) })), questionCount: exercise.units.reduce((sum, unit) => sum + unit.questions.length, 0) })) });
        if (req.method === 'POST' && url.pathname === '/api/materials') {
          const imported=store.materials.import(user.id,await body(req,48*1024*1024));
          return send(res,imported.importStatus==='created'?201:200,publicExercise(imported));
        }
        const materialMatch=url.pathname.match(/^\/api\/materials\/([a-zA-Z0-9_-]{1,100})$/);
        if(req.method==='DELETE'&&materialMatch)return send(res,200,store.materials.remove(user.id,materialMatch[1]));
        if (req.method === 'GET' && url.pathname === '/api/import-template') {
          const requestedPart=url.searchParams.get('part')||'3';
          if(!['2','3','4','general-listening'].includes(requestedPart))fail(400,'Loại mẫu phải là 2, 3, 4 hoặc general-listening.');
          const general=requestedPart==='general-listening',part=general?requestedPart:Number(requestedPart);
          const count=general?8:part===2?1:3,options=general?['[A]','[B]']:part===2?['[A]','[B]','[C]']:['[A]','[B]','[C]','[D]'];
          const template={title:'[Tên bài của bạn]',part,source:{name:'[Tên nhà xuất bản/nguồn]',book:'[Tên sách hoặc tài liệu]',test:'[Bài học/test và số trang]',materialType:'licensed-book',answerLocation:'[Trang/file đáp án gốc]',rightsNote:'[Quyền sử dụng cá nhân của bạn]'},transcript:null,questions:Array.from({length:count},(_,index)=>({number:String(index+1),prompt:'[Chép từ tài liệu bạn có quyền sử dụng]',options:[...options],answer:null,explanation:''}))};
          return send(res,200,template,{'Content-Disposition':`attachment; filename="listenlab-${general?'general-listening':'personal-material'}-template.json"`});
        }
        const assetMatch=url.pathname.match(/^\/api\/assets\/([a-zA-Z0-9_-]{1,100})$/);
        if (['GET','HEAD'].includes(req.method)&&assetMatch) {
          const asset=store.materials.asset(user.id,assetMatch[1]);if(!asset)fail(404,'Không tìm thấy file thuộc tài khoản này.');
          const bytes=Buffer.from(asset.bytes),size=bytes.length;let start=0,end=size-1,status=200;
          if(req.headers.range){const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}if(!range[1])start=Math.max(0,size-Number(range[2]));else{start=Number(range[1]);if(range[2])end=Math.min(end,Number(range[2]));}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}status=206;}
          res.writeHead(status,{'Content-Type':asset.mime,'Content-Length':end-start+1,'Cache-Control':'private, no-store','Accept-Ranges':'bytes',...(asset.mime.startsWith('audio/')?{}:{'Content-Disposition':`attachment; filename="document-${asset.id}.${asset.mime==='application/pdf'?'pdf':'txt'}"`}),...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});return res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
        }
        const exerciseMatch = url.pathname.match(/^\/api\/exercises\/([a-zA-Z0-9_-]+)$/);
        if (req.method === 'GET' && exerciseMatch) {
          const exercise = store.getExercise(user.id,exerciseMatch[1]);
          if (!exercise) fail(404, 'Không tìm thấy bài luyện.');
          return send(res, 200, publicExercise(exercise));
        }
        if (req.method === 'POST' && url.pathname === '/api/runs') {
          const input = await body(req);
          const exercise=store.getExercise(user.id,input.exerciseId),unit=exercise?.units.find(item=>item.id===input.unitId);
          if (unit && !audioMetadata(exercise,unit).ready) fail(409,'Bài này chưa có file audio hợp lệ. Chưa thể bắt đầu lượt luyện nghe.');
          return send(res, 201, store.startRun(user.id, input.exerciseId, input.unitId));
        }
        const runMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]{1,100})$/);
        if (req.method === 'GET' && runMatch) {
          const row = store.db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').get(runMatch[1], user.id);
          if (!row) fail(404, 'Không tìm thấy lượt đang làm.');
          const attempt = store.db.prepare('SELECT id FROM attempts WHERE run_id = ? AND user_id = ?').get(row.id, user.id);
          return send(res, 200, { id: row.id, exerciseId: row.exercise_id, version: row.version, unitId: row.unit_id, startedAt: row.started_at, submittedAttemptId: attempt?.id || null });
        }
        if (req.method === 'POST' && url.pathname === '/api/attempts') return send(res, 201, store.submitAttempt(user.id, await body(req)));
        if (req.method === 'GET' && url.pathname === '/api/progress') return send(res, 200, store.getProgress(user.id,{category:url.searchParams.get('category')||'official'}));
        if (req.method === 'GET' && url.pathname === '/api/attempts') return send(res, 200, store.listAttempts(user.id, Object.fromEntries(url.searchParams)));
        const attemptMatch = url.pathname.match(/^\/api\/attempts\/([a-zA-Z0-9_-]{1,100})$/);
        if (req.method === 'GET' && attemptMatch) {
          const attempt = store.getAttempt(user.id, attemptMatch[1]);
          if (!attempt) fail(404, 'Không tìm thấy lượt làm.');
          return send(res, 200, attempt);
        }
        if (req.method === 'GET' && url.pathname === '/api/report') {
          const format = url.searchParams.get('format') || 'markdown';
          if (!['markdown', 'json'].includes(format)) fail(400, 'format phải là markdown hoặc json.');
          const report = store.getReport(user.id);
          const extension = format === 'markdown' ? 'md' : 'json';
          const downloadHeaders = url.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="listenlab-report-${new Date().toISOString().slice(0, 10)}.${extension}"` } : {};
          if (format === 'json') return send(res, 200, report, downloadHeaders);
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', ...downloadHeaders });
          return res.end(reportMarkdown(report));
        }
        return send(res, 404, { error: 'API không tồn tại.' });
      }
      const staticFiles = {
        '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/tutor.js': ['tutor.js','text/javascript; charset=utf-8'], '/generator.js':['generator.js','text/javascript; charset=utf-8'], '/speaking.js':['speaking.js','text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']
      };
      const asset = staticFiles[url.pathname];
      if (asset && ['GET', 'HEAD'].includes(req.method)) {
        const bytes = fs.readFileSync(path.join(ROOT, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      send(res, 404, { error: 'Không tìm thấy trang.' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error.status || error.statusCode || 500;
      if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${String(req.url).split('?')[0]}: lỗi xử lý ${error.code || error.name}`);
      send(res, status, { error: status >= 500 && !error.tutorError && !error.speakingError ? 'Server không xử lý được yêu cầu. Hãy thử lại.' : error.message, ...(error.tutorError?{providerCode:error.providerCode||null,requestId:error.requestId||null,upstreamStatus:error.upstreamStatus||null}:{}) });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server, store, config, tutor, drafts, speaking,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
      if (!config.publicOrigin) config.publicOrigin = `http://${config.host === '::1' ? '[::1]' : config.host}:${server.address().port}`;
      try { mcpHandler = createMcpHandler({ store, config }); }
      catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
      return config.publicOrigin;
    },
    async close() {
      tutor.close();
      speaking.close();
      await closeTranscriber();
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
      store.close();
    }
  };
}

if (require.main === module) {
  const app = createApp();
  app.listen().then(url => { console.log(`Listen Lab: ${url}\nDữ liệu SQLite: ${app.config.dbPath}\nMở trang để tạo tài khoản hoặc đăng nhập. Ctrl+C để dừng.`); }).catch(error => { console.error(error.message); app.store.close(); process.exitCode = 1; });
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(); });
}
module.exports = { createApp, loadConfig };

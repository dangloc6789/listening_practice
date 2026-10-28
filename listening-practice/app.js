(() => {
  'use strict';
  // Apply the saved theme before the stylesheet and page content are painted.
  const themeKey = 'listenlab-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let chosenTheme = null;
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'dark' || saved === 'light') chosenTheme = saved;
  } catch {}

  function applyTheme() {
    const theme = chosenTheme || (systemTheme.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101a16' : '#f6f7f3');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.title = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
      document.getElementById('theme-label').textContent = theme === 'dark' ? 'Tối' : 'Sáng';
    }
  }
  applyTheme();
  systemTheme.addEventListener('change', () => { if (!chosenTheme) applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key !== themeKey && event.key !== null) return;
    chosenTheme = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
    applyTheme();
  });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(themeKey, chosenTheme); } catch {}
      applyTheme();
    });
  }, { once: true });

  function initializeApp() {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const letters = ['A','B','C','D'];
  const audioPlayer = $('recording-player');
  const draftKey = 'listenlab-server-draft-v2', settingsKey = 'listenlab-audio-v2';
  let configured = true, library = [], exercise = null, unit = null, run = null, savedAttempt = null;
  let answers = {}, playback = emptyPlayback(), submitting = false, starting = false;
  let playing = false, audioToken = 0, activePlayback = null;
  let page = 1, pages = 1;
  let timezone = 'Asia/Bangkok';
  const sourceLabel=kind=>kind==='official'?'Nguồn chính thức':kind==='user'?'Tài liệu người dùng':'AI tự soạn / TTS';
  let settings = readLocal(settingsKey, {rate:0.9,voiceURI:''});
  if (!Number.isFinite(settings?.rate) || settings.rate < .6 || settings.rate > 1.2) settings = {rate:0.9,voiceURI:''};
  const practiceSet = createPracticeSet();

  function emptyPlayback() { return {plays:0,replays:0,completedPlays:0,rate:0.9,voice:''}; }
  function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
  function writeLocal(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
  function notice(message, error = false) { $('global-status').textContent=message; $('global-status').hidden=!message; $('global-status').classList.toggle('error',error); }
  function date(value) { return new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:timezone}).format(new Date(value)); }
  function percent(value,count) { return !count ? '—' : `${Number(value||0).toFixed(1)}%`; }
  function duration(ms) { const s=Math.max(0,Math.round(Number(ms||0)/1000));return `${Math.floor(s/60)} phút ${s%60} giây`; }
  async function api(url,options={}) {
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    const result=(response.headers.get('content-type')||'').includes('application/json')?await response.json():await response.text();
    if(!response.ok){
      if(response.status===401&&!url.startsWith('/api/auth/')){stopAudio();practiceSet.stop();$('app-shell').hidden=true;$('auth-section').hidden=false;configureAuth(true);}
      throw new Error(result.error||`Yêu cầu thất bại (${response.status}).`);
    }return result;
  }
  function post(url,value){return api(url,{method:'POST',body:JSON.stringify(value)});}
  function configureAuth(hasAccount){
    configured=hasAccount;
    $('auth-title').textContent=hasAccount?'Chào bạn, đăng nhập để học tiếp.':'Tạo tài khoản cá nhân trên máy này.';
    $('auth-description').textContent=hasAccount?'Bài làm và tiến độ được đọc từ SQLite trên backend.':'Chọn tên đăng nhập và mật khẩu từ 12 ký tự. Chỉ tạo một tài khoản cho ứng dụng cá nhân này.';
    $('password').autocomplete=hasAccount?'current-password':'new-password';$('password').minLength=hasAccount?1:12;
    $('auth-submit').textContent=hasAccount?'Đăng nhập →':'Tạo tài khoản và bắt đầu →';$('auth-submit').disabled=false;
  }
  function resetPractice(){
    practiceSet.reset();$('practice-workspace').hidden=false;
    stopAudio();run=null;unit=null;exercise=null;savedAttempt=null;answers={};playback=emptyPlayback();
    $('exercise').hidden=true;$('practice-empty').hidden=false;$('transcript').hidden=true;$('transcript').innerHTML='';$('answer-fields').innerHTML='';
    $('attempt-detail').hidden=true;$('attempt-detail').innerHTML='';$('history-list').innerHTML='';updateAudioButtons();
  }
  function applySaved(attempt){savedAttempt=attempt;playback={...attempt.playback};answers=Object.fromEntries(attempt.questions.map(q=>[q.questionId,q.selectedChoice]));}
  function refreshLocks(){
    updateAudioButtons();$('submit-btn').disabled=starting||submitting||Boolean(savedAttempt)||!allAnswered();
    $('answer-form').querySelectorAll('.question-fieldset').forEach(fieldset=>{fieldset.disabled=starting||submitting||Boolean(savedAttempt);});
    updatePracticeControls();
  }
  function updatePracticeControls(){const locked=starting||submitting||practiceSet.busy;$('start-btn').disabled=locked;$('exercise-select').disabled=locked;$('logout-btn').disabled=locked;}
  async function enterApp(username){
    resetPractice();
    $('auth-section').hidden=true;$('app-shell').hidden=false;$('user-name').textContent=username;$('password').value='';$('auth-error').textContent='';notice('');
    library=(await api('/api/exercises')).items;
    $('exercise-select').innerHTML=library.map(item=>`<option value="${escape(item.id)}">[${sourceLabel(item.source?.kind)}] ${escape(item.title)}</option>`).join('');
    $('exercise-select').value='official-iibc-part3-32-34';
    fillUnits();await loadProgress();showView('dashboard');
    try{
      if(await practiceSet.restore()){
        $('exercise-select').value=practiceSet.exerciseId;fillUnits();$('practice-workspace').hidden=true;showView('practice');
        notice('Đã khôi phục cả bộ bài, các lựa chọn và kết quả đã lưu.');return;
      }
    }catch{practiceSet.clearDraft();notice('Không khôi phục được bộ đang làm. Lịch sử đã nộp vẫn còn trên server.');}
    let draft;try{draft=JSON.parse(sessionStorage.getItem(draftKey));}catch{}
    if(draft?.runId&&draft.exerciseId){
      try{
        const restored=await api(`/api/runs/${encodeURIComponent(draft.runId)}`),content=await api(`/api/exercises/${encodeURIComponent(draft.exerciseId)}`);
        const restoredUnit=content.units.find(item=>item.id===restored.unitId);
        if(restored.version!==content.version||!restoredUnit)throw new Error('Phiên bản bài đã thay đổi.');
        $('exercise-select').value=content.id;fillUnits();
        if(content.audio?.kind!=='external-link'){
          const attempt=restored.submittedAttemptId?await api(`/api/attempts/${restored.submittedAttemptId}`):null;
          practiceSet.open(content,{seed:{unitId:restoredUnit.id,run:restored,answers:draft.answers||{},playback:draft.playback,attempt}});
          $('practice-workspace').hidden=true;clearDraft();
        }else{
          exercise=content;unit=restoredUnit;run=restored;answers=draft.answers||{};playback={...emptyPlayback(),...draft.playback};savedAttempt=null;
          $('unit-select').value=unit.id;
          if(restored.submittedAttemptId)applySaved(await api(`/api/attempts/${restored.submittedAttemptId}`));
          renderUnit();
        }
        showView('practice');notice('Đã tiếp tục bài đang làm. Lịch sử hoàn thành vẫn ở server.');
      }catch{clearDraft();notice('Không khôi phục được lượt đang làm. Có thể bắt đầu lượt mới; lịch sử đã lưu vẫn còn.');}
    }
    const requested=new URLSearchParams(location.search);
    if(!draft?.runId&&(requested.get('part')==='3'||requested.get('source')==='official')){showView('practice');await startUnit('official-iibc-part3-32-34','iibc-32-34');}
  }
  function showView(name){if(name!=='practice')practiceSet.stop();['dashboard','practice','history'].forEach(item=>{$(`${item}-view`).hidden=item!==name;$(`${item}-tab`).classList.toggle('active',item===name);if(item===name)$(`${item}-tab`).setAttribute('aria-current','page');else $(`${item}-tab`).removeAttribute('aria-current');});}
  function fillUnits(){const meta=library.find(item=>item.id===$('exercise-select').value);if(!meta)return;$('unit-select').innerHTML=meta.units.map(item=>`<option value="${escape(item.id)}">${escape(item.title)} · ${item.questionCount} câu</option>`).join('');$('start-btn').textContent=meta.audio?.kind==='external-link'?'Bắt đầu lượt mới →':`Làm lại bộ ${meta.questionCount} câu →`;$('exercise-description').textContent=`${meta.description} Phiên bản ${meta.version}. ${meta.audio?.kind==='external-link'?'Nghe và đọc tại nguồn, ghi lựa chọn ở đây.':`Toàn bộ ${meta.questionCount} câu hiện trên cùng một trang. Có thể nộp từng câu/đoạn hoặc cả bộ.`}`;}
  async function openSelectedPractice(fresh=false){
    if(starting||submitting||practiceSet.busy)return;
    const meta=library.find(item=>item.id===$('exercise-select').value);if(!meta)return;
    stopAudio();practiceSet.stop();
    if(meta.audio?.kind==='external-link'){practiceSet.hide();$('practice-workspace').hidden=false;return;}
    if(!fresh&&practiceSet.exerciseId===meta.id){practiceSet.show();$('practice-workspace').hidden=true;return;}
    starting=true;updatePracticeControls();notice('');
    try{
      const content=await api(`/api/exercises/${encodeURIComponent(meta.id)}`);
      practiceSet.open(content,{fresh});$('practice-workspace').hidden=true;clearDraft();run=null;unit=null;exercise=null;savedAttempt=null;
    }catch(error){notice(error.message,true);}finally{starting=false;refreshLocks();}
  }
  function saveDraft(){if(!run)return;try{sessionStorage.setItem(draftKey,JSON.stringify({runId:run.id,exerciseId:exercise.id,answers,playback}));}catch{notice('Không lưu được bản nháp trong trình duyệt. Các bài đã nộp vẫn ở SQLite trên server.');}}
  function clearDraft(){try{sessionStorage.removeItem(draftKey);}catch{}}
  async function startUnit(exerciseId,unitId){
    if(starting||submitting||practiceSet.busy)return;practiceSet.hide();$('practice-workspace').hidden=false;starting=true;$('start-btn').disabled=true;stopAudio();refreshLocks();notice('');
    try{
      const content=await api(`/api/exercises/${encodeURIComponent(exerciseId)}`),selected=content.units.find(item=>item.id===unitId);if(!selected)throw new Error('Không tìm thấy câu / đoạn.');
      const newRun=await post('/api/runs',{exerciseId,unitId});exercise=content;unit=selected;run=newRun;savedAttempt=null;answers={};playback=emptyPlayback();saveDraft();
      $('exercise-select').value=exerciseId;fillUnits();$('unit-select').value=unitId;renderUnit();$('question-heading').focus({preventScroll:true});$('exercise').scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){notice(error.message,true);}finally{starting=false;$('start-btn').disabled=false;refreshLocks();}
  }
  function questionFields(question,index){
    return questionHTML(question,index,exercise,answers,Boolean(savedAttempt));
  }
  function questionHTML(question,index,content,selections,locked,number){
    const external=content.audio?.kind==='external-link';
    const hidePrompt=content.part===2;
    return `<fieldset class="question-fieldset" ${locked?'disabled':''}><legend>${external?escape(question.prompt):hidePrompt?`Câu ${escape(number??question.number??index+1)}: chọn hồi đáp phù hợp`:`${index+1}. ${escape(question.prompt)}`}</legend><div class="${external?'answer-grid':'text-answer-grid'}">${question.options.map((option,i)=>`<label class="answer-choice ${external?'':'text-choice'}"><input type="radio" name="question-${escape(question.id)}" value="${i}" ${selections[question.id]===i?'checked':''}><span class="choice-letter">${letters[i]}</span><span class="${external?'choice-caption':'option-text'}" ${external?'':'lang="en"'}>${external?`Lựa chọn ${letters[i]}`:escape(option)}</span></label>`).join('')}</div></fieldset>`;
  }
  function sourceHTML(source){if(!source)return '<p class="small muted">AI tự soạn · nguồn cũ</p>';return `<strong>${escape(sourceLabel(source.kind))} · ${escape(source.name)}</strong><p class="small">${escape(source.book||'')} ${escape(source.test||'')} · Loại: ${escape(source.materialType)} · Câu ${escape((source.questionNumbers||[]).join(', '))}</p>${source.url?`<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">Trang nguồn ↗</a>`:''}${source.rights?.termsUrl?` · <a href="${escape(source.rights.termsUrl)}" target="_blank" rel="noopener noreferrer">Điều kiện sử dụng ↗</a>`:''}${(source.documents||[]).map(document=>`<p><a href="${escape(document.url)}" download>Tài liệu cá nhân: ${escape(document.name)}</a></p>`).join('')}<p class="small muted">${escape(source.rights?.decision||source.verification?.method||'')} ${source.verification?.checkedAt?`Kiểm tra: ${date(source.verification.checkedAt)}.`:''}</p>`;}
  function detailsHTML(attempt){
    if(attempt.audio?.kind==='external-link')return `${sourceHTML(attempt.source)}<p class="notice">Audio, câu hỏi và transcript được nghe/đọc tại IIBC, không sao chép vào app. Không tạo transcript hay bản dịch thay thế. Kết quả dưới đây chấm theo key của IIBC đã đối chiếu.</p>${attempt.questions.map(q=>`<p><strong>Câu ${escape(q.number||q.questionId)}:</strong> chọn ${letters[q.selectedChoice]} · đáp án ${letters[q.correctChoice]} · ${q.correct?'đúng':'sai'}</p>`).join('')}<a href="${escape(attempt.source.transcriptUrl)}" target="_blank" rel="noopener noreferrer">Xem transcript/giải đáp tại nguồn ↗</a><p class="small muted">Số lần phát là tự báo; app không quan sát việc phát tại website khác. Đây chỉ là ba câu mẫu, không suy ra điểm TOEIC hay năng lực trên đề mới.</p>`;
    return `<h3>Lời thoại · ${escape(attempt.audio?.kind==='tts-file'?'File WAV TTS tạo sẵn':attempt.audio?.kind==='tts'?'TTS trình duyệt (lượt cũ)':'audio')}</h3><div class="dialogue">${attempt.transcript.map(turn=>`<p lang="en">${turn.speaker?`<strong>${escape(turn.speaker)}:</strong> `:''}${escape(turn.text)}</p>${turn.translation?`<p class="translation">${escape(turn.translation)}</p>`:''}`).join('')}</div>${attempt.questions.map((q,index)=>`<div class="question-review"><h3 lang="en">${index+1}. ${escape(q.prompt)}</h3><p class="translation">${escape(q.translation)}</p><p class="small ${q.correct?'correct-text':'error-text'}">${q.correct?'✓ Đúng':'× Chưa đúng'} · Bạn chọn ${letters[q.selectedChoice]} · Đáp án ${letters[q.correctChoice]} · ${q.firstAttempt?'Lần đầu':'Làm lại'}</p><ol class="transcript-options">${q.options.map((option,i)=>`<li class="${i===q.correctChoice?'correct':i===q.selectedChoice?'wrong':''}" lang="en"><strong>${letters[i]}.</strong> ${escape(option)}${i===q.correctChoice?' ✓':''}</li>`).join('')}</ol><p class="explanation">${escape(q.explanation)}</p>${q.evidence?.length?`<div class="evidence"><strong>Dẫn chứng trong audio</strong>${q.evidence.map(item=>`<blockquote lang="en">“${escape(item.quote)}”<small>Lượt thoại ${item.turn+1}</small></blockquote>`).join('')}</div>`:''}${q.vocabulary?.length?`<div class="vocabulary">${q.vocabulary.map(entry=>`<span><strong lang="en">${escape(entry.term)}</strong>: ${escape(entry.meaning)}</span>`).join('')}</div>`:''}</div>`).join('')}`;
  }
  function renderUnit(){
    $('practice-empty').hidden=true;$('exercise').hidden=false;$('part-label').textContent=`PART ${exercise.part} · ${sourceLabel(exercise.source?.kind)}`;
    $('source-info').innerHTML=sourceHTML(exercise.source);
    const external=exercise.audio?.kind==='external-link';$('external-panel').hidden=!external;$('audio-panel').hidden=external;
    document.querySelector('.recording-settings').hidden=external;
    if(!external)document.querySelector('.recording-settings>p.small').textContent=unit.audio?.kind==='user-file'?'Audio gốc do bạn cung cấp, không thay bằng giọng tổng hợp. Quyền sử dụng và việc khớp đề/key do bạn xác nhận.':'AI tự soạn / TTS luyện thêm, thống kê riêng. WAV tạo sẵn, không phải bản thu ETS.';
    $('external-confirm').checked=Boolean(savedAttempt);$('external-confirm').disabled=Boolean(savedAttempt);$('external-plays').disabled=Boolean(savedAttempt);$('external-plays').value=savedAttempt?.playback?.plays||1;
    if(external){$('external-source').href=exercise.source.url;audioPlayer.removeAttribute('src');audioPlayer.load();}
    const index=exercise.units.findIndex(item=>item.id===unit.id);$('unit-progress').textContent=`${index+1} / ${exercise.units.length} câu / đoạn · v${exercise.version}`;$('question-heading').textContent=unit.title;
    $('answer-fields').innerHTML=unit.questions.map(questionFields).join('');$('submit-btn').hidden=Boolean(savedAttempt);$('submit-btn').disabled=Boolean(savedAttempt)||!allAnswered();
    $('feedback').hidden=!savedAttempt;$('transcript').hidden=!savedAttempt;$('transcript').innerHTML=savedAttempt?detailsHTML(savedAttempt):'';$('next-btn').hidden=!savedAttempt;$('next-btn').textContent=index===exercise.units.length-1?'Về dashboard →':'Câu / đoạn tiếp theo →';$('submit-error').textContent='';
    if(savedAttempt&&!external&&!savedAttempt.transcript.length)$('transcript').insertAdjacentHTML('afterbegin','<p class="notice">Tài liệu nhập chưa có transcript. App không tự tạo lời thoại, bản dịch hay dẫn chứng còn thiếu.</p>');
    $('attempt-note').textContent=savedAttempt?`Đã lưu · ${date(savedAttempt.submittedAt)} · ${duration(savedAttempt.durationMs)} · ${savedAttempt.attemptKind==='first'?'Lần đầu':savedAttempt.attemptKind==='retry'?'Làm lại':'Kết hợp lần đầu và làm lại'}`:'Đang làm · server ghi giờ bắt đầu và tự chấm khi nộp.';
    if(savedAttempt){$('feedback').textContent=`Đúng ${savedAttempt.correct}/${savedAttempt.total} câu (${Number(savedAttempt.accuracy).toFixed(1)}%). Đã lưu lịch sử trên server.`;$('feedback').classList.toggle('wrong',savedAttempt.correct<savedAttempt.total);}
    $('listening-context').textContent=unit.context||'';
    if(unit.audio?.ready&&!external){
      if(audioPlayer.getAttribute('src')!==unit.audio.url){audioPlayer.src=unit.audio.url;audioPlayer.load();}
      const shortVoice=name=>name.replace('Microsoft ','').replace(' Desktop - English (United States)','');
      $('recording-voices').textContent=exercise.part===3?(unit.audio.roles||[]).map(role=>`${role.speaker}: ${shortVoice(role.voice)}`).join(' · '):(unit.audio.voices||[]).map(shortVoice).join(' / ');
      $('audio-download').href=unit.audio.url;$('audio-download').hidden=false;
      $('audio-status').textContent='Sẵn sàng · file audio TTS có sẵn';
      if(unit.audio.kind==='user-file'){$('audio-status').textContent='Sẵn sàng · audio bạn cung cấp';$('recording-voices').textContent='Giọng trong file gốc do bạn cung cấp; không thay bằng TTS.';}
      $('audio-panel').querySelector('.audio-hint').textContent=unit.audio.kind==='user-file'?'Audio gốc cá nhân · Lời thoại/key chỉ hiện sau nộp nếu đã được nhập.':'WAV TTS · Transcript, bản dịch và đáp án đúng mở sau khi nộp.';
    }else if(!external){$('audio-status').textContent='Bài này chưa có file audio hợp lệ.';$('audio-download').hidden=true;}
    updateAudioTime();updateAudioButtons();
  }
  function allAnswered(){return unit&&unit.questions.every(q=>Number.isInteger(answers[q.id])&&answers[q.id]>=0&&answers[q.id]<q.options.length)&&(exercise.audio?.kind!=='external-link'||Boolean(savedAttempt)||$('external-confirm').checked);}
  function updateAudioButtons(){const unavailable=!unit?.audio?.ready||starting||submitting;$('play-btn').disabled=unavailable||playing;$('replay-btn').disabled=unavailable||(!savedAttempt&&playback.plays===0);$('stop-btn').disabled=!playing;$('audio-panel').classList.toggle('is-playing',playing);$('listen-count').textContent=`${playback.plays} lượt phát · ${playback.replays} lượt nghe lại · ${playback.completedPlays} lượt hết bài${savedAttempt?' · số liệu tại lúc nộp':''}`;}
  function updateAudioTime(){const elapsed=audioPlayer.currentTime||0,total=Number.isFinite(audioPlayer.duration)?audioPlayer.duration:(unit?.audio?.durationSeconds||0),clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;$('audio-time').textContent=`${clock(elapsed)} / ${clock(total)}`;$('audio-progress').value=total?elapsed/total*100:0;}
  function stopAudio(message='Đã dừng. Có thể nghe lại từ đầu.'){audioToken++;activePlayback=null;playing=false;audioPlayer.pause();if(audioPlayer.readyState)audioPlayer.currentTime=0;$('audio-status').textContent=message;updateAudioTime();updateAudioButtons();}
  async function play(){
    if(!unit?.audio?.ready||exercise.audio?.kind==='external-link'||starting||submitting)return;stopAudio('Đang mở file audio…');const token=audioToken;
    activePlayback={token,tracking:!savedAttempt,counted:false,rate:settings.rate};playing=true;audioPlayer.playbackRate=settings.rate;audioPlayer.currentTime=0;updateAudioButtons();
    try{await audioPlayer.play();if(token===audioToken)$('audio-status').textContent=`Đang phát ${exercise.part===2?'câu hỏi và A/B/C':exercise.part===3?'hội thoại':'bài nói'} · ${unit.audio.kind==='user-file'?'audio bạn cung cấp':'WAV TTS'}`;}
    catch(error){if(token===audioToken)stopAudio(`Không phát được file audio (${error.name}). Hãy bấm Phát lại hoặc tải WAV để nghe.`);}
  }
  audioPlayer.addEventListener('playing',()=>{const current=activePlayback;if(!current||current.token!==audioToken||current.counted)return;current.counted=true;if(current.tracking){if(playback.plays)playback.replays++;playback.plays++;playback.rate=current.rate;playback.voice=`WAV TTS: ${(unit.audio.voices||[]).map(name=>name.replace('Microsoft ','').replace(' Desktop - English (United States)','')).join(' / ')}`;saveDraft();}updateAudioButtons();});
  audioPlayer.addEventListener('ended',()=>{const current=activePlayback;if(current?.token!==audioToken)return;if(current.tracking&&current.counted){playback.completedPlays++;saveDraft();}activePlayback=null;playing=false;$('audio-status').textContent=savedAttempt?'Đã nghe lại đoạn audio.':'Đã nghe xong. Hãy chọn đáp án.';updateAudioTime();updateAudioButtons();});
  audioPlayer.addEventListener('error',()=>{if(unit)stopAudio('Không tải hoặc giải mã được audio. Kiểm tra server rồi thử lại; bạn cũng có thể tải WAV.');});
  audioPlayer.addEventListener('timeupdate',updateAudioTime);audioPlayer.addEventListener('loadedmetadata',updateAudioTime);
  function createPracticeSet(){
    const root=$('practice-set'),key='listenlab-set-draft-v1',banks=new Map();
    let current=null,batch=false;
    const states=()=>current?[...current.states.values()]:[];
    const cardFor=state=>current?.states.get(state.unit.id)===state?root.querySelector(`[data-unit-id="${CSS.escape(state.unit.id)}"]`):null;
    const answered=state=>state.unit.questions.every(q=>Number.isInteger(state.answers[q.id])&&state.answers[q.id]>=0&&state.answers[q.id]<q.options.length);
    const clock=value=>{const s=Math.max(0,Math.floor(value||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
    const shortVoice=value=>value.replace('Microsoft ','').replace(' Desktop - English (United States)','');

    function save(){
      if(!current)return;
      try{sessionStorage.setItem(key,JSON.stringify({active:!root.hidden,exerciseId:current.content.id,version:current.content.version,states:states().map(s=>({unitId:s.unit.id,runId:s.run?.id||null,answers:s.answers,playback:s.playback}))}));}
      catch{notice('Không lưu được bản nháp trong trình duyệt. Kết quả đã nộp vẫn ở server.');}
    }
    function applyAttempt(state,attempt){state.attempt=attempt;state.playback={...attempt.playback};state.answers=Object.fromEntries(attempt.questions.map(q=>[q.questionId,q.selectedChoice]));}
    function updateAudio(state){
      const card=cardFor(state);if(!card)return;
      const player=state.player,unavailable=!state.unit.audio?.ready||state.submitting||batch;
      card.querySelector('[data-play]').disabled=unavailable||state.playing||state.openingAudio;
      card.querySelector('[data-replay]').disabled=unavailable||state.openingAudio||(!state.attempt&&!state.playback.plays);
      card.querySelector('[data-stop]').disabled=!state.playing&&!state.openingAudio;
      card.querySelector('[data-audio-status]').textContent=state.status||(!state.unit.audio?.ready?'Audio chưa sẵn sàng.':state.unit.audio.kind==='user-file'?'Audio gốc do bạn cung cấp.':`WAV TTS · ${current.content.part===2?'câu hỏi và hồi đáp':current.content.part===3?'hội thoại':'bài nói'}`);
      const total=Number.isFinite(player?.duration)?player.duration:state.unit.audio?.durationSeconds||0,elapsed=player?.currentTime||0;
      card.querySelector('[data-audio-time]').textContent=`${clock(elapsed)} / ${clock(total)}`;
      card.querySelector('progress').value=total?elapsed/total*100:0;
      card.querySelector('[data-listen-count]').textContent=`${state.playback.plays} lượt phát · ${state.playback.replays} nghe lại · ${state.playback.completedPlays} nghe hết${state.attempt?' · tại lúc nộp':''}`;
    }
    function updateState(state){
      const card=cardFor(state);if(!card)return;
      card.querySelectorAll('fieldset').forEach(fieldset=>{fieldset.disabled=Boolean(state.attempt)||state.submitting||batch||!state.unit.audio?.ready;});
      const submit=card.querySelector('[data-submit-unit]');submit.disabled=!answered(state)||Boolean(state.attempt)||state.submitting||batch||!state.unit.audio?.ready;
      submit.textContent=state.attempt?'Đã lưu':state.submitting?'Đang lưu…':'Nộp và lưu →';
      card.querySelector('[data-unit-error]').textContent=state.error||'';
      card.querySelector('[data-unit-note]').textContent=state.attempt?`${date(state.attempt.submittedAt)} · ${state.attempt.attemptKind==='first'?'Lần đầu':state.attempt.attemptKind==='retry'?'Làm lại':'Kết hợp'} · ${duration(state.attempt.durationMs)}`:state.run?'Đang làm · giờ bắt đầu đã ghi trên server.':'Chưa bắt đầu · thời gian tính từ khi bạn nghe hoặc chọn đáp án.';
      const feedback=card.querySelector('[data-unit-feedback]'),result=card.querySelector('[data-unit-result]');
      feedback.hidden=result.hidden=!state.attempt;
      if(state.attempt){
        feedback.textContent=`Đúng ${state.attempt.correct}/${state.attempt.total} câu. Đã lưu lịch sử.`;
        feedback.classList.toggle('wrong',state.attempt.correct<state.attempt.total);
        if(result.dataset.attemptId!==state.attempt.id){
          result.innerHTML=(!state.attempt.transcript?.length?'<p class="notice">Tài liệu nhập chưa có transcript. App không tự tạo lời thoại còn thiếu.</p>':'')+detailsHTML(state.attempt);
          result.dataset.attemptId=state.attempt.id;
        }
      }
      updateAudio(state);
    }
    function updateSummary(){
      if(!current)return;
      const list=states(),total=current.content.units.reduce((n,u)=>n+u.questions.length,0);
      const selected=list.reduce((n,s)=>n+s.unit.questions.filter(q=>Number.isInteger(s.answers[q.id])).length,0);
      const done=list.reduce((n,s)=>n+(s.attempt?.total||0),0),correct=list.reduce((n,s)=>n+(s.attempt?.correct||0),0);
      root.querySelectorAll('[data-set-summary]').forEach(el=>{el.textContent=`Đã chọn ${selected}/${total} · Đã lưu ${done}/${total} · Đúng ${correct}/${done} câu đã chấm`;});
      root.querySelectorAll('[data-submit-set]').forEach(button=>{button.disabled=batch||list.some(s=>s.submitting||s.pending)||!list.every(s=>s.attempt||answered(s)&&s.unit.audio?.ready)||done===total;button.textContent=batch?'Đang lưu cả bộ…':done===total?'Đã nộp cả bộ':`Nộp cả bộ ${total} câu →`;});
      updatePracticeControls();
    }
    function stopState(state){
      state.token++;state.activePlayback=null;state.playing=false;state.openingAudio=false;
      if(state.player){state.player.pause();if(state.player.readyState)state.player.currentTime=0;}
      state.status='Đã dừng. Bấm Phát audio để nghe từ đầu.';updateAudio(state);
    }
    function stop(){for(const state of states())if(state.playing||state.openingAudio)stopState(state);}
    async function ensureRun(state){
      if(state.run)return state.run;
      if(!state.unit.audio?.ready)throw new Error('Bài này chưa có audio hợp lệ.');
      if(!state.pending){
        state.pending=post('/api/runs',{exerciseId:current.content.id,unitId:state.unit.id}).then(value=>{state.run=value;save();return value;}).finally(()=>{state.pending=null;updateState(state);updateSummary();});
        updateSummary();
      }
      return state.pending;
    }
    async function play(state){
      if(batch||state.submitting||!state.unit.audio?.ready)return;
      stopAudio();stop();const token=++state.token;state.openingAudio=true;state.error='';state.status='Đang mở audio…';updateAudio(state);
      try{
        if(!state.attempt)await ensureRun(state);
        if(token!==state.token||root.hidden)return;
        state.player.currentTime=0;state.player.playbackRate=settings.rate;
        state.activePlayback={token,tracking:!state.attempt,counted:false,rate:settings.rate};
        await state.player.play();
      }catch(error){if(token===state.token){state.status='Không phát được audio. Có thể tải file để nghe.';state.error=error.message;state.playing=false;state.activePlayback=null;}}
      finally{if(token===state.token){state.openingAudio=false;updateState(state);}}
    }
    function bindPlayer(state){
      const player=state.player;
      player.addEventListener('playing',()=>{
        const playback=state.activePlayback;if(player!==state.player||!playback||playback.token!==state.token)return;
        state.playing=true;state.openingAudio=false;state.status='Đang phát audio…';
        if(!playback.counted){playback.counted=true;if(playback.tracking){if(state.playback.plays)state.playback.replays++;state.playback.plays++;state.playback.rate=playback.rate;state.playback.voice=state.unit.audio.kind==='user-file'?'Audio cá nhân':`WAV TTS: ${(state.unit.audio.voices||[]).map(shortVoice).join(' / ')}`;save();}}
        updateAudio(state);
      });
      player.addEventListener('ended',()=>{
        const playback=state.activePlayback;if(player!==state.player||!playback||playback.token!==state.token)return;
        if(playback.tracking&&playback.counted){state.playback.completedPlays++;save();}
        state.activePlayback=null;state.playing=false;state.status='Đã nghe xong. Chọn đáp án ở bên dưới.';updateAudio(state);
      });
      player.addEventListener('error',()=>{if(player!==state.player)return;stopState(state);state.status='Không tải được audio. Kiểm tra server hoặc tải file để nghe.';updateAudio(state);});
      for(const event of ['timeupdate','loadedmetadata'])player.addEventListener(event,()=>{if(player===state.player)updateAudio(state);});
    }
    async function submit(state){
      if(state.attempt||state.submitting||!answered(state))return true;
      state.submitting=true;state.error='';stopState(state);updateState(state);updateSummary();
      try{
        const started=await ensureRun(state);
        const attempt=await post('/api/attempts',{runId:started.id,answers:state.unit.questions.map(q=>({questionId:q.id,choice:state.answers[q.id]})),playback:{...state.playback}});
        applyAttempt(state,attempt);save();return true;
      }catch(error){state.error=`Chưa xác nhận lưu: ${error.message} Có thể nộp lại; cùng một lượt không bị ghi trùng.`;return false;}
      finally{state.submitting=false;updateState(state);updateSummary();}
    }
    async function refreshProgress(){try{await loadProgress();}catch(error){notice(`Bài đã lưu; chưa cập nhật được dashboard: ${error.message}`,true);}}
    async function submitAll(){
      if(batch||states().some(s=>s.submitting||s.pending)||!states().every(s=>s.attempt||answered(s)&&s.unit.audio?.ready))return;
      batch=true;stop();states().forEach(updateState);updateSummary();
      try{for(const state of states())if(!state.attempt&&!await submit(state))break;}
      finally{batch=false;states().forEach(updateState);updateSummary();await refreshProgress();}
    }
    function open(content,{fresh=false,seed=null,restored=[]}={}){
      stop();
      let bank=banks.get(content.id);
      if(fresh||!bank||bank.content.version!==content.version){
        bank={content,states:new Map(content.units.map((unit,index)=>[unit.id,{unit,index,run:null,answers:{},playback:emptyPlayback(),attempt:null,pending:null,submitting:false,token:0,playing:false,openingAudio:false,activePlayback:null,player:null,error:'',status:''}]))};
        banks.set(content.id,bank);
      }
      current=bank;
      for(const data of [...restored,...(seed?[seed]:[])]){
        const state=bank.states.get(data.unitId);if(!state)continue;
        state.run=data.run||null;state.answers=data.answers||{};state.playback={...emptyPlayback(),...data.playback};
        if(data.attempt)applyAttempt(state,data.attempt);
      }
      const total=content.units.reduce((n,u)=>n+u.questions.length,0);
      const submitBar=()=>`<div class="set-submit-bar"><p class="small muted" data-set-summary role="status"></p><button type="button" class="button dark" data-submit-set disabled>Nộp cả bộ ${total} câu →</button></div>`;
      root.innerHTML=`<section class="card set-overview"><span class="pill">PART ${content.part} · ${escape(sourceLabel(content.source?.kind))}</span><h2>${escape(content.title)} · ${total} câu</h2><div class="source-info">${sourceHTML(content.source)}</div><p class="small muted">Làm lần lượt từ trên xuống. Mỗi câu/đoạn có audio và lựa chọn riêng; đáp án đúng, lời thoại và giải thích chỉ mở sau khi nộp. Thời gian từng câu/đoạn bắt đầu khi bạn nghe hoặc chọn đáp án.</p><div class="set-rate"><label for="set-rate" class="field-label">Tốc độ phát <output id="set-rate-value" for="set-rate">${settings.rate.toFixed(1)}×</output></label><input id="set-rate" data-set-rate type="range" min="0.6" max="1.2" step="0.1" value="${settings.rate}"></div>${submitBar()}</section><div class="set-list">${states().map(state=>{
        const audio=state.unit.audio,roles=(audio?.roles||[]).map(role=>`${role.speaker}: ${shortVoice(role.voice)}`).join(' · ');
        return `<article class="card set-unit" data-unit-id="${escape(state.unit.id)}" aria-labelledby="set-unit-${state.index}"><div class="card-top"><h3 id="set-unit-${state.index}">${escape(state.unit.title)}</h3><span class="pill">${state.unit.questions.length} CÂU</span></div><p class="small muted" data-unit-note></p><p class="small muted">${escape(state.unit.context||'')}</p><div class="set-audio"><audio class="set-player" preload="none" ${audio?.ready?`src="${escape(audio.url)}"`:''}></audio><p class="small" data-audio-status role="status"></p>${content.part===3&&roles?`<p class="small muted">Giọng TTS · ${escape(roles)}</p>`:''}<div class="set-audio-actions"><button class="button primary" type="button" data-play>▶ Phát audio</button><button class="button subtle" type="button" data-replay disabled>↻ Nghe lại</button><button class="button icon-button" type="button" data-stop disabled aria-label="Dừng phát">■</button>${audio?.ready?`<a class="small muted" href="${escape(audio.url)}" download>Tải audio</a>`:''}</div><div class="set-timeline"><progress max="100" value="0" aria-label="Tiến độ audio ${state.index+1}"></progress><span data-audio-time></span></div><p class="small muted" data-listen-count></p></div><form data-unit-form>${state.unit.questions.map((q,index)=>questionHTML(q,index,content,state.answers,Boolean(state.attempt),content.part===2?state.index+1:undefined)).join('')}<div class="submit-row"><span class="small muted">${content.part===2?'Chọn một hồi đáp.':'Chọn đủ các đáp án cho đoạn nghe.'}</span><button class="button dark" type="submit" data-submit-unit>Nộp và lưu →</button></div></form><p class="small error-text" data-unit-error role="alert"></p><div class="feedback" data-unit-feedback hidden role="status"></div><section class="transcript" data-unit-result hidden aria-label="Lời thoại, đáp án và giải thích"></section></article>`;
      }).join('')}</div><section class="card set-bottom">${submitBar()}</section>`;
      root.hidden=false;
      for(const state of states()){state.player=cardFor(state).querySelector('audio');bindPlayer(state);updateState(state);}
      updateSummary();save();
    }
    async function restore(){
      let draft;try{draft=JSON.parse(sessionStorage.getItem(key));}catch{return false;}
      if(!draft?.active||!draft.exerciseId||!Array.isArray(draft.states))return false;
      const content=await api(`/api/exercises/${encodeURIComponent(draft.exerciseId)}`);
      if(content.version!==draft.version||content.audio?.kind==='external-link')throw new Error('Phiên bản bộ bài đã thay đổi.');
      const restored=await Promise.all(draft.states.map(async data=>{
        if(!content.units.some(u=>u.id===data.unitId))throw new Error('Câu trong bản nháp không còn tồn tại.');
        if(!data.runId)return data;
        const started=await api(`/api/runs/${encodeURIComponent(data.runId)}`);
        if(started.exerciseId!==content.id||started.version!==content.version||started.unitId!==data.unitId)throw new Error('Bản nháp không khớp lượt làm trên server.');
        return {...data,run:started,attempt:started.submittedAttemptId?await api(`/api/attempts/${started.submittedAttemptId}`):null};
      }));
      open(content,{restored});return true;
    }
    root.addEventListener('input',event=>{
      if(!event.target.matches('[data-set-rate]'))return;
      settings.rate=Number(event.target.value);$('set-rate-value').textContent=`${settings.rate.toFixed(1)}×`;$('rate').value=settings.rate;$('rate-value').textContent=`${settings.rate.toFixed(1)}×`;writeLocal(settingsKey,settings);
    });
    root.addEventListener('change',async event=>{
      const input=event.target;if(!input.matches('input[type=radio]'))return;
      const state=current?.states.get(input.closest('[data-unit-id]')?.dataset.unitId);if(!state||state.attempt||state.submitting||batch)return;
      state.answers[input.name.slice('question-'.length)]=Number(input.value);state.error='';save();updateState(state);updateSummary();
      try{await ensureRun(state);}catch(error){state.error=error.message;updateState(state);}
    });
    root.addEventListener('click',event=>{
      if(event.target.closest('[data-submit-set]')){void submitAll();return;}
      const button=event.target.closest('[data-play],[data-replay],[data-stop]');if(!button)return;
      const state=current?.states.get(button.closest('[data-unit-id]').dataset.unitId);if(!state)return;
      if(button.hasAttribute('data-stop'))stopState(state);else void play(state);
    });
    root.addEventListener('submit',async event=>{
      if(!event.target.matches('[data-unit-form]'))return;event.preventDefault();if(batch)return;
      const state=current?.states.get(event.target.closest('[data-unit-id]').dataset.unitId);if(!state)return;
      if(await submit(state))await refreshProgress();
    });
    return {
      open,restore,stop,save,
      get exerciseId(){return current?.content.id;},
      get busy(){return batch||states().some(s=>s.submitting||s.pending);},
      hide(){stop();root.hidden=true;save();},
      show(){root.hidden=false;if($('set-rate')){$('set-rate').value=settings.rate;$('set-rate-value').textContent=`${settings.rate.toFixed(1)}×`;}save();},
      reset(){stop();banks.clear();current=null;root.hidden=true;root.innerHTML='';},
      clearDraft(){try{sessionStorage.removeItem(key);}catch{}}
    };
  }
  async function loadProgress(){
    const progress=await api(`/api/progress?category=${$('progress-source').value}`),o=progress.overall;timezone=progress.timezone||'Asia/Bangkok';
    $('source-counts').textContent=`Đang xem: ${sourceLabel(progress.category)}. Câu gặp lần đầu: chính thức ${progress.bySource.official.firstAnswered} · sách cá nhân ${progress.bySource.user.firstAnswered} · AI/TTS ${progress.bySource.ai.firstAnswered}.`;
    $('first-accuracy').textContent=percent(o.firstAccuracy,o.firstAnswered);$('first-count').textContent=`${o.firstCorrect||0}/${o.firstAnswered||0} câu ở lần đầu`;$('overall-accuracy').textContent=percent(o.accuracy,o.answered);$('overall-count').textContent=`${o.correct||0}/${o.answered||0} lượt trả lời, gồm làm lại`;$('attempt-count').textContent=o.attempts||0;
    $('part-stats').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Part</th><th>Lần đầu</th><th>Tất cả</th></tr></thead><tbody>${progress.byPart.map(p=>`<tr><td>Part ${p.part}</td><td><strong>${percent(p.firstAccuracy,p.firstAnswered)}</strong><small>${p.firstCorrect||0}/${p.firstAnswered||0} câu</small></td><td>${percent(p.accuracy,p.answered)}<small>${p.correct||0}/${p.answered||0} lượt trả lời</small></td></tr>`).join('')}</tbody></table></div>`;
    $('daily-trend').innerHTML=progress.daily.length?`<div class="trend-list">${progress.daily.slice(0,14).reverse().map(d=>`<div class="trend-row"><span>${escape(d.date)}</span><progress max="100" value="${Number(d.firstAccuracy||0)}" aria-label="Lần đầu ngày ${escape(d.date)}"></progress><strong>${percent(d.firstAccuracy,d.firstAnswered)}</strong><small>${d.firstAnswered||0} câu mới · ${d.answered||0} lượt trả lời</small></div>`).join('')}</div><p class="small muted">14 ngày có dữ liệu gần nhất. Thanh là lần đầu; “—” là ngày chỉ làm lại.</p>`:'<p class="empty-history">Chưa có lượt làm. Bắt đầu một câu để tạo mốc đầu tiên.</p>';
    $('review-list').innerHTML=progress.review.length?progress.review.map(item=>`<div class="review-item"><span class="pill">PART ${item.part} · ${escape(item.skill)}</span><p lang="en">${escape(item.prompt)}</p><span class="small ${item.latestCorrect?'correct-text':'error-text'}">${item.wrongCount} lần sai · ${item.latestCorrect?'lượt gần nhất đã đúng':'cần ôn lại'}</span></div>`).join(''):'<p class="small muted">Chưa có câu cần ôn được ghi nhận.</p>';$('limitations').textContent=(progress.limitations||[]).join(' ');
  }
  async function loadHistory(){
    const query=new URLSearchParams({page:String(page),pageSize:'10'});if($('from-date').value)query.set('from',$('from-date').value);if($('to-date').value)query.set('to',$('to-date').value);if($('part-filter').value)query.set('part',$('part-filter').value);
    const result=await api(`/api/attempts?${query}`);pages=result.pages||1;
    $('history-list').innerHTML=result.items.length?result.items.map(item=>`<button class="history-button" type="button" data-attempt-id="${escape(item.id)}"><span><strong>Part ${item.part} · ${escape(item.unitTitle||item.exerciseTitle)}</strong><small>${date(item.submittedAt)} · v${escape(item.version)} · ${item.attemptKind==='first'?'Lần đầu':item.attemptKind==='retry'?'Làm lại':'Kết hợp'} · ${duration(item.durationMs)}</small><small>${item.playback?.plays||0} lượt phát / ${item.playback?.replays||0} nghe lại</small></span><strong>${item.correct}/${item.total} →</strong></button>`).join(''):'<p class="empty-history">Không có lượt làm trong bộ lọc này.</p>';
    $('page-info').textContent=`Trang ${page}/${pages} · ${result.total} lượt`;$('prev-page').disabled=page<=1;$('next-page').disabled=page>=pages;
  }
  function download(format){const link=document.createElement('a');link.href=`/api/report?format=${format}&download=1`;link.download=`listenlab-report.${format==='json'?'json':'md'}`;document.body.append(link);link.click();link.remove();}
  $('auth-form').addEventListener('submit',async event=>{event.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{const result=await post(configured?'/api/auth/login':'/api/auth/setup',{username:$('username').value,password:$('password').value});await enterApp(result.username);}catch(error){$('auth-error').textContent=error.message;}finally{$('auth-submit').disabled=false;}});
  $('logout-btn').addEventListener('click',async()=>{if(starting||submitting||practiceSet.busy)return;try{await post('/api/auth/logout',{});clearDraft();practiceSet.clearDraft();resetPractice();$('app-shell').hidden=true;$('auth-section').hidden=false;configureAuth(true);}catch(error){notice(error.message,true);}});
  $('exercise-select').addEventListener('change',()=>{fillUnits();void openSelectedPractice();});
  $('start-btn').addEventListener('click',()=>{const meta=library.find(item=>item.id===$('exercise-select').value);if(meta?.audio?.kind==='external-link')void startUnit(meta.id,meta.units[0].id);else void openSelectedPractice(true);});
  $('answer-form').addEventListener('change',event=>{if(savedAttempt||submitting||starting)return;const input=event.target;if(input.matches('input[type=radio]')){answers[input.name.slice('question-'.length)]=Number(input.value);$('submit-btn').disabled=!allAnswered();saveDraft();}});
  $('answer-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!run||savedAttempt||submitting||starting||!allAnswered())return;submitting=true;$('submit-btn').disabled=true;$('start-btn').disabled=true;stopAudio();refreshLocks();$('submit-error').textContent='';
    try{if(exercise.audio?.kind==='external-link'){const plays=Number($('external-plays').value);if(!Number.isInteger(plays)||plays<1||plays>10000)throw new Error('Số lượt phát tự báo phải từ 1 đến 10000.');playback={plays,replays:plays-1,completedPlays:0,rate:1,voice:'Nguồn ngoài — số lần do người học tự báo, app không đo'};}applySaved(await post('/api/attempts',{runId:run.id,answers:unit.questions.map(q=>({questionId:q.id,choice:answers[q.id]})),playback}));saveDraft();renderUnit();try{await loadProgress();}catch(error){notice(`Bài đã lưu, nhưng chưa tải lại được dashboard: ${error.message}`,true);}$('feedback').scrollIntoView({behavior:'smooth',block:'nearest'});}
    catch(error){$('submit-error').textContent=`Chưa xác nhận lưu bài: ${error.message} Có thể nộp lại; server không tạo trùng cùng một lượt.`;}
    finally{submitting=false;$('start-btn').disabled=false;refreshLocks();}
  });
  $('next-btn').addEventListener('click',async()=>{if(!savedAttempt||starting||submitting)return;const index=exercise.units.findIndex(item=>item.id===unit.id);if(index===exercise.units.length-1){stopAudio();clearDraft();showView('dashboard');try{await loadProgress();}catch(error){notice(error.message,true);}}else await startUnit(exercise.id,exercise.units[index+1].id);});
  ['dashboard','practice','history'].forEach(name=>$(`${name}-tab`).addEventListener('click',async()=>{showView(name);try{if(name==='practice')await openSelectedPractice();if(name==='dashboard')await loadProgress();if(name==='history'){page=1;await loadHistory();}}catch(error){notice(error.message,true);}}));
  $('go-practice-btn').addEventListener('click',()=>{showView('practice');void openSelectedPractice();});
  $('history-filter').addEventListener('submit',async event=>{event.preventDefault();page=1;try{await loadHistory();}catch(error){notice(error.message,true);}});
  $('prev-page').addEventListener('click',async()=>{if(page>1){page--;try{await loadHistory();}catch(error){notice(error.message,true);}}});$('next-page').addEventListener('click',async()=>{if(page<pages){page++;try{await loadHistory();}catch(error){notice(error.message,true);}}});
  $('history-list').addEventListener('click',async event=>{const button=event.target.closest('[data-attempt-id]');if(!button)return;try{const a=await api(`/api/attempts/${button.dataset.attemptId}`);$('attempt-detail').hidden=false;$('attempt-detail').innerHTML=`<h2>Part ${a.part} · ${escape(a.unitTitle)}</h2><p class="small muted">${date(a.submittedAt)} · phiên bản ${escape(a.version)} · ${duration(a.durationMs)} · đúng ${a.correct}/${a.total}</p>${detailsHTML(a)}`;$('attempt-detail').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){notice(error.message,true);}});
  $('play-btn').addEventListener('click',play);$('replay-btn').addEventListener('click',play);$('stop-btn').addEventListener('click',()=>stopAudio());
  $('rate').value=settings.rate;$('rate-value').textContent=`${settings.rate.toFixed(1)}×`;$('rate').addEventListener('input',()=>{settings.rate=Number($('rate').value);$('rate-value').textContent=`${settings.rate.toFixed(1)}×`;writeLocal(settingsKey,settings);});
  $('download-md').addEventListener('click',()=>download('markdown'));$('download-json').addEventListener('click',()=>download('json'));
  $('external-confirm').addEventListener('change',refreshLocks);
  $('progress-source').addEventListener('change',()=>loadProgress().catch(error=>notice(error.message,true)));
  $('import-form').addEventListener('submit',async event=>{
    event.preventDefault();$('import-submit').disabled=true;$('import-status').textContent='Đang nhập tài liệu riêng tư…';
    try{
      const manifestFile=$('import-manifest').files[0],audioFile=$('import-audio').files[0],documents=Array.from($('import-documents').files);
      if(!manifestFile||!audioFile||audioFile.size>20*1024*1024||documents.length>2||documents.some(file=>file.size>5*1024*1024))throw new Error('Kiểm tra giới hạn audio 20 MB và tối đa hai tài liệu 5 MB.');
      const encode=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,base64:String(reader.result).split(',')[1]});reader.onerror=()=>reject(new Error('Không đọc được file.'));reader.readAsDataURL(file);});
      const created=await post('/api/materials',{manifest:JSON.parse(await manifestFile.text()),audio:await encode(audioFile),documents:await Promise.all(documents.map(encode)),rightsConfirmed:$('import-rights').checked,matchConfirmed:$('import-match').checked});
      library=(await api('/api/exercises')).items;$('exercise-select').innerHTML=library.map(item=>`<option value="${escape(item.id)}">[${sourceLabel(item.source?.kind)}] ${escape(item.title)}</option>`).join('');$('exercise-select').value=created.id;fillUnits();await openSelectedPractice();$('import-status').textContent='Đã lưu audio/đề/key riêng tư và mở toàn bộ bài bên dưới. Nguồn này được thống kê riêng, không tự gắn nhãn chính thức.';
    }catch(error){$('import-status').textContent=`Chưa nhập: ${error.message}`;}finally{$('import-submit').disabled=false;}
  });
  $('copy-report-btn').addEventListener('click',async()=>{try{const report=await api('/api/report?format=markdown');$('report-text').value=report;try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(report);$('copy-status').textContent='Đã sao chép. Dán vào ChatGPT để giáo viên AI nhận xét.';}catch{$('report-details').hidden=false;$('report-details').open=true;$('report-text').focus();$('report-text').select();$('copy-status').textContent='Nội dung đã được chọn. Nhấn Ctrl+C rồi dán vào chat.';}}catch(error){notice(error.message,true);}});
  window.addEventListener('pagehide',()=>{stopAudio();practiceSet.stop();practiceSet.save();if(run)saveDraft();});
  updateAudioButtons();
  if(location.protocol==='file:'){configureAuth(true);$('auth-submit').disabled=true;notice('Bản có backend cần chạy npm start rồi mở http://127.0.0.1:4173. Không mở trực tiếp index.html.',true);return;}
  api('/api/auth/status').then(async status=>{configureAuth(status.configured);if(status.authenticated)await enterApp(status.username);}).catch(error=>notice(`Không kết nối được backend: ${error.message}`,true));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
  } else initializeApp();
})();

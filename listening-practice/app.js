(() => {
  'use strict';
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
      if(response.status===401&&!url.startsWith('/api/auth/')){stopAudio();$('app-shell').hidden=true;$('auth-section').hidden=false;configureAuth(true);}
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
    stopAudio();run=null;unit=null;exercise=null;savedAttempt=null;answers={};playback=emptyPlayback();
    $('exercise').hidden=true;$('practice-empty').hidden=false;$('transcript').hidden=true;$('transcript').innerHTML='';$('answer-fields').innerHTML='';
    $('attempt-detail').hidden=true;$('attempt-detail').innerHTML='';$('history-list').innerHTML='';updateAudioButtons();
  }
  function applySaved(attempt){savedAttempt=attempt;playback={...attempt.playback};answers=Object.fromEntries(attempt.questions.map(q=>[q.questionId,q.selectedChoice]));}
  function refreshLocks(){
    updateAudioButtons();$('submit-btn').disabled=starting||submitting||Boolean(savedAttempt)||!allAnswered();
    document.querySelectorAll('.question-fieldset').forEach(fieldset=>{fieldset.disabled=starting||submitting||Boolean(savedAttempt);});
  }
  async function enterApp(username){
    resetPractice();
    $('auth-section').hidden=true;$('app-shell').hidden=false;$('user-name').textContent=username;$('password').value='';$('auth-error').textContent='';notice('');
    library=(await api('/api/exercises')).items;
    $('exercise-select').innerHTML=library.map(item=>`<option value="${escape(item.id)}">[${sourceLabel(item.source?.kind)}] ${escape(item.title)}</option>`).join('');
    $('exercise-select').value='official-iibc-part3-32-34';
    fillUnits();await loadProgress();showView('dashboard');
    let draft;try{draft=JSON.parse(sessionStorage.getItem(draftKey));}catch{}
    if(draft?.runId&&draft.exerciseId){
      try{
        const restored=await api(`/api/runs/${encodeURIComponent(draft.runId)}`),content=await api(`/api/exercises/${encodeURIComponent(draft.exerciseId)}`);
        const restoredUnit=content.units.find(item=>item.id===restored.unitId);
        if(restored.version!==content.version||!restoredUnit)throw new Error('Phiên bản bài đã thay đổi.');
        exercise=content;unit=restoredUnit;run=restored;answers=draft.answers||{};playback={...emptyPlayback(),...draft.playback};savedAttempt=null;
        $('exercise-select').value=exercise.id;fillUnits();$('unit-select').value=unit.id;
        if(restored.submittedAttemptId)applySaved(await api(`/api/attempts/${restored.submittedAttemptId}`));
        renderUnit();showView('practice');notice(savedAttempt?'Đã khôi phục bài làm đã lưu trên server.':'Đã tiếp tục lượt đang làm. Lịch sử hoàn thành vẫn ở server.');
      }catch{clearDraft();notice('Không khôi phục được lượt đang làm. Có thể bắt đầu lượt mới; lịch sử đã lưu vẫn còn.');}
    }
    const requested=new URLSearchParams(location.search);
    if(!draft?.runId&&(requested.get('part')==='3'||requested.get('source')==='official')){showView('practice');await startUnit('official-iibc-part3-32-34','iibc-32-34');}
  }
  function showView(name){['dashboard','practice','history'].forEach(item=>{$(`${item}-view`).hidden=item!==name;$(`${item}-tab`).classList.toggle('active',item===name);if(item===name)$(`${item}-tab`).setAttribute('aria-current','page');else $(`${item}-tab`).removeAttribute('aria-current');});}
  function fillUnits(){const meta=library.find(item=>item.id===$('exercise-select').value);if(!meta)return;$('unit-select').innerHTML=meta.units.map(item=>`<option value="${escape(item.id)}">${escape(item.title)} · ${item.questionCount} câu</option>`).join('');$('exercise-description').textContent=`${meta.description} Phiên bản ${meta.version}. Mỗi lần nộp câu / đoạn là một lượt lưu riêng.`;}
  function saveDraft(){if(!run)return;try{sessionStorage.setItem(draftKey,JSON.stringify({runId:run.id,exerciseId:exercise.id,answers,playback}));}catch{notice('Không lưu được bản nháp trong trình duyệt. Các bài đã nộp vẫn ở SQLite trên server.');}}
  function clearDraft(){try{sessionStorage.removeItem(draftKey);}catch{}}
  async function startUnit(exerciseId,unitId){
    if(starting||submitting)return;starting=true;$('start-btn').disabled=true;stopAudio();refreshLocks();notice('');
    try{
      const content=await api(`/api/exercises/${encodeURIComponent(exerciseId)}`),selected=content.units.find(item=>item.id===unitId);if(!selected)throw new Error('Không tìm thấy câu / đoạn.');
      const newRun=await post('/api/runs',{exerciseId,unitId});exercise=content;unit=selected;run=newRun;savedAttempt=null;answers={};playback=emptyPlayback();saveDraft();
      $('exercise-select').value=exerciseId;fillUnits();$('unit-select').value=unitId;renderUnit();$('question-heading').focus({preventScroll:true});$('exercise').scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){notice(error.message,true);}finally{starting=false;$('start-btn').disabled=false;refreshLocks();}
  }
  function questionFields(question,index){
    const blind=exercise.part===2||exercise.audio?.kind==='external-link';
    return `<fieldset class="question-fieldset" ${savedAttempt?'disabled':''}><legend>${exercise.audio?.kind==='external-link'?escape(question.prompt):blind?`Câu ${question.number||index+1}: chọn hồi đáp phù hợp`:`${index+1}. ${escape(question.prompt)}`}</legend><div class="${blind?'answer-grid':'text-answer-grid'}">${question.options.map((option,i)=>`<label class="answer-choice ${blind?'':'text-choice'}"><input type="radio" name="question-${escape(question.id)}" value="${i}" ${answers[question.id]===i?'checked':''}><span class="choice-letter">${letters[i]}</span><span class="${blind?'choice-caption':'option-text'}" ${blind?'':'lang="en"'}>${blind?`Lựa chọn ${letters[i]}`:escape(option)}</span></label>`).join('')}</div></fieldset>`;
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
      $('audio-panel').querySelector('.audio-hint').textContent=unit.audio.kind==='user-file'?'Audio gốc cá nhân · Lời thoại/key chỉ hiện sau nộp nếu đã được nhập.':'WAV TTS · Transcript, bản dịch và đáp án mở sau khi nộp.';
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
  $('logout-btn').addEventListener('click',async()=>{if(starting||submitting)return;try{await post('/api/auth/logout',{});clearDraft();resetPractice();$('app-shell').hidden=true;$('auth-section').hidden=false;configureAuth(true);}catch(error){notice(error.message,true);}});
  $('exercise-select').addEventListener('change',fillUnits);$('start-btn').addEventListener('click',()=>startUnit($('exercise-select').value,$('unit-select').value));
  $('answer-form').addEventListener('change',event=>{if(savedAttempt||submitting||starting)return;const input=event.target;if(input.matches('input[type=radio]')){answers[input.name.slice('question-'.length)]=Number(input.value);$('submit-btn').disabled=!allAnswered();saveDraft();}});
  $('answer-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!run||savedAttempt||submitting||starting||!allAnswered())return;submitting=true;$('submit-btn').disabled=true;$('start-btn').disabled=true;stopAudio();refreshLocks();$('submit-error').textContent='';
    try{if(exercise.audio?.kind==='external-link'){const plays=Number($('external-plays').value);if(!Number.isInteger(plays)||plays<1||plays>10000)throw new Error('Số lượt phát tự báo phải từ 1 đến 10000.');playback={plays,replays:plays-1,completedPlays:0,rate:1,voice:'Nguồn ngoài — số lần do người học tự báo, app không đo'};}applySaved(await post('/api/attempts',{runId:run.id,answers:unit.questions.map(q=>({questionId:q.id,choice:answers[q.id]})),playback}));saveDraft();renderUnit();try{await loadProgress();}catch(error){notice(`Bài đã lưu, nhưng chưa tải lại được dashboard: ${error.message}`,true);}$('feedback').scrollIntoView({behavior:'smooth',block:'nearest'});}
    catch(error){$('submit-error').textContent=`Chưa xác nhận lưu bài: ${error.message} Có thể nộp lại; server không tạo trùng cùng một lượt.`;}
    finally{submitting=false;$('start-btn').disabled=false;refreshLocks();}
  });
  $('next-btn').addEventListener('click',async()=>{if(!savedAttempt||starting||submitting)return;const index=exercise.units.findIndex(item=>item.id===unit.id);if(index===exercise.units.length-1){stopAudio();clearDraft();showView('dashboard');try{await loadProgress();}catch(error){notice(error.message,true);}}else await startUnit(exercise.id,exercise.units[index+1].id);});
  ['dashboard','practice','history'].forEach(name=>$(`${name}-tab`).addEventListener('click',async()=>{showView(name);try{if(name==='dashboard')await loadProgress();if(name==='history'){page=1;await loadHistory();}}catch(error){notice(error.message,true);}}));
  $('go-practice-btn').addEventListener('click',()=>showView('practice'));
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
      library=(await api('/api/exercises')).items;$('exercise-select').innerHTML=library.map(item=>`<option value="${escape(item.id)}">[${sourceLabel(item.source?.kind)}] ${escape(item.title)}</option>`).join('');$('exercise-select').value=created.id;fillUnits();$('import-status').textContent='Đã lưu audio/đề/key riêng tư. Bấm Bắt đầu lượt mới. Nguồn này được thống kê riêng, không tự gắn nhãn chính thức.';
    }catch(error){$('import-status').textContent=`Chưa nhập: ${error.message}`;}finally{$('import-submit').disabled=false;}
  });
  $('copy-report-btn').addEventListener('click',async()=>{try{const report=await api('/api/report?format=markdown');$('report-text').value=report;try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(report);$('copy-status').textContent='Đã sao chép. Dán vào ChatGPT để giáo viên AI nhận xét.';}catch{$('report-details').hidden=false;$('report-details').open=true;$('report-text').focus();$('report-text').select();$('copy-status').textContent='Nội dung đã được chọn. Nhấn Ctrl+C rồi dán vào chat.';}}catch(error){notice(error.message,true);}});
  window.addEventListener('pagehide',()=>{stopAudio();if(run)saveDraft();});
  updateAudioButtons();
  if(location.protocol==='file:'){configureAuth(true);$('auth-submit').disabled=true;notice('Bản có backend cần chạy npm start rồi mở http://127.0.0.1:4173. Không mở trực tiếp index.html.',true);return;}
  api('/api/auth/status').then(async status=>{configureAuth(status.configured);if(status.authenticated)await enterApp(status.username);}).catch(error=>notice(`Không kết nối được backend: ${error.message}`,true));
})();

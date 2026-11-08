(() => {
  'use strict';
  window.createListenLabSpeaking=({api,post,onBusyChange=()=>{}})=>{
    const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const key='listenlab-speaking-session-v1',topics={work:'Công việc',client:'Khách hàng',meeting:'Cuộc họp',interview:'Phỏng vấn',daily:'Hằng ngày'};
    let catalog=[],config=null,session=null,phase='answer',mode='response',target=null,transcriptionId=null,busy=false,visible=false,epoch=0,page=1,historyPages=1;
    let recorder=null,stream=null,pendingMic=false,recording=false,recordToken=0,recordTimer=null,recorded=null,recordURL=null,voiceURL=null,voiceKey=null,sttKey=null,reviewKey=null,startKey=null,draftTimer=null,draftPromise=null;
    const clip=$('sp-recording'),voice=$('sp-voice');
    const status=(message,error=false)=>{$('sp-status').textContent=message||'';$('sp-status').classList.toggle('error-text',error);};
    const call=(suffix,data)=>post(`/api/speaking/sessions/${encodeURIComponent(session.id)}/${suffix}`,data);
    const context=()=>({revision:session.revision,mode,targetTurnId:target});
    const lastMain=()=>session?.turns.filter(turn=>turn.kind==='response').at(-1);
    const canRetry=()=>{const main=lastMain();return main&&session.turns.filter(turn=>turn.parentTurnId===main.id).length<2;};
    function controls(){
      const locked=busy||recording||pendingMic;
      $('sp-topic').disabled=locked;$('sp-lesson').disabled=locked;$('sp-start').disabled=locked||!catalog.length;$('sp-reload').disabled=locked;
      $('sp-record').disabled=locked||!session||phase!=='answer'||!window.MediaRecorder;
      $('sp-stop-record').disabled=!recording&&!pendingMic;
      $('sp-transcribe').disabled=locked||!recorded||!config||phase!=='answer';
      $('sp-answer').disabled=locked||!session||phase!=='answer';
      $('sp-review').disabled=locked||!session||phase!=='answer'||!config?.configured||!$('sp-answer').value.trim();
      $('sp-save').disabled=locked||!session||phase!=='answer';
      $('sp-next').disabled=locked||phase!=='feedback'||session?.status!=='active';
      $('sp-retry').disabled=locked||phase!=='feedback'||!canRetry();
      $('sp-finish').disabled=locked||!session||session.status==='completed';
      for(const id of ['sp-listen-question','sp-listen-sample','sp-listen-corrected'])$(id).disabled=locked||!session||!('speechSynthesis' in window)||(id==='sp-listen-corrected'&&!session?.turns.length);
      $('sp-history-prev').disabled=locked||page<=1;$('sp-history-next').disabled=locked||page>=historyPages;
      $('sp-history-list').querySelectorAll('button').forEach(button=>button.disabled=locked);
      onBusyChange();
    }
    function setBusy(value){busy=value;controls();}
    function configView(){
      $('sp-api-status').textContent=config?.configured?`Claude API đã cấu hình (${config.models?.feedback||'Claude'}) · ${config.usedToday}/${config.limits.dailyApiCalls} lượt nhận xét hôm nay · thu tối đa ${config.limits.maxAudioSeconds} giây. Nhận dạng giọng nói chạy trên máy.`:'Chưa cấu hình Claude API (ANTHROPIC_API_KEY). Vẫn thu âm, nhận dạng trên máy, nghe giọng đọc trình duyệt và lưu bản nháp; nhận xét AI cần API.';
      $('sp-api-status').classList.toggle('notice',!config?.configured);
      $('sp-mic-note').textContent=window.MediaRecorder?'Audio chỉ gửi đến OpenAI khi bấm “Chuyển audio thành chữ”. Sau đó sửa transcript trước khi gửi nhận xét. Bản thu không lưu lâu dài.':'Trình duyệt chưa hỗ trợ thu âm. Bạn vẫn có thể luyện bằng ô nhập chữ; hãy thử Chrome hoặc Edge nếu cần micro.';
    }
    function fillLessons(preferred){
      const selected=catalog.filter(lesson=>!$('sp-topic').value||lesson.topic===$('sp-topic').value);
      $('sp-lesson').replaceChildren(...selected.map(lesson=>new Option(lesson.title,lesson.id)));
      if(selected.some(lesson=>lesson.id===preferred))$('sp-lesson').value=preferred;
      previewLesson();controls();
    }
    function previewLesson(){
      const lesson=catalog.find(item=>item.id===$('sp-lesson').value);if(!lesson)return;
      $('sp-lesson-preview').innerHTML=`<span class="pill">${escape(topics[lesson.topic])} · AI biên soạn</span><h3>${escape(lesson.title)}</h3><p lang="en">${escape(lesson.situation)}</p><p class="small"><strong>Mục tiêu:</strong> ${escape(lesson.objective)}</p><div class="sp-vocabulary">${lesson.vocabulary.map(word=>`<span><strong lang="en">${escape(word.phrase)}</strong> · ${escape(word.meaning)}</span>`).join('')}</div><details><summary>Xem câu trả lời mẫu</summary><p lang="en">${escape(lesson.sample)}</p></details><p class="small muted">${escape(lesson.authorship)}</p>`;
    }
    function stopVoice(){voice.pause();if('speechSynthesis' in window)speechSynthesis.cancel();}
    function clearRecording(){
      clip.pause();clip.removeAttribute('src');clip.load();clip.hidden=true;
      if(recordURL)URL.revokeObjectURL(recordURL);recordURL=null;recorded=null;sttKey=null;
    }
    function stopRecord(discard=false){
      if(pendingMic){recordToken++;pendingMic=false;}
      if(discard)recordToken++;
      clearInterval(recordTimer);recordTimer=null;
      if(recorder&&recorder.state!=='inactive')recorder.stop();
      stream?.getTracks().forEach(track=>track.stop());stream=null;recording=false;controls();
    }
    function clearAnswer(){stopRecord(true);clearRecording();stopVoice();voice.hidden=true;voiceKey=null;transcriptionId=null;reviewKey=null;$('sp-answer').value='';$('sp-draft-status').textContent='';$('sp-record-time').textContent='Chưa thu âm';}
    function summaryView(){
      const summary=session?.summary;$('sp-summary').hidden=!summary;if(!summary)return;
      const labels={grammar:'Ngữ pháp',vocabulary:'Từ vựng',content:'Nội dung'};
      $('sp-summary').innerHTML=`<span class="pill">Tổng kết từ dữ liệu đã lưu</span><h3>${summary.mainTurns}/5 lượt chính · ${summary.retries} lần luyện lại</h3>${summary.mainTurns===0?'<p class="small">Chưa có lượt nhận xét AI; bài và bản nháp được lưu để bạn xem lại.</p>':''}<p class="small">Thời gian từ khi mở bài: ${Math.ceil(summary.elapsedSeconds/60)} phút, có thể gồm lúc nghỉ.</p>${summary.strengths.map(text=>`<p class="small">${escape(text)}</p>`).join('')}<p class="small"><strong>Cần ôn:</strong> ${summary.focus.length?summary.focus.map(item=>`${labels[item.category]} (${item.count} lần được nhắc)`).join(' · '):'Chưa ghi nhận lỗi nổi bật.'}</p><div class="sp-vocabulary">${summary.reviewWords.map(word=>`<span><strong lang="en">${escape(word.phrase)}</strong> · ${escape(word.meaning)}</span>`).join('')}</div><p class="small">${escape(summary.nextStep)}</p><p class="small muted">${escape(summary.limitation)}</p>`;
    }
    function renderSession(){
      $('sp-work').hidden=!session;if(!session){controls();return;}
      $('sp-session-title').textContent=session.lesson.title;
      $('sp-turn-progress').max=5;$('sp-turn-progress').value=session.mainCount;
      $('sp-turn-label').textContent=`${session.mainCount}/5 lượt chính · ${session.turns.filter(turn=>turn.kind==='retry').length} lần luyện lại`;
      const previous=session.turns.at(-1),parent=lastMain();
      $('sp-question').textContent=phase==='feedback'?previous?.question||session.lesson.opening:mode==='retry'?parent.question:session.currentQuestion||session.lesson.opening;
      $('sp-session-goal').textContent=session.lesson.objective;
      $('sp-sample').textContent=session.lesson.sample;
      $('sp-criteria').replaceChildren(...session.lesson.criteria.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
      $('sp-retry-hint').hidden=mode!=='retry'||phase!=='answer';$('sp-retry-hint').textContent=mode==='retry'?`Nói lại theo ý của bạn. Câu đã sửa: ${previous?.feedback.corrected||parent?.feedback.corrected||''}`:'';
      $('sp-feedback').hidden=phase!=='feedback'||!previous;
      if(previous&&phase==='feedback'){
        const feedback=previous.feedback;
        $('sp-feedback').innerHTML=`<h3>Nhận xét câu vừa trả lời</h3><p class="small muted">${previous.kind==='retry'?'Luyện lại câu đã sửa':'Lượt chính'} · Chỉ nhận xét từ transcript</p><p class="small"><strong>Bạn đã nói${previous.inputType==='text'?' / nhập':''}:</strong></p><blockquote lang="en">${escape(previous.transcript)}</blockquote>${previous.recognizedTranscript&&previous.recognizedTranscript!==previous.transcript?`<details><summary>Transcript nhận dạng trước khi sửa</summary><p lang="en">${escape(previous.recognizedTranscript)}</p></details>`:''}<p class="small"><strong>Câu sửa, giữ ý ban đầu:</strong></p><blockquote lang="en" class="sp-corrected">${escape(feedback.corrected)}</blockquote>${feedback.issues.length?`<ol class="sp-issues">${feedback.issues.map(issue=>`<li><p lang="en"><del>${escape(issue.original)}</del> → <strong>${escape(issue.replacement||'(lược bỏ)')}</strong></p><p class="small">${escape(issue.explanation)}</p></li>`).join('')}</ol>`:'<p class="small correct-text">Không có lỗi nổi bật cần sửa trong câu này.</p>'}<p class="small"><strong>Cách diễn đạt tự nhiên:</strong></p><p lang="en">${escape(feedback.natural)}</p><p class="small">${escape(feedback.encouragement)}</p><div class="sp-vocabulary">${feedback.reviewWords.map(word=>`<span><strong lang="en">${escape(word.phrase)}</strong> · ${escape(word.meaning)}</span>`).join('')}</div>${session.status==='active'?`<p class="small"><strong>Câu hỏi tiếp theo:</strong></p><p lang="en">${escape(session.currentQuestion)}</p>`:''}`;
      }
      $('sp-answer-panel').hidden=session.status==='completed'&&phase!=='answer';
      $('sp-turn-history').hidden=!session.turns.length;
      $('sp-turn-history').innerHTML=`<summary>Xem ${session.turns.length} lượt trả lời đã lưu</summary><div class="sp-turn-log">${session.turns.map(turn=>`<article data-sp-turn="${escape(turn.id)}"><h3>Lượt ${turn.mainNumber} · ${turn.kind==='retry'?'Luyện lại':'Trả lời chính'}</h3><p lang="en"><strong>${escape(turn.question)}</strong></p><p class="small">Bạn đã nói / nhập:</p><p lang="en">${escape(turn.transcript)}</p><p class="small">Câu đã sửa:</p><p lang="en" class="correct-text">${escape(turn.feedback.corrected)}</p>${turn.feedback.issues.map(issue=>`<p class="small">${escape(issue.explanation)}</p>`).join('')}<p class="small">Diễn đạt tự nhiên:</p><p lang="en">${escape(turn.feedback.natural)}</p></article>`).join('')}</div>`;
      $('sp-finish').hidden=session.status==='completed';$('sp-next').hidden=session.status==='completed';$('sp-retry').hidden=!parent;
      summaryView();
      if(session.summary&&session.draft?.transcript){const details=document.createElement('details'),title=document.createElement('summary'),paragraph=document.createElement('p');title.textContent='Bản nháp chưa gửi nhận xét';paragraph.textContent=session.draft.transcript;paragraph.lang='en';details.append(title,paragraph);$('sp-summary').append(details);}
      controls();
    }
    function applySession(next){
      session=next;try{sessionStorage.setItem(key,next.id);}catch{}
      phase=next.draft&&next.draft.revision===next.revision?'answer':next.turns.length?'feedback':'answer';
      mode=next.draft?.mode||'response';target=next.draft?.targetTurnId||null;transcriptionId=next.draft?.transcriptionId||null;
      $('sp-answer').value=next.draft?.transcript||'';reviewKey=null;clearRecording();renderSession();
      const selected=catalog.find(item=>item.id===next.lesson.id);if(selected){$('sp-topic').value=selected.topic;fillLessons(selected.id);}
    }
    async function refreshProgress(){
      const mine=epoch;const [progress,history]=await Promise.all([api('/api/speaking/progress'),api(`/api/speaking/sessions?page=${page}`)]);if(mine!==epoch)return;
      $('sp-progress').innerHTML=`<div><strong>${progress.completed}</strong><span>Bài đã kết thúc</span></div><div><strong>${progress.mainTurns}</strong><span>Lượt nhận xét chính</span></div><div><strong>${progress.retries}</strong><span>Lần luyện lại</span></div>`;
      $('sp-words').innerHTML=progress.reviewWords.length?progress.reviewWords.map(word=>`<span><strong lang="en">${escape(word.phrase)}</strong> · ${escape(word.meaning)}</span>`).join(''):'<p class="small muted">Từ cần ôn sẽ xuất hiện sau khi có nhận xét AI.</p>';
      historyPages=history.pages;$('sp-history-page').textContent=`Trang ${history.page}/${history.pages} · ${history.total} bài đã mở`;
      $('sp-history-list').innerHTML=history.items.length?history.items.map(item=>`<button class="history-button" type="button" data-sp-session="${escape(item.id)}"><span><strong>${escape(item.lessonTitle)}</strong><small>${new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(item.createdAt))} · ${item.status==='completed'?'Đã kết thúc':'Đang luyện'}</small></span><strong>${item.turnCount}/5 →</strong></button>`).join(''):'<p class="small muted">Chưa có lịch sử Speaking.</p>';controls();
    }
    async function refreshStatus(){config=await api('/api/speaking/status');configView();controls();}
    async function open(){
      visible=true;if(busy||recording||pendingMic)return;const mine=epoch;setBusy(true);status('Đang tải bài luyện nói…');
      try{
        const [data,nextConfig]=await Promise.all([api('/api/speaking/lessons'),api('/api/speaking/status')]);if(mine!==epoch)return;catalog=data.lessons;config=nextConfig;configView();fillLessons(session?.lesson.id);
        if(!session){let id;try{id=sessionStorage.getItem(key);}catch{}if(id){try{applySession(await api(`/api/speaking/sessions/${encodeURIComponent(id)}`));}catch(error){if(error.status===404){try{sessionStorage.removeItem(key);}catch{}}else throw error;}}}
        await refreshProgress();if(mine===epoch)status(config.configured?'Chọn bài và bắt đầu bằng 1–3 câu ngắn.':'Chọn bài để luyện. Nhận xét AI cần cấu hình Claude API.');
      }catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}
    }
    async function saveDraft(quiet=false){
      clearTimeout(draftTimer);draftTimer=null;if(!session||phase!=='answer')return;
      const id=session.id,data={...context(),transcript:$('sp-answer').value,transcriptionId};
      const current=JSON.stringify({id,...data});if(draftPromise?.key===current)return draftPromise.promise;
      const mine=epoch,promise=post(`/api/speaking/sessions/${encodeURIComponent(id)}/draft`,data).then(()=>{if(mine===epoch&&session?.id===id)$('sp-draft-status').textContent='Đã lưu bản nháp trên máy chủ.';}).catch(error=>{if(mine===epoch&&!quiet)status(`Chưa lưu bản nháp: ${error.message}`,true);throw error;});
      draftPromise={key:current,promise};try{await promise;}finally{if(draftPromise?.promise===promise)draftPromise=null;}
    }
    async function start(){
      if(busy||recording||pendingMic)return;const mine=++epoch;setBusy(true);status('Đang mở bài…');
      try{if(session&&phase==='answer')await saveDraft();clearAnswer();const lessonId=$('sp-lesson').value;if(!startKey||startKey.lessonId!==lessonId)startKey={lessonId,id:crypto.randomUUID()};const next=await post('/api/speaking/sessions',{lessonId,requestId:startKey.id});if(mine!==epoch)return;startKey=null;applySession(next);await refreshProgress();status('Trả lời ngắn bằng tiếng Anh. Có thể thu âm hoặc nhập chữ.');$('sp-work').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}
    }
    async function record(){
      if(busy||recording||pendingMic||!session||phase!=='answer')return;
      if(!navigator.mediaDevices?.getUserMedia){status('Micro cần Chrome/Edge và địa chỉ localhost hoặc HTTPS. Bạn có thể nhập câu trả lời bên dưới.',true);return;}
      stopVoice();clearRecording();const token=++recordToken;pendingMic=true;controls();status('Đang xin quyền micro…');
      try{
        const captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
        if(token!==recordToken||!visible){captured.getTracks().forEach(track=>track.stop());return;}
        stream=captured;pendingMic=false;
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));
        recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});const chunks=[];let bytes=0;const began=performance.now(),max=config?.limits.maxAudioSeconds||60;
        recorder.addEventListener('dataavailable',event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>2*1024*1024){stopRecord(true);status('Bản thu vượt 2 MB. Hãy thu lại một câu ngắn hơn.',true);}}});
        recorder.addEventListener('stop',()=>{
          if(token!==recordToken)return;recording=false;clearInterval(recordTimer);recordTimer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;$('sp-record-time').textContent=`Đã thu ${Math.round((performance.now()-began)/1000)} giây`;
          if(chunks.length&&bytes<=2*1024*1024){recorded=new Blob(chunks,{type:recorder.mimeType||mime||'audio/webm'});recordURL=URL.createObjectURL(recorded);clip.src=recordURL;clip.hidden=false;sttKey=crypto.randomUUID();status('Đã dừng thu. Nghe lại rồi bấm “Chuyển audio thành chữ” nếu muốn gửi đến OpenAI.');}else status('Bản thu trống hoặc quá lớn. Hãy thu lại một câu ngắn.',true);controls();
        });
        recorder.addEventListener('error',()=>{stopRecord(true);status('Micro bị ngắt hoặc không ghi được audio. Thu lại hoặc dùng ô nhập chữ.',true);});
        transcriptionId=null;reviewKey=null;$('sp-answer').value='';recorder.start(250);recording=true;recordTimer=setInterval(()=>{const seconds=Math.floor((performance.now()-began)/1000);$('sp-record-time').textContent=`● Đang thu ${seconds}/${max} giây`;if(seconds>=max)stopRecord();},200);status('Đang thu. Bấm Dừng khi nói xong; chưa gửi audio đến OpenAI.');controls();
      }catch(error){if(token!==recordToken)return;pendingMic=false;stream?.getTracks().forEach(track=>track.stop());stream=null;const messages={NotAllowedError:'Bạn chưa cấp quyền micro. Bật quyền micro cho trang hoặc dùng ô nhập chữ.',NotFoundError:'Không tìm thấy micro. Kết nối micro hoặc dùng ô nhập chữ.',NotReadableError:'Micro đang bị ứng dụng khác giữ. Đóng ứng dụng đó rồi thử lại.'};status(messages[error.name]||'Không mở được micro. Hãy thử lại hoặc nhập chữ.',true);controls();}
    }
    const base64=bytes=>{const blocks=[];for(let i=0;i<bytes.length;i+=32768)blocks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(blocks.join(''));};
    async function wav(blob){
      const Audio=window.AudioContext||window.webkitAudioContext,Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!Audio||!Offline)throw new Error('Trình duyệt chưa hỗ trợ chuyển audio. Dùng Chrome/Edge hoặc nhập chữ.');const audio=new Audio();
      try{
        let decoded;try{decoded=await audio.decodeAudioData(await blob.arrayBuffer());}catch{throw new Error('Không đọc được bản thu. Hãy thu lại hoặc nhập chữ.');}
        const maximum=config?.limits.maxAudioSeconds||60;
        if(decoded.duration<.4||decoded.duration>maximum+2)throw new Error('Bản thu quá ngắn hoặc vượt thời lượng. Hãy thu lại.');
        const offline=new Offline(1,Math.min(Math.ceil(decoded.duration*16000),maximum*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const rendered=await offline.startRendering(),samples=rendered.getChannelData(0);let power=0;for(const sample of samples)power+=sample*sample;if(Math.sqrt(power/samples.length)<.0015)throw new Error('Bản thu im lặng hoặc quá nhỏ. Kiểm tra micro và thu lại.');
        const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer),write=(offset,text)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);};write(0,'RIFF');view.setUint32(4,bytes.length-8,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);return base64(bytes);
      }finally{await audio.close().catch(()=>{});}
    }
    async function transcribe(){
      if(busy||!recorded||!session)return;const mine=epoch;setBusy(true);status('Đang chuyển audio thành chữ qua OpenAI…');clip.pause();
      try{const result=await call('transcriptions',{...context(),requestId:sttKey||(sttKey=crypto.randomUUID()),wavBase64:await wav(recorded)});if(mine!==epoch)return;transcriptionId=result.transcriptionId;reviewKey=null;$('sp-answer').value=result.transcript;await saveDraft();await refreshStatus();status('Đã nhận dạng. Sửa từ/ngữ bị nghe nhầm, rồi bấm “Gửi nhận xét”.');}
      catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}
    }
    async function review(){
      if(busy||!session||phase!=='answer')return;const mine=epoch,text=$('sp-answer').value.trim();if(!text){status('Hãy nói hoặc nhập một câu trước khi gửi.',true);return;}setBusy(true);status('Đang nhận xét ngữ pháp, từ vựng và nội dung…');clip.pause();stopVoice();
      try{
        await saveDraft();if(!reviewKey||reviewKey.text!==text)reviewKey={text,id:crypto.randomUUID()};const next=await call('turns',{...context(),requestId:reviewKey.id,transcript:text,transcriptionId});if(mine!==epoch)return;session=next;phase='feedback';reviewKey=null;transcriptionId=null;clearRecording();renderSession();await Promise.all([refreshProgress(),refreshStatus()]);status(next.status==='completed'?'Đã hoàn tất bài và lưu tổng kết. Có thể luyện lại câu cuối.':'Đã lưu nhận xét. Luyện lại câu vừa sửa hoặc sang câu hỏi tiếp theo.');$('sp-feedback').scrollIntoView({behavior:'smooth',block:'start'});
      }catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}
    }
    function nextQuestion(retry=false){
      if(busy||!session||phase!=='feedback')return;if(retry&&!canRetry())return;if(!retry&&session.status!=='active')return;
      clearAnswer();mode=retry?'retry':'response';target=retry?lastMain().id:null;phase='answer';renderSession();status(retry?'Thu lại hoặc nhập lại câu theo cách đã sửa. Lượt này được lưu là luyện lại.':'Trả lời câu hỏi tiếp theo bằng 1–3 câu ngắn.');$('sp-question').focus({preventScroll:true});
    }
    async function listen(kind){
      if(busy||!session||!('speechSynthesis' in window))return;const turn=session.turns.at(-1),text=kind==='question'?$('sp-question').textContent:kind==='sample'?session.lesson.sample:turn?.feedback[kind];
      if(!text){status('Chưa có câu để đọc.',true);return;}
      clip.pause();stopVoice();speechSynthesis.cancel();
      const utterance=new SpeechSynthesisUtterance(text),voices=speechSynthesis.getVoices().filter(v=>/^en[-_]/i.test(v.lang));
      utterance.lang='en-US';utterance.rate=.92;utterance.voice=voices.find(v=>/en[-_]US/i.test(v.lang)&&/natural|online/i.test(v.name))||voices.find(v=>/en[-_]US/i.test(v.lang))||voices[0]||null;
      utterance.onerror=event=>{if(event.error!=='canceled'&&event.error!=='interrupted')status('Trình duyệt không phát được giọng đọc. Kiểm tra giọng tiếng Anh trong hệ điều hành.',true);};
      speechSynthesis.speak(utterance);status('Đang đọc bằng giọng máy của trình duyệt (không phải AI tạo audio).');
    }
    async function finish(){
      if(busy||recording||pendingMic||!session||session.status==='completed')return;const mine=epoch;setBusy(true);
      try{if(phase==='answer')await saveDraft();const next=await call('finish',{revision:session.revision});if(mine!==epoch)return;session=next;phase='feedback';clearRecording();renderSession();await refreshProgress();status('Đã kết thúc và lưu lịch sử. Tổng kết không quy đổi thành điểm thi.');}catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}
    }
    $('sp-topic').addEventListener('change',()=>fillLessons());$('sp-lesson').addEventListener('change',()=>{startKey=null;previewLesson();});$('sp-start').addEventListener('click',()=>void start());
    $('sp-record').addEventListener('click',()=>void record());$('sp-stop-record').addEventListener('click',()=>stopRecord());$('sp-transcribe').addEventListener('click',()=>void transcribe());$('sp-review').addEventListener('click',()=>void review());
    $('sp-save').addEventListener('click',()=>void saveDraft().catch(()=>{}));$('sp-next').addEventListener('click',()=>nextQuestion());$('sp-retry').addEventListener('click',()=>nextQuestion(true));$('sp-finish').addEventListener('click',()=>void finish());
    $('sp-listen-question').addEventListener('click',()=>void listen('question'));$('sp-listen-sample').addEventListener('click',()=>void listen('sample'));$('sp-listen-corrected').addEventListener('click',()=>void listen('corrected'));
    $('sp-answer').addEventListener('input',()=>{reviewKey=null;controls();clearTimeout(draftTimer);draftTimer=setTimeout(()=>{void saveDraft(true).catch(()=>{});},800);});
    $('sp-history-list').addEventListener('click',async event=>{const button=event.target.closest('[data-sp-session]');if(!button||busy||recording||pendingMic)return;const mine=++epoch;setBusy(true);try{await saveDraft();clearAnswer();applySession(await api(`/api/speaking/sessions/${button.dataset.spSession}`));if(mine===epoch){status('Đã mở bài đã lưu. Bản nháp và nhận xét lấy từ SQLite.');$('sp-work').scrollIntoView({behavior:'smooth',block:'start'});}}catch(error){if(mine===epoch)status(error.message,true);}finally{if(mine===epoch)setBusy(false);}});
    for(const [id,delta]of [['sp-history-prev',-1],['sp-history-next',1]])$(id).addEventListener('click',async()=>{if(busy)return;page+=delta;try{await refreshProgress();}catch(error){status(error.message,true);}});
    $('sp-reload').addEventListener('click',async()=>{if(busy||recording||pendingMic)return;try{await saveDraft();if(session){const id=session.id;clearAnswer();applySession(await api(`/api/speaking/sessions/${id}`));}await open();}catch(error){status(error.message,true);}});
    clip.addEventListener('play',stopVoice);voice.addEventListener('play',()=>clip.pause());
    clip.addEventListener('error',()=>{if(clip.getAttribute('src'))status('Không phát được bản thu. Hãy thu lại hoặc nhập chữ.',true);});
    voice.addEventListener('error',()=>{if(voice.getAttribute('src'))status('Không phát được giọng đọc. Hãy bấm nghe để thử lại.',true);});
    function pause(){visible=false;stopVoice();clip.pause();if(recording||pendingMic)stopRecord();if(session&&phase==='answer')void saveDraft(true).catch(()=>{});}
    window.addEventListener('pagehide',()=>{stopRecord(true);stopVoice();clip.pause();});
    return {open,pause,get busy(){return busy||recording||pendingMic;},reset({forget=false}={}){epoch++;busy=false;visible=false;clearTimeout(draftTimer);draftTimer=null;stopRecord(true);clearRecording();stopVoice();voice.removeAttribute('src');voice.load();voice.hidden=true;if(voiceURL)URL.revokeObjectURL(voiceURL);voiceURL=null;voiceKey=null;session=null;config=null;catalog=[];phase='answer';mode='response';target=null;transcriptionId=null;startKey=null;reviewKey=null;$('sp-answer').value='';$('sp-work').hidden=true;$('sp-summary').hidden=true;$('sp-feedback').innerHTML='';$('sp-lesson-preview').innerHTML='';$('sp-history-list').innerHTML='';$('sp-words').innerHTML='';$('sp-progress').innerHTML='';status('');if(forget)try{sessionStorage.removeItem(key);}catch{}controls();}};
  };
})();

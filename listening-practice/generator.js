(() => {
  'use strict';
  window.createListenLabGenerator = ({api,post,onUse,onBusyChange=()=>{}}) => {
    const $=id=>document.getElementById(id),panel=$('generator-panel'),form=$('generator-form');
    let busy=false,refreshing=false,epoch=0,result=null,files=null,checkedJSON=null,stale=false;
    const selectedModel=()=>$('generator-model').value;
    function status(message,error=false){$('generator-status').textContent=message||'';$('generator-status').classList.toggle('error-text',error);}
    function controls(){
      const unsupported=$('generator-part').value==='2'&&$('generator-mode').value==='compose';
      $('generator-fields').disabled=busy;
      $('generator-generate').disabled=busy||unsupported;
      $('generator-refresh-models').disabled=busy||refreshing;
      $('generator-edit').disabled=busy;
      $('generator-check').disabled=busy||!result;
      $('generator-download').disabled=busy||!result;
      $('generator-use').disabled=busy||stale||!result?.ready||checkedJSON!==$('generator-edit').value;
      $('generator-generate').textContent=busy?'Đang xử lý…':selectedModel()?'Tạo JSON bằng AI':'Tạo JSON trên máy';
      $('generator-use').textContent=files?.audioFile?'Dùng JSON này để nhập bài →':'Chuyển JSON sang nhập bài →';
    }
    function setBusy(value){busy=value;controls();onBusyChange();}
    function updateMode(){
      const compose=$('generator-mode').value==='compose';
      const general=$('generator-part').value==='general-listening';
      $('generator-count-field').hidden=!compose||!general;
      $('generator-count').disabled=!general;
      if(!general)$('generator-count').value=$('generator-part').value==='2'?'1':'3';
      $('generator-mode-hint').textContent=compose&&$('generator-part').value==='2'?'Part 2 cần audio có câu hỏi và ba hồi đáp A/B/C thật sự được đọc. Hãy chọn “Trích câu hỏi và key có trong nguồn”; công cụ không soạn lựa chọn không có trong audio.':compose?'AI soạn câu hỏi và đáp án mới cho nghe tổng quát hoặc Part 3/4 từ nội dung nghe. Bài được ghi nhãn AI, thống kê riêng; cần chọn mô hình đã kết nối.':'Chỉ lấy câu hỏi và key có trong nguồn. Phần thiếu giữ trống để bổ sung, không tự đoán đáp án gốc. Transcript nhận dạng từ audio luôn cần đối chiếu.';
      controls();
    }
    function renderReview(){
      const issues=result?.issues||[],warnings=result?.warnings||[],root=$('generator-review');root.replaceChildren();
      $('generator-readiness').textContent=result?.ready&&!stale?'Đủ cấu trúc để chuyển sang nhập bài · vẫn cần đối chiếu nguồn':stale?'Đã đổi đầu vào · cần tạo JSON mới':'Bản nháp · cần bổ sung trước khi nhập bài';
      $('generator-readiness').classList.toggle('error-text',stale||!result?.ready);
      for(const [title,items] of [['Cần bổ sung',issues],['Lưu ý',warnings]]){
        if(!items.length)continue;
        const heading=document.createElement('p');heading.className='small';heading.textContent=title;root.append(heading);
        const list=document.createElement('ul');list.className='small muted';
        for(const message of items){const item=document.createElement('li');item.textContent=String(message);list.append(item);}
        root.append(list);
      }
      const methods={'local-parser':'Đọc PDF/văn bản trên máy','local-asr+local-parser':'Nhận dạng audio và đọc tài liệu trên máy','local-pdf+chatgpt':'Đọc tài liệu trên máy; AI hỗ trợ tạo JSON','local-asr+chatgpt':'Nhận dạng audio trên máy; AI hỗ trợ tạo JSON','local-pdf+claude':'Đọc tài liệu trên máy; Claude hỗ trợ tạo JSON','local-asr+claude':'Nhận dạng audio trên máy; Claude hỗ trợ tạo JSON'};
      $('generator-method').textContent=result?.method?`Cách xử lý: ${methods[result.method]||'Xem thông tin nguồn trong JSON'}`:'';
      $('generator-extracted').textContent=result?.extractedText||'';
      $('generator-extracted-panel').hidden=!result?.extractedText;
      controls();
    }
    function invalidate(){
      if(busy||!result)return;stale=true;checkedJSON=null;renderReview();
      status('Đầu vào đã thay đổi. Bấm Tạo JSON để cập nhật; bản nháp cũ vẫn ở dưới để bạn sao chép hoặc tải xuống.');
    }
    async function refreshModels(){
      const select=$('generator-model'),previous=select.value;
      select.replaceChildren(new Option('Tự trích trên máy (không dùng AI)',''));
      try{
        const [status,models]=await Promise.all([api('/api/tutor/status'),api('/api/tutor/models')]);
        for(const model of models.items||[])select.add(new Option(model.label||model.id,model.id));
        if([...select.options].some(option=>option.value===previous))select.value=previous;
        $('generator-model-status').textContent=status.supported?'Chọn mô hình Claude để AI hỗ trợ trích hoặc soạn câu hỏi. Nội dung tài liệu được gửi tới Claude API.':status.message;
      }catch(error){$('generator-model-status').textContent=error.message;}
      select.disabled=busy;$('generator-refresh-models').hidden=false;
    }
    const base64=buffer=>{
      const bytes=new Uint8Array(buffer),chunks=[];
      for(let offset=0;offset<bytes.length;offset+=32768)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));
      return btoa(chunks.join(''));
    };
    async function encode(file){return {name:file.name,base64:base64(await file.arrayBuffer())};}
    async function pcm(file){
      const Audio=window.AudioContext||window.webkitAudioContext,Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
      if(!Audio||!Offline)throw new Error('Trình duyệt chưa hỗ trợ đọc audio. Hãy dùng Chrome/Edge mới hoặc đưa transcript trong file TXT.');
      const context=new Audio();
      try{
        let decoded;try{decoded=await context.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('Không giải mã được audio. Hãy thử file MP3 hoặc WAV phát được trên trình duyệt.');}
        if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>300)throw new Error('Công cụ nhận dạng hỗ trợ audio tối đa 5 phút. Hãy cắt đúng đoạn bài nghe trước khi đưa vào.');
        const offline=new Offline(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();
        source.buffer=decoded;source.connect(offline.destination);source.start();
        const rendered=await offline.startRendering();
        return {base64:base64(rendered.getChannelData(0).buffer),sampleRate:16000};
      }finally{await context.close().catch(()=>{});}
    }
    async function validate(){
      if(busy||!result)return;
      if(stale){status('Bạn đã đổi đầu vào. Hãy tạo JSON mới trước khi chuyển sang nhập bài.',true);return;}
      const text=$('generator-edit').value;let manifest;
      try{manifest=JSON.parse(text);}catch{status('JSON chưa hợp lệ. Kiểm tra dấu phẩy, ngoặc và dấu nháy trong bản nháp.',true);return;}
      const mine=epoch;setBusy(true);status('Đang kiểm tra cấu trúc JSON…');
      try{
        const checked=await post('/api/material-drafts/validate',{manifest});if(mine!==epoch)return;
        result={...result,...checked,manifest};checkedJSON=text;renderReview();
        status(checked.ready?'Cấu trúc hợp lệ. Đối chiếu nội dung với nguồn trước khi nhập bài.':'Đã kiểm tra. Bổ sung các mục còn thiếu được liệt kê bên dưới.',!checked.ready);
      }catch(error){if(mine===epoch)status(`Chưa kiểm tra được: ${error.message}`,true);}
      finally{if(mine===epoch)setBusy(false);}
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const audioFile=$('generator-audio').files[0]||null,documents=Array.from($('generator-documents').files);
      if(!audioFile&&!documents.length){status('Chọn ít nhất một file audio, PDF hoặc TXT.',true);return;}
      if(audioFile?.size>20*1024*1024||documents.length>2||documents.some(file=>file.size>5*1024*1024)){status('Audio tối đa 20 MB; tài liệu tối đa 2 file, mỗi file 5 MB.',true);return;}
      if(!$('generator-rights').checked){status('Cần xác nhận quyền xử lý các tài liệu đã chọn.',true);return;}
      if($('generator-mode').value==='compose'&&!selectedModel()){status('Chế độ soạn câu hỏi mới cần mô hình AI. Kết nối trong Gia sư AI rồi cập nhật và chọn mô hình.',true);return;}
      const mine=epoch;setBusy(true);status(audioFile?'Đang đọc audio trên máy… Lần đầu nhận dạng có thể cần tải mô hình và chờ vài phút.':'Đang đọc tài liệu…');
      try{
        const input={audio:audioFile?await encode(audioFile):undefined,documents:await Promise.all(documents.map(encode)),pcm:audioFile?await pcm(audioFile):undefined,
          part:$('generator-part').value==='general-listening'?'general-listening':Number($('generator-part').value),mode:$('generator-mode').value,
          questionCount:Number($('generator-count').value),title:$('generator-title').value.trim(),model:selectedModel(),rightsConfirmed:true,
          source:{name:$('generator-source').value.trim(),book:$('generator-book').value.trim(),test:$('generator-test').value.trim(),url:$('generator-url').value.trim(),answerLocation:$('generator-answer-location').value.trim(),materialType:'user-owned-material'}};
        if(mine!==epoch)return;
        status(input.model?'Đang tạo bản nháp với mô hình đã chọn…':'Đang trích nội dung trên máy… Lần đầu nhận dạng audio có thể cần chờ tải mô hình.');
        const response=await post('/api/material-drafts',input);if(mine!==epoch)return;
        if(!response.manifest||typeof response.manifest!=='object')throw new Error('Server chưa trả về bản nháp JSON.');
        result=response;files={audioFile,documents};stale=false;
        $('generator-edit').value=JSON.stringify(result.manifest,null,2);checkedJSON=$('generator-edit').value;
        $('generator-result').hidden=false;renderReview();
        status(result.ready?'Đã tạo JSON. Kiểm tra câu hỏi, key và transcript rồi dùng nút chuyển sang nhập bài.':'Đã tạo bản nháp JSON. Cần bổ sung các mục được liệt kê trước khi nhập bài.');
      }catch(error){if(mine===epoch)status(`Chưa tạo được JSON: ${error.message}`,true);}
      finally{if(mine===epoch)setBusy(false);}
    });
    form.addEventListener('change',event=>{if(['generator-mode','generator-part'].includes(event.target.id))updateMode();if(event.target.id!=='generator-rights')invalidate();controls();});
    $('generator-edit').addEventListener('input',()=>{checkedJSON=null;if(result)result={...result,ready:false};$('generator-readiness').textContent='Đã chỉnh sửa · bấm Kiểm tra JSON trước khi nhập bài';controls();});
    $('generator-check').addEventListener('click',()=>void validate());
    $('generator-download').addEventListener('click',()=>{
      if(busy||!result)return;
      let manifest;try{manifest=JSON.parse($('generator-edit').value);}catch{status('JSON chưa hợp lệ. Sửa cú pháp trước khi tải xuống.',true);return;}
      const name=String(manifest.title||'listening').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'listening';
      const blob=new Blob([JSON.stringify(manifest,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`${name}${result.ready&&!stale&&checkedJSON===$('generator-edit').value?'':'-draft'}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status('Đã tải JSON. Bản nháp còn thiếu dữ liệu sẽ có hậu tố “-draft”; không tự thêm vào thư viện.');
    });
    $('generator-use').addEventListener('click',async()=>{
      if(busy||stale||!result?.ready||checkedJSON!==$('generator-edit').value)return;
      const mine=epoch;setBusy(true);
      try{await onUse({manifest:JSON.parse(checkedJSON),audioFile:files?.audioFile||null,documents:files?.documents||[]});if(mine===epoch)status('Đã chuyển JSON và các file sang form nhập bài. Đối chiếu nguồn và xác nhận trước khi lưu.');}
      catch(error){if(mine===epoch)status(`Chưa chuyển được: ${error.message}`,true);}
      finally{if(mine===epoch)setBusy(false);}
    });
    $('generator-refresh-models').addEventListener('click',()=>void refreshModels());
    panel.addEventListener('toggle',()=>{if(panel.open)void refreshModels();});
    updateMode();
    return {get busy(){return busy;},reset(){epoch++;busy=false;refreshing=false;result=null;files=null;checkedJSON=null;stale=false;form.reset();$('generator-edit').value='';$('generator-result').hidden=true;$('generator-model').replaceChildren(new Option('Tự trích trên máy (không dùng AI)',''));$('generator-model-status').textContent='Mở Gia sư AI để kết nối nếu muốn AI hỗ trợ đọc đề hoặc soạn câu hỏi.';status('');updateMode();onBusyChange();}};
  };
})();

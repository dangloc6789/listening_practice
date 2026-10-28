'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function fail(message,status=400){throw Object.assign(new Error(message),{status,statusCode:status});}
function text(value,name,max=500){if(typeof value!=='string'||!value.trim()||value.length>max)fail(`Thiếu hoặc sai ${name}.`);return value.trim();}
function assetInput(input,audio=false){
  if(!input||typeof input.base64!=='string'||input.base64.length>(audio?28000000:7000000)||input.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))fail('File quá lớn hoặc base64 không hợp lệ. Audio tối đa 20 MB, mỗi tài liệu 5 MB.');
  const bytes=Buffer.from(input.base64,'base64');if(bytes.length<10||bytes.length>(audio?20:5)*1024*1024)fail('File trống hoặc quá lớn.');
  let mime;
  if(audio){
    if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')mime='audio/wav';
    else if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224))mime='audio/mpeg';
    else if(bytes.toString('ascii',0,4)==='OggS')mime='audio/ogg';
    else if(bytes.toString('ascii',4,8)==='ftyp')mime='audio/mp4';
    else fail('Chỉ hỗ trợ audio WAV, MP3, OGG hoặc M4A thật.');
  }else if(bytes.toString('ascii',0,5)==='%PDF-')mime='application/pdf';
  else if(!bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD'))mime='text/plain';
  else fail('Tài liệu phải là PDF hoặc văn bản UTF-8.');
  return {id:crypto.randomUUID(),name:text(input.name,'tên file',150).replace(/[\r\n"\\/]/g,'_'),mime,bytes,sha256:hash(bytes)};
}
class MaterialLibrary{
  constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS personal_materials(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),exercise_json TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS personal_assets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL);`);}
  list(userId){return this.db.prepare('SELECT exercise_json FROM personal_materials WHERE user_id=? ORDER BY created_at DESC').all(userId).map(row=>JSON.parse(row.exercise_json));}
  find(userId,id){const row=this.db.prepare('SELECT exercise_json FROM personal_materials WHERE id=? AND user_id=?').get(id,userId);return row?JSON.parse(row.exercise_json):null;}
  asset(userId,id){return this.db.prepare('SELECT * FROM personal_assets WHERE id=? AND user_id=?').get(id,userId)||null;}
  import(userId,input){
    const manifest=input?.manifest;
    if(!manifest||input.rightsConfirmed!==true||input.matchConfirmed!==true)fail('Cần xác nhận quyền sử dụng cá nhân và đã đối chiếu audio/đề/key cùng bài.');
    const title=text(manifest.title,'tên bài',180),part=manifest.part;
    if(![2,3,4].includes(part))fail('Part phải là 2, 3 hoặc 4.');
    const provided=manifest.source||{};
    const name=text(provided.name,'tên nguồn'),book=text(provided.book,'tên sách/tài liệu'),test=text(provided.test,'test và trang/câu'),answerLocation=text(provided.answerLocation,'vị trí đáp án gốc');
    if(!['licensed-book','user-owned-material'].includes(provided.materialType))fail('Loại học liệu phải là licensed-book hoặc user-owned-material.');
    let url=null;if(provided.url){let parsed;try{parsed=new URL(provided.url);}catch{fail('URL nguồn không hợp lệ.');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search)fail('URL nguồn phải là http(s), không chứa secret/query.');url=parsed.href;}
    if(input.documents!==undefined&&(!Array.isArray(input.documents)||input.documents.length>2))fail('Tối đa hai tài liệu đính kèm.');
    const audio=assetInput(input.audio,true),documents=(input.documents||[]).map(document=>assetInput(document));
    const expected=part===2?1:3,questions=manifest.questions;
    if(!Array.isArray(questions)||questions.length!==expected)fail(`Part ${part} cần ${expected} câu cho một đoạn audio.`);
    const seen=new Set();
    const normalized=questions.map((question,index)=>{
      const number=text(String(question.number||''),'số câu',40);if(seen.has(number))fail('Trùng số câu.');seen.add(number);
      if(!Array.isArray(question.options)||question.options.length!==(part===2?3:4))fail('Sai số lựa chọn.');
      const answer=typeof question.answer==='string'?'ABCD'.indexOf(question.answer.toUpperCase()):-1;if(answer<0||answer>=question.options.length)fail('Thiếu đáp án gốc. Không tự suy đoán đáp án; điền A/B/C/D từ tài liệu.');
      return {id:`user-q-${index+1}`,number,materialKey:`user-audio:${audio.sha256}:question:${number}`,prompt:text(question.prompt,'nội dung câu hỏi',3000),options:question.options.map(value=>text(value,'lựa chọn',1500)),answer,
        explanation:typeof question.explanation==='string'?question.explanation.slice(0,6000):`Đối chiếu đáp án do bạn cung cấp tại: ${answerLocation}. Chưa có giải thích trong tài liệu nhập.`,translation:typeof question.translation==='string'?question.translation.slice(0,6000):null,vocabulary:[],evidence:[],topic:'Tài liệu cá nhân',skill:'Theo tài liệu cung cấp',answerSource:answerLocation};
    });
    const transcript=manifest.transcript==null?[]:manifest.transcript;
    if(!Array.isArray(transcript)||transcript.length>100)fail('Transcript phải là danh sách lượt thoại, hoặc bỏ trống nếu nguồn không có.');
    const turns=transcript.map(turn=>({speaker:typeof turn.speaker==='string'?turn.speaker.slice(0,80):'',text:text(turn.text,'transcript gốc',12000),...(typeof turn.translation==='string'?{translation:turn.translation.slice(0,12000)}:{})}));
    const id=`personal-${crypto.randomUUID()}`;
    const source={id:`personal-source:${audio.sha256}`,name,book,test,url,answerLocation,kind:'user',materialType:provided.materialType,questionNumbers:normalized.map(q=>q.number),questionCount:normalized.length,rights:{mode:'personal-upload',confirmedByUser:true,note:typeof provided.rightsNote==='string'?provided.rightsNote.slice(0,1000):'Người dùng xác nhận có quyền sử dụng cá nhân, không cấp quyền đăng lại.'},verification:{method:'Người dùng xác nhận đã đối chiếu; app không xác minh quyền nhà xuất bản hoặc suy đoán phần còn thiếu.',checkedAt:new Date().toISOString(),matchedByUser:true,transcriptProvided:turns.length>0},documents:documents.map(file=>({name:file.name,url:`/api/assets/${file.id}`,sha256:file.sha256}))};
    const audioInfo={kind:'user-file',url:`/api/assets/${audio.id}`,source:name,ready:true,sha256:audio.sha256,mime:audio.mime};
    const exercise={id,version:'1',part,title,description:'Tài liệu do người dùng cung cấp; quyền và việc khớp audio/đề/key do người dùng xác nhận.',original:false,source,audio:audioInfo,units:[{id:'personal-unit',title,context:`${book} · ${test}`,audio:audioInfo,transcript:turns,questions:normalized}]};
    this.db.exec('BEGIN IMMEDIATE');try{for(const file of [audio,...documents])this.db.prepare('INSERT INTO personal_assets(id,user_id,name,mime,sha256,bytes) VALUES(?,?,?,?,?,?)').run(file.id,userId,file.name,file.mime,file.sha256,file.bytes);this.db.prepare('INSERT INTO personal_materials(id,user_id,exercise_json,created_at) VALUES(?,?,?,?)').run(id,userId,JSON.stringify(exercise),new Date().toISOString());this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    return exercise;
  }
}
module.exports={MaterialLibrary};

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { exercises, audioSource, audioFilename } = require('../backend/content.cjs');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'audio');
fs.mkdirSync(output,{recursive:true});
const filter = process.argv[2];
const targets = exercises.flatMap(exercise=>exercise.units.map(unit=>({exercise,unit}))).filter(({unit})=>!filter||unit.id===filter);
if(!targets.length)throw new Error('Unknown unit ID.');
const hash = value=>crypto.createHash('sha256').update(value).digest('hex');
function readWave(bytes){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Speech engine did not return WAV.');
  let format,pcm;
  for(let offset=12;offset+8<=bytes.length;){
    const size=bytes.readUInt32LE(offset+4),name=bytes.toString('ascii',offset,offset+4);
    if(offset+8+size>bytes.length)throw new Error('Truncated WAV.');
    if(name==='fmt ')format=bytes.subarray(offset+8,offset+8+size);
    if(name==='data')pcm=bytes.subarray(offset+8,offset+8+size);
    offset+=8+size+(size%2);
  }
  if(!format||!pcm||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==22050||format.readUInt16LE(14)!==16||pcm.length<4400)throw new Error('Expected nonempty mono 22050 Hz PCM16.');
  let peak=0;for(let i=0;i<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
  if(peak<300)throw new Error('Silent or invalid speech segment.');
  return pcm;
}
for(const {exercise,unit} of targets){
  const segments=audioSource(exercise,unit);
  const filename=audioFilename(exercise,unit);
  const sourceHash=hash(JSON.stringify({version:exercise.version,segments}));
  const manifestPath=path.join(output,filename+'.json');
  if(fs.existsSync(manifestPath)&&fs.existsSync(path.join(output,filename))){
    const previous=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(previous.sourceHash===sourceHash&&previous.sha256===hash(fs.readFileSync(path.join(output,filename)))){console.log(`UNCHANGED ${unit.id} ${previous.durationSeconds}s`);continue;}
  }
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'listenlab-speech-'));
  try{
    const job=segments.map((segment,index)=>({...segment,path:path.join(temporary,`${index}.wav`)}));
    const jobPath=path.join(temporary,'job.json');fs.writeFileSync(jobPath,JSON.stringify({segments:job}),'utf8');
    const result=spawnSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'render-speech.ps1'),'-JobPath',jobPath],{encoding:'utf8',windowsHide:true,timeout:120000});
    if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||'Speech rendering failed.');
    const sampleRate=22050,byteRate=sampleRate*2;
    const silence=Buffer.alloc(Math.round(byteRate*.35/2)*2);
    const parts=[Buffer.alloc(Math.round(byteRate*.2/2)*2)],timings=[];
    let position=parts[0].length;
    for(let index=0;index<job.length;index++){
      const pcm=readWave(fs.readFileSync(job[index].path));
      timings.push({...segments[index],startSeconds:Number((position/byteRate).toFixed(3)),endSeconds:Number(((position+pcm.length)/byteRate).toFixed(3)),pcmSha256:hash(pcm)});
      parts.push(pcm,silence);position+=pcm.length+silence.length;
    }
    const pcm=Buffer.concat(parts),header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(byteRate,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
    const bytes=Buffer.concat([header,pcm]);fs.writeFileSync(path.join(output,filename),bytes);
    const manifest={kind:'tts-file',engine:'Microsoft SAPI 5 / offline Windows voices',sourceHash,sha256:hash(bytes),sampleRate,channels:1,bitsPerSample:16,durationSeconds:Number((pcm.length/byteRate).toFixed(3)),segments:timings};
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');
    console.log(`GENERATED ${unit.id} ${manifest.durationSeconds}s · ${[...new Set(segments.map(segment=>segment.voice))].join(' / ')}`);
  }finally{
    const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('listenlab-speech-'))throw new Error('Unsafe temporary cleanup path.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}

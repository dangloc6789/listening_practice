'use strict';
// Read official HTML and media HEAD only. Never download, mirror or embed ETS audio/text.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const PAGE='https://www.iibc-global.org/toeic/test/lr/about/format/sample03.html';
const TRANSCRIPT='https://www.iibc-global.org/toeic/toeic_program/sample_all.html';
const TERMS='https://www.iibc-global.org/english/toeic/test/lr/about/format.html';
async function read(url){const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Official page returned ${response.status}`);return response.text();}
async function main(){
  const [html,transcript,terms]=await Promise.all([read(PAGE),read(TRANSCRIPT),read(TERMS)]);
  const media=[...html.matchAll(/<audio\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]).find(url=>url.endsWith('/Part3No32_34.mp3'));
  if(!media||!transcript.includes('Part3No32_34.mp3'))throw new Error('Official audio/transcript pages no longer reference the same recording.');
  const answers={};
  for(const number of [32,33,34]){
    const expression=new RegExp(`No\\.\\s*${number}\\s`),start=html.search(expression);
    if(start<0)throw new Error(`Missing official question ${number}`);
    const rest=html.slice(start),next=rest.slice(1).search(/No\.\s*\d+\s/),block=next<0?rest:rest.slice(0,next+1);
    const letter=block.match(/<li\s+data-val="正解"[^>]*>\s*([ABCD])\s*<\/li>/)?.[1];
    if(!letter)throw new Error(`Missing unambiguous publisher key ${number}`);
    answers[number]=letter;
  }
  if(JSON.stringify(answers)!==JSON.stringify({32:'B',33:'D',34:'A'}))throw new Error('Publisher key changed. Manual review required; do not infer a replacement.');
  if(!transcript.includes('Questions No.32')||!transcript.includes('coffee machine'))throw new Error('Matching published transcript was not found.');
  if(!/may not be reproduced|without the permission of ETS/i.test(terms))throw new Error('Copyright notice changed. Review source terms before integration.');
  const head=await fetch(media,{method:'HEAD',signal:AbortSignal.timeout(20000)});
  if(!head.ok||!/(audio|octet-stream)/i.test(head.headers.get('content-type')||'')||Number(head.headers.get('content-length'))<1000)throw new Error('Official recording not reachable as audio.');
  const record={sourceId:'iibc-lr-part3-sample-32-34',title:'IIBC / ETS — TOEIC Listening & Reading, official Part 3 sample',pageUrl:PAGE,transcriptPageUrl:TRANSCRIPT,termsUrl:TERMS,questionNumbers:['32','33','34'],materialType:'official-sample',integration:'external-link-only',checkedAt:new Date().toISOString(),audioFileName:'Part3No32_34.mp3',sameAudioReferencedByBothPages:true,audioHead:{status:head.status,contentType:head.headers.get('content-type'),contentLength:Number(head.headers.get('content-length'))},publisherAnswerKey:answers,pageSha256:crypto.createHash('sha256').update(html).digest('hex'),transcriptPageSha256:crypto.createHash('sha256').update(transcript).digest('hex'),rightsDecision:'No reproduction permission established. Open the official page; keep only source references, question numbers, answer-key facts and personal attempt records locally.'};
  const destination=path.join(__dirname,'..','backend','verified-iibc.json');fs.writeFileSync(destination,JSON.stringify(record,null,2)+'\n','utf8');
  console.log(JSON.stringify({source:record.title,questionNumbers:record.questionNumbers,matchingAudio:record.sameAudioReferencedByBothPages,audioHead:record.audioHead,answerKeyVerified:true,integration:record.integration,checkedAt:record.checkedAt}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

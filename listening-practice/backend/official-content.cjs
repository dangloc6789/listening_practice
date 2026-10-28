'use strict';
const verification=require('./verified-iibc.json');
const source={
  id:verification.sourceId,name:'IIBC / ETS — TOEIC Listening & Reading official sample',
  kind:'official',materialType:'official-sample',test:'Part 3 sample · No. 32–34',book:null,
  url:verification.pageUrl,transcriptUrl:verification.transcriptPageUrl,answerKeyUrl:verification.pageUrl,
  questionNumbers:['32','33','34'],questionCount:3,
  rights:{mode:'external-link-only',termsUrl:verification.termsUrl,reproductionAllowed:false,decision:'Chỉ mở trang IIBC để nghe/đọc. Không sao chép, nhúng hoặc lưu audio/đề/transcript ETS trên app.'},
  verification:{checkedAt:verification.checkedAt,method:'Đối chiếu hai trang IIBC cùng audio No32_34; key do nhà xuất bản đánh dấu; kiểm tra HEAD audio 200.',sameAudioAndTranscript:true,publisherKeyVerified:true,audioFileName:verification.audioFileName}
};
module.exports={
  id:'official-iibc-part3-32-34',version:'source-2026-10-28',part:3,original:false,
  title:'IIBC chính thức · Part 3 mẫu · Câu 32–34',
  description:'Nghe và đọc 3 câu tại IIBC, sau đó ghi A/B/C/D ở đây. Đây là bài mẫu chính thức, không phải một đề thi đầy đủ.',source,
  audio:{kind:'external-link',source:source.name,url:source.url,ready:true},
  units:[{id:'iibc-32-34',title:'IIBC · Part 3 · No. 32–34',context:'Mở trang gốc IIBC, tìm No. 32–34 và phát đoạn hội thoại tại đó. Quay lại app ghi đáp án theo đúng số câu.',
    audio:{kind:'external-link',source:source.name,url:source.url,ready:true},transcript:[],
    questions:source.questionNumbers.map(number=>({
      id:`iibc-p3-${number}`,number,materialKey:`iibc:toeic-lr:official-sample:part3:${number}`,
      prompt:`Câu ${number} — đọc câu hỏi và các lựa chọn tại IIBC`,options:['A','B','C','D'],
      answer:'ABCD'.indexOf(verification.publisherAnswerKey[number]),
      explanation:`Đáp án câu ${number} được đối chiếu từ key do IIBC công bố. App không sao chép hoặc tự tạo transcript/giải thích của nhà xuất bản; xem lời thoại và phần giải đáp tại trang nguồn.`,
      translation:null,vocabulary:[],evidence:[],topic:'Nguồn chính thức IIBC',skill:'Bài mẫu chính thức',answerSource:source.answerKeyUrl
    }))
  }]
};

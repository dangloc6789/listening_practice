"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require('node:crypto');

// Authored practice material is read only by the server. Never serve this file.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "questions.js"), "utf8"), sandbox, { timeout: 1000 });
const part2Questions = JSON.parse(JSON.stringify(sandbox.window.LISTENING_QUESTIONS));
const audio = {kind:'tts-file',source:'Microsoft SAPI · giọng Windows tạo sẵn thành WAV',license:'Nội dung tự soạn; file TTS tạo cục bộ cho việc luyện tập cá nhân, không phải bản thu ETS.'};
const question = (id, prompt, options, answer, explanation, translation, skill, vocabulary = []) => ({ id, prompt, options, answer, explanation, translation, skill, vocabulary, topic: "IT / SAP" });

const exercises = [
  {
    id: "part2-work-v1", version: "2.0.0", part: 2,
    title: "Part 2 · Công việc, cuộc họp và IT/SAP",
    description: "10 câu hỏi và hồi đáp tự soạn. Mỗi câu có ba lựa chọn.", original: true, audio,
    units: part2Questions.map((item, index) => ({
      id: `p2-unit-${String(index + 1).padStart(2, "0")}`, title: `Câu ${index + 1}`,
      transcript: [{ speaker: "", text: item.spokenQuestion || item.question }],
      questions: [{ ...item, prompt: item.question }]
    }))
  },
  {
    id: "part3-work-v1", version: "2.0.0", part: 3,
    title: "Part 3 · Hội thoại công việc và IT",
    description: "Hai đoạn hội thoại tự soạn, mỗi đoạn có ba câu hỏi và bốn lựa chọn.", original: true, audio,
    units: [
      {
        id: "p3-unit-01", title: "Hội thoại 1 · Chuẩn bị buổi đào tạo",
        transcript: [
          { speaker: "Linh", text: "Hi, Alex. The purchasing team needs a training session on the new S A P screen. Could we use the training room on Thursday?" },
          { speaker: "Alex", text: "The room is booked all Thursday. It's free on Friday morning, though." },
          { speaker: "Linh", text: "Friday works. Let's start at nine and finish before eleven. There will be twelve participants." },
          { speaker: "Alex", text: "All right. I'll book the room. Can you send me the participant list by tomorrow afternoon? I need it to create their training accounts." },
          { speaker: "Linh", text: "Sure. I'll also ask everyone to bring a laptop." }
        ],
        questions: [
          question("p3-01", "What is the training session about?", ["A new purchasing screen", "A building security policy", "A laptop repair service", "A sales presentation"], 0,
            "A đúng: Linh nói đội mua hàng cần học cách dùng màn hình SAP mới. B, C và D không phải nội dung đào tạo; laptop chỉ là thiết bị người tham gia cần mang theo.", "Buổi đào tạo nói về điều gì?", "Ý chính", [{ term: "purchasing team", meaning: "bộ phận mua hàng" }]),
          question("p3-02", "When will the training session begin?", ["Thursday at nine", "Friday at nine", "Friday at eleven", "Tomorrow afternoon"], 1,
            "B đúng: phòng bận suốt thứ Năm nên họ thống nhất sáng thứ Sáu, bắt đầu lúc chín giờ. Mười một giờ là giới hạn kết thúc. Chiều mai là hạn gửi danh sách.", "Buổi đào tạo sẽ bắt đầu khi nào?", "Thời gian", [{ term: "booked", meaning: "đã được đặt trước" }]),
          question("p3-03", "Why does Alex need the participant list?", ["To order lunch", "To arrange transportation", "To create training accounts", "To print expense reports"], 2,
            "C đúng: Alex nói rõ cần danh sách để tạo tài khoản đào tạo. Hội thoại không nhắc đặt bữa trưa, sắp xếp xe hay in báo cáo chi phí.", "Tại sao Alex cần danh sách người tham gia?", "Lý do", [{ term: "participant", meaning: "người tham gia" }])
        ]
      },
      {
        id: "p3-unit-02", title: "Hội thoại 2 · Sự cố in nhãn",
        transcript: [
          { speaker: "Nora", text: "Ben, the warehouse printer stopped producing shipping labels after this morning's software update." },
          { speaker: "Ben", text: "Can other applications still print?" },
          { speaker: "Nora", text: "Yes. Only the labels from S A P are affected. We've checked the paper and the network connection." },
          { speaker: "Ben", text: "I'll check the print settings remotely. Please send me a screenshot of the error message and the printer name." },
          { speaker: "Nora", text: "I'll do that now. The next delivery leaves at three." },
          { speaker: "Ben", text: "If I can't fix it within thirty minutes, use the backup printer in the packing area." }
        ],
        questions: [
          question("p3-04", "What problem does Nora report?", ["A delivery arrived late", "The warehouse has no paper", "All applications are offline", "Shipping labels will not print"], 3,
            "D đúng: máy không in được nhãn vận chuyển từ SAP. Các ứng dụng khác vẫn in được, họ đã kiểm tra giấy và mạng; hội thoại không nói giao hàng bị trễ.", "Nora báo cáo vấn đề gì?", "Chi tiết", [{ term: "shipping label", meaning: "nhãn vận chuyển" }]),
          question("p3-05", "What does Ben ask Nora to send?", ["An error screenshot and the printer name", "A copy of the delivery schedule", "A list of all warehouse employees", "The latest software invoice"], 0,
            "A đúng: Ben yêu cầu ảnh chụp thông báo lỗi và tên máy in. Lịch giao hàng được nhắc để nêu mức độ gấp, không phải tài liệu Ben yêu cầu. C và D không được nhắc đến.", "Ben nhờ Nora gửi những gì?", "Yêu cầu", [{ term: "screenshot", meaning: "ảnh chụp màn hình" }]),
          question("p3-06", "What should Nora do if the problem continues?", ["Delay every delivery until tomorrow", "Use the backup printer", "Install the update again", "Buy another network cable"], 1,
            "B đúng: nếu không sửa được trong ba mươi phút, Ben hướng dẫn dùng máy in dự phòng ở khu đóng gói. Ba phương án còn lại không phải giải pháp được đề xuất.", "Nora nên làm gì nếu vấn đề vẫn tiếp diễn?", "Hành động tiếp theo", [{ term: "backup printer", meaning: "máy in dự phòng" }])
        ]
      }
    ]
  },
  {
    id: "part4-work-v1", version: "2.0.0", part: 4,
    title: "Part 4 · Thông báo và lời nhắn công việc",
    description: "Hai bài nói tự soạn, mỗi bài có ba câu hỏi và bốn lựa chọn.", original: true, audio,
    units: [
      {
        id: "p4-unit-01", title: "Bài nói 1 · Bảo trì hệ thống",
        transcript: [{ speaker: "Thông báo", text: "This is a message from the information technology team. Our S A P training system will be unavailable this Saturday from eight in the morning until noon while we install a software update. The production system will remain available, so regular business activities can continue. Please save your practice work and log out of the training system by seven forty-five. When the update is complete, we will send a confirmation email. If you need help signing in afterward, contact the help desk rather than creating a new account." }],
        questions: [
          question("p4-01", "What is the purpose of the announcement?", ["To introduce a new team member", "To request equipment orders", "To announce scheduled system maintenance", "To cancel all weekend deliveries"], 2,
            "C đúng: thông báo cho biết hệ thống đào tạo sẽ tạm ngừng để cài bản cập nhật. Không có việc giới thiệu nhân sự, đặt thiết bị hay hủy giao hàng.", "Mục đích của thông báo là gì?", "Mục đích", [{ term: "unavailable", meaning: "không thể sử dụng" }]),
          question("p4-02", "Which system will remain available?", ["The training system", "The help desk training site", "The old test database", "The production system"], 3,
            "D đúng: bài nói nêu hệ thống production vẫn hoạt động để công việc thường ngày tiếp tục. Hệ thống training mới là nơi tạm ngừng. B và C không được nhắc đến.", "Hệ thống nào vẫn có thể sử dụng?", "Chi tiết", [{ term: "production system", meaning: "hệ thống vận hành thực tế" }]),
          question("p4-03", "What are listeners asked to do by seven forty-five?", ["Save their work and log out", "Create a new account", "Reply to a confirmation email", "Call the purchasing manager"], 0,
            "A đúng: người dùng được yêu cầu lưu bài thực hành và đăng xuất trước 7 giờ 45. Email xác nhận sẽ đến sau khi cập nhật xong; thông báo khuyên liên hệ hỗ trợ thay vì tạo tài khoản mới. D không được nhắc đến.", "Người nghe được yêu cầu làm gì trước 7 giờ 45?", "Hành động được yêu cầu", [{ term: "log out", meaning: "đăng xuất" }])
        ]
      },
      {
        id: "p4-unit-02", title: "Bài nói 2 · Lời nhắn về cuộc họp dự án",
        transcript: [{ speaker: "Lời nhắn", text: "Hello, Jordan. This is Maya calling about tomorrow's project review. Because our client will be joining from another time zone, we've moved the meeting from ten in the morning to two in the afternoon. We'll meet online instead of in conference room B. I've already sent an updated invitation with the video link. Could you replace the old budget chart in the presentation with the figures that finance approved today? Please send me the revised slides before noon tomorrow so I can check them before the meeting. There is no need to print copies. Thanks." }],
        questions: [
          question("p4-04", "Why has the meeting time changed?", ["The conference room is being cleaned", "The client is in another time zone", "The budget has not been approved", "The video equipment has failed"], 1,
            "B đúng: Maya giải thích khách hàng tham gia từ múi giờ khác nên đổi giờ họp. Ngân sách đã được duyệt; không có thông tin phòng đang vệ sinh hay thiết bị bị hỏng.", "Tại sao thời gian cuộc họp thay đổi?", "Lý do", [{ term: "time zone", meaning: "múi giờ" }]),
          question("p4-05", "How will the meeting take place?", ["In conference room B", "At the client's office", "By video call", "By telephone only"], 2,
            "C đúng: họ sẽ họp online và lời mời mới có liên kết video. Phòng B là địa điểm cũ. Văn phòng khách hàng và cuộc gọi chỉ có âm thanh không phải hình thức đã thống nhất.", "Cuộc họp sẽ diễn ra bằng hình thức nào?", "Chi tiết", [{ term: "updated invitation", meaning: "lời mời đã cập nhật" }]),
          question("p4-06", "What must Jordan send before noon tomorrow?", ["Printed copies of the old budget", "A new meeting invitation", "A list of client phone numbers", "The revised presentation slides"], 3,
            "D đúng: Maya yêu cầu Jordan thay biểu đồ ngân sách bằng số liệu mới rồi gửi các trang trình chiếu đã sửa trước trưa mai. Lời mời đã gửi sẵn và không cần bản in. C không được yêu cầu.", "Jordan phải gửi gì trước trưa mai?", "Hạn chót và yêu cầu", [{ term: "revised slides", meaning: "các trang trình chiếu đã chỉnh sửa" }])
        ]
      }
    ]
  }
];

// A complete recording script is separate from the multiple-choice prompts.
const translations = {
  'p3-unit-01': [
    'Chào Alex. Bộ phận mua hàng cần một buổi đào tạo về màn hình SAP mới. Thứ Năm chúng ta dùng phòng đào tạo được không?',
    'Phòng đã kín lịch cả thứ Năm. Tuy nhiên sáng thứ Sáu thì còn trống.',
    'Thứ Sáu được đấy. Bắt đầu lúc chín giờ và kết thúc trước mười một giờ nhé. Sẽ có mười hai người tham gia.',
    'Được rồi. Tôi sẽ đặt phòng. Bạn gửi danh sách người tham gia cho tôi trước chiều mai được không? Tôi cần danh sách để tạo tài khoản đào tạo cho họ.',
    'Được. Tôi cũng sẽ nhắc mọi người mang máy tính xách tay.'
  ],
  'p3-unit-02': [
    'Ben này, máy in trong kho không in được nhãn vận chuyển sau bản cập nhật phần mềm sáng nay.',
    'Các ứng dụng khác vẫn in được chứ?',
    'Vâng. Chỉ nhãn in từ SAP bị ảnh hưởng. Chúng tôi đã kiểm tra giấy và kết nối mạng.',
    'Tôi sẽ kiểm tra cài đặt in từ xa. Hãy gửi ảnh chụp thông báo lỗi và tên máy in cho tôi.',
    'Tôi sẽ gửi ngay. Chuyến giao hàng tiếp theo khởi hành lúc ba giờ.',
    'Nếu tôi không sửa được trong ba mươi phút, hãy dùng máy in dự phòng ở khu đóng gói.'
  ],
  'p4-unit-01': ['Đây là thông báo từ bộ phận công nghệ thông tin. Hệ thống đào tạo SAP sẽ tạm ngừng vào thứ Bảy này, từ tám giờ sáng đến trưa, để cài bản cập nhật phần mềm. Hệ thống vận hành thực tế vẫn hoạt động nên công việc thường ngày có thể tiếp tục. Hãy lưu bài thực hành và đăng xuất khỏi hệ thống đào tạo trước bảy giờ bốn mươi lăm. Khi cập nhật xong, chúng tôi sẽ gửi email xác nhận. Nếu cần hỗ trợ đăng nhập sau đó, hãy liên hệ bộ phận hỗ trợ thay vì tạo tài khoản mới.'],
  'p4-unit-02': ['Chào Jordan. Tôi là Maya từ Trung tâm Cộng đồng Riverside, gọi về buổi học nấu ăn cuối tuần bạn đã đăng ký. Vì nhà bếp đang được sửa vào sáng thứ Bảy, chúng tôi chuyển lớp sang hai giờ chiều Chủ nhật. Địa điểm vẫn là bếp ở tầng hai. Bạn không cần mang dụng cụ, nhưng hãy mang hai hộp đựng thức ăn để mang món ăn về nhà. Học phí đã bao gồm nguyên liệu. Vui lòng trả lời email của tôi trước tối thứ Sáu để xác nhận tham dự. Nếu Chủ nhật không phù hợp, chúng tôi sẽ hoàn lại học phí.']
};
const contexts = {
  'p3-unit-01': 'Tại văn phòng, Linh và Alex trao đổi về việc tổ chức một buổi đào tạo nội bộ.',
  'p3-unit-02': 'Nora ở kho hàng gọi Ben, nhân viên IT, để nhờ hỗ trợ một sự cố.',
  'p4-unit-01': 'Bạn nghe một thông báo nội bộ do bộ phận IT gửi đến người dùng hệ thống.',
  'p4-unit-02': 'Bạn nghe lời nhắn thoại từ một trung tâm cộng đồng về hoạt động cuối tuần.'
};
const part2OptionTranslations = [
  ['Chậm nhất năm giờ vào thứ Sáu.','Ở văn phòng tài chính.','Vâng, các báo cáo đã được duyệt.'],
  ['Vào khoảng mười hai giờ ba mươi.','Daniel thuộc bộ phận hành chính.','Chiếc bàn bên cạnh lối vào.'],
  ['Căng tin ở tầng trệt.','Hôm qua chúng tôi đã ăn trưa cùng nhau.','Tất nhiên. Tôi sẽ gửi qua email trong vài phút nữa.'],
  ['Bắt đầu lúc hai giờ.','Vâng, mọi người đều đã được mời.','Trong phòng họp ở tầng ba.'],
  ['Người thuyết trình đang nghỉ ốm.','Sáng thứ Năm tới.','Một máy chiếu mới trong phòng họp.'],
  ['Cô ấy gia nhập đội bán hàng tháng trước.','Tôi sẽ kết nối từ nhà, cảm ơn.','Phòng đã được đặt rồi.'],
  ['Trên một máy chủ sao lưu riêng.','Bộ phận hỗ trợ đã thực hiện việc đó.','Mỗi buổi tối sau giờ làm việc.'],
  ['Hãy liên hệ bộ phận hỗ trợ.','Mất khoảng năm phút.','Trước khi bạn đăng nhập.'],
  ['Ở bộ phận mua hàng.','Vâng, quản lý tài chính đã duyệt sáng nay.','Văn phòng của quản lý ở tầng ba.'],
  ['Thư mục dùng chung ở trên máy chủ.','Lần cập nhật trước diễn ra suôn sẻ.','Hãy đợi đến thứ Bảy, khi có ít người đang dùng hệ thống hơn.']
];
const everyday = exercises[2].units[1];
everyday.title = 'Bài nói 2 · Lớp học nấu ăn cuối tuần';
everyday.transcript = [{speaker:'Maya',text:"Hello, Jordan. This is Maya from the Riverside Community Center. I'm calling about the weekend cooking workshop you booked. Because the kitchen is being repaired on Saturday morning, we've moved the class to Sunday at two in the afternoon. It will still be held in the second-floor kitchen. You don't need to bring any equipment, but please bring two food containers so you can take your dishes home. The workshop fee includes all the ingredients. Please reply to my email by Friday evening to confirm that you can attend. If Sunday doesn't work for you, we'll refund your fee."}];
everyday.questions = [
  question('p4-04','Why has the workshop been rescheduled?',['The instructor is on vacation','The kitchen is being repaired','The class has too few students','The center is moving to another building'],1,'B đúng: Maya nói nhà bếp đang được sửa vào sáng thứ Bảy nên lớp phải đổi lịch. Không có thông tin giảng viên nghỉ phép, thiếu học viên hay trung tâm chuyển địa điểm.','Tại sao buổi học được đổi lịch?','Lý do',[{term:'reschedule',meaning:'đổi lịch'}]),
  question('p4-05','When will the workshop take place?',['Friday evening','Saturday morning','Sunday at two in the afternoon','Sunday at noon'],2,'C đúng: lịch mới là hai giờ chiều Chủ nhật. Sáng thứ Bảy là lịch bị thay đổi; tối thứ Sáu là hạn xác nhận tham dự. Bài nói không đề cập lớp bắt đầu vào trưa Chủ nhật.','Buổi học sẽ diễn ra khi nào?','Thời gian',[{term:'workshop',meaning:'buổi học thực hành'}]),
  question('p4-06','What should Jordan bring?',['Cooking equipment','A bag of ingredients','A printed registration form','Two food containers'],3,'D đúng: Maya yêu cầu mang hai hộp đựng thức ăn để đem món ăn về. Không cần dụng cụ; nguyên liệu đã gồm trong học phí; không có yêu cầu mang giấy đăng ký.','Jordan nên mang theo gì?','Hành động được yêu cầu',[{term:'food container',meaning:'hộp đựng thức ăn'}])
];
everyday.questions.forEach(item=>{item.topic='Đời sống';});
exercises[1].units[0].questions[0].options[0]='A new SAP screen for the purchasing team';

const evidence = {
  'p3-01': [[0,'The purchasing team needs a training session on the new S A P screen.']],
  'p3-02': [[1,"It's free on Friday morning, though."],[2,"Friday works. Let's start at nine and finish before eleven."]],
  'p3-03': [[3,'I need it to create their training accounts.']],
  'p3-04': [[0,"the warehouse printer stopped producing shipping labels after this morning's software update."],[2,'Only the labels from S A P are affected.']],
  'p3-05': [[3,'Please send me a screenshot of the error message and the printer name.']],
  'p3-06': [[5,"If I can't fix it within thirty minutes, use the backup printer in the packing area."]],
  'p4-01': [[0,'Our S A P training system will be unavailable this Saturday from eight in the morning until noon while we install a software update.']],
  'p4-02': [[0,'The production system will remain available, so regular business activities can continue.']],
  'p4-03': [[0,'Please save your practice work and log out of the training system by seven forty-five.']],
  'p4-04': [[0,"Because the kitchen is being repaired on Saturday morning, we've moved the class to Sunday at two in the afternoon."]],
  'p4-05': [[0,"we've moved the class to Sunday at two in the afternoon."]],
  'p4-06': [[0,'please bring two food containers so you can take your dishes home.']]
};
for(const exercise of exercises){
  exercise.source={id:`listenlab-${exercise.id}`,name:'Listen Lab — AI tự soạn',kind:'ai',materialType:'ai-authored-tts',url:null,book:null,test:exercise.title,questionNumbers:exercise.units.flatMap(unit=>unit.questions.map(item=>item.id)),questionCount:exercise.units.reduce((sum,unit)=>sum+unit.questions.length,0),rights:{mode:'local-authored'},verification:{method:'Lời thoại AI tự soạn khớp WAV theo manifest; không phải học liệu ETS.'}};
  if(exercise.part===4)exercise.title='Part 4 · Thông báo công việc và lời nhắn đời sống';
  for(const unit of exercise.units){
    unit.context=contexts[unit.id]||'Nghe câu hỏi hoặc phát biểu, sau đó chọn câu đáp phù hợp nhất.';
    if(exercise.part===2){
      const item=unit.questions[0];
      unit.transcript[0].translation=item.translation;
      unit.transcript.push(...item.options.map((text,index)=>({speaker:String.fromCharCode(65+index),text,translation:part2OptionTranslations[exercise.units.indexOf(unit)][index]})));
      item.evidence=[{turn:0,quote:unit.transcript[0].text},{turn:item.answer+1,quote:item.options[item.answer]}];
    }else{
      unit.transcript.forEach((turn,index)=>{turn.translation=translations[unit.id][index];});
      unit.questions.forEach(item=>{item.evidence=evidence[item.id].map(([turn,quote])=>({turn,quote}));});
    }
    unit.audio={...exercise.audio,url:`/audio/${audioFilename(exercise,unit)}`};
  }
}

function audioFilename(exercise,unit){return `${exercise.id}_${exercise.version}_${unit.id}.wav`;}
function audioSource(exercise,unit){
  const female='Microsoft Zira Desktop - English (United States)',male='Microsoft David Desktop - English (United States)';
  return unit.transcript.map((turn,index)=>({
    speaker:turn.speaker,
    voice:exercise.part===2?(index===0?male:female):['Linh','Nora','Maya'].includes(turn.speaker)?female:male,
    text:exercise.part===2&&index>0?`${turn.speaker}. ${turn.text}`:turn.text
  }));
}
function audioMetadata(exercise,unit){
  if(['external-link','user-file'].includes(unit.audio?.kind))return {...unit.audio,ready:true};
  const filename=audioFilename(exercise,unit),directory=path.join(__dirname,'..','audio');
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(directory,filename+'.json'),'utf8'));
    const sourceHash=crypto.createHash('sha256').update(JSON.stringify({version:exercise.version,segments:audioSource(exercise,unit)})).digest('hex');
    if(sourceHash!==manifest.sourceHash||!fs.existsSync(path.join(directory,filename)))return {...unit.audio,ready:false};
    if(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,filename))).digest('hex')!==manifest.sha256)return {...unit.audio,ready:false};
    const roles=[...new Map(manifest.segments.map(segment=>[segment.speaker,segment.voice]))].map(([speaker,voice])=>({speaker,voice}));
    return {...unit.audio,ready:true,durationSeconds:manifest.durationSeconds,sha256:manifest.sha256,voices:[...new Set(manifest.segments.map(segment=>segment.voice))],roles};
  }catch{return {...unit.audio,ready:false};}
}

const catalog=[require('./official-content.cjs'),...exercises];
function findExercise(id) { return catalog.find((exercise) => exercise.id === id); }

function publicExercise(exercise) {
  if (!exercise) return null;
  const result = JSON.parse(JSON.stringify(exercise));
  for (const unit of result.units) {
    unit.audio=audioMetadata(exercise,exercise.units.find(item=>item.id===unit.id));
    delete unit.transcript;
    for (const item of unit.questions) {
      delete item.answer;
      delete item.explanation;
      delete item.translation;
      delete item.vocabulary;
      delete item.evidence;
    }
  }
  return result;
}

module.exports = { exercises, catalog, findExercise, publicExercise, audioFilename, audioSource, audioMetadata };

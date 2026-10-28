/* Bài luyện tập tự soạn; không phải đề thi TOEIC chính thức. */
window.LISTENING_QUESTIONS = Object.freeze([
  {
    id: "p2-01",
    topic: "Công việc",
    skill: "Thời gian",
    question: "When do we need to submit our expense reports?",
    options: [
      "By five o'clock on Friday.",
      "In the finance office.",
      "Yes, the reports have been approved."
    ],
    answer: 0,
    explanation: "A đúng: 'When' hỏi thời gian, và 'By five o'clock on Friday' cho biết hạn chót là 5 giờ chiều thứ Sáu. B chỉ địa điểm. C nói báo cáo đã được duyệt, không trả lời khi nào cần nộp.",
    translation: "Khi nào chúng ta cần nộp báo cáo chi phí?",
    vocabulary: [
      { term: "submit", meaning: "nộp" },
      { term: "expense report", meaning: "báo cáo chi phí" }
    ]
  },
  {
    id: "p2-02",
    topic: "Công việc",
    skill: "Người phụ trách",
    question: "Who's covering reception while Mia is at lunch?",
    options: [
      "At about twelve thirty.",
      "Daniel from the administration team.",
      "The desk next to the entrance."
    ],
    answer: 1,
    explanation: "B đúng: 'Who' hỏi ai đang trực thay ở quầy lễ tân; Daniel là tên người. A trả lời về thời gian. C nói vị trí của một chiếc bàn, không xác định người phụ trách.",
    translation: "Ai đang trực thay ở quầy lễ tân trong lúc Mia đi ăn trưa?",
    vocabulary: [
      { term: "cover reception", meaning: "trực thay ở quầy lễ tân" },
      { term: "administration team", meaning: "bộ phận hành chính" }
    ]
  },
  {
    id: "p2-03",
    topic: "Công việc",
    skill: "Yêu cầu lịch sự",
    question: "Could you send me the updated budget before lunch?",
    options: [
      "The cafeteria is on the ground floor.",
      "We had lunch together yesterday.",
      "Of course. I'll email it in a few minutes."
    ],
    answer: 2,
    explanation: "C đúng: người nói đồng ý gửi bản ngân sách cập nhật qua email trong vài phút nữa. 'Could you' ở đây là một lời nhờ, nên cần đáp lại yêu cầu đó. A nói nơi có căng tin. B nhắc bữa trưa hôm qua; cả hai chỉ liên quan đến từ 'lunch' mà không đáp ứng lời nhờ.",
    translation: "Bạn có thể gửi cho tôi bản ngân sách đã cập nhật trước giờ ăn trưa không?",
    vocabulary: [
      { term: "updated budget", meaning: "bản ngân sách đã cập nhật" },
      { term: "in a few minutes", meaning: "trong vài phút nữa" }
    ]
  },
  {
    id: "p2-04",
    topic: "Cuộc họp",
    skill: "Địa điểm",
    question: "Where are we meeting the client this afternoon?",
    options: [
      "It starts at two o'clock.",
      "Yes, everyone has been invited.",
      "In the conference room on the third floor."
    ],
    answer: 2,
    explanation: "C đúng: 'Where' hỏi địa điểm, và câu trả lời cho biết phòng họp ở tầng ba. A đưa ra giờ bắt đầu. B xác nhận mọi người đã được mời; cả hai đều không nói cuộc gặp diễn ra ở đâu.",
    translation: "Chiều nay chúng ta gặp khách hàng ở đâu?",
    vocabulary: [
      { term: "client", meaning: "khách hàng" },
      { term: "conference room", meaning: "phòng họp" }
    ]
  },
  {
    id: "p2-05",
    topic: "Cuộc họp",
    skill: "Lý do",
    question: "Why was the product demonstration postponed?",
    options: [
      "The presenter is on sick leave.",
      "Next Thursday morning.",
      "A new projector in the meeting room."
    ],
    answer: 0,
    explanation: "A đúng: người thuyết trình đang nghỉ ốm là một lý do hợp lý khiến buổi trình diễn sản phẩm bị hoãn. Câu trả lời cho 'Why' không bắt buộc phải có từ 'because'. B nêu thời gian. C chỉ nhắc một thiết bị, không giải thích nguyên nhân hoãn.",
    translation: "Tại sao buổi trình diễn sản phẩm bị hoãn?",
    vocabulary: [
      { term: "postpone", meaning: "hoãn" },
      { term: "on sick leave", meaning: "đang nghỉ ốm" }
    ]
  },
  {
    id: "p2-06",
    topic: "Cuộc họp",
    skill: "Câu hỏi lựa chọn",
    question: "Would you rather join by video or come to the office?",
    options: [
      "She joined the sales team last month.",
      "I'll connect from home, thanks.",
      "The room has already been booked."
    ],
    answer: 1,
    explanation: "B đúng: kết nối từ nhà thể hiện lựa chọn tham gia qua video. 'Would you rather ... or ...' yêu cầu chọn giữa hai phương án. A dùng 'joined' nhưng nói việc gia nhập đội bán hàng. C nói phòng đã được đặt, không nêu lựa chọn của người được hỏi.",
    translation: "Bạn muốn tham gia qua video hay đến văn phòng hơn?",
    vocabulary: [
      { term: "would you rather", meaning: "bạn muốn chọn phương án nào hơn" },
      { term: "join by video", meaning: "tham gia qua cuộc gọi video" }
    ]
  },
  {
    id: "p2-07",
    topic: "IT / SAP",
    skill: "Tần suất",
    question: "How often should we back up the test database?",
    options: [
      "On a separate backup server.",
      "The support team did it.",
      "Every evening after business hours."
    ],
    answer: 2,
    explanation: "C đúng: 'How often' hỏi tần suất; 'Every evening' nghĩa là mỗi buổi tối. A nêu nơi lưu bản sao. B nêu người đã thực hiện. Hai lựa chọn đó không cho biết việc sao lưu nên diễn ra thường xuyên đến mức nào.",
    translation: "Chúng ta nên sao lưu cơ sở dữ liệu kiểm thử với tần suất như thế nào?",
    vocabulary: [
      { term: "back up", meaning: "sao lưu" },
      { term: "test database", meaning: "cơ sở dữ liệu kiểm thử" }
    ]
  },
  {
    id: "p2-08",
    topic: "IT / SAP",
    skill: "Người phụ trách",
    question: "Who can help me reset my SAP password?",
    spokenQuestion: "Who can help me reset my S A P password?",
    options: [
      "Contact the help desk.",
      "It takes about five minutes.",
      "Before you log in."
    ],
    answer: 0,
    explanation: "A đúng: hãy liên hệ bộ phận hỗ trợ, tức nơi có người giúp đặt lại mật khẩu. Câu trả lời phù hợp có thể hướng dẫn liên hệ một bộ phận mà không cần nêu tên cá nhân. B nói mất bao lâu. C nói thời điểm thực hiện; cả hai không trả lời ai có thể giúp.",
    translation: "Ai có thể giúp tôi đặt lại mật khẩu SAP?",
    vocabulary: [
      { term: "reset a password", meaning: "đặt lại mật khẩu" },
      { term: "help desk", meaning: "bộ phận hỗ trợ kỹ thuật" }
    ]
  },
  {
    id: "p2-09",
    topic: "IT / SAP",
    skill: "Xác nhận trạng thái",
    question: "Has the purchase order already been approved in SAP?",
    spokenQuestion: "Has the purchase order already been approved in S A P?",
    options: [
      "In the purchasing department.",
      "Yes, the finance manager approved it this morning.",
      "The manager's office is on the third floor."
    ],
    answer: 1,
    explanation: "B đúng: 'Has ... been approved?' hỏi đơn mua hàng đã được duyệt hay chưa; câu trả lời xác nhận đã được quản lý tài chính duyệt sáng nay. A nêu một bộ phận. C nêu vị trí văn phòng, không xác nhận trạng thái phê duyệt.",
    translation: "Đơn mua hàng đã được phê duyệt trong SAP chưa?",
    vocabulary: [
      { term: "purchase order", meaning: "đơn mua hàng" },
      { term: "approve", meaning: "phê duyệt" }
    ]
  },
  {
    id: "p2-10",
    topic: "IT / SAP",
    skill: "Câu hỏi lựa chọn",
    question: "Should we deploy the SAP update today or wait until the weekend?",
    spokenQuestion: "Should we deploy the S A P update today or wait until the weekend?",
    options: [
      "The shared folder is on the server.",
      "The previous update went smoothly.",
      "Let's wait until Saturday, when fewer people are online."
    ],
    answer: 2,
    explanation: "C đúng: người nói chọn đợi đến thứ Bảy, một ngày cuối tuần, và giải thích rằng lúc đó có ít người đang dùng hệ thống hơn. A nói vị trí thư mục dùng chung. B nhận xét về lần cập nhật trước, không chọn triển khai hôm nay hay cuối tuần.",
    translation: "Chúng ta nên triển khai bản cập nhật SAP hôm nay hay đợi đến cuối tuần?",
    vocabulary: [
      { term: "deploy an update", meaning: "triển khai bản cập nhật" },
      { term: "go smoothly", meaning: "diễn ra suôn sẻ" }
    ]
  }
]);

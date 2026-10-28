# Audio của Listen Lab

14 file WAV trong thư mục này đã được tạo, không cần tạo lại khi mở app. Nội dung do project tự soạn; âm thanh là TTS tạo cục bộ bằng **Microsoft David Desktop** và **Microsoft Zira Desktop** đã cài trên Windows. Không có bản thu của ETS hoặc nhạc/audio mẫu bên ngoài. Các file được chuẩn bị cho việc luyện tập cá nhân trong project này; tên giọng không có nghĩa Microsoft hay ETS bảo trợ nội dung.

- Part 2: một giọng đọc câu hỏi/phát biểu, một giọng đọc đủ ba hồi đáp A/B/C.
- Part 3: một file hội thoại đầy đủ; Linh/Nora dùng Zira, Alex/Ben dùng David. Cùng nhân vật giữ nguyên giọng qua các lượt thoại.
- Part 4: một file bài nói/thông báo hoặc tin nhắn thoại, có đủ thông tin cho ba câu hỏi.

Mỗi file `*.wav.json` ghi lời thoại từng phần, giọng, mốc thời gian, SHA-256 của audio và hash nguồn. Server chỉ công bố bài sẵn sàng khi hash nguồn/file khớp. Manifest không được phục vụ qua HTTP; transcript/bản dịch/dẫn chứng chỉ có trong bài đã chấm.

Khi sửa nội dung: tăng `version` của bộ bài trong `backend/content.cjs`, rồi trên Windows có đủ hai giọng trên chạy:

```powershell
npm run audio:build
# Hoặc tạo trước một bài:
node scripts/build-audio.cjs p3-unit-01
```

Quá trình tạo audio dùng SAPI offline, không gọi dịch vụ mạng, không cần API key. File WAV đã tạo vẫn phát được trên máy khác không cài hai giọng đó. Giữ WAV cùng manifest tương ứng khi chuyển project. API audio yêu cầu phiên đăng nhập; nút tải WAV có trong giao diện.

Tham khảo kỹ thuật: [Microsoft SAPI AudioOutputStream](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms723597(v=vs.85)) và [HTMLMediaElement.playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate).

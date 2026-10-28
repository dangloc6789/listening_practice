# Listen Lab — TOEIC Listening cá nhân

Node.js 24 + SQLite, HTML/CSS/JS thuần. **Bài chính: IIBC / ETS Part 3 mẫu, câu 32–34**, đã đối chiếu audio và key. Do chưa có phép tái xuất bản, app mở trang IIBC để nghe/đọc và chỉ ghi/chấm/lưu đáp án. Không sao chép hoặc nhúng audio/đề/transcript ETS. Xem [bài gốc IIBC](https://www.iibc-global.org/toeic/test/lr/about/format/sample03.html) và [điều kiện nguồn](https://www.iibc-global.org/english/toeic/test/lr/about/format.html).

14 bài AI/TTS cũ vẫn có để luyện thêm, ghi nhãn và thống kê **riêng**, không cộng vào dữ liệu chính thức. Hỗ trợ nhập audio/đề/key từ sách người dùng có quyền dùng cá nhân; không tự bịa phần thiếu.

## Chạy local

Yêu cầu Node.js 24 trở lên; không cần `npm install`, API key hay tài khoản dịch vụ ngoài.

```powershell
cd listening-practice
npm start
```

Mở **http://127.0.0.1:4173** bằng Edge/Chrome. Lần đầu tạo tên đăng nhập và mật khẩu tối thiểu 12 ký tự ngay trên trang. Chỉ cho tạo tài khoản khi origin và kết nối đều là loopback; tạo xong trước khi hosting. Những lần sau đăng nhập lại. Không mở trực tiếp `index.html` nữa vì bản này cần backend.

Nếu cổng 4173 đang bận, chạy `$env:PORT = '4174'` trước `npm start` và dùng URL cổng 4174.

**Thử bài thực tế:** mở **http://127.0.0.1:4173/?source=official**, đăng nhập/tạo tài khoản, bấm **Mở bài tại IIBC**, nghe đúng No. 32–34 rồi quay lại ghi A/B/C/D. App không tự phát hoặc đo lượt nghe ở website nguồn; số lần phát là tự báo.

Vào **Luyện nghe → chọn bài/câu/đoạn → Bắt đầu lượt mới**. Bài chính thức liên kết ngoài; tài liệu cá nhân và AI/TTS có file audio local. Câu hỏi/key chấm trên server. Bài nhập cần cung cấp JSON đề/key gốc; PDF chỉ đính kèm tham chiếu. Transcript thiếu được ghi rõ, không tự tạo. Nguồn, URL hoặc sách/test, loại học liệu và số câu lưu cùng mỗi lượt.

Phần **AI/TTS luyện thêm** có 10 câu Part 2, hai hội thoại Part 3 và hai bài nói Part 4 với WAV tạo sẵn. Xem [audio/README.md](audio/README.md) để tạo lại audio AI khi sửa lời thoại. Bài IIBC cần Internet và luôn nghe ở nguồn gốc.

**Mỗi lượt lưu là một câu Part 2 hoặc một đoạn Part 3/4 gồm ba câu.** Làm lại tạo lượt mới; nộp lại cùng run do lỗi mạng trả cùng kết quả, không tạo trùng. Lần đầu tính riêng cho từng câu/bài/phiên bản. Tăng `version` trong `backend/content.cjs` khi thay nội dung có ảnh hưởng đến chấm điểm.

## Dữ liệu và cấu hình

- Kết quả, câu hỏi, lựa chọn, đáp án đúng/đã chọn, giải thích/dẫn chứng, transcript/bản dịch, giờ bắt đầu/nộp, thời gian, lượt phát/nghe lại và phiên bản được lưu trong **`.data/listenlab.sqlite`**. Không dùng localStorage làm lịch sử chính. Bản nháp chưa nộp chỉ lưu tạm trong tab; tốc độ phát lưu trong trình duyệt.
- Dashboard tách độ chính xác lần đầu/tất cả, theo Part, theo ngày và câu cần ôn. Ngày mặc định theo **Asia/Bangkok**. Thời gian server có thể gồm lúc nghỉ; số lượt phát do frontend báo lại. Không suy ra năng lực từ điểm làm lại cùng nội dung.
- Mật khẩu lưu bằng scrypt có salt; phiên dùng cookie HttpOnly/SameSite, token phiên chỉ lưu hash trong DB. API lấy bài không gửi transcript, bản dịch, dẫn chứng hay đáp án chuẩn trước khi nộp. File audio yêu cầu đăng nhập, hỗ trợ byte-range và tải xuống. Người học vẫn có thể nghe lại hoặc tự chép lời; đây không phải hệ thống chống gian lận thi cử.
- `.env.example` liệt kê cấu hình; sao chép thành `.env` khi cần đổi `HOST`, `PORT`, `DATA_DIR`, `APP_TIMEZONE`, `PUBLIC_ORIGIN` hoặc OAuth. Không commit `.env`/`.data`, không đặt secret trong frontend hay URL. Khi đổi múi giờ server hãy giữ múi giờ hiển thị tương ứng.
- Muốn sao lưu, **dừng server rồi sao chép cả thư mục `.data`**, lưu bản sao ở nơi riêng tư. Giữ persistent volume nếu hosting. Xóa `.data` sẽ mất tài khoản và lịch sử. Lịch sử từ bản static cũ không tự nhập vào dashboard vì chưa được server xác minh.

## API

Web dùng cookie đăng nhập cùng origin. API dữ liệu trả 401 khi chưa đăng nhập; JSON POST kiểm tra Origin và giới hạn kích thước. Không dùng token MCP để ghi bài.

| API | Mục đích |
| --- | --- |
| `POST /api/auth/setup`, `/login`, `/logout` | Tạo tài khoản lần đầu / đăng nhập / đăng xuất |
| `GET /api/auth/status` | Trạng thái đăng nhập |
| `GET /api/exercises`, `/api/exercises/:id` | Bộ bài và nội dung không có đáp án chuẩn |
| `POST /api/runs` | `{exerciseId, unitId}` → mã lượt và giờ bắt đầu server |
| `GET /api/runs/:id` | Tiếp tục bản nháp, chỉ người sở hữu |
| `POST /api/attempts` | `{runId, answers:[{questionId,choice}], playback:{plays,replays,completedPlays,rate,voice}}`; choice bắt đầu từ 0; server tự chấm |
| `GET /api/progress` | Tổng quan, lần đầu, từng Part, theo ngày và nội dung cần ôn |
| `GET /api/progress?category=official`, `ai`, `user` | Ba nhóm tách riêng; mặc định official; `bySource` ghi tổng từng nhóm |
| `GET /api/import-template`, `POST /api/materials` | Mẫu JSON và nhập audio/tài liệu có quyền cá nhân |
| `GET /api/assets/:id` | File riêng tư thuộc tài khoản, audio hỗ trợ Range; tài liệu tải dạng attachment |
| `GET /api/attempts?page=1&pageSize=10&from=2026-10-01&to=2026-10-28&part=2` | Phân trang, lọc ngày gồm hai đầu mốc; pageSize tối đa 100 |
| `GET /api/attempts/:id` | Snapshot chi tiết từng lượt |
| `GET /api/report?format=markdown` hoặc `format=json` | Tổng quan toàn bộ và chi tiết tối đa 20 lượt gần nhất; thêm `download=1` để tải |

Dashboard có nút **Tải báo cáo Markdown / JSON** và **Sao chép báo cáo** để gửi lại ChatGPT ngay khi chưa có MCP. Báo cáo có kết quả thực tế, hạn chế dữ liệu và gợi ý buổi sau. Chi tiết lịch sử đầy đủ vẫn đọc qua API phân trang.

## MCP chỉ đọc

`POST /mcp` cung cấp đúng ba tool: `get_learning_progress`, `list_attempts`, `get_attempt_details`, dùng chung Store/SQLite. Mặc định đóng cho đến khi cấu hình xác thực. Token dev chỉ hoạt động loopback và không thay thế OAuth của ChatGPT.

Cấu hình OAuth provider, scope, subject của người học và HTTPS qua `.env.example`. Tài liệu nội bộ trong `docs/` không được đưa lên GitHub. ChatGPT web không tự truy cập URL localhost; POST web không tạo tin nhắn chat. **Chưa xác minh kết nối ChatGPT thực tế.**

## Trạng thái đã kiểm tra

Trước khi dọn project, 32 kiểm tra backend/API/MCP/audio/nguồn đã đạt; Chrome đã kiểm tra audio IIBC, ghi/chấm bài, nhập tài liệu và tách thống kê. Bộ test và ảnh kiểm thử đã được xóa theo yêu cầu; project giữ mã ứng dụng, học liệu và công cụ bảo trì nguồn/audio.

Node 24 có thể in thông báo SQLite experimental; đây không phải lỗi chạy. **Kết nối ChatGPT thực tế vẫn chưa được xác minh.**

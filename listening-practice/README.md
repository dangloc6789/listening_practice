# Listen Lab — Listening và Speaking cá nhân

Listen Lab là website hỗ trợ người Việt tự luyện nghe và nói tiếng Anh, tập trung vào TOEIC Listening và các bài nghe tổng quát. Website giúp người học luyện tập, xem lại lỗi sai và theo dõi tiến độ trong quá trình học.

Các chức năng chính gồm:

- **Đăng ký, đăng nhập:** Tạo tài khoản cá nhân để lưu bài làm và tiến độ học tập.
- **Thư viện bài nghe:** Chọn bài luyện TOEIC Part 2, 3, 4 hoặc bài nghe tổng quát. Mỗi bài có thông tin nguồn để người học dễ tra cứu.
- **Luyện nghe:** Nghe audio, trả lời câu hỏi trắc nghiệm và nộp bài để kiểm tra kết quả.
- **Xem đáp án và transcript:** Đối chiếu câu trả lời với đáp án, đọc nội dung bài nghe và xem giải thích sau khi làm bài.
- **Nhập tài liệu cá nhân:** Thêm bài học bằng JSON, đính kèm audio và tài liệu để xây dựng thư viện riêng.
- **Luyện nói:** Nghe mẫu, ghi âm giọng nói và nghe lại để tự đối chiếu, luyện phát âm.
- **Theo dõi tiến độ:** Hiển thị độ chính xác, số lượt luyện tập và kết quả theo từng loại bài, từng ngày.
- **Ôn tập câu sai:** Tổng hợp các câu từng trả lời sai để người học luyện lại.
- **Lịch sử làm bài:** Xem lại những lần luyện tập trước cùng kết quả chi tiết.
- **Xuất báo cáo:** Tải kết quả học tập dưới dạng Markdown hoặc JSON để lưu trữ và chia sẻ.
- **Chế độ sáng/tối:** Chuyển giao diện phù hợp với điều kiện sử dụng, hỗ trợ cả máy tính và điện thoại.

## Chi tiết kỹ thuật

Node.js 24 + SQLite, HTML/CSS/JS thuần. **Bài chính: IIBC / ETS Part 3 mẫu, câu 32–34**, đã đối chiếu audio và key. Do chưa có phép tái xuất bản, app mở trang IIBC để nghe/đọc và chỉ ghi/chấm/lưu đáp án. Không sao chép hoặc nhúng audio/đề/transcript ETS. Xem [bài gốc IIBC](https://www.iibc-global.org/toeic/test/lr/about/format/sample03.html) và [điều kiện nguồn](https://www.iibc-global.org/english/toeic/test/lr/about/format.html).

14 bài AI/TTS cũ vẫn có để luyện thêm, ghi nhãn và thống kê **riêng**, không cộng vào dữ liệu chính thức. Hỗ trợ nhập audio/đề/key từ sách người dùng có quyền dùng cá nhân; không tự bịa phần thiếu.

## Chạy local

Yêu cầu Node.js 24 trở lên. Chạy `npm install` lần đầu để cài thư viện xác minh đăng nhập; phần luyện nghe không cần API key.

```powershell
cd listening-practice
npm install
npm start
```

Mở **http://127.0.0.1:4173** bằng Edge/Chrome. Lần đầu tạo tên đăng nhập và mật khẩu tối thiểu 12 ký tự ngay trên trang. Chỉ cho tạo tài khoản khi origin và kết nối đều là loopback; tạo xong trước khi hosting. Những lần sau đăng nhập lại. Không mở trực tiếp `index.html` nữa vì bản này cần backend.

Khi sửa code, dùng `npm run dev` để Node tự khởi động lại khi file backend thay đổi. Nếu server cũ đang chạy bằng `npm start`, nhấn Ctrl+C trong terminal đó trước khi đổi lệnh; sau đó Ctrl+F5 trên web. Trang sẽ báo rõ khi backend còn chạy bản chưa hỗ trợ `general-listening`.

Nếu cổng 4173 đang bận, chạy `$env:PORT = '4174'` trước `npm start` và dùng URL cổng 4174.

**Thử bài thực tế:** mở **http://127.0.0.1:4173/?source=official**, đăng nhập/tạo tài khoản, bấm **Mở bài tại IIBC**, nghe đúng No. 32–34 rồi quay lại ghi A/B/C/D. App không tự phát hoặc đo lượt nghe ở website nguồn; số lần phát là tự báo.

Vào **Luyện nghe → chọn bài/câu/đoạn → Bắt đầu lượt mới**. Bài chính thức liên kết ngoài; tài liệu cá nhân và AI/TTS có file audio local. Câu hỏi/key chấm trên server. Bài nhập cần cung cấp JSON đề/key gốc; PDF chỉ đính kèm tham chiếu. Transcript thiếu được ghi rõ, không tự tạo. Nguồn, URL hoặc sách/test, loại học liệu và số câu lưu cùng mỗi lượt.

Phần **AI/TTS luyện thêm** có 10 câu Part 2, hai hội thoại Part 3 và hai bài nói Part 4 với WAV tạo sẵn. Xem [audio/README.md](audio/README.md) để tạo lại audio AI khi sửa lời thoại. Bài IIBC cần Internet và luôn nghe ở nguồn gốc.

**Mỗi lượt lưu là một câu Part 2 hoặc một đoạn Part 3/4 gồm ba câu.** Làm lại tạo lượt mới; nộp lại cùng run do lỗi mạng trả cùng kết quả, không tạo trùng. Lần đầu tính riêng cho từng câu/bài/phiên bản. Tăng `version` trong `backend/content.cjs` khi thay nội dung có ảnh hưởng đến chấm điểm.

Bài tự nhập có nút **Xóa bài** cạnh nút làm lại. Thao tác gỡ bài khỏi thư viện và bỏ bản nháp của bài đó; lịch sử, điểm và tài liệu gốc được giữ để xem lại kết quả. Nhập lại cùng nội dung và bộ file sẽ mở bản có sẵn hoặc khôi phục bản đã xóa, không tạo thêm bản trùng.

## Speaking Practice

Mở **Luyện nói**, chọn chủ đề/bài học rồi bắt đầu. Có 10 bài AI biên soạn cho SAP ABAP/CPI, họp khách hàng, phỏng vấn và đời sống; bắt đầu bằng câu ngắn vì chưa có đánh giá Speaking chính thức. Mỗi bài có tình huống, mục tiêu, 5 cụm từ, câu mẫu ẩn và tiêu chí luyện tập.

**Luồng:** nghe câu hỏi → thu âm → dừng/nghe lại → bấm **Chuyển audio thành chữ** → sửa transcript → **Gửi nhận xét**. Có thể nhập chữ và lưu bản nháp khi không dùng mic. AI sửa câu giữ ý, nêu tối đa 3 lỗi bằng tiếng Việt, cách nói tự nhiên và câu hỏi tiếng Anh tiếp theo. Luyện lại câu đã sửa hoặc sang câu tiếp theo; sau 5 lượt chính, app tổng kết từ dữ liệu đã lưu. Các lượt cũ đều xem lại được, không bị ghi đè.

Nhận xét Speaking, Gia sư AI và chế độ AI hỗ trợ tạo JSON dùng chung **Claude API (Anthropic)** qua SDK `@anthropic-ai/sdk`, khóa API chỉ nằm trên server. `.env.example` trên máy chỉ có tên biến/giá trị mẫu và vẫn nằm trong Git ignore. Để cấu hình từ thư mục `listening-practice`:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
# Mở .env trong IDE, điền ANTHROPIC_API_KEY bằng key của bạn (tùy chọn: ANTHROPIC_MODEL).
npm install
npm run dev
```

Dừng server cũ bằng Ctrl+C trước khi chạy lại; sau đó Ctrl+F5 trên web. Không nhập API key vào ô chat hoặc mã frontend. Chưa có key vẫn xem bài/câu mẫu, thu và nghe lại, nhận dạng giọng nói trên máy, nghe giọng đọc trình duyệt và lưu bản nháp chữ; chỉ phần nhận xét AI cần API.

Mô hình mặc định `claude-opus-5-5` (đổi bằng `ANTHROPIC_MODEL`), bật server-side fallback khi Claude từ chối một yêu cầu. Nhận xét dùng structured outputs (JSON Schema) với effort `low` để phản hồi nhanh. **Nhận dạng giọng nói chạy trên máy bằng Whisper** (Claude không có API chuyển giọng nói thành chữ), **giọng đọc dùng `speechSynthesis` của trình duyệt** (Claude không có API tạo giọng nói) — chất lượng giọng phụ thuộc giọng tiếng Anh cài trong hệ điều hành.

Giới hạn mặc định: **60 giây / 2 MB WAV**, 1.200 ký tự trả lời, **5 lượt chính + tối đa 2 lần luyện lại mỗi câu**, 40 lượt nhận xét AI/bài và 80/ngày theo Asia/Bangkok. `SPEAKING_MAX_AUDIO_SECONDS` điều chỉnh 15–60 giây; `SPEAKING_DAILY_API_LIMIT` điều chỉnh 1–200. Yêu cầu lỗi cũng tính vào hạn mức; không tự thử lại API. Giới hạn số yêu cầu không phải trần tiền USD. Audio thu không lưu vào SQLite/file server và không gửi ra ngoài; chỉ transcript (sau khi bạn sửa) được gửi tới Claude khi bấm Gửi nhận xét.

SQLite lưu bài/phiên bản, câu hỏi, transcript nhận dạng và bản người học đã sửa, phản hồi, các lần luyện lại, tổng kết và từ cần ôn. Speaking có lịch sử/tiến độ riêng, không cộng vào Listening, không chấm phát âm hoặc suy ra điểm IELTS/TOEIC từ transcript.

Kiểm tra đã thực hiện: HTTP/SQLite và WebSocket với provider thử; Chrome với MediaRecorder và micro giả lập, không tự upload khi dừng; sửa transcript → nhận xét → luyện lại → 5 lượt → lưu/xem lịch sử; quyền mic, im lặng, mạng/API, gửi trùng, hạn mức, khôi phục sau restart; sáng/tối ở 320/390/1280px. **Bản Claude đã kiểm thử với client giả lập và Whisper trên máy; chưa xác minh chất lượng nhận xét với API key thật. Không dùng kết quả thử làm dữ liệu học của người dùng.**

API Speaking yêu cầu cùng cookie đăng nhập và kiểm tra Origin như các API cũ: `GET /api/speaking/lessons`, `/status`, `/progress`, `/sessions?page=1`, `/sessions/:id`; `POST /api/speaking/sessions` và `/sessions/:id/{draft,transcriptions,turns,speech,finish}`. Không có audio/key trong API lịch sử.

## Tạo JSON từ audio/PDF

Trong **Luyện nghe → Tạo JSON từ audio/PDF**, chọn tối đa một audio 20 MB (5 phút) và hai PDF/TXT, mỗi file 5 MB. Chế độ **Trích đề và key gốc** đọc trên máy; PDF “Changing plans” nhận được đủ 8 câu, key và transcript. Chọn đúng Task/test nếu tài liệu có nhiều bài. Thiếu key thì để `null`, không tự đoán; PDF scan chưa có lớp chữ cần OCR hoặc bản TXT.

Audio dùng Whisper local; lần đầu tải model khoảng 41 MB về `.data/models`, không cần API key. Transcript nhận dạng là bản nháp, cần nghe và sửa lỗi. Nếu muốn AI hỗ trợ đọc cấu trúc phức tạp hoặc **soạn câu hỏi mới** từ nội dung nghe, cấu hình `ANTHROPIC_API_KEY`, bấm **Cập nhật mô hình** và chọn mô hình Claude. Chỉ văn bản trích được được gửi tới mô hình khi bấm tạo; audio nhận dạng ở máy. Model local: [Whisper tiny.en, Apache-2.0](https://huggingface.co/Xenova/whisper-tiny.en).

Xem/sửa bản nháp, bấm **Kiểm tra JSON**, rồi **Tải JSON** hoặc **Dùng để nhập bài**. Công cụ điền file vào form cũ; bạn vẫn cần audio, đối chiếu nguồn và xác nhận trước khi lưu. Câu hỏi AI soạn mang `ai-generated-exercise`, được thống kê ở nhóm AI, không biến thành key gốc/đề chính thức. Part 2 chỉ trích học liệu có câu hỏi và ba hồi đáp tương ứng trong audio.

Sau khi cập nhật code, chạy `npm install` một lần trước `npm run dev`. PDF và bản nháp không tự lưu trên server; chỉ khi xác nhận nhập bài mới lưu vào SQLite. Model tải lần đầu và `node_modules` nằm ngoài Git; không thay đổi kho token/đăng nhập.

Kiểm tra thủ công: PDF → JSON → kiểm tra 8 key với nguồn → chuyển sang nhập → chọn MP3 → xác nhận → lưu → làm bài → xem lịch sử. Đổi sang Part 3 với 8 câu phải báo chưa hợp lệ; thiếu key phải chặn chuyển sang nhập cho tới khi bổ sung. Thử cả chế độ sáng/tối.

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
| `GET /api/progress?category=general-listening`, `general-listening-ai` | Nghe tổng quát từ nguồn gốc và câu hỏi AI soạn tách riêng; không cộng vào TOEIC |
| `GET /api/import-template`, `POST /api/materials` | Mẫu JSON và nhập audio/tài liệu có quyền cá nhân |
| `DELETE /api/materials/:id` | Gỡ bài tự nhập của tài khoản khỏi thư viện; giữ lịch sử đã nộp |
| `GET /api/assets/:id` | File riêng tư thuộc tài khoản, audio hỗ trợ Range; tài liệu tải dạng attachment |
| `POST /api/material-drafts` | Tạo bản nháp từ audio/PCM và PDF/TXT; cần đăng nhập/xác nhận quyền, không tự lưu bài |
| `POST /api/material-drafts/validate` | Kiểm tra `{manifest}` trước khi chuyển sang form nhập; chưa có key thì không sẵn sàng |
| `GET /api/attempts?page=1&pageSize=10&from=2026-10-01&to=2026-10-28&part=2` | Phân trang, lọc ngày gồm hai đầu mốc; pageSize tối đa 100 |
| `GET /api/attempts/:id` | Snapshot chi tiết từng lượt |
| `GET /api/report?format=markdown` hoặc `format=json` | Tổng quan toàn bộ và chi tiết tối đa 20 lượt gần nhất; thêm `download=1` để tải |

Dashboard có nút **Tải báo cáo Markdown / JSON** và **Sao chép báo cáo** để gửi lại ChatGPT ngay khi chưa có MCP. Báo cáo có kết quả thực tế, hạn chế dữ liệu và gợi ý buổi sau. Chi tiết lịch sử đầy đủ vẫn đọc qua API phân trang.

## Gia sư AI trong web

Sau khi nộp bài, mở chi tiết lượt làm và bấm **Hỏi gia sư AI** ở câu muốn hỏi (hoặc mở **Gia sư AI** ở thanh trên để xem trạng thái). Gia sư dùng Claude API với khóa `ANTHROPIC_API_KEY` trên server; không cần đăng nhập tài khoản riêng.

Gia sư nhận snapshot câu đã nộp, đáp án đã chọn/đúng và transcript có sẵn từ server. Không tự tạo transcript còn thiếu. Chỉ khi bấm Gửi, ngữ cảnh câu và hội thoại liên quan mới được gửi tới Claude API. Hội thoại lưu trong SQLite (`tutor_messages`) theo từng lượt/câu, tối đa 40 tin mỗi câu; tin chỉ được lưu khi Claude trả lời thành công. Bài IIBC liên kết ngoài không có nội dung câu hỏi trong app nên không hỏi gia sư được.

API: `GET /api/tutor/status`, `/api/tutor/models`, `/api/tutor/history?attemptId=&questionId=`, `POST /api/tutor/messages`. Xem [tài liệu Claude API](https://platform.claude.com/docs).

## MCP chỉ đọc

`POST /mcp` cung cấp đúng ba tool: `get_learning_progress`, `list_attempts`, `get_attempt_details`, dùng chung Store/SQLite. Mặc định đóng cho đến khi cấu hình xác thực. Token dev chỉ hoạt động loopback và không thay thế OAuth của ChatGPT.

Cấu hình OAuth provider, scope, subject của người học và HTTPS qua `.env.example`. Tài liệu nội bộ trong `docs/` không được đưa lên GitHub. ChatGPT web không tự truy cập URL localhost; POST web không tạo tin nhắn chat. **Chưa xác minh kết nối ChatGPT thực tế.**

## Trạng thái đã kiểm tra

Trước khi dọn project, 32 kiểm tra backend/API/MCP/audio/nguồn đã đạt; Chrome đã kiểm tra audio IIBC, ghi/chấm bài, nhập tài liệu và tách thống kê. Bộ test và ảnh kiểm thử đã được xóa theo yêu cầu; project giữ mã ứng dụng, học liệu và công cụ bảo trì nguồn/audio.

Node 24 có thể in thông báo SQLite experimental; đây không phải lỗi chạy. **Kết nối ChatGPT thực tế vẫn chưa được xác minh.**

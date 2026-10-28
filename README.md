# Listening English Website

Web luyện nghe tiếng Anh cá nhân với Node.js 24, SQLite và HTML/CSS/JavaScript thuần.

- Bài mẫu TOEIC chính thức của IIBC được nghe/đọc tại trang nguồn; app ghi đáp án và lưu kết quả.
- Hỗ trợ nhập học liệu có quyền sử dụng cá nhân.
- Tách thống kê nguồn chính thức, tài liệu cá nhân và bài AI/TTS.
- Có dashboard, báo cáo tải xuống và MCP chỉ đọc có xác thực.

## Chạy local

```powershell
cd listening-practice
npm start
```

Mở **http://127.0.0.1:4173/?source=official** và tạo tài khoản trên máy. Không cần cài dependency hoặc nhập API key để luyện nghe local.

Xem [hướng dẫn ứng dụng](listening-practice/README.md). Database, file cá nhân, secret và thư mục tài liệu nội bộ được loại khỏi Git. Kết nối MCP với ChatGPT cần cấu hình riêng; chưa xác minh kết nối thực tế.

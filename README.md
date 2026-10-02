# OnluyenKit

Extension cho Chrome/Edge và CLI Node.js để đọc nội dung trên Onluyen, xuất đề, tạo prompt AI, lưu ghi chú và điền đáp án từ JSON hoặc Gemini.

## Cài extension

1. Clone repo hoặc tải **Code → Download ZIP** và giải nén.
2. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Developer mode**.
3. Chọn **Load unpacked**, trỏ tới thư mục có `manifest.json`.
4. Mở bài trên `app.onluyen.vn`, tải lại trang và mở extension.

Extension chạy trực tiếp, không cần Node.js hoặc bước build. Khi cập nhật mã, reload extension rồi tải lại trang Onluyen.

## Sử dụng

- **Giải & Tự Điền**: lấy đáp án từ trang kết quả/History, tạo prompt cho AI ngoài, nạp JSON và bắt đầu tự điền.
- **API Key (Gemini)**: thêm key cá nhân để gọi Gemini trực tiếp. API có thể tính phí theo tài khoản của bạn.
- **Ghi Chú & Feedback**: xuất Markdown/JSON, lưu ghi chú và gửi báo lỗi.

Prompt có thể kèm ảnh tải xuống. Đính kèm những ảnh đó khi gửi prompt cho AI để xử lý phương án hình vẽ. JSON nên giữ ID câu, ID lựa chọn và nội dung đáp án; chữ A/B/C/D có thể đổi khi đề xáo trộn.

Trước khi tự điền, tiện ích đọc và kiểm tra toàn bộ đề. Nếu API thiếu câu, nó mở từng câu bằng thanh điều hướng rồi trở về câu ban đầu, chưa chọn đáp án. Một lỗi ở bất kỳ câu nào sẽ chặn cả lượt tự điền và giữ database cũ. Trang luyện tập không cho đọc trước đủ đề sẽ được báo rõ thay vì trả lời để mở câu tiếp theo.

Trong cùng tab và bài làm, tạo prompt, nạp database và tự điền dùng chung bản đề đã đọc. Bấm **Bắt đầu Tự Điền** có thể nạp luôn JSON trong ô; không cần nạp riêng trước. JSON đã xác minh không bị kiểm tra toàn đề lần nữa. Chuyển bài, thay nguồn API, số câu hoặc nội dung đang hiển thị làm mất hiệu lực bản lưu. Trước mỗi lần chọn/lưu đáp án, bot vẫn kiểm tra câu trên giao diện.

Nếu đáp án đang chọn/điền khớp database nhưng nút vẫn là **Bỏ qua**, bot bấm nút đó để chuyển tiếp. Đúng/Sai phải khớp đủ tất cả các ý; ô trống hoặc nhiều lựa chọn đang chọn cùng lúc sẽ không được coi là hoàn thành.

**Kiểm tra toàn bộ đề** đọc lại đề và kiểm tra JSON trong ô mà không thay database; dùng nút này khi muốn kiểm tra lại cả những câu chưa mở sau khi đề thay đổi. **Xuất báo cáo lỗi** tải báo cáo JSON cục bộ, gồm số câu, ID, nguồn công thức và phần không khớp. Bạn có thể gửi file này cùng cách tái hiện qua Feedback; tiện ích không tự gửi báo cáo.

Prompt mới có `snapshot_id`. Chép đúng trường này vào đáp án nếu chỉ dùng chữ cái, khóa a/b/c/d hoặc câu không có ID. Token chỉ có hiệu lực với snapshot của lần tạo prompt đó; database cũ chỉ có vị trí mà không có căn cứ ánh xạ sẽ bị từ chối. Khi lựa chọn đã được xác minh, tiện ích lưu nội dung và nguồn công thức để đối chiếu lại sau khi xáo trộn.

Ví dụ định dạng đáp án:

```json
[
  {
    "cau": 1,
    "id": "question-id",
    "loai": "MCQ",
    "dap_an": "B",
    "id_dap_an": "option-id",
    "noi_dung_dap_an": "x+y≤50."
  }
]
```

Chỉ giữ ID thực tế từ đề; không tự điền các ID ví dụ. Với công thức, extension dùng chung bộ đọc LaTeX/MathML/Unicode với CLI. Nó dừng khi nội dung chưa render, cú pháp chưa hỗ trợ hoặc không khớp duy nhất. Bộ đọc không biến đổi đại số và không hỗ trợ mọi lệnh LaTeX. Chi tiết ở [MATH_CONTENT.md](MATH_CONTENT.md).

## CLI (tùy chọn)

Cần Node.js 22.12+ và Chrome hoặc Edge đã cài trên máy.

```sh
npm ci
```

Mở `bulk-tests.txt`, xóa dòng ví dụ rồi dán URL bài của bạn, mỗi dòng một URL. Dòng bắt đầu bằng `#` được bỏ qua.

```sh
node cli/bulk-runner.js --links bulk-tests.txt --answers answers.json --dry-run --headed
```

Runner hỏi thông tin đăng nhập khi chạy. Có thể dùng `--gemini-config config.json` hoặc biến môi trường `GEMINI_API_KEY` / `GEMINI_API_KEYS` nếu cần Gemini. File cấu hình tối thiểu:

```json
{
  "geminiApiKeys": ["YOUR_API_KEY"]
}
```

`--dry-run` vẫn có thể chọn và lưu đáp án trên trang, nhưng không nộp bài cuối cùng. Thêm `--submit` khi muốn nộp. `--headless` chạy không hiện cửa sổ trình duyệt. Trên Windows có thể dùng `run-bulk-dry.cmd` hoặc `run-bulk.cmd` (script thứ hai có nộp bài).

Cache và log được tạo trong `cache/` và `logs/`. Các thư mục này và cấu hình key được bỏ qua bởi Git. `bulk-tests.txt` trong repo chỉ chứa ví dụ; đừng commit link bài cá nhân khi chỉnh file này.

CLI dùng cùng bộ kiểm tra với extension. Khi chạy gặp lỗi đối chiếu, báo cáo được lưu tại `cache/onluyen-match-report.json`.

## Phát triển

```sh
npm ci
npm test
```

- `content.js`, `inject.js`: đọc đề và thao tác với trang.
- `math-content.js`: xử lý và đối chiếu nội dung toán dùng chung.
- `background.js`: gọi API, lưu trữ và tải file.
- `popup.html`, `popup.js`: giao diện extension.
- `cli/bulk-runner.js`: runner Puppeteer.
- `tests/`: kiểm thử bộ đọc, DOM và CLI bằng dữ liệu mẫu.

Kiểm thử DOM cần Chrome/Edge hoặc Chromium mà Puppeteer quản lý. Để báo lỗi chọn sai khi xáo trộn, gửi ID câu và thứ tự lựa chọn trước/sau nếu có.

## Dữ liệu và quyền truy cập

Key, database và ghi chú của extension được lưu trong `chrome.storage.local`. Khi dùng Gemini, nội dung đề và ảnh liên quan được gửi tới Gemini API. Quyền truy cập HTTPS được dùng để lấy ảnh trong đề. Feedback chỉ sao chép mẫu vào clipboard và mở kênh liên hệ; không tự gửi dữ liệu hay thu thập telemetry.

Repo không chứa key, tài khoản, cache, log hoặc danh sách bài cá nhân. Kiểm tra thông tin nhạy cảm trước khi đính kèm ảnh hay file báo lỗi.

## Feedback

Mở **Feedback / Báo lỗi** trong extension để sao chép mẫu báo lỗi, hoặc liên hệ qua:

- [GitHub Issues](https://github.com/shizunavn/onluyen-kit/issues)
- Discord: `lam017367`
- [Facebook](https://www.facebook.com/profile.php?id=61591530574387)

Gửi phiên bản extension, các bước tái hiện, kết quả mong đợi và ảnh lỗi đã che thông tin cá nhân.

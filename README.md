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

Xuất prompt dùng nguồn văn bản, LaTeX và MathML, độc lập với bộ đối chiếu công thức. LaTeX gốc được giữ nguyên; MathML được chuyển sang LaTeX khi giữ được cấu trúc, hoặc xuất nguyên trong khối `[MathML]`. Cú pháp parser chưa hỗ trợ không làm mất câu hay lựa chọn. Thiếu nguồn hoặc chưa render vẫn phải đọc lại trước khi xuất. Không có bước chụp màn hình/OCR.

Prompt dài được chia theo câu, dùng chung `snapshot_id`. Nếu có nhiều phần, tiện ích lưu các file `OnluyenKit-prompt-N.txt` vào Downloads và sao chép phần đầu. Gửi từng phần cho AI rồi gộp các mảng JSON trước khi nạp. CLI/Gemini xử lý các phần lần lượt. Một câu riêng vượt giới hạn sẽ được báo rõ, không cắt nội dung.

Ảnh base64 và SVG dựng công thức không được tính vào giới hạn đọc văn bản/công thức. Ảnh được thu riêng; LaTeX và MathML gốc vẫn giữ trong prompt. Một câu ngắn có ảnh lớn sẽ không bị báo quá dài chỉ vì dữ liệu ảnh.

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

Chỉ giữ ID thực tế từ đề; không tự điền các ID ví dụ. Extension và CLI dùng chung bộ xác minh: nội dung có cấu trúc khớp, hoặc ID/vị trí của snapshot hiện tại có căn cứ. Công thức chưa hỗ trợ vẫn có thể ánh xạ theo snapshot hoặc nguồn nguyên dạng; nội dung bổ sung mâu thuẫn hay không xác minh được sẽ bị chặn. `verification` trong JSON mô tả căn cứ ánh xạ, không phải xác suất AI giải đúng. Không dùng điểm giống chuỗi hay biến đổi đại số. Chi tiết ở [MATH_CONTENT.md](MATH_CONTENT.md).

Ký hiệu độ như `60°` và LaTeX `60^{\circ}` được đối chiếu với MathML của MathJax, kể cả khi dấu độ nằm trên một nhóm rỗng. Giá trị góc khác, số mũ `0` và toán tử `∘` vẫn khác nhau. Nếu chữ cái hoặc ID mâu thuẫn với nội dung, báo lỗi chỉ ra chính lựa chọn đó.

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

CLI chuẩn bị snapshot qua cùng content driver, dùng lại cho prompt, nhập JSON và tự điền. JSON thay đổi chỉ cần đối chiếu trên nguồn đã thu; không quét toàn đề thêm một lần khi nguồn không đổi. Nội dung gốc người dùng gửi được giữ bên cạnh nguồn lựa chọn đã xác minh trong cache.

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

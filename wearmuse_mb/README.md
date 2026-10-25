# WearMuseMeow — Mobile MVP

Ứng dụng Expo SDK 58, React Native 0.88 và TypeScript. Giao diện dùng **HeroUI Native + Uniwind**, theme sáng/tối theo thiết bị. Thanh điều hướng có **Tủ đồ · Chụp ảnh · Cá nhân**; camera mở toàn màn hình và quay lại đúng tab trước đó.

Giao diện dùng component mặc định của HeroUI: bộ sưu tập được ưu tiên hiển thị, Tabs lọc trạng thái, Card/Chip cho món đồ, Alert báo lỗi và ListGroup/Accordion cho cá nhân. Không có bảng màu hay font tùy chỉnh. Xem [tài liệu UI](docs/UI_REDESIGN.md). Sau khi kéo thay đổi, chạy `npm ci` rồi khởi động lại Metro với `--clear`. Native development build cần được build lại để nhận cấu hình giao diện theo hệ thống.

Phạm vi thử thay đổi điều hướng hiện tại: **iPhone qua Expo Go**. Cách chạy, danh sách file, cách thêm mục thứ tư/thứ năm và checklist iPhone nằm trong [docs/NAVIGATION.md](docs/NAVIGATION.md). Các kiểm tra tự động 84 ca, TypeScript, ESLint và export iOS đã pass; kiểm tra giao diện native trên iPhone vẫn cần thực hiện.

Chụp ảnh → sao chép vào Documents → ghi SQLite và công việc tải lên trong cùng một bản ghi → chụp tiếp. Upload và polling chạy độc lập khi ứng dụng ở foreground. Ảnh tách nền chỉ thay ảnh gốc sau khi đã tải, giải mã kiểm tra và lưu bền vững; hiệu ứng chuyển khoảng 250 ms, tắt khi bật giảm chuyển động.

Queue tự tạo bản JPEG tối đa 1600 px ở cạnh dài để gửi tới backend, giải quyết giới hạn 12 triệu pixel và các định dạng thư viện native có thể đọc. Bản gốc đầy đủ được giữ nguyên. Việc chuyển đổi chỉ diễn ra sau khi đã lưu local và không làm camera đợi upload/inference.

## Cài đặt

Dùng Node.js 24 LTS để chạy cả ứng dụng và các bài test SQLite tích hợp của Node. Cài Android Studio, Android SDK và JDK phù hợp với Expo SDK 57 nếu build Android tại Windows. Build iOS tại máy Mac hoặc qua EAS.

```powershell
cd D:\Projects\WearMuseMeow\wearmuse_mb
npm ci
Copy-Item .env.example .env.local
```

Các module cần thiết đã có trong `package.json` và lockfile. Khi cần thay đổi phiên bản, dùng `npx expo install`, sau đó `npx expo-doctor`; không tự nâng riêng React Native khác SDK.

```powershell
# Chỉ khi cần cài lại các module tính năng:
npx expo install expo-camera expo-image-picker expo-image-manipulator expo-file-system expo-sqlite expo-network expo-crypto expo-image expo-build-properties expo-dev-client @expo/vector-icons
```

## Địa chỉ dịch vụ AI

Sửa `.env.local`. Các biến `EXPO_PUBLIC_*` là cấu hình công khai, không đặt mật khẩu vào đó.

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000
EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true
```

| Thiết bị | `EXPO_PUBLIC_API_BASE_URL` |
| --- | --- |
| Android Emulator mặc định của Android Studio | `http://10.0.2.2:8000` |
| iOS Simulator trên Mac | `http://127.0.0.1:8000` nếu API chạy trên chính Mac; nếu API ở PC Windows, dùng LAN IP của PC |
| Điện thoại Android/iPhone | `http://<LAN-IP-của-PC>:8000`, cùng mạng Wi-Fi tin cậy |

Dùng `ipconfig` trên PC để tìm IPv4 của Wi-Fi/Ethernet, ví dụ `192.168.1.20`. Thay ví dụ bằng địa chỉ thật trong `.env.local`. Điện thoại dùng `127.0.0.1` sẽ truy cập chính điện thoại. Mạng khách, AP isolation hoặc VPN có thể chặn kết nối giữa hai thiết bị.

Khi chưa cấu hình hoặc cấu hình sai, tủ đồ và chụp ảnh vẫn hoạt động; ứng dụng giữ công việc trong SQLite và không gửi yêu cầu AI. Sau khi sửa biến môi trường, khởi động lại Metro với `--clear`.

`EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true` là opt-in dành cho phát triển. `app.config.ts` bật Android cleartext và iOS ATS exception chỉ khi biến này là `true`; ứng dụng từ chối HTTP tới hostname/IP công khai. Cần **build lại native app** sau khi thay đổi quyền HTTP hoặc plugin. Mặc định không có exception. Profile EAS `production` tắt HTTP và chặn cấu hình HTTP rõ ràng. Trước phát hành phải dùng HTTPS, xác thực và rà soát bảo mật; backend hiện tại chỉ dành cho mạng phát triển tin cậy.

## FastAPI trên Windows

Backend hiện có không bị thay đổi. Dùng môi trường Python/GPU đang hoạt động của dự án. Nếu chưa có môi trường API, cài `AI_Service/requirements.txt` trong venv riêng; giữ cách cài ONNX/CUDA hiện có cho worker.

Mở terminal thứ nhất:

```powershell
cd D:\Projects\WearMuseMeow\AI_Service
$env:WARDROBE_DATA_DIR = Join-Path (Get-Location) 'local_data'
.\.venv\Scripts\python.exe -m uvicorn wardrobe_seg.api:app --host 0.0.0.0 --port 8000
```

Terminal thứ hai, cùng thư mục dữ liệu:

```powershell
cd D:\Projects\WearMuseMeow\AI_Service
$env:WARDROBE_DATA_DIR = Join-Path (Get-Location) 'local_data'
.\.venv\Scripts\python.exe -m wardrobe_seg.worker --provider cuda --model birefnet-general
```

Kiểm tra API từ PC:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Mở `http://<LAN-IP-của-PC>:8000/health` trong trình duyệt điện thoại để kiểm tra đường truyền trước khi chạy mobile. Nếu Windows Firewall hỏi, chỉ cho phép Python/API trên profile **Private**, giới hạn mạng nội bộ; không tắt firewall. Chỉ bind `0.0.0.0` khi cần thiết bị khác truy cập. Không port-forward, không tạo public tunnel cho API không có xác thực.

Nếu chỉ muốn kiểm tra transport và UI mà không chạy GPU, có thể thay worker bằng `--engine mock`. Đây không phải kiểm tra chất lượng BiRefNet.

## Chạy trên Android thật

1. Bật Developer options và USB debugging, kết nối USB, chấp nhận khóa máy tính trên điện thoại; kiểm tra `adb devices` trong Android SDK platform-tools.
2. Đặt LAN IP của PC trong `.env.local`, bật development HTTP như trên. API và GPU worker phải chạy.
3. Build development app lần đầu (hoặc sau thay đổi native config):

```powershell
cd D:\Projects\WearMuseMeow\wearmuse_mb
npx expo run:android --device
```

4. Những lần sau khởi động Metro trong LAN và mở development client đã cài:

```powershell
npm start -- --lan
# Sau thay đổi .env.local:
npm start -- --lan --clear
```

Cho phép Metro trên mạng Private khi Windows yêu cầu. Dùng development build vì ứng dụng thêm native module; Expo Go không phải môi trường nghiệm thu của dự án. Không cần giữ USB khi LAN và development client đã hoạt động.

Nếu không có Android toolchain tại PC, có thể tạo development build qua `npx eas-cli@latest build --profile development --platform android`, cài APK rồi kết nối Metro. Cần tài khoản EAS và cấu hình project riêng; chưa chạy build cloud trong lần triển khai này. Không dùng tunnel public để thay thế đường kết nối API nội bộ.

Android Emulator: mở máy ảo rồi `npx expo run:android`. iOS Simulator: trên Mac, `npx expo run:ios`. Cả hai dùng cùng SQLite/Documents nhưng dữ liệu không chia sẻ giữa các thiết bị hay bản cài app. Web chỉ hiển thị hướng dẫn mở ứng dụng mobile, không hỗ trợ tủ đồ/camera offline trong MVP này.

## Chạy thử trên iPhone bằng Expo Go

Các module đang dùng có trong Expo Go tương ứng SDK 57. Để mở bằng QR Expo Go thay vì development client:

```powershell
cd D:\Projects\WearMuseMeow\wearmuse_mb
npm run start:go -- --clear
```

Với thanh điều hướng mới, chuyển **Home → Profile → Home**, mở **Camera** từ từng tab rồi đóng để kiểm tra trở về đúng tab và giữ vị trí tủ đồ. Thanh nổi dùng chung vùng chừa dưới nội dung, tắt trên camera/chi tiết và khi bàn phím mở. Cá nhân hiển thị số liệu tủ đồ, kết nối AI và hướng dẫn sử dụng. Để thêm tab, tạo tệp route thật trong `src/app/(tabs)` rồi bổ sung mục `type: 'tab'` vào `src/config/navigation.ts`; xem ví dụ 4–5 mục trong [hướng dẫn điều hướng](docs/NAVIGATION.md).

Giữ FastAPI chạy `--host 0.0.0.0`, iPhone cùng Wi-Fi với PC, cấu hình API bằng LAN IP thật trong `.env` hoặc `.env.local`. Cho phép quyền Mạng cục bộ cho Expo Go. Cấu hình Info.plist/plugin của dự án chỉ áp dụng cho native build riêng, không thay đổi Expo Go.

Nếu Safari gọi `/health` được nhưng FastAPI không có `POST /v1/items`, mở chi tiết món đồ để xem lý do, chọn **Kiểm tra kết nối AI** để thử GET từ chính app, rồi **Thử gửi lại ảnh**. Kiểm tra kết nối không gửi ảnh và không xác nhận GPU worker đang xử lý.

Bản sửa ngày 16/10/2026 loại bỏ lời gọi `signal.throwIfAborted()` không có trong polyfill AbortSignal của React Native. Lỗi này từng làm dừng chuẩn bị ảnh trước request; test trước đó dùng AbortSignal của Node nên không phát hiện. Đã thêm regression dùng đúng polyfill React Native cho upload, download và cancellation.

Lỗi `Unsupported FormDataPart implementation` cũng xảy ra trước HTTP: SDK 57 dùng Expo fetch làm global fetch và không nhận object `{ uri, name, type }` trong multipart. Upload hiện append `new File(uri)` của Expo FileSystem để encoder đọc byte ảnh thật. Endpoint vẫn là `POST <EXPO_PUBLIC_API_BASE_URL>/v1/items`, multipart field `file`. Test giờ dùng chính FormData patch, RequestUtils và encoder của SDK đang cài; smoke test gửi payload đó qua HTTP thật tới FastAPI riêng. Không cần đổi URL, bật CORS, tự đặt boundary hoặc đổi global fetch để sửa lỗi này.

Sau khi nhận bản sửa, full Reload Expo Go. Những item đã `failed` cần nhấn thử gửi lại để đặt lại lượt thử; không cần xóa ảnh hoặc gỡ ứng dụng. Nếu còn lỗi, xem phần lý do trong chi tiết và console Expo/React Native DevTools: `[WearMuseMeow] queue_attempt → preparing_image → image_prepared → request_started → request_response → upload_accepted`. Log lỗi cho biết phase/kind/status, không ghi nội dung ảnh hoặc đường dẫn thiết bị. Các log này chỉ bật trong development.

FastAPI phải nhận `POST /v1/items` và trả 202 trước khi worker có job mới. Worker hiện in kết quả sau khi `run_one` hoàn tất; khi không có job, nó chờ và không in lặp lại. GET `/health` không tạo công việc AI.

## Luồng nghiệm thu chính

1. Mở tủ đồ, nhấn **Camera** trên thanh điều hướng nổi.
2. Cho phép camera, chụp áo thứ nhất; đợi thumbnail và thông báo **Đã lưu ảnh**, không có màn xác nhận.
3. Chụp áo thứ hai trong cùng phiên camera; bộ đếm tăng hai.
4. Nhấn **Xong**. Hai ảnh đã có trong tủ, kể cả khi ngắt Wi-Fi/API.
5. Bật mạng/API và worker. Theo dõi POST `/v1/items` tuần tự, GET status, tải cutout. Mỗi ô tự chuyển ảnh gốc sang PNG, vị trí không thay đổi.
6. Đóng hẳn rồi mở ứng dụng: hai món đồ còn nguyên; bản ghi có remote ID không tải POST lại.
7. Mở chi tiết để thử xử lý lại nếu lỗi/cần kiểm tra, hoặc xóa có xác nhận.

Kịch bản lỗi và checklist chi tiết: [docs/TESTING.md](docs/TESTING.md).

## Kiểm tra đã thực thi ngày 15–16/10/2026

```powershell
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform ios --max-workers 2 --output-dir .test-artifacts/navigation-ios
```

- TypeScript và ESLint: pass.
- 84 bài test tự động: pass; gồm 21 ca navigation (3–5 mục, safe area, chọn tab, Camera, bàn phím, giảm chuyển động), SQLite thật của Node, AbortController polyfill của React Native và bộ mã hóa FormData thực tế của Expo SDK 57. Fetch/camera/FileSystem/decoder và ImageManipulator native dùng mock ở các bài unit test. Đây không phải test thiết bị.
- Expo Doctor: 21/21 pass.
- Bundle Android và iOS với Hermes: pass. Đây là JavaScript/bytecode export, chưa phải APK/IPA hay native build.
- Smoke test API thật qua HTTP: app API + encoder multipart Expo thực tế gửi một ảnh, một upload độc lập khác, worker **mock**, asset PNG 768 × 1024/WebP 384 × 512, retry ID/409, ảnh sai 415 và giới hạn ảnh điện thoại 4032 × 3024/bản JPEG 1600 px: pass. Node cung cấp file I/O và HTTP transport trong test; không thay cho native iPhone. Dữ liệu tạm độc lập, không dùng `local_data` hiện có.

Chạy lại smoke test bằng Python venv của backend đã có FastAPI, Uvicorn và Pillow:

```powershell
cd D:\Projects\WearMuseMeow\AI_Service
.\.venv\Scripts\python.exe ..\wearmuse_mb\scripts\backend-smoke.py
```

Chưa thực thi: camera/permission trên máy thật, native Expo SQLite/FileSystem/decoder trên thiết bị, visual QA và hiệu ứng 250 ms trên màn hình, Android/iOS native build, GPU BiRefNet trong luồng mobile, điều kiện mạng thật, Dynamic Type/TalkBack/VoiceOver. Các bước kiểm tra tương ứng được ghi rõ trong kế hoạch test.

Trong môi trường sandbox, Hermes và Python tạm thời bị chặn quyền ghi file tạm, npm/Doctor bị chặn DNS. Các kiểm tra đã được chạy lại ngoài sandbox và pass; không thay đổi API hay tắt các kiểm tra để vượt lỗi đó.

## Giới hạn còn lại

- POST hiện không có idempotency key: nếu server nhận ảnh nhưng response bị mất, retry có thể tạo bản sao phía server. Không bảo đảm exactly-once. Đề xuất tối thiểu: nhận header `Idempotency-Key` chứa local ID ổn định, ràng buộc duy nhất trong DB server; cùng key và cùng nội dung trả lại item ID cũ, nội dung khác trả 409. Không triển khai thay đổi backend trong MVP này.
- JavaScript upload/poll dừng khi app background/OS kết thúc; công việc được tiếp tục khi foreground/mở lại. Nếu đang lấy ảnh từ camera mà OS kết thúc trước khi copy+SQLite hoàn tất, ảnh đó chưa được coi là đã lưu.
- Mỗi upload có tối đa 5 lần thử tự động, backoff 2–60 giây; lỗi ảnh 400/413/415/422 dừng ngay. Người dùng có thể thử lại trong chi tiết. Poll/status/download lỗi tạm thời tiếp tục với delay tối đa 60 giây khi foreground.
- Xóa chỉ xóa hàng đợi và ảnh trên thiết bị. API hiện không có DELETE nên asset trên server còn tồn tại. File cục bộ không xóa được do lỗi I/O được báo và thu dọn orphan ở lần mở sau.
- Dữ liệu thuộc bản cài trên thiết bị; gỡ app/xóa dữ liệu app làm mất tủ local. Không có đăng nhập, đồng bộ nhiều thiết bị hay backup cloud.
- Ảnh gốc được giữ sau xử lý/lỗi. Upload tự chuyển thành JPEG tối đa 1600 px; ảnh native không giải mã được dừng ở lỗi có thể khôi phục bằng chọn/chụp ảnh khác. Việc chuyển đổi HEIC/AVIF phụ thuộc decoder hệ điều hành và cần kiểm tra trên thiết bị. Không có crop hay form sửa ảnh. Retry nhiều lần có thể để lại cache asset cũ đến khi xóa món đồ.
- Cây dependency hiện báo 30 npm advisories (12 moderate, 18 high) trong lúc cài. Chưa force-upgrade ngoài bộ phiên bản Expo SDK 57; cần rà soát riêng trước phát hành.

Danh sách file, ranh giới trách nhiệm và nguồn API: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

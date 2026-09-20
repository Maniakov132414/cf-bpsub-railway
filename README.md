# 🚀 Cloudflare VLESS Hub (BPSUB + BestCF + ECH)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FManiakov132414%2Fcf-bpsub-railway)

Trình tạo đăng ký VLESS tốc độ cao, tự động lọc và kết hợp dải IP ưu tiên sạch nhất từ **BestCF (优选站)** và kích hoạt mã hóa **ECH (Encrypted Client Hello)** để chống chặn SNI và chống bóp băng thông.

---

## ✨ Tính Năng Nổi Bật

- ⚡ **IP Ưu Tiên Siêu Tốc (BestCF)**: Tự động quét và lấy danh sách Clean IP (Anycast IP) ping thấp nhất từ dải Nhật Bản (JP 🇯🇵), Singapore (SG 🇸🇬), và Hoa Kỳ (US 🇺🇸).
- 🛡️ **Khắc Phục Lỗi Ping -1 Bằng ECH**: Tự động chèn tham số mã hóa SNI `ech=cloudflare-ech.com+https://dns.alidns.com/dns-query` vào từng node, giấu tên miền Worker khỏi tầm ngắm của tường lửa.
- 🔧 **Tự Động Sửa Lỗi Ký Tự `|`**: Tự động chuyển đổi các ký tự `|` trong ghi chú node thành `-` để tương thích 100% với trình phân tích cú pháp của BPSUB.
- 📱 **Đa Định Dạng Đăng Ký**:
  - `GET /sub` &rarr; Định dạng Base64 cho **v2rayN, v2rayNG, Shadowrocket, NekoBox**.
  - `GET /clash` &rarr; Cấu hình YAML cho **Clash Verge, Mihomo Party, FlClash** (Tích hợp sẵn bộ lọc Auto Select, Fallback và Load Balance).
  - `GET /singbox` &rarr; Cấu hình JSON cho **Sing-box**.
  - `GET /ips` &rarr; Xuất danh sách IP ưu tiên sạch đã qua xử lý ký tự `|`.
- 🌐 **Web Dashboard Trực Quan**: Giao diện web quản lý hiện đại, cho phép xem trực tiếp số lượng IP và copy link 1 click.
- 🚀 **1-Click Deploy Lên Railway**: Người dùng hoặc bạn bè chỉ cần nhấn 1 nút là hệ thống tự khởi tạo trên Railway mà không cần cài đặt gì trên máy.

---

## 🚀 Hướng Dẫn Triển Khai 1-Click Lên Railway (Dành Cho Bạn Bè)

### Bước 1: Nhấn Nút Triển Khai
Bấm vào nút bên dưới:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FManiakov132414%2Fcf-bpsub-railway)

### Bước 2: Cấu Hình Biến Môi Trường (Hoặc Để Mặc Định)
Railway sẽ hỏi các biến sau:
- `VLESS_HOST`: Tên miền Cloudflare Worker của bạn (Mặc định: `proxy.maniakov.bond`).
- `VLESS_UUID`: Mã UUID VLESS của bạn (Mặc định: `2eb5a0d9-3f07-4537-93db-e25d2ecbc473`).
- `ECH_DOMAIN`: Tên miền ECH dùng để mã hóa (Mặc định: `cloudflare-ech.com`).
- `ECH_DOH`: DoH server dùng để phân giải ECH (Mặc định: `https://dns.alidns.com/dns-query`).

### Bước 3: Hoàn Tất
Sau khoảng 30 giây, Railway sẽ cung cấp một tên miền dạng `https://xxx.up.railway.app`:
1. Mở trang web đó lên.
2. Bấm **Sao Chép Link** tại mục **v2rayN** hoặc **Clash**.
3. Dán vào ứng dụng proxy trên điện thoại hoặc máy tính và nhấn **Update Subscription**!

---

## 📖 Cách Nhập Đăng Ký Vào Client

### 1. v2rayN (Windows)
1. Mở `v2rayN`.
2. Chọn menu **Subscription group** &rarr; **Subscription group setting**.
3. Nhấn **Add**.
4. Điền tên bất kỳ vào ô `remarks` và dán đường link `https://tên-miền-của-bạn.up.railway.app/sub` vào ô `url`.
5. Nhấn **Confirm**, sau đó chọn menu **Subscription group** &rarr; **Update subscription without proxy**.

### 2. Clash Verge / Mihomo Party (Windows / macOS)
1. Mở `Clash Verge`.
2. Chọn mục **Profiles**.
3. Dán đường link `https://tên-miền-của-bạn.up.railway.app/clash` vào ô URL.
4. Nhấn **Import**.
5. Nhấn chuột phải vào profile vừa thêm và chọn **Select**.

---

## 🛠️ Danh Sách API Endpoints

| Endpoint | Định Dạng | Mô Tả |
| :--- | :--- | :--- |
| `/` | HTML | Web Dashboard quản lý và sao chép link |
| `/sub` | Base64 | Đăng ký cho v2rayN, v2rayNG, Shadowrocket |
| `/clash` | YAML | Đăng ký hoàn chỉnh cho Clash Verge / Mihomo |
| `/singbox` | JSON | Cấu hình cho Sing-box |
| `/raw` | Plain Text | Danh sách các link `vless://...` |
| `/ips` | Plain Text | Danh sách IP ưu tiên sạch (đã thay `|` thành `-`) |
| `/api/info` | JSON | Thông tin cấu hình và thống kê IP hiện tại |
| `/health` | Text | Healthcheck endpoint cho Railway |

---

## ☁️ Cloudflare Worker Kèm Theo
Mã nguồn Cloudflare Worker VLESS tương thích đã được bọc sẵn trong thư mục `cloudflare-worker/`:
- [cloudflare-worker/worker.js](cloudflare-worker/worker.js)
- [cloudflare-worker/wrangler.toml](cloudflare-worker/wrangler.toml)

---

## 📜 Giấy Phép
Dự án được phân phối dưới giấy phép MIT License.

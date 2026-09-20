# 🚀 Cloudflare VLESS Hub (BPSUB + BestCF + ECH)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FManiakov132414%2Fcf-bpsub-railway)

Trình tạo đăng ký VLESS tốc độ cao, tự động lọc và kết hợp dải IP ưu tiên sạch nhất từ **BestCF (优选站)** và kích hoạt mã hóa **ECH (Encrypted Client Hello)** để chống chặn SNI và chống bóp băng thông.

---

## ✨ Tính Năng Nổi Bật

- 🔥 **Public Proxy Trực Tiếp (SOCKS5 / HTTP)**: Chạy một cổng proxy trực tiếp trên Railway (port 8888). Client/Bot chỉ cần điền địa chỉ `socks5://...` hoặc `http://...` vào file `proxies.txt` là dùng ngay, không cần cài đặt v2rayN!
- ⚡ **IP Ưu Tiên Siêu Tốc (BestCF)**: Phía sau proxy tự động cân bằng tải xoay vòng qua 40 Clean Anycast IP ping thấp nhất từ dải Nhật Bản (JP 🇯🇵), Singapore (SG 🇸🇬), và Hoa Kỳ (US 🇺🇸).
- 🛡️ **Khắc Phục Lỗi Ping -1 Bằng ECH**: Tự động chèn tham số mã hóa SNI `ech=cloudflare-ech.com+https://dns.alidns.com/dns-query` vào từng node, giấu tên miền Worker khỏi tầm ngắm của tường lửa.
- 🔧 **Tự Động Sửa Lỗi Ký Tự `|`**: Tự động chuyển đổi các ký tự `|` trong ghi chú node thành `-` để tương thích 100% với trình phân tích cú pháp của BPSUB.
- 📱 **Đa Định Dạng Đăng Ký**:
  - `GET /sub` &rarr; Định dạng Base64 cho **v2rayN, v2rayNG, Shadowrocket, NekoBox**.
  - `GET /clash` &rarr; Cấu hình YAML cho **Clash Verge, Mihomo Party, FlClash** (Tích hợp sẵn bộ lọc Auto Select, Fallback và Load Balance).
  - `GET /singbox` &rarr; Cấu hình JSON cho **Sing-box**.
  - `GET /ips` &rarr; Xuất danh sách IP ưu tiên sạch đã qua xử lý ký tự `|`.
- 🌐 **Web Dashboard Trực Quan**: Giao diện web quản lý hiện đại, hiển thị sẵn link proxy public và link subscription để copy 1 click.
- 🚀 **1-Click Deploy Lên Railway**: Người dùng hoặc bạn bè chỉ cần nhấn 1 nút là hệ thống tự khởi tạo trên Railway mà không cần cài đặt gì trên máy.

---

## 🎯 Dùng Ngay Cho Tool / Bot (`toapis_auto_tool`)

Nếu bạn đang dùng tool chạy hàng loạt (như Python `requests` hoặc `toapis_auto_tool`), copy 1 trong 2 định dạng sau dán vào `proxies.txt`:

```text
socks5://iriguchi.proxy.rlwy.net:22658
http://iriguchi.proxy.rlwy.net:22658
```

Mỗi lần container khởi động trên Railway, nó cũng sẽ in to rõ ràng trong **Console Logs**:
```text
================================================================================
🚀 CF-BPSUB PROXY SERVER ĐÃ SẴN SÀNG!

👉 SOCKS5 Proxy : socks5://iriguchi.proxy.rlwy.net:22658
👉 HTTP Proxy   : http://iriguchi.proxy.rlwy.net:22658

📋 Copy 1 trong 2 dòng trên dán vào 'proxies.txt' của toapis_auto_tool hoặc bot để chạy!
⚡ Định tuyến: Cân bằng tải ngẫu nhiên qua 40 Clean IP BestCF (JP, SG, US)
🌐 Web Dashboard: https://cf-bpsub-production.up.railway.app
================================================================================
```

---

## 🚀 Hướng Dẫn Thêm Trực Tiếp Vào Project Có Sẵn Trên Railway

Nếu bạn bè đã có một Project trên Railway và muốn thêm service proxy này vào chung:

### Cách 1: Thao tác trên giao diện Web Railway (Đơn giản nhất - 1 phút)

1. **Mở Project có sẵn** trên trang [railway.com](https://railway.com).
2. Nhấn nút **`+ Create`** (ở góc trên bên phải màn hình canvas) &rarr; Chọn **`GitHub Repo`**.
3. Dán đường dẫn repository này vào:
   ```text
   https://github.com/Maniakov132414/cf-bpsub-railway
   ```
   *(Hoặc nếu đã Fork repo về tài khoản của họ thì chỉ cần chọn `cf-bpsub-railway` từ danh sách).*
4. Đợi Railway kéo mã nguồn về và khởi tạo service.
5. **Cấu hình mở cổng Proxy công khai**:
   - Bấm vào service vừa tạo &rarr; Chọn thẻ **Settings**.
   - Cuộn xuống mục **Networking**:
     - Bấm **`Add TCP Proxy`** &rarr; Điền số cổng: **`8888`** (đây là cổng chạy proxy SOCKS5/HTTP).
     - *(Tùy chọn)* Bấm **`Generate Domain`** &rarr; Đổi target port thành **`3000`** để xem giao diện web.
6. **Lấy link proxy**:
   - Chuyển sang thẻ **Deploy Logs** của service.
   - Nhìn vào màn hình console, bạn sẽ thấy Railway in sẵn:
     ```text
     👉 SOCKS5 Proxy : socks5://xxxx.proxy.rlwy.net:yyyyy
     👉 HTTP Proxy   : http://xxxx.proxy.rlwy.net:yyyyy
     ```
   - Copy 1 trong 2 dòng đó dán vào `proxies.txt` là dùng được ngay!

---

### Cách 2: Dùng lệnh Railway CLI (Dành cho ai thích gõ lệnh)

Mở terminal tại máy đã đăng nhập Railway CLI:

```bash
# 1. Liên kết vào project có sẵn của bạn
railway link

# 2. Thêm service trực tiếp từ GitHub repo
railway add --repo Maniakov132414/cf-bpsub-railway --branch main --service cf-bpsub

# 3. Tạo cổng TCP Proxy công khai trên port 8888
railway tcp-proxy create --port 8888 --service cf-bpsub

# 4. Xem link proxy trong console logs
railway logs --service cf-bpsub
```

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

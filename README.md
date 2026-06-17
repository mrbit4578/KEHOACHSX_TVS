# KEHOACHSX_TVS — MES Planner

Hệ thống **lập kế hoạch sản xuất tổng thể** cho 2 nhà máy **LAF → LVF** (đế cao su → gò ráp/hoàn tất), tối ưu lịch theo **nhóm màu (Color Grouping Solver)**, quản lý xuyên suốt: Đơn hàng → Kế hoạch → Tiến độ → Tồn kho NVL → Xuất hàng (Tuấn Việt).

> Brand: Adidas · Hình thể: ADIDAS RAINBOOT W · 43 đơn · 17.779 đôi · 12 mã màu · UK 3–14 · Deadline 06/07/2026 → 26/10/2026.

## Chạy thử (không cần cài đặt)

Ứng dụng là **một file HTML tĩnh tự chứa** (đã nhúng sẵn dữ liệu thật, CSS, JS). Có 3 cách chạy:

1. **Mở trực tiếp:** nhấp đúp `index.html` để mở bằng trình duyệt.
2. **Server cục bộ (khuyến nghị):**
   ```bash
   python3 -m http.server 8080
   # mở http://localhost:8080
   ```
3. **GitHub Pages (chạy online):** xem mục bên dưới.

Dữ liệu nhập tay (sản lượng LAF/LVF, tiến độ, trạng thái…) được lưu trong **localStorage của trình duyệt** nên không mất khi tải lại trang. Dùng nút **♻️ Reset dữ liệu test** để xoá hết số liệu đã nhập và đưa về đơn hàng gốc.

## 8 màn hình

1. **Dashboard** — tổng quan KPI, sản lượng theo tháng, cảnh báo real-time.
2. **Đơn hàng** — bảng đơn đầy đủ cột, lọc theo mã màu.
3. **Cấu hình Test** — khai báo test BTP cho LAF/LVF.
4. **Năng xuất MT** — capacity theo giai đoạn, phom/khuôn theo size (khoá cố định).
5. **Kế hoạch SX** — Color Grouping Solver (màu / size / kết hợp), Gantt, **bảng rã chi tiết theo đơn có mapping đầy đủ** (Brand · Quốc gia · ĐH TVS-Elite · ĐH khách hàng · Mã hàng · Màu).
6. **Tiến độ** — **nhập sản lượng tay chi tiết theo đơn / mã hàng / màu / size**, ràng buộc cứng **LVF ≤ LAF** (đầu ra ≤ đầu vào).
7. **Tồn kho NVL** — tồn kho, nhu cầu theo kế hoạch, cảnh báo thiếu.
8. **Xuất hàng** — xác nhận lô giao Tuấn Việt, on-time delivery.

## Cấu trúc dự án

```
.
├── index.html        # Ứng dụng build sẵn (tự chứa) — dùng để chạy & deploy
├── src/
│   ├── app.js        # Logic: solver, render 8 màn hình, reset, nhập sản lượng
│   ├── app.css       # Hệ thống thiết kế (Modern SaaS / Linear style)
│   ├── orders.json   # Dữ liệu đơn hàng thật (43 đơn) trích từ Excel
│   └── build.py      # Script build: nhúng dữ liệu + CSS + JS -> index.html
└── README.md
```

## Build lại từ nguồn

```bash
cd src
python3 build.py        # sinh ra ../index.html
```

## Deploy GitHub Pages

1. Push code lên GitHub (xem mục dưới).
2. Trên GitHub: **Settings → Pages → Build and deployment → Source = Deploy from a branch**.
3. Chọn branch `main`, thư mục `/ (root)`, **Save**.
4. Sau ~1 phút truy cập: `https://mrbit4578.github.io/KEHOACHSX_TVS/`

## Push lên repo

```bash
# Trong thư mục đã giải nén
git init
git add .
git commit -m "MES Planner: prototype 8 màn hình + reset, mapping kế hoạch, nhập sản lượng LVF<=LAF"
git branch -M main
git remote add origin https://github.com/mrbit4578/KEHOACHSX_TVS.git
git push -u origin main
```

import json
orders_raw=json.load(open('orders.json'))
SIZES=[3,4,5,6,7,8,9,10,11,12,13,14]
clean=[]
for o in orders_raw:
    sizes={}
    for s in SIZES:
        v=o.get(f'UK {s}')
        if v: sizes[s]=v
    clean.append({
      'stt':o.get('STT'),'brand':o.get('Brand'),'country':o.get('Quốc gia'),
      'tvs':o.get('Đơn hàng TVS-Elite'),'cust':o.get('Đơn hàng khách hàng'),
      'code':o.get('Mã hàng'),'color':o.get('Màu'),'colorName':o.get('Tên màu'),
      'shape':(o.get('Tên hình thể') or '').strip(),'sizes':sizes,'total':o.get('Tổng') or 0,
      'deadline':o.get('Ngày muộn nhất Tuấn Việt cần giao'),'dow':(o.get('Thứ muộn nhất Tuấn Việt cần giao') or '').strip()
    })
data_js='window.ORDERS='+json.dumps(clean,ensure_ascii=False)+';'
css=open('app.css',encoding='utf-8').read()
app=open('app.js',encoding='utf-8').read()

nav=[('dashboard','📊','Dashboard'),('orders','📦','Đơn hàng'),('test','🧪','Cấu hình Test'),('capacity','⚙️','Năng xuất MT'),('plan','🗓️','Kế hoạch SX'),('progress','📈','Tiến độ'),('materials','🏭','Tồn kho NVL'),('shipment','🚚','Xuất hàng')]
nav_html=''.join(f'<a data-s="{i}" onclick="go(\'{i}\')"><span class="ic">{ic}</span>{t}</a>' for i,ic,t in nav)

html=f'''<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MES Planner — Lập kế hoạch sản xuất tổng thể</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="logo">M</div><div><div class="t1">MES Planner</div><div class="t2">LAF · LVF · Production</div></div></div>
    <div class="nav">
      <div class="sec">Quy trình</div>
      {nav_html}
    </div>
    <div class="sb-foot"><div class="av">A</div><div><div class="nm">Admin</div><div class="rl">Quản lý cấp cao</div></div></div>
  </aside>
  <div class="main">
    <div class="topbar">
      <div><div class="crumb">MES Planner</div><h2 id="crumbTitle">Dashboard</h2></div>
      <div class="spacer"></div>
      <div class="search">🔍<input placeholder="Tìm đơn hàng, mã hàng, màu..."></div>
      <button class="btn sm">🔔</button>
    </div>
    <div class="content"><div id="content" class="page active"></div></div>
  </div>
</div>
<script>{data_js}</script>
<script>
{app}
</script>
</body>
</html>'''
open('../index.html','w',encoding='utf-8').write(html)
print('OK bytes:',len(html),'orders:',len(clean))

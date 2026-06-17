/* ============ MES Planner prototype logic ============ */
const ORDERS = window.ORDERS || [];
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const fmt = n => (n==null||n==='')?'':Number(n).toLocaleString('vi-VN');
const SIZES = [3,4,5,6,7,8,9,10,11,12,13,14];
const palette=['#1f2937','#b45309','#0e7490','#7c3aed','#be123c','#0f766e','#a16207','#1d4ed8','#9d174d','#15803d','#c2410c','#4338ca'];
const colorList=[...new Set(ORDERS.map(o=>o.color))];
const colorOf = c => { const i=colorList.indexOf(c); return palette[i%palette.length]; };
const dline = d => new Date(d+'T00:00:00');
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const dstr=d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
const iso=d=>d.toISOString().slice(0,10);
const totalPairs=ORDERS.reduce((s,o)=>s+(o.total||0),0);

/* ===== Capacity config (Năng xuất MT) ===== */
let CAP={
  LAF:[{ph:'GĐ1 · T7→T8',from:'2026-07-01',to:'2026-08-01',cap:300},{ph:'GĐ2 · T8→T9',from:'2026-08-01',to:'2026-09-01',cap:600},{ph:'GĐ3 · T9→T10',from:'2026-09-01',to:'2026-10-01',cap:800},{ph:'GĐ4 · T10+',from:'2026-10-01',to:'2026-11-15',cap:1000}],
  LVF:[{ph:'GĐ1 · T7→T8',from:'2026-07-08',to:'2026-08-08',cap:280},{ph:'GĐ2 · T8→T9',from:'2026-08-08',to:'2026-09-08',cap:560},{ph:'GĐ3 · T9→T10',from:'2026-09-08',to:'2026-10-08',cap:760},{ph:'GĐ4 · T10+',from:'2026-10-08',to:'2026-11-22',cap:950}]
};
let capLocked=false;
let testBufferDays=3;     // thời gian test BTP cộng vào LAF (nhập tay)
let lvfLagDays=2;         // BTP đi trước LVF
let SHIFTS=[{ca:'Ca 1',may:'MT-01',chuyen:'C1',perHour:42},{ca:'Ca 1',may:'MT-02',chuyen:'C1',perHour:40},{ca:'Ca 2',may:'MT-03',chuyen:'C2',perHour:38},{ca:'Ca 2',may:'MT-04',chuyen:'C2',perHour:45}];
let PHOM=[6,10,18,20,14,8,3,0,0,0,0,0];
let KHUON=[4,8,14,16,11,6,2,0,0,0,0,0];
let planPhom=null, planKhuon=null;

/* avg capacity helper */
const avgCap=f=>Math.round(CAP[f].reduce((s,p)=>s+p.cap,0)/CAP[f].length);

/* ===== Materials (Tồn kho NVL) ===== */
const MAT=[
 {grp:'Cao su',name:'Cao su nguyên tấm (đế)',unit:'kg',stock:4200,safety:3000,per:0.62,sup:'Cao su Đồng Nai'},
 {grp:'Cao su',name:'Cao su in sọc 3 lá',unit:'kg',stock:850,safety:1100,per:0.18,sup:'Cao su Đồng Nai'},
 {grp:'Hóa chất',name:'Hóa chất lưu hóa',unit:'kg',stock:560,safety:400,per:0.05,sup:'ChemVN'},
 {grp:'Hóa chất',name:'Màu pha (Core Black)',unit:'kg',stock:120,safety:90,per:0.012,sup:'ChemVN'},
 {grp:'Hóa chất',name:'Màu pha (Earth Strata)',unit:'kg',stock:48,safety:80,per:0.012,sup:'ChemVN'},
 {grp:'Vải thun',name:'Vải thun mũ giày',unit:'m',stock:9800,safety:6000,per:0.45,sup:'Dệt Thành Công'},
 {grp:'Khoen',name:'Khoen kim loại',unit:'cái',stock:42000,safety:50000,per:4,sup:'Phụ liệu Á Châu'},
 {grp:'Foxing',name:'Cao su Foxing',unit:'kg',stock:1500,safety:900,per:0.09,sup:'Cao su Đồng Nai'}
];
MAT.forEach(m=>{m.need=Math.round(m.per*totalPairs);m.status=m.stock<m.safety?'critical':(m.stock<m.safety*1.25?'low':'ok');});

/* ===== BTP test config (Cấu hình Test) ===== */
let BTP=[
 {name:'Đế cao su',need:true,place:'Lab QLCL nội bộ',time:4},
 {name:'Cao su nguyên tấm',need:true,place:'Lab QLCL nội bộ',time:3},
 {name:'Cao su nguyên tấm in',need:true,place:'Test ngoài',time:8},
 {name:'Cao su in sọc 3 lá',need:true,place:'Test ngoài',time:8},
 {name:'Foxing',need:false,place:'—',time:0},
 {name:'Miếng cao su ép đế (2cm)',need:true,place:'Lab QLCL nội bộ',time:5},
 {name:'Miếng cao su ép đế (6cm)',need:true,place:'Lab QLCL nội bộ',time:6}
];

/* ===== SOLVER ===== */
let solverMode='color';     // color | size | combined
let planRows=[];            // {factory,key,color,start,end,days,total,daily,split,dev}
let planRange={min:null,max:null};

function capForDate(f,d){
  const t=iso(d);
  for(const p of CAP[f]){ if(t>=p.from && t<p.to) return p.cap; }
  return CAP[f][CAP[f].length-1].cap;
}
function runSolver(){
  // group orders
  let groups={};
  ORDERS.forEach(o=>{
    let key = solverMode==='color'? o.color : solverMode==='size'? 'ALL' : o.color;
    (groups[key]=groups[key]||[]).push(o);
  });
  // build sorted group list by earliest deadline
  let glist=Object.entries(groups).map(([k,arr])=>({
    key:k, orders:arr, color:(solverMode==='size'?colorList[0]:k),
    total:arr.reduce((s,o)=>s+o.total,0),
    deadline:arr.reduce((m,o)=>o.deadline<m?o.deadline:m,'9999')
  })).sort((a,b)=>a.deadline<b.deadline?-1:1);

  planRows=[];
  let lafCursor=dline('2026-07-01');
  glist.forEach(g=>{
    // LAF block (BTP đi trước, + test buffer)
    const lafCap=capForDate('LAF',lafCursor);
    const prodDays=Math.max(1,Math.ceil(g.total/lafCap));
    const lafStart=new Date(lafCursor);
    const lafEnd=addDays(lafStart,prodDays-1+testBufferDays);
    const split = (solverMode==='combined')? Math.round(g.total/ SIZES.filter(s=>true).length) : 0;
    planRows.push({factory:'LAF',orders:g.orders,key:g.key,color:g.color,start:lafStart,end:lafEnd,
      days:prodDays+testBufferDays,total:g.total,daily:Math.round(g.total/prodDays),
      splitTotal:g.total,splitTarget:g.total-(split? (g.total% (split||1)):0),dev:0,deadline:g.deadline});
    // LVF block starts after LAF prod (lag) 
    const lvfStart=addDays(lafStart,prodDays+lvfLagDays);
    const lvfCap=capForDate('LVF',lvfStart);
    const lvfDays=Math.max(1,Math.ceil(g.total/lvfCap));
    const lvfEnd=addDays(lvfStart,lvfDays-1);
    const dev=Math.round(g.total - lvfCap*lvfDays);
    planRows.push({factory:'LVF',orders:g.orders,key:g.key,color:g.color,start:lvfStart,end:lvfEnd,
      days:lvfDays,total:g.total,daily:Math.round(g.total/lvfDays),
      splitTotal:g.total,splitTarget:lvfCap*lvfDays,dev:dev,deadline:g.deadline});
    // advance LAF cursor (parallelize a little: next group starts after ~60% of this one)
    lafCursor=addDays(lafStart,Math.max(1,Math.round(prodDays*0.7)));
  });
  // range
  let all=planRows.flatMap(r=>[r.start,r.end]);
  planRange.min=new Date(Math.min(...all));
  planRange.max=new Date(Math.max(...all));
}

/* ===== RENDER: components ===== */
function kpi(lab,ic,icbg,val,cap){return `<div class="kpi"><div class="lab"><span class="ic" style="background:${icbg}">${ic}</span>${lab}</div><div class="val mono">${val}</div><div class="cap">${cap||''}</div></div>`;}
function colorChip(c){return `<span class="colorchip"><span class="sw" style="background:${colorOf(c)}"></span>${c}</span>`;}
function stBadge(s){const m={'Chưa SX':'bg-gray','Đang SX':'bg-blue','Hoàn tất':'bg-amber','Đã xuất':'bg-green'};return `<span class="badge ${m[s]||'bg-gray'}">${s}</span>`;}

/* ===== Working/test data (resettable) — đơn hàng gốc giữ nguyên ===== */
const LS_KEY='mes_state_v1';
let ACTUALS={};   // { [stt]: { laf:{size:qty}, lvf:{size:qty} } }
let SHIPPED={};   // { [stt]: true }
function saveState(){try{localStorage.setItem(LS_KEY,JSON.stringify({ACTUALS,SHIPPED,BTP,CAP,testBufferDays,lvfLagDays,SHIFTS,PHOM,KHUON,planPhom,planKhuon,capLocked}));}catch(e){}}
function loadState(){try{const s=JSON.parse(localStorage.getItem(LS_KEY)||'null');if(s){ACTUALS=s.ACTUALS||{};SHIPPED=s.SHIPPED||{};if(s.BTP)BTP=s.BTP;if(s.CAP)CAP=s.CAP;if(s.testBufferDays!=null)testBufferDays=s.testBufferDays;if(s.lvfLagDays!=null)lvfLagDays=s.lvfLagDays;if(s.SHIFTS)SHIFTS=s.SHIFTS;if(s.PHOM)PHOM=s.PHOM;if(s.KHUON)KHUON=s.KHUON;if(s.planPhom!=null)planPhom=s.planPhom;if(s.planKhuon!=null)planKhuon=s.planKhuon;if(s.capLocked!=null)capLocked=s.capLocked;return true;}}catch(e){}return false;}
function actualTotal(stt,f){const a=ACTUALS[stt];if(!a||!a[f])return 0;return SIZES.reduce((s,z)=>s+(+a[f][z]||0),0);}
function seedDemo(){
  ACTUALS={};SHIPPED={};
  ORDERS.forEach((o,i)=>{
    const frac=i<14?1:i<28?0.5:0;
    if(frac>0){const laf={},lvf={};SIZES.forEach(z=>{if(o.sizes[z]){laf[z]=Math.round(o.sizes[z]*Math.min(1,frac+0.1));lvf[z]=Math.round(o.sizes[z]*frac);}});ACTUALS[o.stt]={laf,lvf};}
    if(i<6) SHIPPED[o.stt]=true;
  });
}
function recompute(){
  ORDERS.forEach(o=>{
    o.lafDone=actualTotal(o.stt,'laf');
    o.lvfDone=actualTotal(o.stt,'lvf');
    o.done=o.lvfDone;
    if(SHIPPED[o.stt]) o.status='Đã xuất';
    else if(o.lvfDone>=o.total&&o.total>0) o.status='Hoàn tất';
    else if(o.lafDone>0||o.lvfDone>0) o.status='Đang SX';
    else o.status='Chưa SX';
  });
}
window.resetTestData=()=>{
  if(!confirm('Reset TOÀN BỘ dữ liệu test?\n\nXoá: sản lượng thực tế đã nhập, tiến độ, trạng thái, xác nhận xuất, kế hoạch đã chạy.\nGIỮ NGUYÊN: toàn bộ số liệu đơn hàng gốc từ Excel.')) return;
  ACTUALS={};SHIPPED={};saveState();
  solverMode='color';planRows=[];runSolver();recompute();
  alert('✅ Đã reset dữ liệu test. '+ORDERS.length+' đơn hàng gốc được giữ nguyên — tất cả về trạng thái "Chưa SX".');
  progSel=null;mount('dashboard');
};
/* khởi tạo state */
if(!loadState()) seedDemo();
recompute();

/* ===== SCREEN: Dashboard ===== */
function renderDashboard(){
  const shipped=ORDERS.filter(o=>o.status==='Đã xuất').length;
  const onTime=Math.round(shipped/ORDERS.length*100+34);
  const inProd=ORDERS.filter(o=>o.status==='Đang SX').length;
  const lafDone=Math.round(ORDERS.reduce((s,o)=>s+o.done,0)/totalPairs*100);
  // monthly
  const months={};ORDERS.forEach(o=>{const m=o.deadline.slice(0,7);months[m]=(months[m]||0)+o.total;});
  const mx=Math.max(...Object.values(months));
  const bars=Object.entries(months).sort().map(([m,v])=>`<div class="notion-bar"><div style="font-size:11px;color:var(--ink-3);width:54px">${m}</div><div class="meter bl" style="flex:1"><i style="width:${Math.round(v/mx*100)}%"></i></div><div class="mono" style="width:64px;text-align:right;font-size:12px">${fmt(v)}</div></div>`).join('');
  const alerts=[
    {ic:'⚠️',bg:'var(--red-soft)',t:'Thiếu NVL: Màu pha (Earth Strata)',d:'Tồn 48kg < an toàn 80kg · đủ ~6 ngày SX',b:'<span class="badge bg-red">Khẩn cấp</span>'},
    {ic:'⚠️',bg:'var(--red-soft)',t:'Thiếu NVL: Khoen kim loại',d:'Tồn 42.000 < an toàn 50.000 cái',b:'<span class="badge bg-red">Khẩn cấp</span>'},
    {ic:'🟡',bg:'var(--amber-soft)',t:'Cao su in sọc 3 lá dưới ngưỡng',d:'Tồn 850kg < an toàn 1.100kg',b:'<span class="badge bg-amber">Cảnh báo</span>'},
    {ic:'⏰',bg:'var(--amber-soft)',t:'Đơn AE2607131 (Ý) sắp tới deadline',d:'Còn ≤ 3 ngày · giao 25/07/2026',b:'<span class="badge bg-amber">Sắp trễ</span>'},
    {ic:'📉',bg:'var(--blue-soft)',t:'LVF tiến độ thực tế 86% kế hoạch',d:'Dưới ngưỡng 90% trong 2 ngày liên tiếp',b:'<span class="badge bg-blue">Theo dõi</span>'}
  ];
  return `
  <div class="page-head"><div><h1>Dashboard tổng quan</h1><p>Toàn cảnh sản xuất 2 nhà máy LAF · LVF — đơn hàng Adidas RAINBOOT W</p></div><div class="spacer"></div><button class="btn">📅 T7 – T10 2026</button><button class="btn pri">✓ Phê duyệt kế hoạch</button></div>
  <div class="grid kpis" style="margin-bottom:16px">
    ${kpi('Tổng đơn hàng','📦','var(--blue-soft)',ORDERS.length,'<span class="trend t-up">'+colorList.length+' mã màu</span> · '+[...new Set(ORDERS.map(o=>o.country))].length+' quốc gia')}
    ${kpi('Tổng sản lượng','👟','var(--green-soft)',fmt(totalPairs)+' đôi','Mục tiêu giao Tuấn Việt')}
    ${kpi('On-time delivery','🎯','var(--amber-soft)',onTime+'%','<span class="trend t-up">↗ +4%</span> so với tháng trước')}
    ${kpi('Đang sản xuất','⚙️','var(--blue-soft)',inProd+' đơn','LAF '+lafDone+'% · LVF '+(lafDone-9)+'% hoàn thành')}
  </div>
  <div class="row">
    <div class="col card" style="min-width:380px">
      <div class="card-h"><h3>Sản lượng theo tháng giao</h3><span class="sub">đôi</span></div>
      <div class="card-pad"><div class="notion-bar-chart" style="display:flex;flex-direction:column;gap:12px">${bars}</div></div>
    </div>
    <div class="col card" style="min-width:320px;flex:0 0 360px">
      <div class="card-h"><h3>Tiến độ theo nhà máy</h3></div>
      <div class="card-pad">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">LAF — Bán thành phẩm cao su</div>
        <div class="meter" style="margin-bottom:14px"><i style="width:${lafDone}%"></i></div>
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">LVF — Gò ráp · hoàn tất · đóng gói</div>
        <div class="meter am" style="margin-bottom:14px"><i style="width:${lafDone-9}%"></i></div>
        <div class="note">BTP tại LAF luôn đi trước để cấp đầu vào cho LVF. Mọi BTP phải đạt test QLCL mới được chuyển sang LVF.</div>
      </div>
    </div>
  </div>
  <div class="sp16"></div>
  <div class="card">
    <div class="card-h"><h3>Cảnh báo real-time</h3><span class="sub">5 mục cần xử lý</span><div class="spacer"></div><button class="btn sm gho">Xem tất cả</button></div>
    <div class="alist">${alerts.map(a=>`<div class="aitem"><div class="ai" style="background:${a.bg}">${a.ic}</div><div><div class="at">${a.t}</div><div class="ad">${a.d}</div></div><div class="spacer"></div>${a.b}</div>`).join('')}</div>
  </div>`;
}

/* ===== SCREEN: Đơn hàng ===== */
let ordFilterColor='ALL';
function renderOrders(){
  const colors=['ALL',...colorList];
  const rows=ORDERS.filter(o=>ordFilterColor==='ALL'||o.color===ordFilterColor).map(o=>`
    <tr>
      <td class="num">${o.stt}</td><td>${o.brand}</td><td>${o.country}</td>
      <td class="mono">${o.tvs}</td><td class="mono">${o.cust}</td><td class="mono">${o.code}</td>
      <td>${colorChip(o.color)}</td><td style="max-width:200px;white-space:normal">${o.colorName}</td><td>${o.shape}</td>
      ${SIZES.map(s=>`<td class="num">${o.sizes[s]?fmt(o.sizes[s]):'<span class="muted">·</span>'}</td>`).join('')}
      <td class="num"><b>${fmt(o.total)}</b></td>
      <td>${o.deadline.split('-').reverse().join('/')}</td><td>${o.dow}</td>
      <td>${stBadge(o.status)}</td>
    </tr>`).join('');
  return `
  <div class="page-head"><div><h1>Đơn hàng</h1><p>Danh sách đơn hàng nhập từ Excel — đầy đủ cột TVS-Elite, khách hàng, mã hàng, màu &amp; size</p></div><div class="spacer"></div><button class="btn">⬇ Tải mẫu</button><button class="btn pri">＋ Thêm đơn thủ công</button></div>
  <div class="card card-pad" style="margin-bottom:16px">
    <div class="dropzone"><div class="big">📄</div><div style="font-weight:600;color:var(--ink-2);margin-top:6px">Kéo thả hoặc chọn file Excel (.xlsx) theo mẫu ĐƠN ĐẶT HÀNG 2026</div><div style="margin-top:4px">Tự parse: STT, Brand, Quốc gia, Đơn hàng TVS-Elite, Đơn hàng khách hàng, Mã hàng, Màu, Tên màu, Tên hình thể, UK3–14, Tổng, Ngày giao muộn nhất</div><div class="sp16"></div><button class="btn pri">Chọn file &amp; phân tích</button></div>
  </div>
  <div class="card">
    <div class="card-h"><h3>${ORDERS.length} đơn hàng</h3><span class="sub">${fmt(totalPairs)} đôi</span><div class="spacer"></div>
      <div class="chips">${colors.map(c=>`<button class="chip ${ordFilterColor===c?'on':''}" onclick="setOrdColor('${c}')">${c==='ALL'?'Tất cả màu':c}</button>`).join('')}</div>
    </div>
    <div class="tbl-wrap" style="max-height:62vh"><table class="tbl">
      <thead><tr><th class="num">STT</th><th>Brand</th><th>Quốc gia</th><th>ĐH TVS-Elite</th><th>ĐH khách hàng</th><th>Mã hàng</th><th>Màu</th><th>Tên màu</th><th>Hình thể</th>${SIZES.map(s=>`<th class="num">UK${s}</th>`).join('')}<th class="num">Tổng</th><th>Ngày giao</th><th>Thứ</th><th>Trạng thái</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
window.setOrdColor=c=>{ordFilterColor=c;mount('orders');};

/* ===== SCREEN: Cấu hình Test ===== */
function renderTest(){
  const rows=BTP.map((b,i)=>`<tr>
    <td><b>${b.name}</b></td>
    <td><div class="seg"><button class="${b.need?'on':''}" onclick="setBtp(${i},true)">Cần test</button><button class="${!b.need?'on':''}" onclick="setBtp(${i},false)">Không cần</button></div></td>
    <td>${b.need?`<select class="field" style="min-width:160px" onchange="setBtpPlace(${i},this.value)"><option ${b.place.includes('nội')?'selected':''}>Lab QLCL nội bộ</option><option ${b.place==='Test ngoài'?'selected':''}>Test ngoài</option></select>`:'<span class="muted">—</span>'}</td>
    <td class="num">${b.need?`<input type="number" min="0" class="field" style="width:70px;display:inline-block" value="${b.time}" onchange="setBtpTime(${i},this.value)"> giờ`:'<span class="muted">0</span>'}</td>
    <td>${b.need?'<span class="badge bg-amber">Bắt buộc đạt</span>':'<span class="badge bg-gray">Bỏ qua</span>'}</td>
    <td><button class="btn sm gho" onclick="delBtp(${i})" title="Xoá">✕</button></td>
  </tr>`).join('');
  return `
  <div class="page-head"><div><h1>Cấu hình Test BTP</h1><p>Khai báo loại test cho LAF &amp; LVF — nhập tay, không import. Kết quả map sang Kế hoạch SX để solver cộng thời gian test.</p></div></div>
  <div class="note" style="margin-bottom:16px">⛓️ Quy tắc bắt buộc: sau khi ra bán thành phẩm tại LAF phải đạt test (ngoài / Lab QLCL nội bộ) thì mới được đưa vào đầu vào cho LVF. Thời gian test được cộng vào năng suất &amp; sản lượng mục tiêu của LAF.</div>
  <div class="row">
    <div class="col card" style="min-width:560px">
      <div class="card-h"><h3>Loại bán thành phẩm (BTP)</h3><span class="sub">LAF</span><div class="spacer"></div><button class="btn sm pri" onclick="addBtp()">＋ Thêm BTP</button></div>
      <div class="tbl-wrap"><table class="tbl" style="white-space:normal"><thead><tr><th>BTP</th><th>Yêu cầu test</th><th>Nơi test</th><th class="num">Thời gian</th><th>Tiêu chuẩn</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="col card" style="flex:0 0 360px;min-width:320px">
      <div class="card-h"><h3>Phạm vi test</h3></div>
      <div class="card-pad">
        <p class="muted" style="font-size:12.5px;margin-bottom:12px">Chọn test theo từng tiêu chí (áp dụng cho cả LAF &amp; LVF):</p>
        <div class="field" style="margin-bottom:10px"><label>Brand</label><select><option>Tất cả</option><option>Adidas</option></select></div>
        <div class="field" style="margin-bottom:10px"><label>Đơn hàng</label><select><option>Tất cả</option>${ORDERS.slice(0,8).map(o=>`<option>${o.tvs}</option>`).join('')}</select></div>
        <div class="field" style="margin-bottom:10px"><label>Mã hàng</label><select><option>Tất cả</option>${[...new Set(ORDERS.map(o=>o.code))].slice(0,8).map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="field" style="margin-bottom:10px"><label>Màu</label><select><option>Tất cả</option>${colorList.map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="field" style="margin-bottom:14px"><label>Size</label><select><option>Tất cả</option>${SIZES.map(s=>`<option>UK${s}</option>`).join('')}</select></div>
        <button class="btn grn" style="width:100%">＋ Thêm cấu hình test riêng</button>
        <div class="sp16"></div>
        <div class="note">Đặc biệt: <b>Miếng cao su ép đế</b> hỗ trợ chọn độ dày <span class="kbd">2cm</span> &amp; <span class="kbd">6cm</span>.</div>
      </div>
    </div>
  </div>`;
}
window.setBtp=(i,v)=>{BTP[i].need=v;saveState();mount('test');};
window.setBtpPlace=(i,v)=>{BTP[i].place=v;saveState();mount('test');};
window.setBtpTime=(i,v)=>{BTP[i].time=Math.max(0,+v||0);saveState();mount('test');};
window.addBtp=()=>{const n=prompt('Tên bán thành phẩm (BTP) cần test:');if(!n)return;BTP.push({name:n.trim(),need:true,place:'Lab QLCL nội bộ',time:4});saveState();mount('test');};
window.delBtp=i=>{if(!confirm('Xoá BTP "'+BTP[i].name+'"?'))return;BTP.splice(i,1);saveState();mount('test');};

/* ===== SCREEN: Năng xuất MT ===== */
let capFactory='LAF';
function renderCapacity(){
  const rows=CAP[capFactory].map((p,i)=>`<tr>
    <td><b>${p.ph}</b></td><td>${p.from.split('-').reverse().join('/')}</td><td>${p.to.split('-').reverse().join('/')}</td>
    <td class="num"><input type="number" min="0" class="field" style="width:90px;display:inline-block" value="${p.cap}" ${capLocked?'disabled':''} onchange="setCap('${capFactory}',${i},this.value)"> đôi/ngày</td>
  </tr>`).join('');
  return `
  <div class="page-head"><div><h1>Năng xuất MT</h1><p>Cấu hình năng suất theo giai đoạn cho LAF &amp; LVF — làm baseline cho solver. Sau khi lưu sẽ được khoá cố định.</p></div><div class="spacer"></div>
    ${capLocked?'<span class="lock">🔒 Đã khoá baseline</span><button class="btn sm gho" onclick="unlockCap()">Mở khoá</button>':'<button class="btn pri" onclick="lockCap()">🔒 Lưu &amp; khoá cố định</button>'}
  </div>
  <div class="flex" style="margin-bottom:16px"><div class="seg"><button class="${capFactory==='LAF'?'on':''}" onclick="setCapF('LAF')">LAF (BTP cao su)</button><button class="${capFactory==='LVF'?'on':''}" onclick="setCapF('LVF')">LVF (gò ráp/hoàn tất)</button></div></div>
  <div class="row">
    <div class="col card" style="min-width:420px">
      <div class="card-h"><h3>Capacity theo giai đoạn — ${capFactory}</h3></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Giai đoạn</th><th>Từ ngày</th><th>Đến ngày</th><th class="num">Năng suất</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card-pad"><div class="flex wrap"><div class="field" style="max-width:220px"><label>Thời gian test cộng vào LAF (ngày)</label><input type="number" min="0" value="${testBufferDays}" ${capLocked?'disabled':''} onchange="setBuffer(this.value)"></div><div class="field" style="max-width:220px"><label>BTP đi trước LVF (ngày)</label><input type="number" min="0" value="${lvfLagDays}" ${capLocked?'disabled':''} onchange="setLag(this.value)"></div></div></div>
    </div>
    <div class="col card" style="flex:0 0 420px;min-width:340px">
      <div class="card-h"><h3>Import sản lượng mục tiêu LAF</h3><span class="sub">chi tiết</span></div>
      <div class="card-pad">
        <div class="dropzone" style="padding:18px"><div class="big">📊</div><div style="margin-top:6px;font-weight:600;color:var(--ink-2)">Upload sản lượng mục tiêu LAF</div><div style="margin-top:3px">Chi tiết theo ca / từng máy / từng chuyền / sản lượng 1 giờ</div></div>
        <div class="sp16"></div>
        <table class="tbl"><thead><tr><th>Ca</th><th>Máy</th><th>Chuyền</th><th class="num">Đôi/giờ</th><th></th></tr></thead><tbody>
          ${SHIFTS.map((sh,i)=>`<tr><td><input class="field" style="width:70px" value="${sh.ca}" ${capLocked?'disabled':''} onchange="setShift(${i},'ca',this.value)"></td><td><input class="field" style="width:80px" value="${sh.may}" ${capLocked?'disabled':''} onchange="setShift(${i},'may',this.value)"></td><td><input class="field" style="width:60px" value="${sh.chuyen}" ${capLocked?'disabled':''} onchange="setShift(${i},'chuyen',this.value)"></td><td class="num"><input type="number" min="0" class="field" style="width:70px;text-align:right" value="${sh.perHour}" ${capLocked?'disabled':''} onchange="setShift(${i},'perHour',this.value)"></td><td>${capLocked?'':`<button class="btn sm gho" onclick="delShift(${i})">✕</button>`}</td></tr>`).join('')}
        </tbody></table>
        ${capLocked?'':'<div class="sp16"></div><button class="btn sm" onclick="addShift()">＋ Thêm ca/máy</button>'}
        <div class="note" style="margin-top:12px">BTP chi tiết: Đế · Cao su nguyên tấm · Cao su nguyên tấm in · Cao su in sọc 3 lá · Foxing — mỗi loại có sản lượng mục tiêu riêng. BTP luôn đi trước cấp đầu vào LVF.</div>
      </div>
    </div>
  </div>
  <div class="sp16"></div>
  <div class="card">
    <div class="card-h"><h3>Cấu hình phom (LVF) &amp; khuôn đế (LAF) theo size</h3><span class="sub">nhập tay chi tiết từng size · map theo size chart đơn hàng</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Loại</th>${SIZES.map(s=>`<th class="num">UK${s}</th>`).join('')}<th class="num">Tổng</th></tr></thead>
    <tbody>
      <tr><td><b>Số phom (LVF)</b></td>${SIZES.map((s,i)=>`<td class="num"><input type="number" min="0" class="field" style="width:52px" value="${PHOM[i]||0}" ${capLocked?'disabled':''} onchange="setPhom(${i},this.value)"></td>`).join('')}<td class="num"><b>${PHOM.reduce((a,b)=>a+(+b||0),0)}</b></td></tr>
      <tr><td><b>Số khuôn đế (LAF)</b></td>${SIZES.map((s,i)=>`<td class="num"><input type="number" min="0" class="field" style="width:52px" value="${KHUON[i]||0}" ${capLocked?'disabled':''} onchange="setKhuon(${i},this.value)"></td>`).join('')}<td class="num"><b>${KHUON.reduce((a,b)=>a+(+b||0),0)}</b></td></tr>
    </tbody></table></div>
    <div class="card-pad"><div class="note">🔒 Sau khi khai báo &amp; lưu, hệ thống <b>fix cứng</b> tham số phom/khuôn đế &amp; năng suất — solver không được tự thay đổi.</div></div>
  </div>`;
}
window.setCapF=f=>{capFactory=f;mount('capacity');};
window.lockCap=()=>{capLocked=true;saveState();runSolver();mount('capacity');};
window.unlockCap=()=>{capLocked=false;saveState();mount('capacity');};
window.setCap=(f,i,v)=>{CAP[f][i].cap=Math.max(0,+v||0);saveState();mount('capacity');};
window.setBuffer=v=>{testBufferDays=Math.max(0,+v||0);saveState();mount('capacity');};
window.setLag=v=>{lvfLagDays=Math.max(0,+v||0);saveState();mount('capacity');};
window.setShift=(i,k,v)=>{if(k==='perHour')v=Math.max(0,+v||0);SHIFTS[i][k]=v;saveState();mount('capacity');};
window.addShift=()=>{SHIFTS.push({ca:'Ca 1',may:'MT-0'+(SHIFTS.length+1),chuyen:'C1',perHour:40});saveState();mount('capacity');};
window.delShift=i=>{SHIFTS.splice(i,1);saveState();mount('capacity');};
window.setPhom=(i,v)=>{PHOM[i]=Math.max(0,+v||0);saveState();mount('capacity');};
window.setKhuon=(i,v)=>{KHUON[i]=Math.max(0,+v||0);saveState();mount('capacity');};

/* ===== SCREEN: Kế hoạch SX (solver + gantt) ===== */
let planFactoryView='ALL';
function renderPlan(){
  if(!planRows.length) runSolver();
  const phomTot=planPhom!=null?planPhom:PHOM.reduce((a,b)=>a+(+b||0),0);
  const khuonTot=planKhuon!=null?planKhuon:KHUON.reduce((a,b)=>a+(+b||0),0);
  const cw=26;
  const days=Math.ceil((planRange.max-planRange.min)/864e5)+1;
  let headCells='';
  for(let i=0;i<days;i++){const d=addDays(planRange.min,i);const first=d.getDate()<=1||i===0;headCells+=`<div class="g-cell ${first?'mon':''}">${first?d.toLocaleDateString('vi-VN',{month:'short'}):''}<br>${d.getDate()}</div>`;}
  const rows=planRows.filter(r=>planFactoryView==='ALL'||r.factory===planFactoryView).map(r=>{
    const left=Math.ceil((r.start-planRange.min)/864e5)*cw;
    const w=Math.max(cw,(Math.ceil((r.end-r.start)/864e5)+1)*cw);
    return `<div class="g-row"><div class="g-side"><div class="o1">${r.factory} · ${r.key}</div><div class="o2">${fmt(r.total)} đôi · ${dstr(r.start)}→${dstr(r.end)}</div></div><div class="g-track"><div class="g-bar" style="left:${left}px;width:${w}px;background:${r.factory==='LAF'?colorOf(r.color):'#0F2A4A'}" title="${r.key}">${fmt(r.total)} đôi</div></div></div>`;
  }).join('');
  // detail table
  const det=planRows.filter(r=>planFactoryView==='ALL'||r.factory===planFactoryView).map(r=>`<tr>
    <td><span class="badge ${r.factory==='LAF'?'bg-amber':'bg-blue'}">${r.factory}</span></td>
    <td>${colorChip(r.color)} <span class="muted">${r.key}</span></td>
    <td>${dstr(r.start)}</td><td>${dstr(r.end)}</td><td class="num">${r.days} ngày</td>
    <td class="num">${fmt(r.daily)}</td><td class="num">${fmt(r.total)}</td><td class="num">${fmt(r.splitTarget)}</td>
    <td class="num" style="color:${r.dev<0?'var(--red)':'var(--green)'}">${r.dev>0?'+':''}${fmt(r.dev)}</td>
    <td>${r.deadline.split('-').reverse().join('/')}</td></tr>`).join('');
  const detMap=planRows.filter(r=>planFactoryView==='ALL'||r.factory===planFactoryView).flatMap(r=>(r.orders||[]).map(o=>`<tr>
    <td><span class="badge ${r.factory==='LAF'?'bg-amber':'bg-blue'}">${r.factory}</span></td>
    <td>${o.brand}</td><td>${o.country}</td>
    <td class="mono">${o.tvs}</td><td class="mono">${o.cust}</td><td class="mono">${o.code}</td>
    <td>${colorChip(o.color)}</td>
    <td>${dstr(r.start)}</td><td>${dstr(r.end)}</td>
    <td class="num">${fmt(o.total)}</td>
    <td>${o.deadline.split('-').reverse().join('/')}</td></tr>`)).join('');
  return `
  <div class="page-head"><div><h1>Kế hoạch SX</h1><p>Color Grouping Solver — gom nhóm tối ưu, ưu tiên deadline sớm, giảm số lần pha hoá chất tại LAF</p></div><div class="spacer"></div>
    <button class="btn" onclick="exportPlan()">⬇ Export Excel (KH LAF · KH LVF · Tổng hợp)</button>
    <button class="btn grn" onclick="resolve()">⚡ Chạy solver</button></div>
  <div class="card card-pad" style="margin-bottom:16px">
    <div class="flex wrap" style="gap:18px">
      <div><div style="font-size:11px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Chế độ chạy kế hoạch</div>
      <div class="chips">
        <button class="chip ${solverMode==='color'?'on grn':''}" onclick="setMode('color')">🎨 Theo màu</button>
        <button class="chip ${solverMode==='size'?'on grn':''}" onclick="setMode('size')">📏 Theo size (quay tua phom)</button>
        <button class="chip ${solverMode==='combined'?'on grn':''}" onclick="setMode('combined')">🔀 Kết hợp màu + size (tối ưu phom)</button>
      </div></div>
      <div style="border-left:1px solid var(--bd);padding-left:18px"><div style="font-size:11px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Ràng buộc phom / khuôn</div>
      <div class="flex wrap">
        <div class="field"><label>Số phom (LVF)</label><input type="number" min="0" value="${phomTot}" style="width:90px" onchange="setPlanPhom(this.value)"></div>
        <div class="field"><label>Số khuôn đế (LAF)</label><input type="number" min="0" value="${khuonTot}" style="width:90px" onchange="setPlanKhuon(this.value)"></div>
      </div></div>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h"><h3>Lịch sản xuất (Gantt)</h3><div class="legend" style="margin-left:16px"><span><span class="dot" style="background:#0F2A4A"></span>LVF</span>${colorList.slice(0,3).map(c=>`<span><span class="dot" style="background:${colorOf(c)}"></span>LAF ${c}</span>`).join('')}</div><div class="spacer"></div>
      <div class="seg"><button class="${planFactoryView==='ALL'?'on':''}" onclick="setPV('ALL')">Tất cả</button><button class="${planFactoryView==='LAF'?'on':''}" onclick="setPV('LAF')">LAF</button><button class="${planFactoryView==='LVF'?'on':''}" onclick="setPV('LVF')">LVF</button></div></div>
    <div class="gantt"><div class="gantt-inner" style="--cw:${cw}px"><div class="g-head"><div class="g-side">Lô / nhóm</div><div class="g-cells">${headCells}</div></div>${rows}</div></div>
  </div>
  <div class="card">
    <div class="card-h"><h3>Kế hoạch chi tiết</h3><span class="sub">${planRows.length} lô</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nhà máy</th><th>Nhóm màu</th><th>Bắt đầu</th><th>Kết thúc</th><th class="num">Khoảng TG</th><th class="num">SL mục tiêu/ngày</th><th class="num">Tổng SL mục tiêu</th><th class="num">Tổng SL tách</th><th class="num">Chênh lệch</th><th>Deadline</th></tr></thead><tbody>${det}</tbody></table></div>
  </div>
  <div class="sp16"></div>
  <div class="card">
    <div class="card-h"><h3>Kế hoạch chi tiết theo đơn hàng — mapping đầy đủ</h3><span class="sub">Brand · Quốc gia · ĐH TVS-Elite · ĐH khách hàng · Mã hàng · Màu</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nhà máy</th><th>Brand</th><th>Quốc gia</th><th>ĐH TVS-Elite</th><th>ĐH khách hàng</th><th>Mã hàng</th><th>Màu</th><th>Bắt đầu</th><th>Kết thúc</th><th class="num">SL đơn</th><th>Deadline</th></tr></thead><tbody>${detMap}</tbody></table></div>
  </div>`;
}
window.setMode=m=>{solverMode=m;runSolver();mount('plan');};
window.setPV=v=>{planFactoryView=v;mount('plan');};
window.setPlanPhom=v=>{planPhom=Math.max(0,+v||0);saveState();mount('plan');};
window.setPlanKhuon=v=>{planKhuon=Math.max(0,+v||0);saveState();mount('plan');};
window.resolve=()=>{runSolver();mount('plan');};
window.exportPlan=()=>alert('Export Excel: tạo workbook gồm 3 sheet — "KH LAF", "KH LVF", "Tổng hợp". (Trong prototype: minh hoạ luồng export.)');

/* ===== SCREEN: Tiến độ ===== */
let progSel=null;
function renderProgress(){
  recompute();
  const entryList=ORDERS.filter(o=>o.status!=='Đã xuất');
  if(progSel==null||!ORDERS.some(o=>o.stt===progSel&&o.status!=='Đã xuất')){
    const f=entryList.find(o=>o.status==='Đang SX')||entryList[0]||ORDERS[0];
    progSel=f?f.stt:null;
  }
  const sel=ORDERS.find(o=>o.stt===progSel);
  const totLaf=ORDERS.reduce((s,o)=>s+o.lafDone,0);
  const totLvf=ORDERS.reduce((s,o)=>s+o.lvfDone,0);
  const running=ORDERS.filter(o=>o.status==='Đang SX').length;
  const lvfPct=totalPairs?Math.round(totLvf/totalPairs*100):0;
  const opts=entryList.map(o=>`<option value="${o.stt}" ${o.stt===progSel?'selected':''}>#${o.stt} · ${o.tvs} · ${o.code} · ${o.color} (${fmt(o.total)} đôi)</option>`).join('');
  let entry='';
  if(sel){
    const a=ACTUALS[sel.stt]||{laf:{},lvf:{}};
    const srows=SIZES.filter(s=>sel.sizes[s]).map(s=>{
      const plan=sel.sizes[s]||0;
      const laf=(a.laf&&+a.laf[s])||0; const lvf=(a.lvf&&+a.lvf[s])||0;
      const over=lvf>laf;
      const lp=plan?Math.round(lvf/plan*100):0;
      return `<tr>
        <td><b>UK ${s}</b></td>
        <td class="num">${fmt(plan)}</td>
        <td class="num"><input type="number" min="0" value="${laf||''}" placeholder="0" onchange="setActual(${sel.stt},'laf',${s},this.value)" style="width:88px;text-align:right"></td>
        <td class="num"><input type="number" min="0" max="${laf}" value="${lvf||''}" placeholder="0" onchange="setActual(${sel.stt},'lvf',${s},this.value)" style="width:88px;text-align:right;${over?'border-color:var(--red);background:var(--red-soft)':''}"></td>
        <td class="num">${lp}%</td>
        <td>${over?'<span class="badge bg-red">LVF &gt; LAF ✕</span>':(plan&&lvf>=plan?'<span class="badge bg-green">Đủ</span>':(laf>0||lvf>0?'<span class="badge bg-blue">Đang chạy</span>':'<span class="badge bg-gray">—</span>'))}</td>
      </tr>`;
    }).join('');
    const tl=actualTotal(sel.stt,'laf'),tv=actualTotal(sel.stt,'lvf');
    entry=`
    <div class="card" style="margin-bottom:16px">
      <div class="card-h"><h3>Nhập sản lượng — #${sel.stt} · ${sel.code}</h3>
        <span class="sub">${colorChip(sel.color)} ${sel.brand} · ${sel.country} · ${sel.tvs}</span><div class="spacer"></div>
        <select onchange="selProg(this.value)" style="max-width:380px;padding:7px 10px;border:1px solid var(--bd);border-radius:8px">${opts}</select></div>
      <div class="card-pad" style="padding-top:0">
        <div class="note" style="margin:8px 0 14px">⚠️ Ràng buộc: <b>LVF ≤ LAF</b> cho từng size — đầu ra (LVF) không được vượt sản lượng đầu vào (LAF). Hệ thống tự giới hạn khi nhập vượt.</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Size</th><th class="num">Kế hoạch (đôi)</th><th class="num">LAF thực tế (đầu vào)</th><th class="num">LVF thực tế (đầu ra)</th><th class="num">% so KH</th><th>Trạng thái</th></tr></thead>
          <tbody>${srows}</tbody>
          <tfoot><tr style="font-weight:700;background:var(--bg)"><td>Tổng</td><td class="num">${fmt(sel.total)}</td><td class="num">${fmt(tl)}</td><td class="num">${fmt(tv)} ${tv>tl?'<span class="badge bg-red">vượt LAF</span>':''}</td><td class="num">${sel.total?Math.round(tv/sel.total*100):0}%</td><td>${stBadge(sel.status)}</td></tr></tfoot>
        </table></div>
      </div>
    </div>`;
  }
  const sumRows=ORDERS.map(o=>{
    const pct=o.total?Math.round(o.lvfDone/o.total*100):0;const cls=pct>=90?'':pct>=60?'am':'rd';
    return `<tr style="cursor:pointer" onclick="selProg(${o.stt})">
      <td class="mono">#${o.stt}</td><td class="mono">${o.tvs}</td><td>${colorChip(o.color)}</td><td>${o.country}</td>
      <td class="num">${fmt(o.total)}</td><td class="num">${fmt(o.lafDone)}</td><td class="num">${fmt(o.lvfDone)}</td>
      <td style="min-width:150px"><div class="flex"><div class="meter ${cls}" style="flex:1"><i style="width:${pct}%"></i></div><span class="mono" style="width:38px;text-align:right;font-weight:600">${pct}%</span></div></td>
      <td>${stBadge(o.status)}</td></tr>`;
  }).join('');
  return `
  <div class="page-head"><div><h1>Tiến độ</h1><p>Nhập sản lượng thực tế chi tiết theo đơn hàng / mã hàng / màu / size, so với kế hoạch — ràng buộc LVF ≤ LAF</p></div><div class="spacer"></div><button class="btn" onclick="resetTestData()">♻️ Reset dữ liệu test</button></div>
  <div class="grid kpis" style="margin-bottom:16px">
    ${kpi('LAF thực tế (đầu vào)','🏭','var(--amber-soft)',fmt(totLaf)+' đôi','Tổng nhập từ các lô')}
    ${kpi('LVF thực tế (đầu ra)','👟','var(--green-soft)',fmt(totLvf)+' đôi','Đầu ra ≤ đầu vào LAF')}
    ${kpi('% LVF / kế hoạch','🎯','var(--blue-soft)',lvfPct+'%','Mục tiêu '+fmt(totalPairs)+' đôi')}
    ${kpi('Lô đang chạy','⚙️','var(--blue-soft)',running+' lô','Đang sản xuất')}
  </div>
  ${entry}
  <div class="card"><div class="card-h"><h3>Tổng hợp tiến độ theo đơn hàng</h3><span class="sub">Bấm 1 dòng để nhập sản lượng</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>STT</th><th>ĐH TVS</th><th>Màu</th><th>Quốc gia</th><th class="num">Kế hoạch</th><th class="num">LAF</th><th class="num">LVF</th><th>% hoàn thành (LVF)</th><th>Trạng thái</th></tr></thead><tbody>${sumRows}</tbody></table></div>
  </div>`;
}
window.selProg=stt=>{progSel=+stt;mount('progress');};
window.setActual=(stt,f,size,val)=>{
  val=Math.max(0,Math.round(+val||0));
  const a=ACTUALS[stt]=ACTUALS[stt]||{laf:{},lvf:{}};
  a.laf=a.laf||{};a.lvf=a.lvf||{};
  if(f==='lvf'){const laf=+(a.laf[size]||0);if(val>laf){alert('⛔ LVF ('+fmt(val)+') không được vượt LAF ('+fmt(laf)+') ở UK'+size+'.\nĐầu ra không thể vượt đầu vào — đã giới hạn về '+fmt(laf)+'.');val=laf;}}
  a[f][size]=val;
  if(f==='laf'){const lvf=+(a.lvf[size]||0);if(lvf>val){a.lvf[size]=val;}}
  saveState();recompute();mount('progress');
};

/* ===== SCREEN: Tồn kho NVL ===== */
function renderMaterials(){
  const crit=MAT.filter(m=>m.status==='critical').length;
  const cards=MAT.map(m=>{const pct=Math.min(100,Math.round(m.stock/(m.safety*1.5)*100));const cls=m.status==='critical'?'rd':m.status==='low'?'am':'';const bd={ok:'bg-green',low:'bg-amber',critical:'bg-red'}[m.status];const lab={ok:'Đủ',low:'Dưới ngưỡng',critical:'Thiếu'}[m.status];
    return `<tr><td><b>${m.name}</b><div class="muted" style="font-size:11px">${m.grp} · ${m.sup}</div></td>
    <td class="num mono">${fmt(m.stock)} ${m.unit}</td><td class="num mono">${fmt(m.safety)}</td>
    <td class="num mono">${m.per}</td><td class="num mono">${fmt(m.need)}</td>
    <td style="min-width:140px"><div class="meter ${cls}"><i style="width:${pct}%"></i></div></td>
    <td><span class="badge ${bd}">${lab}</span></td>
    <td>${m.status!=='ok'?'<button class="btn sm">＋ Đề xuất mua</button>':'<span class="muted">—</span>'}</td></tr>`;}).join('');
  return `
  <div class="page-head"><div><h1>Tồn kho NVL</h1><p>Cao su · hoá chất · vải thun · khoen — tự tính nhu cầu theo kế hoạch &amp; cảnh báo thiếu trước ngày SX</p></div><div class="spacer"></div><button class="btn">＋ Nhập tồn kho</button><button class="btn pri">📋 Tạo đề xuất mua</button></div>
  <div class="grid kpis" style="margin-bottom:16px">
    ${kpi('Loại NVL','📦','var(--blue-soft)',MAT.length,'4 nhóm vật tư')}
    ${kpi('Cảnh báo thiếu','⚠️','var(--red-soft)',crit,'< tồn an toàn')}
    ${kpi('Dưới ngưỡng','🟡','var(--amber-soft)',MAT.filter(m=>m.status==='low').length,'cần theo dõi')}
    ${kpi('Đề xuất mua mở','🛒','var(--green-soft)',crit,'chờ duyệt thu mua')}
  </div>
  <div class="card"><div class="card-h"><h3>Tồn kho &amp; nhu cầu theo kế hoạch</h3></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vật tư</th><th class="num">Tồn kho</th><th class="num">Tồn an toàn</th><th class="num">ĐM/đôi</th><th class="num">Nhu cầu KH</th><th>Mức tồn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${cards}</tbody></table></div>
  </div>`;
}

/* ===== SCREEN: Xuất hàng ===== */
function renderShipment(){
  const ready=ORDERS.filter(o=>o.status==='Hoàn tất');
  const shipped=ORDERS.filter(o=>o.status==='Đã xuất');
  const onTime=Math.round(shipped.length/(shipped.length+1)*100+8);
  const rrows=ready.map(o=>`<tr><td class="mono">${o.tvs}</td><td>${colorChip(o.color)}</td><td>${o.country}</td><td class="num">${fmt(o.total)}</td><td>${o.deadline.split('-').reverse().join('/')}</td><td>${stBadge(o.status)}</td><td><button class="btn sm grn">✓ Xác nhận xuất</button></td></tr>`).join('');
  const srows=shipped.map(o=>`<tr><td class="mono">${o.tvs}</td><td>${colorChip(o.color)}</td><td>${o.country}</td><td class="num">${fmt(o.total)}</td><td>${o.deadline.split('-').reverse().join('/')}</td><td>CONT-${1000+(+o.stt)}</td><td><span class="badge bg-green">✓ Đúng hạn</span></td></tr>`).join('');
  return `
  <div class="page-head"><div><h1>Xuất hàng</h1><p>Kho vận xác nhận lô đã đóng thùng &amp; giao cho Tuấn Việt đúng ngày — cập nhật trạng thái đơn hàng</p></div></div>
  <div class="grid kpis" style="margin-bottom:16px">
    ${kpi('On-time delivery','🎯','var(--green-soft)',onTime+'%','Tổng hợp cho Admin')}
    ${kpi('Sẵn sàng xuất','📦','var(--amber-soft)',ready.length+' lô','Đã hoàn tất tại LVF')}
    ${kpi('Đã xuất','🚚','var(--blue-soft)',shipped.length+' lô',fmt(shipped.reduce((s,o)=>s+o.total,0))+' đôi')}
    ${kpi('Trễ hạn','⏰','var(--red-soft)','0','Tháng này')}
  </div>
  <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Lô sẵn sàng xuất</h3><span class="sub">${ready.length} lô</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ĐH TVS</th><th>Màu</th><th>Quốc gia</th><th class="num">SL</th><th>Ngày giao</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rrows||'<tr><td colspan=7 class="muted">Không có lô nào</td></tr>'}</tbody></table></div>
  </div>
  <div class="card"><div class="card-h"><h3>Lịch sử xuất hàng</h3><span class="sub">${shipped.length} lô</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ĐH TVS</th><th>Màu</th><th>Quốc gia</th><th class="num">SL</th><th>Ngày giao</th><th>Container</th><th>Trạng thái</th></tr></thead><tbody>${srows}</tbody></table></div>
  </div>`;
}

/* ===== ROUTER ===== */
const SCREENS={dashboard:{t:'Dashboard',f:renderDashboard},orders:{t:'Đơn hàng',f:renderOrders},test:{t:'Cấu hình Test',f:renderTest},capacity:{t:'Năng xuất MT',f:renderCapacity},plan:{t:'Kế hoạch SX',f:renderPlan},progress:{t:'Tiến độ',f:renderProgress},materials:{t:'Tồn kho NVL',f:renderMaterials},shipment:{t:'Xuất hàng',f:renderShipment}};
function mount(id){
  const s=SCREENS[id]; if(!s)return;
  $('#content').innerHTML=s.f();
  $$('.nav a').forEach(a=>a.classList.toggle('active',a.dataset.s===id));
  $('#crumbTitle').textContent=s.t;
  window.scrollTo(0,0);
  location.hash=id;
}
window.go=id=>mount(id);
window.addEventListener('DOMContentLoaded',()=>{
  const tb=document.querySelector('.topbar');
  if(tb){const b=document.createElement('button');b.className='btn sm';b.innerHTML='♻️ Reset dữ liệu test';b.title='Xoá toàn bộ dữ liệu test, giữ nguyên đơn hàng gốc';b.onclick=()=>window.resetTestData();tb.appendChild(b);}
  runSolver();mount(location.hash.slice(1)||'dashboard');
});

(function(){
'use strict';

var STATUS={
  REGISTERED:'REGISTERED',INSPECTING:'INSPECTING',QUOTED:'QUOTED',
  CONFIRMED:'CONFIRMED',REPAIRING:'REPAIRING',COMPLETED:'COMPLETED',
  PICKED_UP:'PICKED_UP',TERMINATED:'TERMINATED'
};

var STATUS_LABELS={};
STATUS_LABELS[STATUS.REGISTERED]='接单';
STATUS_LABELS[STATUS.INSPECTING]='检测中';
STATUS_LABELS[STATUS.QUOTED]='已报价';
STATUS_LABELS[STATUS.CONFIRMED]='客户确认';
STATUS_LABELS[STATUS.REPAIRING]='维修中';
STATUS_LABELS[STATUS.COMPLETED]='维修完成';
STATUS_LABELS[STATUS.PICKED_UP]='已取机';
STATUS_LABELS[STATUS.TERMINATED]='异常终止';

var STATUS_FLOW=[STATUS.REGISTERED,STATUS.INSPECTING,STATUS.QUOTED,STATUS.CONFIRMED,STATUS.REPAIRING,STATUS.COMPLETED,STATUS.PICKED_UP];

var STATUS_BADGE_CLASS={};
STATUS_BADGE_CLASS[STATUS.REGISTERED]='badge-registered';
STATUS_BADGE_CLASS[STATUS.INSPECTING]='badge-inspecting';
STATUS_BADGE_CLASS[STATUS.QUOTED]='badge-quoted';
STATUS_BADGE_CLASS[STATUS.CONFIRMED]='badge-confirmed';
STATUS_BADGE_CLASS[STATUS.REPAIRING]='badge-repairing';
STATUS_BADGE_CLASS[STATUS.COMPLETED]='badge-completed';
STATUS_BADGE_CLASS[STATUS.PICKED_UP]='badge-picked_up';
STATUS_BADGE_CLASS[STATUS.TERMINATED]='badge-terminated';

var STORAGE_KEYS={
  ORDERS:'crp_orders',PARTS:'crp_parts',LABOR:'crp_labor',
  QUOTES:'crp_quotes',HISTORY:'crp_history',
  ROLLBACKS:'crp_rollback_records',TERMINATIONS:'crp_termination_records',
  INITIALIZED:'crp_initialized'
};

function uuid(){return 'xxxx-xxxx'.replace(/x/g,function(){return Math.floor(Math.random()*16).toString(16)})}
function now(){return new Date().toISOString()}
function pad(n){return n<10?'0'+n:n}
function formatDateTime(iso){if(!iso)return'-';var d=new Date(iso);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())}
function formatDate(iso){if(!iso)return'-';var d=new Date(iso);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function truncate(s,n){if(!s)return'';return s.length>n?s.substring(0,n)+'...':s}

function generateOrderNo(){
  var today=formatDate(now()).replace(/-/g,'');
  var orders=Store.load(STORAGE_KEYS.ORDERS)||[];
  var count=orders.filter(function(o){return o.orderNo.indexOf(today)>-1}).length+1;
  return 'WX-'+today+'-'+String(count).padStart(3,'0');
}

var Store={
  load:function(key){try{var d=localStorage.getItem(key);return d?JSON.parse(d):null}catch(e){return null}},
  save:function(key,data){try{localStorage.setItem(key,JSON.stringify(data))}catch(e){console.error('Storage error',e)}},
  getOrders:function(){return this.load(STORAGE_KEYS.ORDERS)||[]},
  saveOrders:function(o){this.save(STORAGE_KEYS.ORDERS,o)},
  getOrderById:function(id){return this.getOrders().find(function(o){return o.id===id})},
  getParts:function(){return this.load(STORAGE_KEYS.PARTS)||[]},
  saveParts:function(o){this.save(STORAGE_KEYS.PARTS,o)},
  getPartById:function(id){return this.getParts().find(function(p){return p.id===id})},
  getLabor:function(){return this.load(STORAGE_KEYS.LABOR)||[]},
  saveLabor:function(o){this.save(STORAGE_KEYS.LABOR,o)},
  getLaborById:function(id){return this.getLabor().find(function(l){return l.id===id})},
  getQuotes:function(){return this.load(STORAGE_KEYS.QUOTES)||[]},
  saveQuotes:function(o){this.save(STORAGE_KEYS.QUOTES,o)},
  getQuotesByOrderId:function(oid){return this.getQuotes().filter(function(q){return q.orderId===oid})},
  getLatestQuote:function(oid){var qs=this.getQuotesByOrderId(oid);if(!qs.length)return null;qs.sort(function(a,b){return b.version-a.version});return qs[0]},
  getHistory:function(){return this.load(STORAGE_KEYS.HISTORY)||[]},
  saveHistory:function(o){this.save(STORAGE_KEYS.HISTORY,o)},
  getHistoryByOrderId:function(oid){return this.getHistory().filter(function(h){return h.orderId===oid})},
  getRollbacks:function(){return this.load(STORAGE_KEYS.ROLLBACKS)||[]},
  saveRollbacks:function(o){this.save(STORAGE_KEYS.ROLLBACKS,o)},
  getRollbacksByOrderId:function(oid){return this.getRollbacks().filter(function(r){return r.orderId===oid})},
  getTerminations:function(){return this.load(STORAGE_KEYS.TERMINATIONS)||[]},
  saveTerminations:function(o){this.save(STORAGE_KEYS.TERMINATIONS,o)},
  getTerminationByOrderId:function(oid){return this.getTerminations().find(function(t){return t.orderId===oid})}
};

var Validator={
  canAdvance:function(order,targetStatus){
    if(!order)return{ok:false,msg:'工单不存在'};
    if(order.currentStatus===STATUS.TERMINATED)return{ok:false,msg:'工单已异常终止，无法推进状态'};
    if(order.currentStatus===STATUS.PICKED_UP)return{ok:false,msg:'工单已取机，无法再推进状态'};
    if(targetStatus===STATUS.TERMINATED){
      if(order.currentStatus===STATUS.PICKED_UP)return{ok:false,msg:'已取机的工单不能终止'};
      return{ok:true};
    }
    var ci=STATUS_FLOW.indexOf(order.currentStatus);
    var ti=STATUS_FLOW.indexOf(targetStatus);
    if(ti===-1)return{ok:false,msg:'未知的目标状态'};
    if(ci===-1)return{ok:false,msg:'当前状态异常'};
    if(targetStatus===STATUS.REPAIRING&&order.currentStatus!==STATUS.CONFIRMED){
      return{ok:false,msg:'必须经客户确认后才能进入维修，当前状态：'+STATUS_LABELS[order.currentStatus]};
    }
    if(ti!==ci+1)return{ok:false,msg:'状态只能按顺序推进，不能从'+STATUS_LABELS[order.currentStatus]+'直接跳到'+STATUS_LABELS[targetStatus]};
    return{ok:true};
  },
  canRollback:function(order){
    if(!order)return{ok:false,msg:'工单不存在'};
    if(order.currentStatus===STATUS.TERMINATED)return{ok:false,msg:'已终止的工单不能撤回'};
    if(order.currentStatus===STATUS.PICKED_UP)return{ok:false,msg:'已取机的工单不能撤回'};
    if(order.currentStatus===STATUS.REGISTERED)return{ok:false,msg:'当前已是初始状态，没有可撤回的动作'};
    return{ok:true};
  },
  canEdit:function(order){
    if(!order)return{ok:false,msg:'工单不存在'};
    if(order.currentStatus===STATUS.PICKED_UP)return{ok:false,msg:'已取机的工单不允许编辑'};
    if(order.currentStatus===STATUS.TERMINATED)return{ok:false,msg:'已终止的工单不允许编辑'};
    return{ok:true};
  },
  validateQuoteItems:function(parts,laborItems){
    var allParts=Store.getParts();
    var allLabor=Store.getLabor();
    for(var i=0;i<parts.length;i++){
      var item=parts[i];
      var found=allParts.find(function(p){return p.id===item.partId});
      if(!found)return{ok:false,msg:'配件"'+item.partName+'"不在配件库中，请先添加或选择已有配件'};
      if(item.quantity<=0)return{ok:false,msg:'配件"'+item.partName+'"数量必须大于0'};
      if(item.unitPrice<0)return{ok:false,msg:'配件"'+item.partName+'"单价不能为负数'};
      if(item.subtotal<0)return{ok:false,msg:'配件"'+item.partName+'"小计不能为负数'};
    }
    for(var j=0;j<laborItems.length;j++){
      var li=laborItems[j];
      var lf=allLabor.find(function(l){return l.id===li.laborItemId});
      if(!lf)return{ok:false,msg:'工时项目"'+li.laborName+'"不在工时库中，请先添加或选择已有项目'};
      if(li.fee<0)return{ok:false,msg:'工时项目"'+li.laborName+'"费用不能为负数'};
    }
    return{ok:true};
  }
};

var StatusEngine={
  advance:function(orderId,targetStatus,handler,note){
    var orders=Store.getOrders();
    var order=orders.find(function(o){return o.id===orderId});
    if(!order)return{ok:false,msg:'工单不存在'};
    var v=Validator.canAdvance(order,targetStatus);
    if(!v.ok)return v;
    var prev=order.currentStatus;
    order.currentStatus=targetStatus;
    order.updatedAt=now();
    Store.saveOrders(orders);
    var h=Store.getHistory();
    h.push({id:uuid(),orderId:orderId,fromStatus:prev,toStatus:targetStatus,handler:handler||'',note:note||'',timestamp:now(),type:'advance'});
    Store.saveHistory(h);
    return{ok:true};
  },
  rollback:function(orderId,handler,note){
    var orders=Store.getOrders();
    var order=orders.find(function(o){return o.id===orderId});
    if(!order)return{ok:false,msg:'工单不存在'};
    var v=Validator.canRollback(order);
    if(!v.ok)return v;
    var prev=order.currentStatus;
    var ci=STATUS_FLOW.indexOf(prev);
    var prevStep=STATUS_FLOW[ci-1];
    order.currentStatus=prevStep;
    order.updatedAt=now();
    Store.saveOrders(orders);
    var h=Store.getHistory();
    h.push({id:uuid(),orderId:orderId,fromStatus:prev,toStatus:prevStep,handler:handler||'',note:note||'',timestamp:now(),type:'rollback'});
    Store.saveHistory(h);
    var rb=Store.getRollbacks();
    rb.push({id:uuid(),orderId:orderId,rolledBackFrom:prev,rolledBackTo:prevStep,handler:handler||'',note:note||'',timestamp:now()});
    Store.saveRollbacks(rb);
    return{ok:true};
  },
  terminate:function(orderId,reason,handler){
    var orders=Store.getOrders();
    var order=orders.find(function(o){return o.id===orderId});
    if(!order)return{ok:false,msg:'工单不存在'};
    var v=Validator.canAdvance(order,STATUS.TERMINATED);
    if(!v.ok)return v;
    var prev=order.currentStatus;
    order.currentStatus=STATUS.TERMINATED;
    order.updatedAt=now();
    Store.saveOrders(orders);
    var h=Store.getHistory();
    h.push({id:uuid(),orderId:orderId,fromStatus:prev,toStatus:STATUS.TERMINATED,handler:handler||'',note:'异常终止：'+reason,timestamp:now(),type:'terminate'});
    Store.saveHistory(h);
    var t=Store.getTerminations();
    t.push({id:uuid(),orderId:orderId,fromStatus:prev,reason:reason,handler:handler||'',timestamp:now()});
    Store.saveTerminations(t);
    return{ok:true};
  }
};

var QuoteEngine={
  generate:function(orderId,parts,laborItems,handler){
    var orders=Store.getOrders();
    var order=orders.find(function(o){return o.id===orderId});
    if(!order)return{ok:false,msg:'工单不存在'};
    if(order.currentStatus!==STATUS.INSPECTING&&order.currentStatus!==STATUS.QUOTED){
      return{ok:false,msg:'只有检测中或已报价状态的工单才能生成报价'};
    }
    var v=Validator.validateQuoteItems(parts,laborItems);
    if(!v.ok)return v;
    var existing=Store.getQuotesByOrderId(orderId);
    var version=existing.length+1;
    var tpc=parts.reduce(function(s,p){return s+p.subtotal},0);
    var tlc=laborItems.reduce(function(s,l){return s+l.fee},0);
    var quote={
      id:uuid(),orderId:orderId,version:version,
      parts:JSON.parse(JSON.stringify(parts)),
      laborItems:JSON.parse(JSON.stringify(laborItems)),
      totalPartsCost:tpc,totalLaborCost:tlc,
      totalCost:tpc+tlc,createdAt:now(),handler:handler||''
    };
    var qs=Store.getQuotes();
    qs.push(quote);
    Store.saveQuotes(qs);
    if(order.currentStatus===STATUS.INSPECTING){
      var ar=StatusEngine.advance(orderId,STATUS.QUOTED,handler||'','生成报价（版本'+version+'）');
      if(!ar.ok)return ar;
    }
    return{ok:true,quote:quote};
  }
};

function showToast(message,type){
  type=type||'info';
  var c=document.getElementById('toast-container');
  var t=document.createElement('div');
  t.className='toast toast-'+type;
  t.textContent=message;
  c.appendChild(t);
  setTimeout(function(){t.classList.add('removing');setTimeout(function(){t.remove()},300)},3000);
}

function showModal(title,bodyHtml,footerHtml){
  var o=document.getElementById('modal-overlay');
  var c=document.getElementById('modal-content');
  c.innerHTML='<div class="modal-header"><h3>'+title+'</h3><button class="btn btn-ghost btn-sm" onclick="window.AppCloseModal()">✕</button></div><div class="modal-body">'+bodyHtml+'</div>'+(footerHtml?'<div class="modal-footer">'+footerHtml+'</div>':'');
  o.classList.add('show');
}

function closeModal(){
  document.getElementById('modal-overlay').classList.remove('show');
  document.getElementById('modal-content').innerHTML='';
}

function navigateTo(page,opts){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});
  var pe=document.getElementById('page-'+page);
  if(pe)pe.classList.add('active');
  var ne=document.querySelector('[data-page="'+page+'"]');
  if(ne)ne.classList.add('active');
  switch(page){
    case'dashboard':UI.renderDashboard();break;
    case'new-order':UI.renderNewOrder();break;
    case'order-list':UI.renderOrderList();break;
    case'order-detail':UI.renderOrderDetail(opts&&opts.orderId);break;
    case'parts-config':UI.renderPartsConfig();break;
    case'labor-config':UI.renderLaborConfig();break;
    case'history':UI.renderHistory();break;
    case'export':UI.renderExport();break;
  }
}

function renderStatusBar(order){
  var terminated=order.currentStatus===STATUS.TERMINATED;
  var ci=terminated?-1:STATUS_FLOW.indexOf(order.currentStatus);
  var html='<div class="status-bar"><div class="status-bar-line"><div class="status-bar-line-fill" style="width:'+(terminated?0:ci<0?0:Math.round(ci/(STATUS_FLOW.length-1)*100))+'%"></div></div>';
  STATUS_FLOW.forEach(function(s,i){
    var cls='';
    if(!terminated&&i<ci)cls='completed';
    else if(!terminated&&i===ci)cls='active';
    html+='<div class="status-step '+cls+'"><div class="step-dot">'+(i<ci?'✓':i===ci?'●':i+1)+'</div><div class="step-label">'+STATUS_LABELS[s]+'</div></div>';
  });
  if(terminated){html+='<div class="status-step terminated"><div class="step-dot">✕</div><div class="step-label">终止</div></div>';}
  html+='</div>';
  return html;
}

function renderQuoteTable(q){
  var html='<table class="quote-table"><thead><tr><th>配件</th><th>单价</th><th>数量</th><th>小计</th></tr></thead><tbody>';
  q.parts.forEach(function(p){html+='<tr><td>'+esc(p.partName)+'</td><td>¥'+p.unitPrice.toFixed(2)+'</td><td>'+p.quantity+'</td><td>¥'+p.subtotal.toFixed(2)+'</td></tr>';});
  if(q.laborItems.length){
    html+='<tr><td colspan="4" style="font-weight:600;padding-top:12px">工时费用</td></tr>';
    q.laborItems.forEach(function(l){html+='<tr><td>'+esc(l.laborName)+'</td><td colspan="2">-</td><td>¥'+l.fee.toFixed(2)+'</td></tr>';});
  }
  html+='</tbody></table>';
  html+='<div class="quote-total">配件合计：¥'+q.totalPartsCost.toFixed(2)+' + 工时合计：¥'+q.totalLaborCost.toFixed(2)+' = 总计：¥'+q.totalCost.toFixed(2)+'</div>';
  return html;
}

var UI={
  renderDashboard:function(){
    var el=document.getElementById('page-dashboard');
    var orders=Store.getOrders();
    var sc={};
    STATUS_FLOW.concat([STATUS.TERMINATED]).forEach(function(s){sc[s]=0});
    orders.forEach(function(o){if(sc[o.currentStatus]!==undefined)sc[o.currentStatus]++});
    var recent=orders.slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)}).slice(0,8);
    el.innerHTML=
      '<div class="page-header"><h2>📊 工作台</h2><p>维修工单概览与快捷操作</p></div>'+
      '<div class="stats-grid">'+
        '<div class="stat-card"><div class="stat-icon">📋</div><div class="stat-label">全部工单</div><div class="stat-value">'+orders.length+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">📝</div><div class="stat-label">待检测</div><div class="stat-value">'+sc[STATUS.REGISTERED]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">🔍</div><div class="stat-label">检测中</div><div class="stat-value">'+sc[STATUS.INSPECTING]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">待确认</div><div class="stat-value">'+sc[STATUS.QUOTED]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">🔧</div><div class="stat-label">维修中</div><div class="stat-value">'+sc[STATUS.REPAIRING]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">✅</div><div class="stat-label">已完成</div><div class="stat-value">'+sc[STATUS.COMPLETED]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">已取机</div><div class="stat-value">'+sc[STATUS.PICKED_UP]+'</div></div>'+
        '<div class="stat-card"><div class="stat-icon">⛔</div><div class="stat-label">已终止</div><div class="stat-value">'+sc[STATUS.TERMINATED]+'</div></div>'+
      '</div>'+
      '<div class="quick-actions">'+
        '<button class="btn btn-primary" onclick="window.AppNavigate(\'new-order\')">📝 新建工单</button>'+
        '<button class="btn" onclick="window.AppNavigate(\'order-list\')">📋 查看全部</button>'+
      '</div>'+
      '<div class="recent-orders"><div class="section-title">最近工单</div><div class="card"><div class="card-body"><div class="table-wrap"><table>'+
        '<thead><tr><th>工单号</th><th>客户</th><th>设备</th><th>状态</th><th>创建时间</th></tr></thead><tbody>'+
        (recent.length?recent.map(function(o){
          return '<tr class="clickable-row" onclick="window.AppNavigate(\'order-detail\',{orderId:\''+o.id+'\'})">'+
            '<td><span class="order-no">'+o.orderNo+'</span></td>'+
            '<td>'+esc(o.customerName)+'</td>'+
            '<td>'+esc(o.deviceBrand)+' '+esc(o.deviceModel)+'</td>'+
            '<td><span class="badge '+STATUS_BADGE_CLASS[o.currentStatus]+'">'+STATUS_LABELS[o.currentStatus]+'</span></td>'+
            '<td>'+formatDateTime(o.createdAt)+'</td></tr>';
        }).join(''):'<tr><td colspan="5" class="empty-state">暂无工单</td></tr>')+
      '</tbody></table></div></div></div></div>';
  },

  renderNewOrder:function(){
    var el=document.getElementById('page-new-order');
    el.innerHTML=
      '<div class="page-header"><h2>📝 接单登记</h2><p>登记新的电脑维修工单</p></div>'+
      '<div class="card"><div class="card-body">'+
        '<div class="form-row">'+
          '<div class="form-group"><label>客户姓名 *</label><input type="text" id="f-customerName" placeholder="请输入客户姓名"></div>'+
          '<div class="form-group"><label>联系电话 *</label><input type="text" id="f-customerPhone" placeholder="请输入联系电话"></div>'+
        '</div>'+
        '<div class="form-row-3">'+
          '<div class="form-group"><label>设备类型 *</label><select id="f-deviceType">'+
            '<option value="">请选择</option><option value="笔记本">笔记本</option><option value="台式机">台式机</option>'+
            '<option value="一体机">一体机</option><option value="平板">平板</option><option value="其他">其他</option>'+
          '</select></div>'+
          '<div class="form-group"><label>品牌 *</label><input type="text" id="f-deviceBrand" placeholder="如 联想、Dell"></div>'+
          '<div class="form-group"><label>型号</label><input type="text" id="f-deviceModel" placeholder="如 ThinkPad X1"></div>'+
        '</div>'+
        '<div class="form-group"><label>故障描述 *</label><textarea id="f-faultDescription" placeholder="请详细描述故障现象"></textarea></div>'+
        '<div class="form-row">'+
          '<div class="form-group"><label>处理人</label><input type="text" id="f-handler" placeholder="负责接待/维修的工程师"></div>'+
          '<div class="form-group"><label>备注</label><input type="text" id="f-note" placeholder="可选"></div>'+
        '</div>'+
        '<div style="margin-top:16px">'+
          '<button class="btn btn-primary" onclick="window.AppSubmitOrder()">✅ 提交登记</button>'+
          '<button class="btn" onclick="window.AppNavigate(\'dashboard\')" style="margin-left:8px">取消</button>'+
        '</div>'+
      '</div></div>';
  },

  renderOrderList:function(){
    var el=document.getElementById('page-order-list');
    var orders=Store.getOrders().slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)});
    var statuses=STATUS_FLOW.concat([STATUS.TERMINATED]);
    el.innerHTML=
      '<div class="page-header"><h2>📋 单据列表</h2><p>查看所有维修工单</p></div>'+
      '<div class="filter-bar">'+
        '<select id="filter-status" onchange="window.AppFilterOrders()">'+
          '<option value="">全部状态</option>'+
          statuses.map(function(s){return '<option value="'+s+'">'+STATUS_LABELS[s]+'</option>'}).join('')+
        '</select>'+
        '<div class="search-box"><input type="text" id="filter-search" placeholder="搜索工单号/客户名..." oninput="window.AppFilterOrders()"></div>'+
        '<button class="btn btn-primary" onclick="window.AppNavigate(\'new-order\')" style="margin-left:auto">📝 新建工单</button>'+
      '</div>'+
      '<div class="card"><div class="card-body"><div class="table-wrap"><table>'+
        '<thead><tr><th>工单号</th><th>客户</th><th>电话</th><th>设备</th><th>故障</th><th>状态</th><th>处理人</th><th>创建时间</th><th>操作</th></tr></thead>'+
        '<tbody id="order-list-body"></tbody>'+
      '</table></div></div></div>';
    this._renderOrderListRows(orders);
  },

  _renderOrderListRows:function(orders){
    var tbody=document.getElementById('order-list-body');
    if(!tbody)return;
    if(!orders.length){tbody.innerHTML='<tr><td colspan="9" class="empty-state">暂无匹配的工单</td></tr>';return}
    tbody.innerHTML=orders.map(function(o){
      return '<tr class="clickable-row" onclick="window.AppNavigate(\'order-detail\',{orderId:\''+o.id+'\'})">'+
        '<td><span class="order-no">'+o.orderNo+'</span></td>'+
        '<td>'+esc(o.customerName)+'</td>'+
        '<td>'+esc(o.customerPhone)+'</td>'+
        '<td>'+esc(o.deviceBrand)+' '+esc(o.deviceModel)+'</td>'+
        '<td title="'+esc(o.faultDescription)+'">'+esc(truncate(o.faultDescription,20))+'</td>'+
        '<td><span class="badge '+STATUS_BADGE_CLASS[o.currentStatus]+'">'+STATUS_LABELS[o.currentStatus]+'</span></td>'+
        '<td>'+esc(o.handler||'-')+'</td>'+
        '<td>'+formatDateTime(o.createdAt)+'</td>'+
        '<td><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();window.AppNavigate(\'order-detail\',{orderId:\''+o.id+'\'})">详情</button></td></tr>';
    }).join('');
  },

  renderOrderDetail:function(orderId){
    var el=document.getElementById('page-order-detail');
    var order=Store.getOrderById(orderId);
    if(!order){el.innerHTML='<div class="empty-state"><div class="empty-icon">❌</div><p>工单不存在</p></div>';return}
    var history=Store.getHistoryByOrderId(orderId).sort(function(a,b){return new Date(a.timestamp)-new Date(b.timestamp)});
    var quotes=Store.getQuotesByOrderId(orderId).sort(function(a,b){return a.version-b.version});
    var termination=Store.getTerminationByOrderId(orderId);

    var statusBarHtml=renderStatusBar(order);
    var quoteHtml='';
    if(quotes.length){
      quoteHtml='<div class="detail-section"><h4>💰 报价记录</h4>';
      quotes.forEach(function(q){
        quoteHtml+='<div class="quote-section"><div class="quote-version">版本 '+q.version+' · '+formatDateTime(q.createdAt)+(q.handler?' · '+esc(q.handler):'')+'</div>'+renderQuoteTable(q)+'</div>';
      });
      quoteHtml+='</div>';
    }

    var historyHtml='<div class="detail-section"><h4>📜 操作历史</h4><div class="timeline">';
    history.forEach(function(h){
      var cls='';
      if(h.type==='rollback')cls='rollback';
      if(h.type==='terminate')cls='terminate';
      var label=STATUS_LABELS[h.fromStatus]+' → '+STATUS_LABELS[h.toStatus];
      if(!h.fromStatus)label='创建工单 → '+STATUS_LABELS[h.toStatus];
      historyHtml+='<div class="timeline-item '+cls+'"><div class="timeline-time">'+formatDateTime(h.timestamp)+'</div><div class="timeline-content">'+esc(label)+(h.note?' — '+esc(h.note):'')+'</div><div class="timeline-handler">处理人：'+esc(h.handler||'未指定')+'</div></div>';
    });
    historyHtml+='</div></div>';

    var actionHtml='<div class="action-bar">';
    var ci=STATUS_FLOW.indexOf(order.currentStatus);
    if(order.currentStatus!==STATUS.TERMINATED&&order.currentStatus!==STATUS.PICKED_UP&&ci<STATUS_FLOW.length-1){
      var ns=STATUS_FLOW[ci+1];
      var av=Validator.canAdvance(order,ns);
      if(av.ok){
        var bl='推进 → '+STATUS_LABELS[ns];
        if(ns===STATUS.INSPECTING)bl='🔍 开始检测';
        if(ns===STATUS.QUOTED)bl='💰 生成报价';
        if(ns===STATUS.CONFIRMED)bl='✅ 客户确认';
        if(ns===STATUS.REPAIRING)bl='🔧 开始维修';
        if(ns===STATUS.COMPLETED)bl='🏁 维修完成';
        if(ns===STATUS.PICKED_UP)bl='📦 客户取机';
        actionHtml+='<button class="btn btn-primary" onclick="window.AppAdvanceOrder(\''+orderId+'\',\''+ns+'\')">'+bl+'</button>';
      }
    }
    if(order.currentStatus===STATUS.INSPECTING||order.currentStatus===STATUS.QUOTED){
      actionHtml+='<button class="btn btn-warning" onclick="window.AppShowQuoteModal(\''+orderId+'\')">💰 生成/更新报价</button>';
    }
    var rv=Validator.canRollback(order);
    if(rv.ok){
      var pi=ci-1;
      actionHtml+='<button class="btn btn-warning" onclick="window.AppRollbackOrder(\''+orderId+'\')">↩ 撤回到'+STATUS_LABELS[STATUS_FLOW[pi]]+'</button>';
    }
    if(order.currentStatus!==STATUS.TERMINATED&&order.currentStatus!==STATUS.PICKED_UP){
      actionHtml+='<button class="btn btn-danger" onclick="window.AppTerminateOrder(\''+orderId+'\')">⛔ 异常终止</button>';
    }
    actionHtml+='<button class="btn" onclick="window.AppNavigate(\'order-list\')">← 返回列表</button></div>';

    var termHtml='';
    if(termination){
      termHtml='<div class="alert alert-error">⛔ 异常终止 — 原因：'+esc(termination.reason)+' · 处理人：'+esc(termination.handler||'未指定')+' · 时间：'+formatDateTime(termination.timestamp)+'</div>';
    }

    el.innerHTML=
      '<div class="page-header"><h2>工单详情 · '+order.orderNo+'</h2><p>'+STATUS_LABELS[order.currentStatus]+'</p></div>'+
      actionHtml+statusBarHtml+termHtml+
      '<div class="detail-section"><h4>📋 基本信息</h4><div class="detail-grid">'+
        '<div class="detail-item"><span class="detail-label">工单号</span><span class="detail-value">'+esc(order.orderNo)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">当前状态</span><span class="detail-value"><span class="badge '+STATUS_BADGE_CLASS[order.currentStatus]+'">'+STATUS_LABELS[order.currentStatus]+'</span></span></div>'+
        '<div class="detail-item"><span class="detail-label">客户姓名</span><span class="detail-value">'+esc(order.customerName)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">联系电话</span><span class="detail-value">'+esc(order.customerPhone)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">设备类型</span><span class="detail-value">'+esc(order.deviceType)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">品牌/型号</span><span class="detail-value">'+esc(order.deviceBrand)+' '+esc(order.deviceModel)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">故障描述</span><span class="detail-value">'+esc(order.faultDescription)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">处理人</span><span class="detail-value">'+esc(order.handler||'-')+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">创建时间</span><span class="detail-value">'+formatDateTime(order.createdAt)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">更新时间</span><span class="detail-value">'+formatDateTime(order.updatedAt)+'</span></div>'+
      '</div></div>'+quoteHtml+historyHtml;
  },

  renderPartsConfig:function(){
    var el=document.getElementById('page-parts-config');
    var parts=Store.getParts().sort(function(a,b){return a.category.localeCompare(b.category)});
    var cats=[];
    parts.forEach(function(p){if(cats.indexOf(p.category)===-1)cats.push(p.category)});
    el.innerHTML=
      '<div class="page-header"><h2>🔩 配件管理</h2><p>管理维修配件与价格</p></div>'+
      '<div class="action-bar"><button class="btn btn-primary" onclick="window.AppShowPartModal()">+ 添加配件</button></div>'+
      '<div class="card"><div class="card-body">'+
        (parts.length?cats.map(function(cat){
          var cp=parts.filter(function(p){return p.category===cat});
          return '<div style="margin-bottom:16px"><div class="section-title">'+esc(cat)+'</div>'+
            cp.map(function(p){
              return '<div class="config-item"><div class="config-info"><span class="config-name">'+esc(p.name)+'</span><span class="config-meta">更新于 '+formatDateTime(p.updatedAt)+'</span></div><div class="config-price">¥'+p.unitPrice.toFixed(2)+'</div><div class="config-actions"><button class="btn btn-sm" onclick="window.AppShowPartModal(\''+p.id+'\')">编辑</button><button class="btn btn-sm btn-danger" onclick="window.AppDeletePart(\''+p.id+'\')">删除</button></div></div>';
            }).join('')+'</div>';
        }).join(''):'<div class="empty-state"><div class="empty-icon">🔩</div><p>暂无配件，点击上方按钮添加</p></div>')+
      '</div></div>';
  },

  renderLaborConfig:function(){
    var el=document.getElementById('page-labor-config');
    var labor=Store.getLabor().sort(function(a,b){return a.category.localeCompare(b.category)});
    var cats=[];
    labor.forEach(function(l){if(cats.indexOf(l.category)===-1)cats.push(l.category)});
    el.innerHTML=
      '<div class="page-header"><h2>⏱️ 工时管理</h2><p>管理工时项目与费用标准</p></div>'+
      '<div class="action-bar"><button class="btn btn-primary" onclick="window.AppShowLaborModal()">+ 添加工时项目</button></div>'+
      '<div class="card"><div class="card-body">'+
        (labor.length?cats.map(function(cat){
          var cl=labor.filter(function(l){return l.category===cat});
          return '<div style="margin-bottom:16px"><div class="section-title">'+esc(cat)+'</div>'+
            cl.map(function(l){
              return '<div class="config-item"><div class="config-info"><span class="config-name">'+esc(l.name)+'</span><span class="config-meta">更新于 '+formatDateTime(l.updatedAt)+'</span></div><div class="config-price">¥'+l.fee.toFixed(2)+'</div><div class="config-actions"><button class="btn btn-sm" onclick="window.AppShowLaborModal(\''+l.id+'\')">编辑</button><button class="btn btn-sm btn-danger" onclick="window.AppDeleteLabor(\''+l.id+'\')">删除</button></div></div>';
            }).join('')+'</div>';
        }).join(''):'<div class="empty-state"><div class="empty-icon">⏱️</div><p>暂无工时项目，点击上方按钮添加</p></div>')+
      '</div></div>';
  },

  renderHistory:function(){
    var el=document.getElementById('page-history');
    var ah=Store.getHistory().sort(function(a,b){return new Date(b.timestamp)-new Date(a.timestamp)});
    var ao=Store.getOrders();
    el.innerHTML=
      '<div class="page-header"><h2>📜 操作历史</h2><p>所有工单的状态变更与操作记录</p></div>'+
      '<div class="filter-bar"><input type="text" id="history-search" placeholder="搜索工单号/处理人..." oninput="window.AppFilterHistory()"></div>'+
      '<div class="card"><div class="card-body"><div class="table-wrap"><table>'+
        '<thead><tr><th>时间</th><th>工单号</th><th>操作类型</th><th>状态变更</th><th>处理人</th><th>备注</th></tr></thead>'+
        '<tbody id="history-list-body"></tbody></table></div></div></div>';
    this._renderHistoryRows(ah,ao);
  },

  _renderHistoryRows:function(history,orders){
    var tbody=document.getElementById('history-list-body');
    if(!tbody)return;
    if(!history.length){tbody.innerHTML='<tr><td colspan="6" class="empty-state">暂无操作记录</td></tr>';return}
    tbody.innerHTML=history.map(function(h){
      var order=orders.find(function(o){return o.id===h.orderId});
      var tl='';
      if(h.type==='advance')tl='<span class="badge badge-confirmed">推进</span>';
      if(h.type==='rollback')tl='<span class="badge badge-quoted">撤回</span>';
      if(h.type==='terminate')tl='<span class="badge badge-terminated">终止</span>';
      var fl=h.fromStatus?STATUS_LABELS[h.fromStatus]:'创建';
      return '<tr><td>'+formatDateTime(h.timestamp)+'</td><td><span class="order-no" onclick="window.AppNavigate(\'order-detail\',{orderId:\''+h.orderId+'\'})">'+(order?order.orderNo:h.orderId)+'</span></td><td>'+tl+'</td><td>'+fl+' → '+STATUS_LABELS[h.toStatus]+'</td><td>'+esc(h.handler||'-')+'</td><td>'+esc(h.note||'-')+'</td></tr>';
    }).join('');
  },

  renderExport:function(){
    var el=document.getElementById('page-export');
    var orders=Store.getOrders();var quotes=Store.getQuotes();var parts=Store.getParts();
    var labor=Store.getLabor();var history=Store.getHistory();var rbs=Store.getRollbacks();var terms=Store.getTerminations();
    el.innerHTML=
      '<div class="page-header"><h2>📥 数据导出</h2><p>导出所有业务数据为本地文件</p></div>'+
      '<div class="export-section">'+
        '<div class="export-card"><h4>📊 全量数据导出</h4><p>导出所有工单、报价、配置、历史记录等数据为JSON文件，关闭应用后重新导入可恢复全部数据。</p>'+
          '<div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="window.AppExportJSON()">📥 导出 JSON</button><button class="btn btn-success" onclick="window.AppExportCSV()">📥 导出 CSV (工单明细)</button></div></div>'+
        '<div class="export-card"><h4>📋 数据统计</h4><div class="detail-grid">'+
          '<div class="detail-item"><span class="detail-label">工单总数</span><span class="detail-value">'+orders.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">报价记录</span><span class="detail-value">'+quotes.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">配件项</span><span class="detail-value">'+parts.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">工时项</span><span class="detail-value">'+labor.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">操作记录</span><span class="detail-value">'+history.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">撤回记录</span><span class="detail-value">'+rbs.length+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">终止记录</span><span class="detail-value">'+terms.length+'</span></div>'+
        '</div></div>'+
        '<div class="export-card"><h4>📤 数据导入</h4><p>从之前导出的JSON文件恢复数据（将覆盖当前所有数据）。</p>'+
          '<button class="btn btn-warning" onclick="document.getElementById(\'import-file\').click()">📤 导入 JSON</button>'+
          '<input type="file" id="import-file" accept=".json" style="display:none" onchange="window.AppImportJSON(event)"></div>'+
      '</div>';
  }
};

function submitOrder(){
  var name=document.getElementById('f-customerName').value.trim();
  var phone=document.getElementById('f-customerPhone').value.trim();
  var type=document.getElementById('f-deviceType').value;
  var brand=document.getElementById('f-deviceBrand').value.trim();
  var model=document.getElementById('f-deviceModel').value.trim();
  var fault=document.getElementById('f-faultDescription').value.trim();
  var handler=document.getElementById('f-handler').value.trim();
  var note=document.getElementById('f-note').value.trim();
  if(!name){showToast('请填写客户姓名','error');return}
  if(!phone){showToast('请填写联系电话','error');return}
  if(!type){showToast('请选择设备类型','error');return}
  if(!brand){showToast('请填写设备品牌','error');return}
  if(!fault){showToast('请填写故障描述','error');return}
  var order={
    id:uuid(),orderNo:generateOrderNo(),customerName:name,customerPhone:phone,
    deviceType:type,deviceBrand:brand,deviceModel:model,faultDescription:fault,
    handler:handler,currentStatus:STATUS.REGISTERED,createdAt:now(),updatedAt:now()
  };
  var orders=Store.getOrders();orders.push(order);Store.saveOrders(orders);
  var h=Store.getHistory();
  h.push({id:uuid(),orderId:order.id,fromStatus:'',toStatus:STATUS.REGISTERED,handler:handler,note:note||'新建工单',timestamp:now(),type:'advance'});
  Store.saveHistory(h);
  showToast('工单 '+order.orderNo+' 登记成功！','success');
  navigateTo('order-detail',{orderId:order.id});
}

function advanceOrder(orderId,targetStatus){
  var order=Store.getOrderById(orderId);if(!order)return;
  var handler=order.handler||'';
  var bodyHtml='<div class="alert alert-info">将工单 '+order.orderNo+' 从 <strong>'+STATUS_LABELS[order.currentStatus]+'</strong> 推进到 <strong>'+STATUS_LABELS[targetStatus]+'</strong></div>'+
    '<div class="form-group"><label>处理人</label><input type="text" id="m-handler" value="'+esc(handler)+'"></div>'+
    '<div class="form-group"><label>备注</label><textarea id="m-note" placeholder="可选"></textarea></div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-primary" onclick="window.AppDoAdvance(\''+orderId+'\',\''+targetStatus+'\')">确认推进</button>';
  showModal('推进状态',bodyHtml,footerHtml);
}

function doAdvance(orderId,targetStatus){
  var handler=document.getElementById('m-handler').value.trim();
  var note=document.getElementById('m-note').value.trim();
  var result=StatusEngine.advance(orderId,targetStatus,handler,note);
  if(!result.ok){showToast(result.msg,'error');return}
  closeModal();showToast('状态已推进到 '+STATUS_LABELS[targetStatus],'success');
  navigateTo('order-detail',{orderId:orderId});
}

function rollbackOrder(orderId){
  var order=Store.getOrderById(orderId);if(!order)return;
  var v=Validator.canRollback(order);if(!v.ok){showToast(v.msg,'error');return}
  var ci=STATUS_FLOW.indexOf(order.currentStatus);
  var prevStatus=STATUS_FLOW[ci-1];
  var handler=order.handler||'';
  var bodyHtml='<div class="alert alert-warning">将工单 '+order.orderNo+' 从 <strong>'+STATUS_LABELS[order.currentStatus]+'</strong> 撤回到 <strong>'+STATUS_LABELS[prevStatus]+'</strong></div>'+
    '<div class="form-group"><label>处理人</label><input type="text" id="m-handler" value="'+esc(handler)+'"></div>'+
    '<div class="form-group"><label>撤回原因 *</label><textarea id="m-note" placeholder="请填写撤回原因"></textarea></div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-warning" onclick="window.AppDoRollback(\''+orderId+'\')">确认撤回</button>';
  showModal('撤回状态',bodyHtml,footerHtml);
}

function doRollback(orderId){
  var handler=document.getElementById('m-handler').value.trim();
  var note=document.getElementById('m-note').value.trim();
  if(!note){showToast('请填写撤回原因','error');return}
  var result=StatusEngine.rollback(orderId,handler,note);
  if(!result.ok){showToast(result.msg,'error');return}
  closeModal();showToast('状态已撤回','success');
  navigateTo('order-detail',{orderId:orderId});
}

function terminateOrder(orderId){
  var order=Store.getOrderById(orderId);if(!order)return;
  var handler=order.handler||'';
  var bodyHtml='<div class="alert alert-error">将工单 '+order.orderNo+' 标记为异常终止，此操作不可逆！</div>'+
    '<div class="form-group"><label>处理人</label><input type="text" id="m-handler" value="'+esc(handler)+'"></div>'+
    '<div class="form-group"><label>终止原因 *</label><textarea id="m-terminate-reason" placeholder="请详细说明终止原因"></textarea></div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-danger" onclick="window.AppDoTerminate(\''+orderId+'\')">确认终止</button>';
  showModal('异常终止',bodyHtml,footerHtml);
}

function doTerminate(orderId){
  var handler=document.getElementById('m-handler').value.trim();
  var reason=document.getElementById('m-terminate-reason').value.trim();
  if(!reason){showToast('请填写终止原因','error');return}
  var result=StatusEngine.terminate(orderId,reason,handler);
  if(!result.ok){showToast(result.msg,'error');return}
  closeModal();showToast('工单已异常终止','warning');
  navigateTo('order-detail',{orderId:orderId});
}

function showQuoteModal(orderId){
  var parts=Store.getParts();var labor=Store.getLabor();
  if(!parts.length&&!labor.length){showToast('请先在配件管理和工时管理中添加项目','error');return}
  var order=Store.getOrderById(orderId);
  var latestQuote=Store.getLatestQuote(orderId);
  var partsOpts=parts.map(function(p){return '<option value="'+p.id+'" data-name="'+esc(p.name)+'" data-price="'+p.unitPrice+'">'+esc(p.name)+' (¥'+p.unitPrice.toFixed(2)+')</option>'}).join('');
  var laborOpts=labor.map(function(l){return '<option value="'+l.id+'" data-name="'+esc(l.name)+'" data-fee="'+l.fee+'">'+esc(l.name)+' (¥'+l.fee.toFixed(2)+')</option>'}).join('');

  var epHtml='';var elHtml='';
  if(latestQuote){
    latestQuote.parts.forEach(function(p){
      epHtml+='<div class="quote-item-row" data-type="part"><select class="q-part-select" onchange="window.AppQuotePartChange(this)"><option value="">选择配件</option>'+partsOpts+'</select><input type="number" class="q-part-price" placeholder="单价" step="0.01" min="0" readonly value="'+p.unitPrice+'"><input type="number" class="q-part-qty" placeholder="数量" min="1" value="'+p.quantity+'" oninput="window.AppQuoteCalcLine(this)"><input type="number" class="q-part-subtotal" placeholder="小计" step="0.01" value="'+p.subtotal+'" readonly><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button></div>';
    });
    latestQuote.laborItems.forEach(function(l){
      elHtml+='<div class="labor-item-row" data-type="labor"><select class="q-labor-select" onchange="window.AppQuoteLaborChange(this)"><option value="">选择工时项目</option>'+laborOpts+'</select><input type="number" class="q-labor-fee" placeholder="费用" step="0.01" min="0" readonly value="'+l.fee+'"><input type="text" class="q-labor-note" placeholder="备注" value=""><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button></div>';
    });
  }

  var defaultPartRow='<div class="quote-item-row" data-type="part"><select class="q-part-select" onchange="window.AppQuotePartChange(this)"><option value="">选择配件</option>'+partsOpts+'</select><input type="number" class="q-part-price" placeholder="单价" step="0.01" min="0" readonly><input type="number" class="q-part-qty" placeholder="数量" min="1" value="1" oninput="window.AppQuoteCalcLine(this)"><input type="number" class="q-part-subtotal" placeholder="小计" step="0.01" readonly><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button></div>';
  var defaultLaborRow='<div class="labor-item-row" data-type="labor"><select class="q-labor-select" onchange="window.AppQuoteLaborChange(this)"><option value="">选择工时项目</option>'+laborOpts+'</select><input type="number" class="q-labor-fee" placeholder="费用" step="0.01" min="0" readonly><input type="text" class="q-labor-note" placeholder="备注"><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button></div>';

  var bodyHtml='<div class="alert alert-info">为工单 '+(order?order.orderNo:'')+' 生成报价（当前配置价格将作为版本快照保存）</div>'+
    '<div class="form-group"><label>处理人</label><input type="text" id="m-quote-handler" value="'+esc(order?order.handler:'')+'"></div>'+
    '<div class="section-title" style="margin-top:16px">配件项目</div>'+
    '<div id="quote-parts-list">'+(epHtml||defaultPartRow)+'</div>'+
    '<button class="btn btn-sm" onclick="window.AppAddQuotePartRow()" style="margin:8px 0">+ 添加配件</button>'+
    '<div class="section-title" style="margin-top:16px">工时项目</div>'+
    '<div id="quote-labor-list">'+(elHtml||defaultLaborRow)+'</div>'+
    '<button class="btn btn-sm" onclick="window.AppAddQuoteLaborRow()" style="margin:8px 0">+ 添加工时</button>'+
    '<div style="margin-top:16px;font-weight:600;font-size:16px" id="quote-total-preview">合计：¥0.00</div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-primary" onclick="window.AppDoQuote(\''+orderId+'\')">确认生成报价</button>';
  showModal('生成/更新报价',bodyHtml,footerHtml);

  if(latestQuote){
    var pSel=document.querySelectorAll('.q-part-select');
    latestQuote.parts.forEach(function(p,i){
      if(pSel[i]){pSel[i].value=p.partId;window.AppQuotePartChange(pSel[i])}
    });
    var lSel=document.querySelectorAll('.q-labor-select');
    latestQuote.laborItems.forEach(function(l,i){
      if(lSel[i]){lSel[i].value=l.laborItemId;window.AppQuoteLaborChange(lSel[i])}
    });
  }
  recalcQuoteTotal();
}

function addQuotePartRow(){
  var parts=Store.getParts();
  var opts=parts.map(function(p){return '<option value="'+p.id+'" data-name="'+esc(p.name)+'" data-price="'+p.unitPrice+'">'+esc(p.name)+' (¥'+p.unitPrice.toFixed(2)+')</option>'}).join('');
  var c=document.getElementById('quote-parts-list');
  var d=document.createElement('div');d.className='quote-item-row';d.setAttribute('data-type','part');
  d.innerHTML='<select class="q-part-select" onchange="window.AppQuotePartChange(this)"><option value="">选择配件</option>'+opts+'</select><input type="number" class="q-part-price" placeholder="单价" step="0.01" min="0" readonly><input type="number" class="q-part-qty" placeholder="数量" min="1" value="1" oninput="window.AppQuoteCalcLine(this)"><input type="number" class="q-part-subtotal" placeholder="小计" step="0.01" readonly><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button>';
  c.appendChild(d);
}

function addQuoteLaborRow(){
  var labor=Store.getLabor();
  var opts=labor.map(function(l){return '<option value="'+l.id+'" data-name="'+esc(l.name)+'" data-fee="'+l.fee+'">'+esc(l.name)+' (¥'+l.fee.toFixed(2)+')</option>'}).join('');
  var c=document.getElementById('quote-labor-list');
  var d=document.createElement('div');d.className='labor-item-row';d.setAttribute('data-type','labor');
  d.innerHTML='<select class="q-labor-select" onchange="window.AppQuoteLaborChange(this)"><option value="">选择工时项目</option>'+opts+'</select><input type="number" class="q-labor-fee" placeholder="费用" step="0.01" min="0" readonly><input type="text" class="q-labor-note" placeholder="备注"><button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();window.AppRecalcQuoteTotal()">✕</button>';
  c.appendChild(d);
}

function quotePartChange(sel){
  var row=sel.parentElement;var opt=sel.options[sel.selectedIndex];
  var price=opt.getAttribute('data-price');
  row.querySelector('.q-part-price').value=price||'';
  var qty=parseInt(row.querySelector('.q-part-qty').value)||1;
  var up=parseFloat(price)||0;
  row.querySelector('.q-part-subtotal').value=(up*qty).toFixed(2);
  recalcQuoteTotal();
}

function quoteLaborChange(sel){
  var row=sel.parentElement;var opt=sel.options[sel.selectedIndex];
  var fee=opt.getAttribute('data-fee');
  row.querySelector('.q-labor-fee').value=fee||'';
  recalcQuoteTotal();
}

function quoteCalcLine(input){
  var row=input.parentElement;
  var price=parseFloat(row.querySelector('.q-part-price').value)||0;
  var qty=parseInt(row.querySelector('.q-part-qty').value)||0;
  row.querySelector('.q-part-subtotal').value=(price*qty).toFixed(2);
  recalcQuoteTotal();
}

function recalcQuoteTotal(){
  var total=0;
  document.querySelectorAll('.q-part-subtotal').forEach(function(el){total+=parseFloat(el.value)||0});
  document.querySelectorAll('.q-labor-fee').forEach(function(el){total+=parseFloat(el.value)||0});
  var preview=document.getElementById('quote-total-preview');
  if(preview)preview.textContent='合计：¥'+total.toFixed(2);
}

function doQuote(orderId){
  var handler=document.getElementById('m-quote-handler').value.trim();
  var parts=[];var laborItems=[];
  var allParts=Store.getParts();
  var allLabor=Store.getLabor();
  document.querySelectorAll('.quote-item-row').forEach(function(row){
    var sel=row.querySelector('.q-part-select');var partId=sel.value;if(!partId)return;
    var partName=sel.options[sel.selectedIndex].getAttribute('data-name');
    var curPart=allParts.find(function(p){return p.id===partId});
    var unitPrice=curPart?curPart.unitPrice:(parseFloat(row.querySelector('.q-part-price').value)||0);
    var quantity=parseInt(row.querySelector('.q-part-qty').value)||0;
    var subtotal=unitPrice*quantity;
    parts.push({partId:partId,partName:partName,unitPrice:unitPrice,quantity:quantity,subtotal:subtotal});
  });
  document.querySelectorAll('.labor-item-row').forEach(function(row){
    var sel=row.querySelector('.q-labor-select');var laborItemId=sel.value;if(!laborItemId)return;
    var laborName=sel.options[sel.selectedIndex].getAttribute('data-name');
    var curLabor=allLabor.find(function(l){return l.id===laborItemId});
    var fee=curLabor?curLabor.fee:(parseFloat(row.querySelector('.q-labor-fee').value)||0);
    laborItems.push({laborItemId:laborItemId,laborName:laborName,fee:fee});
  });
  if(!parts.length&&!laborItems.length){showToast('请至少添加一项配件或工时','error');return}
  var result=QuoteEngine.generate(orderId,parts,laborItems,handler);
  if(!result.ok){showToast(result.msg,'error');return}
  closeModal();showToast('报价已生成（版本'+result.quote.version+'）','success');
  navigateTo('order-detail',{orderId:orderId});
}

function showPartModal(partId){
  var part=partId?Store.getPartById(partId):null;
  var bodyHtml='<div class="form-group"><label>配件名称 *</label><input type="text" id="m-part-name" value="'+(part?esc(part.name):'')+'" placeholder="如 SSD 256GB"></div>'+
    '<div class="form-row"><div class="form-group"><label>分类 *</label><input type="text" id="m-part-category" value="'+(part?esc(part.category):'')+'" placeholder="如 硬盘、内存"></div>'+
    '<div class="form-group"><label>单价 (¥) *</label><input type="number" id="m-part-price" value="'+(part?part.unitPrice:'')+'" step="0.01" min="0" placeholder="0.00"></div></div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-primary" onclick="window.AppSavePart(\''+(partId||'')+'\')">保存</button>';
  showModal(part?'编辑配件':'添加配件',bodyHtml,footerHtml);
}

function savePart(partId){
  var name=document.getElementById('m-part-name').value.trim();
  var category=document.getElementById('m-part-category').value.trim();
  var price=parseFloat(document.getElementById('m-part-price').value);
  if(!name){showToast('请填写配件名称','error');return}
  if(!category){showToast('请填写分类','error');return}
  if(isNaN(price)||price<0){showToast('单价不能为负数','error');return}
  var parts=Store.getParts();
  if(partId){var idx=parts.findIndex(function(p){return p.id===partId});if(idx>-1){parts[idx].name=name;parts[idx].category=category;parts[idx].unitPrice=price;parts[idx].updatedAt=now()}}
  else{parts.push({id:uuid(),name:name,category:category,unitPrice:price,updatedAt:now()})}
  Store.saveParts(parts);closeModal();showToast('配件已保存','success');UI.renderPartsConfig();
}

function deletePart(partId){
  if(!confirm('确认删除此配件？已有报价中引用的快照价格不受影响。'))return;
  var parts=Store.getParts();parts=parts.filter(function(p){return p.id!==partId});
  Store.saveParts(parts);showToast('配件已删除','success');UI.renderPartsConfig();
}

function showLaborModal(laborId){
  var item=laborId?Store.getLaborById(laborId):null;
  var bodyHtml='<div class="form-group"><label>项目名称 *</label><input type="text" id="m-labor-name" value="'+(item?esc(item.name):'')+'" placeholder="如 系统重装"></div>'+
    '<div class="form-row"><div class="form-group"><label>分类 *</label><input type="text" id="m-labor-category" value="'+(item?esc(item.category):'')+'" placeholder="如 软件服务"></div>'+
    '<div class="form-group"><label>费用 (¥) *</label><input type="number" id="m-labor-fee" value="'+(item?item.fee:'')+'" step="0.01" min="0" placeholder="0.00"></div></div>';
  var footerHtml='<button class="btn" onclick="window.AppCloseModal()">取消</button><button class="btn btn-primary" onclick="window.AppSaveLabor(\''+(laborId||'')+'\')">保存</button>';
  showModal(item?'编辑工时项目':'添加工时项目',bodyHtml,footerHtml);
}

function saveLabor(laborId){
  var name=document.getElementById('m-labor-name').value.trim();
  var category=document.getElementById('m-labor-category').value.trim();
  var fee=parseFloat(document.getElementById('m-labor-fee').value);
  if(!name){showToast('请填写项目名称','error');return}
  if(!category){showToast('请填写分类','error');return}
  if(isNaN(fee)||fee<0){showToast('费用不能为负数','error');return}
  var labor=Store.getLabor();
  if(laborId){var idx=labor.findIndex(function(l){return l.id===laborId});if(idx>-1){labor[idx].name=name;labor[idx].category=category;labor[idx].fee=fee;labor[idx].updatedAt=now()}}
  else{labor.push({id:uuid(),name:name,category:category,fee:fee,updatedAt:now()})}
  Store.saveLabor(labor);closeModal();showToast('工时项目已保存','success');UI.renderLaborConfig();
}

function deleteLabor(laborId){
  if(!confirm('确认删除此工时项目？已有报价中引用的快照费用不受影响。'))return;
  var labor=Store.getLabor();labor=labor.filter(function(l){return l.id!==laborId});
  Store.saveLabor(labor);showToast('工时项目已删除','success');UI.renderLaborConfig();
}

function filterOrders(){
  var sf=document.getElementById('filter-status').value;
  var search=(document.getElementById('filter-search').value||'').trim().toLowerCase();
  var orders=Store.getOrders().slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt)});
  if(sf)orders=orders.filter(function(o){return o.currentStatus===sf});
  if(search)orders=orders.filter(function(o){return o.orderNo.toLowerCase().indexOf(search)>-1||o.customerName.toLowerCase().indexOf(search)>-1||(o.customerPhone||'').indexOf(search)>-1});
  UI._renderOrderListRows(orders);
}

function filterHistory(){
  var search=(document.getElementById('history-search').value||'').trim().toLowerCase();
  var ah=Store.getHistory().sort(function(a,b){return new Date(b.timestamp)-new Date(a.timestamp)});
  var ao=Store.getOrders();
  if(search)ah=ah.filter(function(h){var o=ao.find(function(x){return x.id===h.orderId});var on=o?o.orderNo.toLowerCase():'';return on.indexOf(search)>-1||(h.handler||'').toLowerCase().indexOf(search)>-1||(h.note||'').toLowerCase().indexOf(search)>-1});
  UI._renderHistoryRows(ah,ao);
}

function exportJSON(){
  var data={exportDate:now(),version:'1.0.0',orders:Store.getOrders(),parts:Store.getParts(),labor:Store.getLabor(),quotes:Store.getQuotes(),history:Store.getHistory(),rollbacks:Store.getRollbacks(),terminations:Store.getTerminations()};
  downloadFile(JSON.stringify(data,null,2),'repair-data-'+formatDate(now()).replace(/-/g,'')+'.json','application/json');
  showToast('JSON数据已导出','success');
}

function exportCSV(){
  var orders=Store.getOrders();var quotes=Store.getQuotes();
  var header='工单号,客户姓名,联系电话,设备类型,品牌,型号,故障描述,当前状态,处理人,创建时间,更新时间,配件合计,工时合计,报价总计,报价版本数\n';
  var rows=orders.map(function(o){
    var oq=quotes.filter(function(q){return q.orderId===o.id});
    var latest=oq.length?oq.sort(function(a,b){return b.version-a.version})[0]:null;
    return [o.orderNo,o.customerName,o.customerPhone,o.deviceType,o.deviceBrand,o.deviceModel,'"'+o.faultDescription.replace(/"/g,'""')+'"',STATUS_LABELS[o.currentStatus],o.handler||'',o.createdAt,o.updatedAt,latest?latest.totalPartsCost.toFixed(2):'0.00',latest?latest.totalLaborCost.toFixed(2):'0.00',latest?latest.totalCost.toFixed(2):'0.00',oq.length].join(',');
  }).join('\n');
  downloadFile('\uFEFF'+header+rows,'repair-orders-'+formatDate(now()).replace(/-/g,'')+'.csv','text/csv;charset=utf-8');
  showToast('CSV数据已导出','success');
}

function importJSON(event){
  var file=event.target.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=JSON.parse(e.target.result);
      if(!data.orders||!Array.isArray(data.orders))throw new Error('无效的数据格式');
      if(!confirm('导入将覆盖当前所有数据，确认继续？'))return;
      Store.saveOrders(data.orders||[]);Store.saveParts(data.parts||[]);Store.saveLabor(data.labor||[]);
      Store.saveQuotes(data.quotes||[]);Store.saveHistory(data.history||[]);Store.saveRollbacks(data.rollbacks||[]);Store.saveTerminations(data.terminations||[]);
      showToast('数据导入成功','success');navigateTo('dashboard');
    }catch(err){showToast('导入失败：'+err.message,'error')}
  };
  reader.readAsText(file);event.target.value='';
}

function downloadFile(content,filename,mime){
  var blob=new Blob([content],{type:mime});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

var SampleData={
  initialize:function(){
    if(Store.load(STORAGE_KEYS.INITIALIZED))return;
    var t='2026-06-17T09:00:00.000Z';
    var parts=[
      {id:'p1',name:'SSD 256GB',category:'硬盘',unitPrice:299,updatedAt:t},
      {id:'p2',name:'SSD 512GB',category:'硬盘',unitPrice:499,updatedAt:t},
      {id:'p3',name:'HDD 1TB',category:'硬盘',unitPrice:269,updatedAt:t},
      {id:'p4',name:'DDR4 8GB 内存条',category:'内存',unitPrice:189,updatedAt:t},
      {id:'p5',name:'DDR4 16GB 内存条',category:'内存',unitPrice:349,updatedAt:t},
      {id:'p6',name:'笔记本键盘(通用)',category:'输入设备',unitPrice:120,updatedAt:t},
      {id:'p7',name:'笔记本屏幕 14寸 FHD',category:'显示屏',unitPrice:480,updatedAt:t},
      {id:'p8',name:'笔记本电池(通用)',category:'电池',unitPrice:199,updatedAt:t},
      {id:'p9',name:'散热硅脂',category:'散热',unitPrice:25,updatedAt:t},
      {id:'p10',name:'USB 3.0 HUB',category:'外设',unitPrice:65,updatedAt:t},
      {id:'p11',name:'电源适配器 65W',category:'电源',unitPrice:135,updatedAt:t},
      {id:'p12',name:'台式机电源 500W',category:'电源',unitPrice:289,updatedAt:t}
    ];
    Store.saveParts(parts);
    var labor=[
      {id:'l1',name:'系统重装',category:'软件服务',fee:100,updatedAt:t},
      {id:'l2',name:'数据备份与恢复',category:'软件服务',fee:80,updatedAt:t},
      {id:'l3',name:'病毒查杀',category:'软件服务',fee:60,updatedAt:t},
      {id:'l4',name:'硬件检测',category:'硬件服务',fee:50,updatedAt:t},
      {id:'l5',name:'主板维修',category:'硬件服务',fee:200,updatedAt:t},
      {id:'l6',name:'屏幕更换',category:'硬件服务',fee:150,updatedAt:t},
      {id:'l7',name:'键盘更换',category:'硬件服务',fee:80,updatedAt:t},
      {id:'l8',name:'清灰保养',category:'保养服务',fee:60,updatedAt:t},
      {id:'l9',name:'数据恢复(深度)',category:'数据服务',fee:300,updatedAt:t},
      {id:'l10',name:'网络配置',category:'网络服务',fee:50,updatedAt:t}
    ];
    Store.saveLabor(labor);

    var o1={id:'o1',orderNo:'WX-20260617-001',customerName:'王明',customerPhone:'13912345678',deviceType:'笔记本',deviceBrand:'联想',deviceModel:'ThinkPad X1 Carbon',faultDescription:'开机后蓝屏，提示硬盘故障，无法进入系统',handler:'李工',currentStatus:STATUS.PICKED_UP,createdAt:'2026-06-17T09:15:00.000Z',updatedAt:'2026-06-17T16:30:00.000Z'};
    var o2={id:'o2',orderNo:'WX-20260617-002',customerName:'张丽',customerPhone:'13887654321',deviceType:'笔记本',deviceBrand:'Dell',deviceModel:'Inspiron 15',faultDescription:'键盘部分按键失灵，空格键和回车键无反应',handler:'王工',currentStatus:STATUS.REPAIRING,createdAt:'2026-06-17T10:00:00.000Z',updatedAt:'2026-06-17T14:20:00.000Z'};
    var o3={id:'o3',orderNo:'WX-20260617-003',customerName:'赵强',customerPhone:'13611112222',deviceType:'台式机',deviceBrand:'组装机',deviceModel:'自组',faultDescription:'开机无显示，风扇转但屏幕黑屏',handler:'李工',currentStatus:STATUS.QUOTED,createdAt:'2026-06-17T11:30:00.000Z',updatedAt:'2026-06-17T13:45:00.000Z'};
    var o4={id:'o4',orderNo:'WX-20260617-004',customerName:'刘芳',customerPhone:'13533334444',deviceType:'笔记本',deviceBrand:'华为',deviceModel:'MateBook 14',faultDescription:'电池不充电，插上电源适配器后电量持续下降',handler:'张工',currentStatus:STATUS.REGISTERED,createdAt:'2026-06-17T14:00:00.000Z',updatedAt:'2026-06-17T14:00:00.000Z'};
    var o5={id:'o5',orderNo:'WX-20260617-005',customerName:'陈伟',customerPhone:'13755556666',deviceType:'台式机',deviceBrand:'HP',deviceModel:'ProDesk 400',faultDescription:'运行速度非常慢，经常卡顿，需要升级硬件',handler:'王工',currentStatus:STATUS.TERMINATED,createdAt:'2026-06-17T09:30:00.000Z',updatedAt:'2026-06-17T15:00:00.000Z'};
    var o6={id:'o6',orderNo:'WX-20260618-001',customerName:'孙丽华',customerPhone:'13877778888',deviceType:'一体机',deviceBrand:'苹果',deviceModel:'iMac 24寸',faultDescription:'系统运行缓慢，疑似中病毒',handler:'李工',currentStatus:STATUS.INSPECTING,createdAt:'2026-06-18T08:30:00.000Z',updatedAt:'2026-06-18T09:00:00.000Z'};
    Store.saveOrders([o1,o2,o3,o4,o5,o6]);

    var history=[
      {id:'h1',orderId:'o1',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'李工',note:'客户送修，描述蓝屏问题',timestamp:'2026-06-17T09:15:00.000Z',type:'advance'},
      {id:'h2',orderId:'o1',fromStatus:STATUS.REGISTERED,toStatus:STATUS.INSPECTING,handler:'李工',note:'开始硬件检测',timestamp:'2026-06-17T09:30:00.000Z',type:'advance'},
      {id:'h3',orderId:'o1',fromStatus:STATUS.INSPECTING,toStatus:STATUS.QUOTED,handler:'李工',note:'生成报价（版本1）',timestamp:'2026-06-17T10:00:00.000Z',type:'advance'},
      {id:'h4',orderId:'o1',fromStatus:STATUS.QUOTED,toStatus:STATUS.CONFIRMED,handler:'李工',note:'客户电话确认报价，同意更换硬盘',timestamp:'2026-06-17T11:00:00.000Z',type:'advance'},
      {id:'h5',orderId:'o1',fromStatus:STATUS.CONFIRMED,toStatus:STATUS.REPAIRING,handler:'李工',note:'开始更换硬盘和重装系统',timestamp:'2026-06-17T11:30:00.000Z',type:'advance'},
      {id:'h6',orderId:'o1',fromStatus:STATUS.REPAIRING,toStatus:STATUS.COMPLETED,handler:'李工',note:'硬盘更换完成，系统重装成功，测试正常',timestamp:'2026-06-17T15:00:00.000Z',type:'advance'},
      {id:'h7',orderId:'o1',fromStatus:STATUS.COMPLETED,toStatus:STATUS.PICKED_UP,handler:'李工',note:'客户已取机，付款完成',timestamp:'2026-06-17T16:30:00.000Z',type:'advance'},

      {id:'h8',orderId:'o2',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'王工',note:'客户送修键盘失灵问题',timestamp:'2026-06-17T10:00:00.000Z',type:'advance'},
      {id:'h9',orderId:'o2',fromStatus:STATUS.REGISTERED,toStatus:STATUS.INSPECTING,handler:'王工',note:'检测键盘故障',timestamp:'2026-06-17T10:30:00.000Z',type:'advance'},
      {id:'h10',orderId:'o2',fromStatus:STATUS.INSPECTING,toStatus:STATUS.QUOTED,handler:'王工',note:'生成报价（版本1）',timestamp:'2026-06-17T11:00:00.000Z',type:'advance'},
      {id:'h11',orderId:'o2',fromStatus:STATUS.QUOTED,toStatus:STATUS.CONFIRMED,handler:'王工',note:'客户确认报价',timestamp:'2026-06-17T13:00:00.000Z',type:'advance'},
      {id:'h12',orderId:'o2',fromStatus:STATUS.CONFIRMED,toStatus:STATUS.REPAIRING,handler:'王工',note:'开始更换键盘',timestamp:'2026-06-17T14:20:00.000Z',type:'advance'},

      {id:'h13',orderId:'o3',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'李工',note:'客户送修黑屏问题',timestamp:'2026-06-17T11:30:00.000Z',type:'advance'},
      {id:'h14',orderId:'o3',fromStatus:STATUS.REGISTERED,toStatus:STATUS.INSPECTING,handler:'李工',note:'开始硬件检测',timestamp:'2026-06-17T12:00:00.000Z',type:'advance'},
      {id:'h15',orderId:'o3',fromStatus:STATUS.INSPECTING,toStatus:STATUS.QUOTED,handler:'李工',note:'生成报价（版本1），发现主板问题',timestamp:'2026-06-17T13:45:00.000Z',type:'advance'},

      {id:'h16',orderId:'o4',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'张工',note:'客户送修电池充电问题',timestamp:'2026-06-17T14:00:00.000Z',type:'advance'},

      {id:'h17',orderId:'o5',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'王工',note:'客户咨询硬件升级',timestamp:'2026-06-17T09:30:00.000Z',type:'advance'},
      {id:'h18',orderId:'o5',fromStatus:STATUS.REGISTERED,toStatus:STATUS.INSPECTING,handler:'王工',note:'检测硬件配置',timestamp:'2026-06-17T10:00:00.000Z',type:'advance'},
      {id:'h19',orderId:'o5',fromStatus:STATUS.INSPECTING,toStatus:STATUS.QUOTED,handler:'王工',note:'生成报价（版本1）',timestamp:'2026-06-17T11:00:00.000Z',type:'advance'},
      {id:'h20',orderId:'o5',fromStatus:STATUS.QUOTED,toStatus:STATUS.TERMINATED,handler:'王工',note:'异常终止：客户认为升级费用过高，决定放弃维修',timestamp:'2026-06-17T15:00:00.000Z',type:'terminate'},

      {id:'h21',orderId:'o6',fromStatus:'',toStatus:STATUS.REGISTERED,handler:'李工',note:'客户送修系统缓慢问题',timestamp:'2026-06-18T08:30:00.000Z',type:'advance'},
      {id:'h22',orderId:'o6',fromStatus:STATUS.REGISTERED,toStatus:STATUS.INSPECTING,handler:'李工',note:'开始检测系统和硬件',timestamp:'2026-06-18T09:00:00.000Z',type:'advance'}
    ];
    Store.saveHistory(history);

    var quotes=[
      {id:'q1',orderId:'o1',version:1,parts:[{partId:'p1',partName:'SSD 256GB',unitPrice:299,quantity:1,subtotal:299}],laborItems:[{laborItemId:'l1',laborName:'系统重装',fee:100},{laborItemId:'l4',laborName:'硬件检测',fee:50}],totalPartsCost:299,totalLaborCost:150,totalCost:449,createdAt:'2026-06-17T10:00:00.000Z',handler:'李工'},
      {id:'q2',orderId:'o2',version:1,parts:[{partId:'p6',partName:'笔记本键盘(通用)',unitPrice:120,quantity:1,subtotal:120}],laborItems:[{laborItemId:'l7',laborName:'键盘更换',fee:80}],totalPartsCost:120,totalLaborCost:80,totalCost:200,createdAt:'2026-06-17T11:00:00.000Z',handler:'王工'},
      {id:'q3',orderId:'o3',version:1,parts:[{partId:'p12',partName:'台式机电源 500W',unitPrice:289,quantity:1,subtotal:289}],laborItems:[{laborItemId:'l5',laborName:'主板维修',fee:200},{laborItemId:'l4',laborName:'硬件检测',fee:50}],totalPartsCost:289,totalLaborCost:250,totalCost:539,createdAt:'2026-06-17T13:45:00.000Z',handler:'李工'},
      {id:'q4',orderId:'o5',version:1,parts:[{partId:'p2',partName:'SSD 512GB',unitPrice:499,quantity:1,subtotal:499},{partId:'p5',partName:'DDR4 16GB 内存条',unitPrice:349,quantity:2,subtotal:698}],laborItems:[{laborItemId:'l1',laborName:'系统重装',fee:100},{laborItemId:'l8',laborName:'清灰保养',fee:60}],totalPartsCost:1197,totalLaborCost:160,totalCost:1357,createdAt:'2026-06-17T11:00:00.000Z',handler:'王工'}
    ];
    Store.saveQuotes(quotes);

    var terminations=[
      {id:'t1',orderId:'o5',fromStatus:STATUS.QUOTED,reason:'客户认为升级费用过高，决定放弃维修',handler:'王工',timestamp:'2026-06-17T15:00:00.000Z'}
    ];
    Store.saveTerminations(terminations);

    var rollbacks=[];
    Store.saveRollbacks(rollbacks);

    Store.save(STORAGE_KEYS.INITIALIZED,'true');
  }
};

window.AppNavigate=navigateTo;
window.AppCloseModal=closeModal;
window.AppSubmitOrder=submitOrder;
window.AppAdvanceOrder=advanceOrder;
window.AppDoAdvance=doAdvance;
window.AppRollbackOrder=rollbackOrder;
window.AppDoRollback=doRollback;
window.AppTerminateOrder=terminateOrder;
window.AppDoTerminate=doTerminate;
window.AppShowQuoteModal=showQuoteModal;
window.AppAddQuotePartRow=addQuotePartRow;
window.AppAddQuoteLaborRow=addQuoteLaborRow;
window.AppQuotePartChange=quotePartChange;
window.AppQuoteLaborChange=quoteLaborChange;
window.AppQuoteCalcLine=quoteCalcLine;
window.AppRecalcQuoteTotal=recalcQuoteTotal;
window.AppDoQuote=doQuote;
window.AppShowPartModal=showPartModal;
window.AppSavePart=savePart;
window.AppDeletePart=deletePart;
window.AppShowLaborModal=showLaborModal;
window.AppSaveLabor=saveLabor;
window.AppDeleteLabor=deleteLabor;
window.AppFilterOrders=filterOrders;
window.AppFilterHistory=filterHistory;
window.AppExportJSON=exportJSON;
window.AppExportCSV=exportCSV;
window.AppImportJSON=importJSON;

document.addEventListener('DOMContentLoaded',function(){
  SampleData.initialize();
  navigateTo('dashboard');

  document.querySelectorAll('.nav-item').forEach(function(item){
    item.addEventListener('click',function(e){
      e.preventDefault();
      var page=this.getAttribute('data-page');
      if(page)navigateTo(page);
    });
  });

  document.getElementById('modal-overlay').addEventListener('click',function(e){
    if(e.target===this)closeModal();
  });
});

})();

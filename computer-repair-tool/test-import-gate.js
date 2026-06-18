(function(){
'use strict';

var TEST_NAMESPACE='crp_test_gate_';
var STORAGE_KEYS_TEST={
  ORDERS:TEST_NAMESPACE+'orders',
  QUOTES:TEST_NAMESPACE+'quotes',
  HISTORY:TEST_NAMESPACE+'history',
  IMPORT_TASKS:TEST_NAMESPACE+'import_tasks',
  IMPORT_AUDIT_LOGS:TEST_NAMESPACE+'import_audit_logs',
  IMPORT_STATE:TEST_NAMESPACE+'import_state',
  PERMISSION_CONFIG:TEST_NAMESPACE+'permission_config',
  IMPORT_DETAIL_VIEW:TEST_NAMESPACE+'import_detail_view'
};

var STATUS={
  REGISTERED:'REGISTERED',INSPECTING:'INSPECTING',QUOTED:'QUOTED',
  CONFIRMED:'CONFIRMED',REPAIRING:'REPAIRING',COMPLETED:'COMPLETED',
  PICKED_UP:'PICKED_UP',TERMINATED:'TERMINATED'
};

var IMPORT_DATA_TYPES={ORDERS:'orders',QUOTES:'quotes',HISTORY:'history'};
var IMPORT_TASK_STATUS={
  PRECHECK:'precheck',PENDING:'pending',PROCESSING:'processing',PARTIAL:'partial',
  COMPLETED:'completed',FAILED:'failed',ROLLED_BACK:'rolled_back',STAGING:'staging'
};
var IMPORT_CONFLICT_TYPES={
  DUPLICATE:'duplicate',VERSION_MISMATCH:'version_mismatch',
  MISSING_FIELDS:'missing_fields',RELATION_MISSING:'relation_missing',PERMISSION:'permission'
};

function uuid(){return 'xxxx-xxxx'.replace(/x/g,function(){return Math.floor(Math.random()*16).toString(16)})}
function now(){return new Date().toISOString()}
function pad(n){return n<10?'0'+n:n}
function formatDate(iso){if(!iso)return'-';var d=new Date(iso);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}

var TestStore={
  _db:{},
  load:function(k){try{var d=this._db[k];return d?JSON.parse(d):null}catch(e){return null}},
  save:function(k,v){try{this._db[k]=JSON.stringify(v)}catch(e){console.error('Storage error',e)}},
  getOrders:function(){return this.load(STORAGE_KEYS_TEST.ORDERS)||[]},
  saveOrders:function(o){this.save(STORAGE_KEYS_TEST.ORDERS,o)},
  getOrderById:function(id){return this.getOrders().find(function(o){return o.id===id})},
  getQuotes:function(){return this.load(STORAGE_KEYS_TEST.QUOTES)||[]},
  saveQuotes:function(o){this.save(STORAGE_KEYS_TEST.QUOTES,o)},
  getHistory:function(){return this.load(STORAGE_KEYS_TEST.HISTORY)||[]},
  saveHistory:function(o){this.save(STORAGE_KEYS_TEST.HISTORY,o)},
  getImportTasks:function(){return this.load(STORAGE_KEYS_TEST.IMPORT_TASKS)||[]},
  saveImportTasks:function(o){this.save(STORAGE_KEYS_TEST.IMPORT_TASKS,o)},
  getImportTaskById:function(id){return this.getImportTasks().find(function(t){return t.id===id})},
  getImportAuditLogs:function(){return this.load(STORAGE_KEYS_TEST.IMPORT_AUDIT_LOGS)||[]},
  saveImportAuditLogs:function(o){this.save(STORAGE_KEYS_TEST.IMPORT_AUDIT_LOGS,o)},
  getImportState:function(){return this.load(STORAGE_KEYS_TEST.IMPORT_STATE)||null},
  saveImportState:function(o){this.save(STORAGE_KEYS_TEST.IMPORT_STATE,o)},
  getPermissionConfig:function(){
    var cfg=this.load(STORAGE_KEYS_TEST.PERMISSION_CONFIG);
    if(!cfg){
      cfg={
        version:'1.0.0',updatedAt:now(),
        roles:{
          admin:{canImportOrders:true,canImportQuotes:true,canImportHistory:true,canRollback:true,canExport:true,canEditPermission:true},
          operator:{canImportOrders:true,canImportQuotes:true,canImportHistory:true,canRollback:false,canExport:true,canEditPermission:false},
          viewer:{canImportOrders:false,canImportQuotes:false,canImportHistory:false,canRollback:false,canExport:false,canEditPermission:false}
        },
        currentRole:'admin',
        handlers:['李工','王工','张工','测试员']
      };
      this.save(STORAGE_KEYS_TEST.PERMISSION_CONFIG,cfg);
    }
    return cfg;
  },
  savePermissionConfig:function(o){o.updatedAt=now();this.save(STORAGE_KEYS_TEST.PERMISSION_CONFIG,o)},
  getImportDetailView:function(){return this.load(STORAGE_KEYS_TEST.IMPORT_DETAIL_VIEW)||null},
  saveImportDetailView:function(o){this.save(STORAGE_KEYS_TEST.IMPORT_DETAIL_VIEW,o)},
  clearAll:function(){this._db={}}
};

var TestPermissionManager={
  getConfig:function(){return TestStore.getPermissionConfig();},
  saveConfig:function(cfg){TestStore.savePermissionConfig(cfg);},
  getCurrentRole:function(){var cfg=this.getConfig();return cfg.currentRole||'admin';},
  setCurrentRole:function(role){var cfg=this.getConfig();if(cfg.roles[role]){cfg.currentRole=role;this.saveConfig(cfg);return true;}return false;},
  hasPermission:function(action){
    var cfg=this.getConfig();var role=cfg.currentRole||'admin';var roleCfg=cfg.roles[role];
    if(!roleCfg)return false;return roleCfg[action]===true;
  },
  canImportType:function(dataType){
    var cfg=this.getConfig();var role=cfg.currentRole||'admin';var roleCfg=cfg.roles[role];
    if(!roleCfg)return false;
    if(dataType===IMPORT_DATA_TYPES.ORDERS)return roleCfg.canImportOrders===true;
    if(dataType===IMPORT_DATA_TYPES.QUOTES)return roleCfg.canImportQuotes===true;
    if(dataType===IMPORT_DATA_TYPES.HISTORY)return roleCfg.canImportHistory===true;
    return false;
  },
  canRollback:function(){return this.hasPermission('canRollback');},
  canExport:function(){return this.hasPermission('canExport');},
  canEditPermission:function(){return this.hasPermission('canEditPermission');},
  getPermissionBlockMsg:function(dataType){
    var labels={};labels[IMPORT_DATA_TYPES.ORDERS]='工单';labels[IMPORT_DATA_TYPES.QUOTES]='报价单';labels[IMPORT_DATA_TYPES.HISTORY]='历史快照';
    var label=labels[dataType]||dataType;
    return '无权限导入'+label+'，当前角色 '+this.getCurrentRole()+' 没有权限，请联系管理员在权限配置中开通';
  },
  validateHandler:function(handlerName){
    if(!handlerName)return{ok:false,msg:'处理人不能为空'};
    var cfg=this.getConfig();
    if(!cfg.handlers||cfg.handlers.length===0)return{ok:true};
    if(cfg.handlers.indexOf(handlerName)===-1){
      return{ok:false,msg:'处理人 "'+handlerName+'" 不在权限配置的处理人列表中，请先在权限配置中添加'};
    }
    return{ok:true};
  },
  addHandler:function(name){
    var cfg=this.getConfig();if(!cfg.handlers)cfg.handlers=[];
    if(cfg.handlers.indexOf(name)===-1){cfg.handlers.push(name);this.saveConfig(cfg);return true;}
    return false;
  },
  removeHandler:function(name){
    var cfg=this.getConfig();if(!cfg.handlers)return false;
    var idx=cfg.handlers.indexOf(name);
    if(idx>-1){cfg.handlers.splice(idx,1);this.saveConfig(cfg);return true;}
    return false;
  }
};

var TestImportAuditEngine={
  _parseData:function(data,fileName){
    return{fileName:fileName||'import-data.json',fileSize:JSON.stringify(data).length,fileType:'application/json',uploadedAt:now(),data:data};
  },
  _detectDataType:function(data){
    var types=[];
    if(data.orders&&Array.isArray(data.orders)&&data.orders.length>0)types.push(IMPORT_DATA_TYPES.ORDERS);
    if(data.quotes&&Array.isArray(data.quotes)&&data.quotes.length>0)types.push(IMPORT_DATA_TYPES.QUOTES);
    if(data.history&&Array.isArray(data.history)&&data.history.length>0)types.push(IMPORT_DATA_TYPES.HISTORY);
    return types;
  },
  _validateSchema:function(item,requiredFields,itemName){
    var missing=[];requiredFields.forEach(function(f){if(item[f]===undefined||item[f]===null||item[f]==='')missing.push(f);});
    return{valid:missing.length===0,missing:missing,itemName:itemName};
  },
  _validateOrders:function(orders,existingOrders){
    var self=this;var results=[];
    if(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.ORDERS)){
      orders.forEach(function(order,idx){
        results.push({type:IMPORT_CONFLICT_TYPES.PERMISSION,severity:'blocked',itemId:order.id,
          itemName:'工单 '+(order.orderNo||order.id||('第'+(idx+1)+'条')),
          message:TestPermissionManager.getPermissionBlockMsg(IMPORT_DATA_TYPES.ORDERS),data:order,blocked:true});
      });
      return results;
    }
    var existingMap={};existingOrders.forEach(function(o){existingMap[o.id]=o;existingMap[o.orderNo]=o;});
    var requiredFields=['id','orderNo','customerName','customerPhone','deviceType','deviceBrand','faultDescription','currentStatus'];
    orders.forEach(function(order,idx){
      var itemName='工单 '+(order.orderNo||order.id||('第'+(idx+1)+'条'));
      var schemaResult=self._validateSchema(order,requiredFields,itemName);
      if(!schemaResult.valid){
        results.push({type:IMPORT_CONFLICT_TYPES.MISSING_FIELDS,severity:'error',itemId:order.id,itemName:itemName,
          message:itemName+'缺少必填字段：'+schemaResult.missing.join(', '),data:order});
        return;
      }
      if(existingMap[order.id]){
        var existing=existingMap[order.id];var isSame=JSON.stringify(order)===JSON.stringify(existing);
        results.push({type:IMPORT_CONFLICT_TYPES.DUPLICATE,severity:isSame?'warning':'error',itemId:order.id,
          itemName:itemName+' (ID: '+order.id+')',
          message:isSame?'数据完全相同，将跳过':('ID已存在，'+order.currentStatus+'，不覆盖旧记录'),
          data:order,existing:existing,isSame:isSame});
      }else if(existingMap[order.orderNo]){
        results.push({type:IMPORT_CONFLICT_TYPES.DUPLICATE,severity:'error',itemId:order.id,
          itemName:itemName+' (工单号: '+order.orderNo+')',
          message:'工单号已存在，'+existingMap[order.orderNo].currentStatus+'，不覆盖旧记录',
          data:order,existing:existingMap[order.orderNo],isSame:false});
      }
    });
    return results;
  },
  _validateQuotes:function(quotes,existingQuotes,existingOrders){
    var self=this;var results=[];
    if(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.QUOTES)){
      quotes.forEach(function(quote,idx){
        results.push({type:IMPORT_CONFLICT_TYPES.PERMISSION,severity:'blocked',itemId:quote.id,
          itemName:'报价 '+(quote.id||('第'+(idx+1)+'条')),
          message:TestPermissionManager.getPermissionBlockMsg(IMPORT_DATA_TYPES.QUOTES),data:quote,blocked:true});
      });
      return results;
    }
    var existingMap={};existingQuotes.forEach(function(q){existingMap[q.id]=q;});
    var orderIds=existingOrders.map(function(o){return o.id});
    var requiredFields=['id','orderId','version','parts','laborItems','totalCost','createdAt'];
    quotes.forEach(function(quote,idx){
      var itemName='报价 '+(quote.id||('第'+(idx+1)+'条'));
      var schemaResult=self._validateSchema(quote,requiredFields,itemName);
      if(!schemaResult.valid){
        results.push({type:IMPORT_CONFLICT_TYPES.MISSING_FIELDS,severity:'error',itemId:quote.id,itemName:itemName,
          message:itemName+'缺少必填字段：'+schemaResult.missing.join(', '),data:quote});
        return;
      }
      if(orderIds.indexOf(quote.orderId)===-1){
        results.push({type:IMPORT_CONFLICT_TYPES.RELATION_MISSING,severity:'error',itemId:quote.id,
          itemName:itemName+' (ID: '+quote.id+')',
          message:'关联工单ID '+quote.orderId+' 不存在，无法导入报价',data:quote});
        return;
      }
      if(existingMap[quote.id]){
        var isSame=JSON.stringify(quote)===JSON.stringify(existingMap[quote.id]);
        results.push({type:IMPORT_CONFLICT_TYPES.DUPLICATE,severity:isSame?'warning':'error',itemId:quote.id,
          itemName:itemName+' (ID: '+quote.id+')',
          message:isSame?'数据完全相同，将跳过':('报价ID已存在，不覆盖旧记录'),
          data:quote,existing:existingMap[quote.id],isSame:isSame});
        return;
      }
      var existingVersions=existingQuotes.filter(function(q){return q.orderId===quote.orderId}).map(function(q){return q.version});
      if(existingVersions.indexOf(quote.version)>-1){
        results.push({type:IMPORT_CONFLICT_TYPES.VERSION_MISMATCH,severity:'error',itemId:quote.id,
          itemName:itemName+' (订单: '+quote.orderId+', 版本: '+quote.version+')',
          message:'该工单已存在版本 '+quote.version+' 的报价，不覆盖旧记录',
          data:quote,existing:existingQuotes.find(function(q){return q.orderId===quote.orderId&&q.version===quote.version})});
      }
    });
    return results;
  },
  _validateHistory:function(history,existingHistory,existingOrders){
    var self=this;var results=[];
    if(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.HISTORY)){
      history.forEach(function(h,idx){
        results.push({type:IMPORT_CONFLICT_TYPES.PERMISSION,severity:'blocked',itemId:h.id,
          itemName:'历史记录 '+(h.id||('第'+(idx+1)+'条')),
          message:TestPermissionManager.getPermissionBlockMsg(IMPORT_DATA_TYPES.HISTORY),data:h,blocked:true});
      });
      return results;
    }
    var existingMap={};existingHistory.forEach(function(h){existingMap[h.id]=h;});
    var orderIds=existingOrders.map(function(o){return o.id});
    var requiredFields=['id','orderId','toStatus','timestamp','type'];
    history.forEach(function(h,idx){
      var itemName='历史记录 '+(h.id||('第'+(idx+1)+'条'));
      var schemaResult=self._validateSchema(h,requiredFields,itemName);
      if(!schemaResult.valid){
        results.push({type:IMPORT_CONFLICT_TYPES.MISSING_FIELDS,severity:'error',itemId:h.id,itemName:itemName,
          message:itemName+'缺少必填字段：'+schemaResult.missing.join(', '),data:h});
        return;
      }
      if(orderIds.indexOf(h.orderId)===-1){
        results.push({type:IMPORT_CONFLICT_TYPES.RELATION_MISSING,severity:'error',itemId:h.id,
          itemName:itemName+' (ID: '+h.id+')',
          message:'关联工单ID '+h.orderId+' 不存在，无法导入历史记录',data:h});
        return;
      }
      if(existingMap[h.id]){
        var isSame=JSON.stringify(h)===JSON.stringify(existingMap[h.id]);
        results.push({type:IMPORT_CONFLICT_TYPES.DUPLICATE,severity:isSame?'warning':'error',itemId:h.id,
          itemName:itemName+' (ID: '+h.id+')',
          message:isSame?'数据完全相同，将跳过':('历史记录ID已存在，不覆盖旧记录'),
          data:h,existing:existingMap[h.id],isSame:isSame});
      }
    });
    return results;
  },
  _groupConflictsByType:function(conflicts){
    var groups={};
    groups[IMPORT_CONFLICT_TYPES.DUPLICATE]=[];
    groups[IMPORT_CONFLICT_TYPES.VERSION_MISMATCH]=[];
    groups[IMPORT_CONFLICT_TYPES.MISSING_FIELDS]=[];
    groups[IMPORT_CONFLICT_TYPES.RELATION_MISSING]=[];
    groups[IMPORT_CONFLICT_TYPES.PERMISSION]=[];
    conflicts.forEach(function(c){if(groups[c.type])groups[c.type].push(c);});
    return groups;
  },
  precheck:function(parsedData){
    var self=this;
    return new Promise(function(resolve){
      var data=parsedData.data;var dataTypes=self._detectDataType(data);
      var allConflicts=[];
      var stats={
        totalItems:0,
        orders:{total:0,valid:0,duplicate:0,versionMismatch:0,missingFields:0,relationMissing:0,permissionBlocked:0,errors:0},
        quotes:{total:0,valid:0,duplicate:0,versionMismatch:0,missingFields:0,relationMissing:0,permissionBlocked:0,errors:0},
        history:{total:0,valid:0,duplicate:0,versionMismatch:0,missingFields:0,relationMissing:0,permissionBlocked:0,errors:0}
      };
      var existingOrders=TestStore.getOrders();var existingQuotes=TestStore.getQuotes();var existingHistory=TestStore.getHistory();
      var combinedOrders=existingOrders.concat(data.orders||[]);
      if(dataTypes.indexOf(IMPORT_DATA_TYPES.ORDERS)>-1){
        stats.orders.total=data.orders.length;
        var orderConflicts=self._validateOrders(data.orders,existingOrders);
        allConflicts=allConflicts.concat(orderConflicts);
        stats.orders.duplicate=orderConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.DUPLICATE}).length;
        stats.orders.missingFields=orderConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.MISSING_FIELDS}).length;
        stats.orders.permissionBlocked=orderConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.PERMISSION}).length;
        stats.orders.errors=orderConflicts.filter(function(c){return c.severity==='error'||c.severity==='blocked'}).length;
        stats.orders.valid=Math.max(0,stats.orders.total-stats.orders.duplicate-stats.orders.missingFields-stats.orders.permissionBlocked);
      }
      if(dataTypes.indexOf(IMPORT_DATA_TYPES.QUOTES)>-1){
        stats.quotes.total=data.quotes.length;
        var quoteConflicts=self._validateQuotes(data.quotes,existingQuotes,combinedOrders);
        allConflicts=allConflicts.concat(quoteConflicts);
        stats.quotes.duplicate=quoteConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.DUPLICATE}).length;
        stats.quotes.versionMismatch=quoteConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.VERSION_MISMATCH}).length;
        stats.quotes.missingFields=quoteConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.MISSING_FIELDS}).length;
        stats.quotes.relationMissing=quoteConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.RELATION_MISSING}).length;
        stats.quotes.permissionBlocked=quoteConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.PERMISSION}).length;
        stats.quotes.errors=quoteConflicts.filter(function(c){return c.severity==='error'||c.severity==='blocked'}).length;
        stats.quotes.valid=Math.max(0,stats.quotes.total-stats.quotes.duplicate-stats.quotes.versionMismatch-stats.quotes.missingFields-stats.quotes.relationMissing-stats.quotes.permissionBlocked);
      }
      if(dataTypes.indexOf(IMPORT_DATA_TYPES.HISTORY)>-1){
        stats.history.total=data.history.length;
        var historyConflicts=self._validateHistory(data.history,existingHistory,combinedOrders);
        allConflicts=allConflicts.concat(historyConflicts);
        stats.history.duplicate=historyConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.DUPLICATE}).length;
        stats.history.missingFields=historyConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.MISSING_FIELDS}).length;
        stats.history.relationMissing=historyConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.RELATION_MISSING}).length;
        stats.history.permissionBlocked=historyConflicts.filter(function(c){return c.type===IMPORT_CONFLICT_TYPES.PERMISSION}).length;
        stats.history.errors=historyConflicts.filter(function(c){return c.severity==='error'||c.severity==='blocked'}).length;
        stats.history.valid=Math.max(0,stats.history.total-stats.history.duplicate-stats.history.missingFields-stats.history.relationMissing-stats.history.permissionBlocked);
      }
      stats.totalItems=stats.orders.total+stats.quotes.total+stats.history.total;
      var hasBlocked=allConflicts.some(function(c){return c.severity==='blocked'});
      var overallStatus=IMPORT_TASK_STATUS.STAGING;
      if(hasBlocked){overallStatus=IMPORT_TASK_STATUS.PRECHECK;}
      else if(stats.orders.errors>0||stats.quotes.errors>0||stats.history.errors>0){overallStatus=IMPORT_TASK_STATUS.PRECHECK;}
      else{overallStatus=IMPORT_TASK_STATUS.PENDING;}
      var groupedConflicts=self._groupConflictsByType(allConflicts);
      resolve({
        dataTypes:dataTypes,conflicts:allConflicts,groupedConflicts:groupedConflicts,stats:stats,
        overallStatus:overallStatus,hasBlocked:hasBlocked,
        canImport:!hasBlocked&&(stats.orders.valid+stats.quotes.valid+stats.history.valid>0),
        parsedData:parsedData
      });
    });
  },
  createTask:function(precheckResult,handler,note){
    var task={
      id:'imp-'+uuid(),
      batchNo:'BATCH-'+formatDate(now()).replace(/-/g,'')+'-'+String(TestStore.getImportTasks().length+1).padStart(4,'0'),
      source:precheckResult.parsedData.fileName,sourceSize:precheckResult.parsedData.fileSize,
      dataTypes:precheckResult.dataTypes,status:precheckResult.overallStatus,
      handler:handler||'系统',note:note||'',createdAt:now(),startedAt:null,finishedAt:null,
      stats:precheckResult.stats,conflicts:precheckResult.conflicts,
      groupedConflicts:precheckResult.groupedConflicts,hasBlocked:precheckResult.hasBlocked,
      result:null,
      timeline:[{id:uuid(),type:'create',title:'创建批次任务',detail:(handler||'系统')+' 创建导入任务，来源文件：'+precheckResult.parsedData.fileName,timestamp:now(),handler:handler||'系统'}],
      successSummary:null,failureLog:null,
      snapshots:{before:{orders:JSON.parse(JSON.stringify(TestStore.getOrders())),quotes:JSON.parse(JSON.stringify(TestStore.getQuotes())),history:JSON.parse(JSON.stringify(TestStore.getHistory()))},after:null},
      rawData:precheckResult.parsedData.data
    };
    var tasks=TestStore.getImportTasks();tasks.unshift(task);TestStore.saveImportTasks(tasks);
    return task;
  },
  executeImport:function(taskId){
    var self=this;
    return new Promise(function(resolve){
      var tasks=TestStore.getImportTasks();var task=tasks.find(function(t){return t.id===taskId});
      if(!task){resolve({ok:false,msg:'任务不存在'});return;}
      if(task.hasBlocked){resolve({ok:false,msg:'存在无权限拦截的项目，无法执行导入，请先调整权限配置'});return;}
      task.status=IMPORT_TASK_STATUS.PROCESSING;task.startedAt=now();
      task.timeline.push({id:uuid(),type:'start',title:'开始执行导入',detail:'开始写入数据...',timestamp:now(),handler:task.handler});
      TestStore.saveImportTasks(tasks);
      var data=task.rawData;
      var conflictIds=task.conflicts.filter(function(c){return c.itemId}).map(function(c){return c.itemId});
      var result={imported:{orders:0,quotes:0,history:0},skipped:{orders:0,quotes:0,history:0},failed:{orders:0,quotes:0,history:0},logs:[],details:[]};
      var existingOrders=TestStore.getOrders();var existingQuotes=TestStore.getQuotes();var existingHistory=TestStore.getHistory();
      var importedOrderIds=[];var importedQuoteIds=[];var importedHistoryIds=[];var failedItems=[];
      if(task.dataTypes.indexOf(IMPORT_DATA_TYPES.ORDERS)>-1&&data.orders){
        data.orders.forEach(function(order){
          var hasConflict=conflictIds.indexOf(order.id)>-1||existingOrders.some(function(o){return o.orderNo===order.orderNo});
          if(hasConflict){
            result.skipped.orders++;
            result.details.push({type:'order',id:order.id,name:order.orderNo,status:'skipped',reason:'存在冲突或重复',timestamp:now()});
            result.logs.push({type:'skip',target:'order',id:order.id,detail:order.orderNo+' 被跳过：存在冲突或重复',timestamp:now()});
          }else{
            try{
              existingOrders.push(order);importedOrderIds.push(order.id);result.imported.orders++;
              result.details.push({type:'order',id:order.id,name:order.orderNo,status:'imported',timestamp:now()});
              result.logs.push({type:'success',target:'order',id:order.id,detail:order.orderNo+' 导入成功',timestamp:now()});
            }catch(err){
              result.failed.orders++;failedItems.push({type:'order',id:order.id,name:order.orderNo,error:err.message,timestamp:now()});
              result.details.push({type:'order',id:order.id,name:order.orderNo,status:'failed',reason:err.message,timestamp:now()});
              result.logs.push({type:'error',target:'order',id:order.id,detail:order.orderNo+' 导入失败：'+err.message,timestamp:now()});
            }
          }
        });
      }
      if(task.dataTypes.indexOf(IMPORT_DATA_TYPES.QUOTES)>-1&&data.quotes){
        var allOrders=existingOrders;var orderIds=allOrders.map(function(o){return o.id});
        data.quotes.forEach(function(quote){
          var hasConflict=conflictIds.indexOf(quote.id)>-1||!orderIds.some(function(id){return id===quote.orderId})||existingQuotes.some(function(q){return q.orderId===quote.orderId&&q.version===quote.version});
          if(hasConflict){
            result.skipped.quotes++;
            result.details.push({type:'quote',id:quote.id,status:'skipped',reason:'存在冲突或关联工单不存在',timestamp:now()});
            result.logs.push({type:'skip',target:'quote',id:quote.id,detail:'报价ID='+quote.id+' 被跳过：存在冲突或关联工单不存在',timestamp:now()});
          }else{
            try{
              existingQuotes.push(quote);importedQuoteIds.push(quote.id);result.imported.quotes++;
              result.details.push({type:'quote',id:quote.id,status:'imported',timestamp:now()});
              result.logs.push({type:'success',target:'quote',id:quote.id,detail:'报价ID='+quote.id+' 导入成功',timestamp:now()});
            }catch(err){
              result.failed.quotes++;failedItems.push({type:'quote',id:quote.id,error:err.message,timestamp:now()});
              result.details.push({type:'quote',id:quote.id,status:'failed',reason:err.message,timestamp:now()});
              result.logs.push({type:'error',target:'quote',id:quote.id,detail:'报价ID='+quote.id+' 导入失败：'+err.message,timestamp:now()});
            }
          }
        });
      }
      if(task.dataTypes.indexOf(IMPORT_DATA_TYPES.HISTORY)>-1&&data.history){
        var allOrderIds=existingOrders.map(function(o){return o.id});
        data.history.forEach(function(h){
          var hasConflict=conflictIds.indexOf(h.id)>-1||!allOrderIds.some(function(id){return id===h.orderId});
          if(hasConflict){
            result.skipped.history++;
            result.details.push({type:'history',id:h.id,status:'skipped',reason:'存在冲突或关联工单不存在',timestamp:now()});
            result.logs.push({type:'skip',target:'history',id:h.id,detail:'历史ID='+h.id+' 被跳过：存在冲突或关联工单不存在',timestamp:now()});
          }else{
            try{
              existingHistory.push(h);importedHistoryIds.push(h.id);result.imported.history++;
              result.details.push({type:'history',id:h.id,status:'imported',timestamp:now()});
              result.logs.push({type:'success',target:'history',id:h.id,detail:'历史ID='+h.id+' 导入成功',timestamp:now()});
            }catch(err){
              result.failed.history++;failedItems.push({type:'history',id:h.id,error:err.message,timestamp:now()});
              result.details.push({type:'history',id:h.id,status:'failed',reason:err.message,timestamp:now()});
              result.logs.push({type:'error',target:'history',id:h.id,detail:'历史ID='+h.id+' 导入失败：'+err.message,timestamp:now()});
            }
          }
        });
      }
      TestStore.saveOrders(existingOrders);TestStore.saveQuotes(existingQuotes);TestStore.saveHistory(existingHistory);
      task.snapshots.after={orders:JSON.parse(JSON.stringify(existingOrders)),quotes:JSON.parse(JSON.stringify(existingQuotes)),history:JSON.parse(JSON.stringify(existingHistory))};
      var totalImported=result.imported.orders+result.imported.quotes+result.imported.history;
      var totalSkipped=result.skipped.orders+result.skipped.quotes+result.skipped.history;
      var totalFailed=result.failed.orders+result.failed.quotes+result.failed.history;
      task.result=result;
      task.successSummary={
        totalImported:totalImported,totalSkipped:totalSkipped,totalFailed:totalFailed,
        importedOrderIds:importedOrderIds,importedQuoteIds:importedQuoteIds,importedHistoryIds:importedHistoryIds,
        ordersImported:result.imported.orders,quotesImported:result.imported.quotes,historyImported:result.imported.history,
        completedAt:now()
      };
      task.failureLog={failedItems:failedItems,logs:result.logs.filter(function(l){return l.type==='error'||l.type==='skip'}),failedAt:now()};
      if(totalImported>0&&(totalSkipped>0||totalFailed>0)){task.status=IMPORT_TASK_STATUS.PARTIAL;}
      else if(totalImported>0){task.status=IMPORT_TASK_STATUS.COMPLETED;}else{task.status=IMPORT_TASK_STATUS.FAILED;}
      task.finishedAt=now();
      task.timeline.push({id:uuid(),type:'complete',title:'导入完成',detail:'成功导入 '+totalImported+' 条，跳过 '+totalSkipped+' 条，失败 '+totalFailed+' 条',timestamp:now(),handler:task.handler});
      TestStore.saveImportTasks(tasks);
      resolve({ok:true,task:task});
    });
  },
  rollback:function(taskId,handler,reason){
    var self=this;
    return new Promise(function(resolve){
      if(!TestPermissionManager.canRollback()){resolve({ok:false,msg:'当前角色没有回滚权限，请联系管理员'});return;}
      var tasks=TestStore.getImportTasks();var task=tasks.find(function(t){return t.id===taskId});
      if(!task){resolve({ok:false,msg:'任务不存在'});return;}
      if(task.status===IMPORT_TASK_STATUS.ROLLED_BACK){resolve({ok:false,msg:'任务已回滚，不能重复回滚'});return;}
      if(!task.snapshots||!task.snapshots.before){resolve({ok:false,msg:'没有快照数据，无法回滚'});return;}
      var rollbackCount=(task.result?(task.result.imported.orders+task.result.imported.quotes+task.result.imported.history):0);
      TestStore.saveOrders(task.snapshots.before.orders);TestStore.saveQuotes(task.snapshots.before.quotes);TestStore.saveHistory(task.snapshots.before.history);
      var prevStatus=task.status;task.status=IMPORT_TASK_STATUS.ROLLED_BACK;
      task.rollbackInfo={handler:handler||'系统',reason:reason||'用户操作回滚',rolledBackAt:now(),previousStatus:prevStatus,rollbackCount:rollbackCount};
      task.timeline.push({id:uuid(),type:'rollback',title:'执行回滚',detail:'已回滚 '+rollbackCount+' 条数据，原因：'+(reason||'用户操作'),timestamp:now(),handler:handler||'系统'});
      TestStore.saveImportTasks(tasks);
      resolve({ok:true,task:task});
    });
  },
  rollbackConflict:function(taskId,conflictType,handler,reason){
    var self=this;
    return new Promise(function(resolve){
      if(!TestPermissionManager.canRollback()){resolve({ok:false,msg:'当前角色没有回滚权限，请联系管理员'});return;}
      var tasks=TestStore.getImportTasks();var task=tasks.find(function(t){return t.id===taskId});
      if(!task){resolve({ok:false,msg:'任务不存在'});return;}
      if(task.status!==IMPORT_TASK_STATUS.COMPLETED&&task.status!==IMPORT_TASK_STATUS.PARTIAL){
        resolve({ok:false,msg:'只有已完成或部分成功的任务可以执行冲突回退'});return;
      }
      var conflicts=task.conflicts.filter(function(c){return c.type===conflictType});
      if(conflicts.length===0){resolve({ok:false,msg:'没有该类型的冲突项'});return;}
      var rollbackCount=0;var existingOrders=TestStore.getOrders();
      conflicts.forEach(function(c){
        if(c.data&&c.type===IMPORT_CONFLICT_TYPES.DUPLICATE&&c.existing){
          if(c.data.id&&existingOrders.some(function(o){return o.id===c.data.id})){
            var idx=existingOrders.findIndex(function(o){return o.id===c.data.id});
            if(idx>-1){existingOrders[idx]=c.existing;rollbackCount++;}
          }
        }
      });
      TestStore.saveOrders(existingOrders);
      task.timeline.push({id:uuid(),type:'conflict_rollback',title:'冲突回退',detail:'回退类型：'+conflictType+'，处理 '+rollbackCount+' 条，原因：'+(reason||'用户操作'),timestamp:now(),handler:handler||'系统'});
      task.conflictRollbackInfo=task.conflictRollbackInfo||[];
      task.conflictRollbackInfo.push({type:conflictType,rollbackCount:rollbackCount,handler:handler||'系统',reason:reason||'用户操作',timestamp:now()});
      TestStore.saveImportTasks(tasks);
      resolve({ok:true,task:task,rollbackCount:rollbackCount});
    });
  },
  exportResult:function(taskId){
    var task=TestStore.getImportTaskById(taskId);if(!task)return null;
    return{
      exportFormat:'crp-import-result',formatVersion:'2.0.0',exportedAt:now(),
      taskId:task.id,batchNo:task.batchNo,source:task.source,status:task.status,handler:task.handler,note:task.note,
      createdAt:task.createdAt,startedAt:task.startedAt,finishedAt:task.finishedAt,
      dataTypes:task.dataTypes,stats:task.stats,result:task.result,
      successSummary:task.successSummary,failureLog:task.failureLog,conflicts:task.conflicts,
      groupedConflicts:task.groupedConflicts,timeline:task.timeline,
      rollbackInfo:task.rollbackInfo||null,conflictRollbackInfo:task.conflictRollbackInfo||null,
      hasBlocked:task.hasBlocked||false
    };
  },
  verifyReimport:function(exportData){
    var issues=[];
    if(!exportData||exportData.exportFormat!=='crp-import-result'){issues.push({type:'format',severity:'error',message:'文件格式不正确，缺少 exportFormat 字段或格式错误'});}
    if(!exportData||!exportData.taskId){issues.push({type:'missing',severity:'error',message:'缺少任务ID字段'});}
    if(!exportData||!exportData.stats||!exportData.result){issues.push({type:'missing',severity:'error',message:'缺少统计或结果数据'});}
    if(exportData&&exportData.formatVersion&&exportData.formatVersion!=='2.0.0'&&exportData.formatVersion!=='1.0.0'){
      issues.push({type:'version',severity:'warning',message:'格式版本 '+exportData.formatVersion+' 与当前版本 2.0.0 不一致，尝试兼容导入'});
    }
    if(exportData&&exportData.successSummary){
      var calcTotal=(exportData.result.imported.orders||0)+(exportData.result.imported.quotes||0)+(exportData.result.imported.history||0);
      if(exportData.successSummary.totalImported!==calcTotal){
        issues.push({type:'inconsistency',severity:'warning',message:'成功摘要与导入明细数量不一致，摘要：'+exportData.successSummary.totalImported+'，明细：'+calcTotal});
      }
    }
    var existingTask=TestStore.getImportTaskById(exportData?exportData.taskId:null);
    if(existingTask){issues.push({type:'duplicate',severity:'warning',message:'该批次ID已存在于本地（'+existingTask.batchNo+'），将保留本地记录不覆盖'});}
    return{valid:issues.filter(function(i){return i.severity==='error'}).length===0,issues:issues,hasDuplicate:!!existingTask,existingTask:existingTask};
  },
  saveCurrentState:function(state){TestStore.saveImportState(state);},
  loadCurrentState:function(){return TestStore.getImportState();},
  saveDetailView:function(view){TestStore.saveImportDetailView(view);},
  loadDetailView:function(){return TestStore.getImportDetailView();},
  getTaskList:function(filters){
    var tasks=TestStore.getImportTasks();
    if(filters){
      if(filters.status)tasks=tasks.filter(function(t){return t.status===filters.status});
      if(filters.batchNo)tasks=tasks.filter(function(t){return(t.batchNo||'').indexOf(filters.batchNo)>-1});
    }
    return tasks;
  }
};

var TestRunner={
  results:[],
  _queue:[],
  _running:false,
  run:function(name,fn,module){
    var self=this;
    this._queue.push({name:name,fn:fn,module:module||''});
    if(!this._running){this._next();}
  },
  _next:function(){
    var self=this;
    if(this._queue.length===0){this._running=false;return;}
    this._running=true;
    var item=this._queue.shift();
    Promise.resolve().then(function(){
      var ret=item.fn();
      return ret&&typeof ret.then==='function'?ret:Promise.resolve();
    }).then(function(){
      self.results.push({name:item.name,module:item.module,pass:true});
      console.log('%c  PASS  ','background:#10b981;color:#fff',item.name);
      self._next();
    }).catch(function(err){
      self.results.push({name:item.name,module:item.module,pass:false,error:err.message});
      console.log('%c  FAIL  ','background:#ef4444;color:#fff',item.name,err.message);
      self._next();
    });
  },
  assert:function(cond,msg){if(!cond)throw new Error(msg||'Assertion failed');},
  assertEq:function(a,b,msg){if(a!==b)throw new Error((msg||'Assertion failed')+': expected '+b+' but got '+a);},
  assertGt:function(a,b,msg){if(!(a>b))throw new Error((msg||'Assertion failed')+': expected >'+b+' but got '+a);},
  waitDone:function(){
    var self=this;
    return new Promise(function(resolve){
      var timer=setInterval(function(){
        if(!self._running&&self._queue.length===0){
          clearInterval(timer);resolve();
        }
      },50);
    });
  },
  getTests:function(){return this.results;},
  getSummary:function(){return this.summary();},
  summary:function(){
    var passed=this.results.filter(function(r){return r.pass}).length;
    var failed=this.results.filter(function(r){return !r.pass}).length;
    var total=this.results.length;
    var passRate=total>0?Math.round(passed*10000/total)/100:0;
    console.log('\n================= 测试结果 =================');
    console.log('总计: '+total+'  通过: '+passed+'  失败: '+failed+'  通过率: '+passRate+'%');
    if(failed>0){
      console.log('\n失败用例:');
      this.results.filter(function(r){return !r.pass}).forEach(function(r){console.log('  ❌ '+r.name+': '+r.error);});
    }
    console.log('============================================');
    return{passed:passed,failed:failed,total:total,passRate:passRate,results:this.results};
  }
};

function runAllTests(){
  console.log('========== 导入准入与回放台 - 回归测试 ==========\n');
  TestStore.clearAll();

  console.log('--- 1. PermissionManager 权限配置模块测试 ---');
  TestRunner.run('默认角色为 admin',function(){
    TestRunner.assertEq(TestPermissionManager.getCurrentRole(),'admin');
  });
  TestRunner.run('admin 有所有权限',function(){
    TestRunner.assert(TestPermissionManager.canImportType(IMPORT_DATA_TYPES.ORDERS));
    TestRunner.assert(TestPermissionManager.canImportType(IMPORT_DATA_TYPES.QUOTES));
    TestRunner.assert(TestPermissionManager.canImportType(IMPORT_DATA_TYPES.HISTORY));
    TestRunner.assert(TestPermissionManager.canRollback());
    TestRunner.assert(TestPermissionManager.canExport());
    TestRunner.assert(TestPermissionManager.canEditPermission());
  });
  TestRunner.run('切换角色到 viewer',function(){
    TestPermissionManager.setCurrentRole('viewer');
    TestRunner.assertEq(TestPermissionManager.getCurrentRole(),'viewer');
  });
  TestRunner.run('viewer 没有导入权限',function(){
    TestRunner.assert(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.ORDERS));
    TestRunner.assert(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.QUOTES));
    TestRunner.assert(!TestPermissionManager.canImportType(IMPORT_DATA_TYPES.HISTORY));
    TestRunner.assert(!TestPermissionManager.canRollback());
  });
  TestRunner.run('权限拦截提示文案',function(){
    var msg=TestPermissionManager.getPermissionBlockMsg(IMPORT_DATA_TYPES.ORDERS);
    TestRunner.assert(msg.indexOf('无权限导入工单')>-1);
    TestRunner.assert(msg.indexOf('viewer')>-1);
  });
  TestRunner.run('viewer 不能修改权限',function(){
    TestRunner.assert(!TestPermissionManager.canEditPermission());
  });
  TestRunner.run('切回 admin 角色',function(){
    TestPermissionManager.setCurrentRole('admin');
    TestRunner.assertEq(TestPermissionManager.getCurrentRole(),'admin');
  });
  TestRunner.run('处理人校验 - 合法处理人',function(){
    var r=TestPermissionManager.validateHandler('李工');
    TestRunner.assert(r.ok);
  });
  TestRunner.run('处理人校验 - 非法处理人',function(){
    var r=TestPermissionManager.validateHandler('不存在的人');
    TestRunner.assert(!r.ok);
    TestRunner.assert(r.msg.indexOf('不在权限配置')>-1);
  });
  TestRunner.run('处理人校验 - 空值',function(){
    var r=TestPermissionManager.validateHandler('');
    TestRunner.assert(!r.ok);
  });
  TestRunner.run('添加处理人',function(){
    TestRunner.assert(TestPermissionManager.addHandler('测试新人'));
    var r=TestPermissionManager.validateHandler('测试新人');
    TestRunner.assert(r.ok);
  });
  TestRunner.run('添加重复处理人返回 false',function(){
    TestRunner.assert(!TestPermissionManager.addHandler('测试新人'));
  });
  TestRunner.run('删除处理人',function(){
    TestRunner.assert(TestPermissionManager.removeHandler('测试新人'));
    var r=TestPermissionManager.validateHandler('测试新人');
    TestRunner.assert(!r.ok);
  });
  TestRunner.run('权限配置持久化 - 改完后读回相同',function(){
    TestPermissionManager.setCurrentRole('operator');
    var cfg1=TestPermissionManager.getConfig();
    TestRunner.assertEq(cfg1.currentRole,'operator');
    TestPermissionManager.setCurrentRole('admin');
  });
  TestRunner.run('修改权限矩阵配置',function(){
    var cfg=TestPermissionManager.getConfig();
    cfg.roles.operator.canRollback=true;
    TestPermissionManager.saveConfig(cfg);
    TestPermissionManager.setCurrentRole('operator');
    TestRunner.assert(TestPermissionManager.canRollback());
    cfg.roles.operator.canRollback=false;
    TestPermissionManager.saveConfig(cfg);
    TestPermissionManager.setCurrentRole('admin');
  });

  console.log('\n--- 2. ImportAuditEngine 预检机制测试 ---');
  TestStore.clearAll();
  TestPermissionManager.setCurrentRole('admin');

  TestRunner.run('预检 - 正常工单数据',function(done){
    var orders=[{id:'test-o1',orderNo:'WX-TEST-001',customerName:'测试客户',customerPhone:'13800000000',deviceType:'笔记本',deviceBrand:'联想',faultDescription:'测试故障',currentStatus:STATUS.REGISTERED}];
    var data={orders:orders};
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data,'test.json')).then(function(r){
      TestRunner.assert(r.canImport);
      TestRunner.assertEq(r.dataTypes.length,1);
      TestRunner.assertEq(r.stats.orders.total,1);
      TestRunner.assertEq(r.stats.orders.valid,1);
      TestRunner.assertEq(r.conflicts.length,0);
      TestRunner.assert(!r.hasBlocked);
    });
  });
  TestRunner.run('预检 - 重复工单检测',function(){
    TestStore.saveOrders([{id:'exist-o1',orderNo:'WX-EXIST-001',customerName:'存在',customerPhone:'139',deviceType:'台式机',deviceBrand:'Dell',faultDescription:'旧',currentStatus:STATUS.REGISTERED}]);
    var orders=[{id:'exist-o1',orderNo:'WX-EXIST-001',customerName:'存在',customerPhone:'139',deviceType:'台式机',deviceBrand:'Dell',faultDescription:'旧',currentStatus:STATUS.REGISTERED}];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({orders:orders})).then(function(r){
      TestRunner.assertEq(r.conflicts.length,1);
      TestRunner.assertEq(r.conflicts[0].type,IMPORT_CONFLICT_TYPES.DUPLICATE);
      TestRunner.assertEq(r.stats.orders.duplicate,1);
    });
  });
  TestRunner.run('预检 - 缺少字段检测',function(){
    var orders=[{id:'miss-1',customerName:'缺字段'}];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({orders:orders})).then(function(r){
      TestRunner.assertEq(r.conflicts.length,1);
      TestRunner.assertEq(r.conflicts[0].type,IMPORT_CONFLICT_TYPES.MISSING_FIELDS);
      TestRunner.assertEq(r.stats.orders.missingFields,1);
      TestRunner.assert(!r.canImport);
    });
  });
  TestRunner.run('预检 - 报价关联缺失检测',function(){
    var quotes=[{id:'q-bad-1',orderId:'no-such-order',version:1,parts:[],laborItems:[],totalCost:0,createdAt:now()}];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({quotes:quotes})).then(function(r){
      TestRunner.assertEq(r.conflicts.length,1);
      TestRunner.assertEq(r.conflicts[0].type,IMPORT_CONFLICT_TYPES.RELATION_MISSING);
      TestRunner.assertEq(r.stats.quotes.relationMissing,1);
    });
  });
  TestRunner.run('预检 - 报价版本冲突检测',function(){
    TestStore.saveOrders([{id:'o-v1',orderNo:'WX-V-001',customerName:'版本',customerPhone:'139',deviceType:'笔记本',deviceBrand:'HP',faultDescription:'版本测试',currentStatus:STATUS.INSPECTING}]);
    TestStore.saveQuotes([{id:'exist-q1',orderId:'o-v1',version:1,parts:[],laborItems:[],totalCost:100,createdAt:now()}]);
    var quotes=[{id:'q-new',orderId:'o-v1',version:1,parts:[],laborItems:[],totalCost:200,createdAt:now()}];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({quotes:quotes})).then(function(r){
      TestRunner.assertEq(r.conflicts.length,1);
      TestRunner.assertEq(r.conflicts[0].type,IMPORT_CONFLICT_TYPES.VERSION_MISMATCH);
      TestRunner.assertEq(r.stats.quotes.versionMismatch,1);
    });
  });
  TestRunner.run('预检 - 5类冲突分组正确',function(){
    TestStore.saveOrders([{id:'grp-o1',orderNo:'WX-GRP-001',customerName:'分组',customerPhone:'13911110000',deviceType:'笔记本',deviceBrand:'HP',faultDescription:'分组',currentStatus:STATUS.INSPECTING}]);
    var orders=[
      {id:'grp-o1',orderNo:'WX-GRP-001',customerName:'分组',customerPhone:'13911110000',deviceType:'笔记本',deviceBrand:'HP',faultDescription:'分组',currentStatus:STATUS.INSPECTING},
      {customerName:'缺字段'}
    ];
    var quotes=[
      {id:'grp-q1',orderId:'no-such',version:1,parts:[],laborItems:[],totalCost:0,createdAt:now()}
    ];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({orders:orders,quotes:quotes})).then(function(r){
      TestRunner.assert(r.groupedConflicts);
      TestRunner.assertGt(r.groupedConflicts[IMPORT_CONFLICT_TYPES.DUPLICATE].length,0);
      TestRunner.assertGt(r.groupedConflicts[IMPORT_CONFLICT_TYPES.MISSING_FIELDS].length,0);
      TestRunner.assertGt(r.groupedConflicts[IMPORT_CONFLICT_TYPES.RELATION_MISSING].length,0);
    });
  });
  TestRunner.run('预检 - 权限拦截 viewer 角色',function(){
    TestPermissionManager.setCurrentRole('viewer');
    var orders=[{id:'perm-o1',orderNo:'WX-PERM-001',customerName:'权限',customerPhone:'139',deviceType:'笔记本',deviceBrand:'HP',faultDescription:'权限',currentStatus:STATUS.REGISTERED}];
    TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({orders:orders})).then(function(r){
      TestRunner.assert(r.hasBlocked);
      TestRunner.assert(!r.canImport);
      TestRunner.assertEq(r.conflicts.length,1);
      TestRunner.assertEq(r.conflicts[0].type,IMPORT_CONFLICT_TYPES.PERMISSION);
      TestRunner.assertEq(r.conflicts[0].severity,'blocked');
      TestRunner.assertEq(r.stats.orders.permissionBlocked,1);
      TestPermissionManager.setCurrentRole('admin');
    });
  });

  console.log('\n--- 3. 批次处理、失败日志、成功摘要测试 ---');
  TestStore.clearAll();
  TestPermissionManager.setCurrentRole('admin');

  TestRunner.run('创建任务生成批次号',function(){
    var data={orders:[{id:'batch-o1',orderNo:'WX-BATCH-001',customerName:'批次',customerPhone:'139',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'批次测试',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工','测试备注');
      TestRunner.assert(task.batchNo);
      TestRunner.assert(task.batchNo.indexOf('BATCH-')===0);
      TestRunner.assertEq(task.handler,'李工');
      TestRunner.assertEq(task.note,'测试备注');
      TestRunner.assertGt(task.timeline.length,0);
      TestRunner.assertEq(task.timeline[0].type,'create');
    });
  });
  TestRunner.run('执行导入生成成功摘要',function(){
    var data={orders:[{id:'exec-o1',orderNo:'WX-EXEC-001',customerName:'执行',customerPhone:'13911112222',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'执行测试',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工');
      return TestImportAuditEngine.executeImport(task.id).then(function(r){
        TestRunner.assert(r.ok);
        TestRunner.assert(r.task.successSummary);
        TestRunner.assertEq(r.task.successSummary.totalImported,1);
        TestRunner.assertEq(r.task.successSummary.ordersImported,1);
        TestRunner.assertEq(r.task.status,IMPORT_TASK_STATUS.COMPLETED);
        TestRunner.assert(r.task.failureLog);
        TestRunner.assertEq(r.task.failureLog.failedItems.length,0);
        var savedOrder=TestStore.getOrderById('exec-o1');
        TestRunner.assert(savedOrder);
        TestRunner.assertEq(savedOrder.orderNo,'WX-EXEC-001');
      });
    });
  });
  TestRunner.run('导入明细记录完整',function(){
    var data={orders:[{id:'detail-o1',orderNo:'WX-DETAIL-001',customerName:'明细',customerPhone:'13922223333',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'明细测试',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'王工');
      return TestImportAuditEngine.executeImport(task.id).then(function(r){
        TestRunner.assertGt(r.task.result.details.length,0);
        TestRunner.assertEq(r.task.result.details[0].status,'imported');
        TestRunner.assertEq(r.task.result.details[0].type,'order');
      });
    });
  });
  TestRunner.run('失败日志记录冲突跳过项',function(){
    TestStore.saveOrders([{id:'skip-o1',orderNo:'WX-SKIP-001',customerName:'跳过',customerPhone:'139',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'跳过',currentStatus:STATUS.REGISTERED}]);
    var data={orders:[
      {id:'skip-o1',orderNo:'WX-SKIP-001',customerName:'跳过',customerPhone:'139',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'跳过',currentStatus:STATUS.REGISTERED},
      {id:'new-o1',orderNo:'WX-NEW-001',customerName:'新单',customerPhone:'13933334444',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'新',currentStatus:STATUS.REGISTERED}
    ]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'王工');
      return TestImportAuditEngine.executeImport(task.id).then(function(r){
        TestRunner.assertEq(r.task.status,IMPORT_TASK_STATUS.PARTIAL);
        TestRunner.assertEq(r.task.successSummary.totalImported,1);
        TestRunner.assertEq(r.task.successSummary.totalSkipped,1);
        TestRunner.assertGt(r.task.failureLog.logs.length,0);
      });
    });
  });

  console.log('\n--- 4. 回滚与冲突回退测试 ---');
  TestStore.clearAll();
  TestPermissionManager.setCurrentRole('admin');

  TestRunner.run('按批次撤销 - 数据恢复正确',function(){
    TestStore.clearAll();
    TestPermissionManager.setCurrentRole('admin');
    var data={orders:[{id:'rollback-o1',orderNo:'WX-ROLL-001',customerName:'回滚',customerPhone:'13944445555',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'回滚测试',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工');
      return TestImportAuditEngine.executeImport(task.id).then(function(er){
        TestRunner.assert(TestStore.getOrderById('rollback-o1'),'导入后工单存在');
        return TestImportAuditEngine.rollback(task.id,'李工','测试回滚').then(function(rr){
          TestRunner.assert(rr.ok);
          TestRunner.assert(!TestStore.getOrderById('rollback-o1'),'回滚后工单不存在');
          TestRunner.assertEq(rr.task.status,IMPORT_TASK_STATUS.ROLLED_BACK);
          TestRunner.assert(rr.task.rollbackInfo);
          TestRunner.assertEq(rr.task.rollbackInfo.reason,'测试回滚');
        });
      });
    });
  });
  TestRunner.run('viewer 角色不能回滚',function(){
    TestPermissionManager.setCurrentRole('viewer');
    return TestImportAuditEngine.rollback('fake-id','handler','reason').then(function(r){
      TestRunner.assert(!r.ok);
      TestRunner.assert(r.msg.indexOf('没有回滚权限')>-1);
      TestPermissionManager.setCurrentRole('admin');
    });
  });
  TestRunner.run('重复回滚被拒绝',function(){
    var data={orders:[{id:'rb2-o1',orderNo:'WX-RB2-001',customerName:'回滚2',customerPhone:'13955556666',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'回滚2',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工');
      return TestImportAuditEngine.executeImport(task.id).then(function(er){
        return TestImportAuditEngine.rollback(task.id,'李工','回滚1').then(function(r1){
          TestRunner.assert(r1.ok);
          return TestImportAuditEngine.rollback(task.id,'李工','回滚2').then(function(r2){
            TestRunner.assert(!r2.ok);
            TestRunner.assert(r2.msg.indexOf('已回滚')>-1);
          });
        });
      });
    });
  });

  console.log('\n--- 5. 导出与再导入校验测试 ---');
  TestStore.clearAll();
  TestPermissionManager.setCurrentRole('admin');

  TestRunner.run('导出结果格式版本为 2.0.0',function(){
    var data={orders:[{id:'exp-o1',orderNo:'WX-EXP-001',customerName:'导出',customerPhone:'13966667777',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'导出',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工');
      return TestImportAuditEngine.executeImport(task.id).then(function(er){
        var exportData=TestImportAuditEngine.exportResult(task.id);
        TestRunner.assert(exportData);
        TestRunner.assertEq(exportData.formatVersion,'2.0.0');
        TestRunner.assertEq(exportData.exportFormat,'crp-import-result');
        TestRunner.assertEq(exportData.batchNo,task.batchNo);
        TestRunner.assert(exportData.successSummary);
        TestRunner.assert(exportData.failureLog);
        TestRunner.assert(exportData.timeline);
      });
    });
  });
  TestRunner.run('导出后再导入校验 - 有效文件',function(){
    var data={orders:[{id:'ver-o1',orderNo:'WX-VER-001',customerName:'校验',customerPhone:'13977778888',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'校验',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工');
      return TestImportAuditEngine.executeImport(task.id).then(function(er){
        var exportData=TestImportAuditEngine.exportResult(task.id);
        var vr=TestImportAuditEngine.verifyReimport(exportData);
        TestRunner.assert(vr.valid);
        TestRunner.assert(vr.hasDuplicate);
      });
    });
  });
  TestRunner.run('导出后再导入校验 - 格式错误',function(){
    var vr=TestImportAuditEngine.verifyReimport({bad:'data'});
    TestRunner.assert(!vr.valid);
    TestRunner.assertGt(vr.issues.length,0);
  });
  TestRunner.run('导出后再导入校验 - 版本兼容警告',function(){
    var vr=TestImportAuditEngine.verifyReimport({exportFormat:'crp-import-result',formatVersion:'3.0.0',taskId:'x',stats:{},result:{imported:{orders:0,quotes:0,history:0}}});
    TestRunner.assert(vr.valid);
    TestRunner.assert(vr.issues.some(function(i){return i.type==='version'}));
  });

  console.log('\n--- 6. 视图状态持久化测试 ---');
  TestStore.clearAll();

  TestRunner.run('筛选条件持久化保存和读取',function(){
    TestImportAuditEngine.saveCurrentState({currentTab:'list',filters:{status:'completed',batchNo:'TEST'},savedAt:now()});
    var loaded=TestImportAuditEngine.loadCurrentState();
    TestRunner.assert(loaded);
    TestRunner.assertEq(loaded.currentTab,'list');
    TestRunner.assertEq(loaded.filters.status,'completed');
    TestRunner.assertEq(loaded.filters.batchNo,'TEST');
  });
  TestRunner.run('详情视图子Tab持久化',function(){
    TestImportAuditEngine.saveDetailView({subTab:'conflicts',savedAt:now()});
    var dv=TestImportAuditEngine.loadDetailView();
    TestRunner.assert(dv);
    TestRunner.assertEq(dv.subTab,'conflicts');
  });
  TestRunner.run('按批次号筛选任务',function(){
    TestStore.saveImportTasks([
      {id:'t1',batchNo:'BATCH-20260101-0001',status:IMPORT_TASK_STATUS.COMPLETED,createdAt:now()},
      {id:'t2',batchNo:'BATCH-20260102-0002',status:IMPORT_TASK_STATUS.PARTIAL,createdAt:now()},
      {id:'t3',batchNo:'OTHER-0003',status:IMPORT_TASK_STATUS.COMPLETED,createdAt:now()}
    ]);
    var filtered=TestImportAuditEngine.getTaskList({batchNo:'BATCH-20260101'});
    TestRunner.assertEq(filtered.length,1);
    TestRunner.assertEq(filtered[0].batchNo,'BATCH-20260101-0001');
    var byStatus=TestImportAuditEngine.getTaskList({status:IMPORT_TASK_STATUS.COMPLETED});
    TestRunner.assertEq(byStatus.length,2);
  });

  console.log('\n--- 7. 时间线记录测试 ---');
  TestStore.clearAll();
  TestPermissionManager.setCurrentRole('admin');

  TestRunner.run('完整流程时间线包含多个节点',function(){
    var data={orders:[{id:'tl-o1',orderNo:'WX-TL-001',customerName:'时间线',customerPhone:'13988889999',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'时间线',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'李工','时间线测试');
      return TestImportAuditEngine.executeImport(task.id).then(function(er){
        return TestImportAuditEngine.rollback(task.id,'张工','测试回滚时间线').then(function(rr){
          var t=TestStore.getImportTaskById(task.id);
          var types=t.timeline.map(function(tl){return tl.type});
          TestRunner.assert(types.indexOf('create')>-1);
          TestRunner.assert(types.indexOf('start')>-1);
          TestRunner.assert(types.indexOf('complete')>-1);
          TestRunner.assert(types.indexOf('rollback')>-1);
        });
      });
    });
  });

  console.log('\n--- 8. 处理人备注和异常提示测试 ---');
  TestStore.clearAll();

  TestRunner.run('任务保存处理人备注',function(){
    var data={orders:[{id:'note-o1',orderNo:'WX-NOTE-001',customerName:'备注',customerPhone:'13999990000',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'备注测试',currentStatus:STATUS.REGISTERED}]};
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData(data)).then(function(pr){
      var task=TestImportAuditEngine.createTask(pr,'王工','这是一个测试备注');
      TestRunner.assertEq(task.handler,'王工');
      TestRunner.assertEq(task.note,'这是一个测试备注');
    });
  });
  TestRunner.run('无权限拦截有明确异常提示',function(){
    TestPermissionManager.setCurrentRole('viewer');
    var orders=[{id:'blocked-o1',orderNo:'WX-BLOCKED-001',customerName:'拦截',customerPhone:'13900001111',deviceType:'笔记本',deviceBrand:'Acer',faultDescription:'拦截测试',currentStatus:STATUS.REGISTERED}];
    return TestImportAuditEngine.precheck(TestImportAuditEngine._parseData({orders:orders})).then(function(r){
      TestRunner.assert(r.hasBlocked);
      TestRunner.assertEq(r.conflicts[0].severity,'blocked');
      TestRunner.assert(r.conflicts[0].message.indexOf('viewer')>-1);
      TestRunner.assert(r.conflicts[0].message.indexOf('无权限')>-1);
      TestPermissionManager.setCurrentRole('admin');
    });
  });

  setTimeout(function(){
    var summary=TestRunner.summary();
    if(typeof window!=='undefined'){
      window.TEST_RESULT=summary;
      console.log('\n测试完成，结果已保存到 window.TEST_RESULT');
    }
  },500);
}

if(typeof window!=='undefined'){
  window.TestImportGate={
    runAllTests:runAllTests,
    TestRunner:TestRunner,
    TestStore:TestStore,
    TestPermissionManager:TestPermissionManager,
    TestImportAuditEngine:TestImportAuditEngine
  };
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={runAllTests:runAllTests};
}

})();
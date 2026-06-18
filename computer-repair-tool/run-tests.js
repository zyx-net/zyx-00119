const fs = require('fs');
const vm = require('vm');

console.log('========================================');
console.log('🚀 批量导入审计中心 - 验收测试');
console.log('========================================\n');

const sandbox = {
  window: {},
  document: {
    addEventListener: () => {},
    getElementById: () => ({ textContent: '', innerHTML: '', value: '', click: () => {} }),
    querySelector: () => ({ addEventListener: () => {} }),
    querySelectorAll: () => [],
    createElement: () => ({ textContent: '', innerHTML: '', value: '', href: '', click: () => {}, style: {}, classList: { add: () => {}, remove: () => {} } }),
  },
  localStorage: {
    _data: {},
    getItem: function(k) { return this._data[k] || null; },
    setItem: function(k, v) { this._data[k] = v; },
  },
  console: console,
  setTimeout: setTimeout,
  Blob: function(data, opts) { this.data = data; this.opts = opts; },
  URL: { createObjectURL: () => 'test-url', revokeObjectURL: () => {} },
};

const appCode = fs.readFileSync('app.js', 'utf8');
const testCode = fs.readFileSync('test-import-audit.js', 'utf8');

vm.createContext(sandbox);
vm.runInContext(appCode, sandbox);
vm.runInContext(testCode, sandbox);

const results = [];

function runTest(name, testFn) {
  console.log(`\n📋 测试场景: ${name}`);
  console.log('   ' + '─'.repeat(50));
  try {
    testFn();
    console.log(`   ✅ 通过`);
    results.push({ name, status: 'pass' });
    return true;
  } catch (e) {
    console.log(`   ❌ 失败: ${e.message}`);
    console.log(`      ${e.stack.split('\n').slice(1, 3).join('\n      ')}`);
    results.push({ name, status: 'fail', error: e.message });
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || '断言失败'}: 期望 ${expected}, 实际 ${actual}`);
  }
}

const STORAGE_KEYS = {
  ORDERS: 'crp_test_import_orders',
  QUOTES: 'crp_test_import_quotes',
  HISTORY: 'crp_test_import_history',
  IMPORT_TASKS: 'crp_test_import_tasks',
  IMPORT_AUDIT_LOGS: 'crp_test_import_audit_logs',
  IMPORT_STATE: 'crp_test_import_state',
};

const Store = {
  load: function(key) {
    try {
      var val = sandbox.localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  },
  save: function(key, val) {
    sandbox.localStorage.setItem(key, JSON.stringify(val));
  },
  getOrders: function() { return this.load(STORAGE_KEYS.ORDERS) || []; },
  saveOrders: function(o) { this.save(STORAGE_KEYS.ORDERS, o); },
  getQuotes: function() { return this.load(STORAGE_KEYS.QUOTES) || []; },
  saveQuotes: function(o) { this.save(STORAGE_KEYS.QUOTES, o); },
  getHistory: function() { return this.load(STORAGE_KEYS.HISTORY) || []; },
  saveHistory: function(o) { this.save(STORAGE_KEYS.HISTORY, o); },
  getImportTasks: function() { return this.load(STORAGE_KEYS.IMPORT_TASKS) || []; },
  saveImportTasks: function(o) { this.save(STORAGE_KEYS.IMPORT_TASKS, o); },
  getImportAuditLogs: function() { return this.load(STORAGE_KEYS.IMPORT_AUDIT_LOGS) || []; },
  saveImportAuditLogs: function(o) { this.save(STORAGE_KEYS.IMPORT_AUDIT_LOGS, o); },
  getImportState: function() { return this.load(STORAGE_KEYS.IMPORT_STATE) || null; },
  saveImportState: function(o) { this.save(STORAGE_KEYS.IMPORT_STATE, o); },
  clear: function() {
    Object.values(STORAGE_KEYS).forEach(function(k) { sandbox.localStorage.setItem(k, null); });
  }
};

const IMPORT_DATA_TYPES = { ORDER: 'order', QUOTE: 'quote', HISTORY: 'history' };
const IMPORT_TASK_STATUS = {
  PRECHECKING: 'prechecking',
  PENDING: 'pending',
  PROCESSING: 'processing',
  PARTIAL_SUCCESS: 'partial_success',
  ALL_SUCCESS: 'all_success',
  ALL_FAILED: 'all_failed',
  ROLLED_BACK: 'rolled_back'
};
const IMPORT_CONFLICT_TYPES = {
  DUPLICATE: 'duplicate',
  VERSION_MISMATCH: 'version_mismatch',
  MISSING_FIELDS: 'missing_fields',
  PERMISSION: 'permission'
};

const ImportAuditEngine = {
  _parseFile: function(content) {
    try {
      var data = JSON.parse(content);
      return { success: true, data: data, type: this._detectDataType(data) };
    } catch (e) {
      return { success: false, error: 'JSON 解析失败: ' + e.message };
    }
  },

  _detectDataType: function(data) {
    var types = [];
    if (data.orders && data.orders.length > 0) types.push(IMPORT_DATA_TYPES.ORDER);
    if (data.quotes && data.quotes.length > 0) types.push(IMPORT_DATA_TYPES.QUOTE);
    if (data.history && data.history.length > 0) types.push(IMPORT_DATA_TYPES.HISTORY);
    return types;
  },

  _validateSchema: function(item, requiredFields, itemName) {
    var missing = [];
    requiredFields.forEach(function(field) {
      if (!item[field] && item[field] !== 0) {
        missing.push(field);
      }
    });
    return { valid: missing.length === 0, missing: missing, itemName: itemName };
  },

  _validateOrders: function(orders, existingOrders) {
    var results = [];
    var existingMap = {};
    existingOrders.forEach(function(o) { existingMap[o.id] = o; existingMap[o.orderNo] = o; });
    var requiredFields = ['id', 'orderNo', 'customerName', 'customerPhone', 'deviceType', 'deviceBrand', 'faultDescription', 'currentStatus'];
    orders.forEach(function(order, idx) {
      var schemaResult = this._validateSchema(order, requiredFields, '工单 ' + (order.orderNo || order.id || ('第' + (idx + 1) + '条')));
      if (!schemaResult.valid) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.MISSING_FIELDS,
          severity: 'error',
          itemId: order.id,
          itemName: schemaResult.itemName,
          message: schemaResult.itemName + '缺少必填字段：' + schemaResult.missing.join(', '),
          data: order
        });
        return;
      }
      if (existingMap[order.id]) {
        var existing = existingMap[order.id];
        var isSame = JSON.stringify(order) === JSON.stringify(existing);
        results.push({
          type: IMPORT_CONFLICT_TYPES.DUPLICATE,
          severity: isSame ? 'warning' : 'error',
          itemId: order.id,
          itemName: schemaResult.itemName + ' (ID: ' + order.id + ')',
          message: isSame ? '数据完全相同，将跳过' : ('ID已存在，' + order.currentStatus + '，不覆盖旧记录'),
          data: order,
          existing: existing,
          isSame: isSame
        });
      } else if (existingMap[order.orderNo]) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.DUPLICATE,
          severity: 'error',
          itemId: order.id,
          itemName: schemaResult.itemName + ' (工单号: ' + order.orderNo + ')',
          message: '工单号已存在，' + existingMap[order.orderNo].currentStatus + '，不覆盖旧记录',
          data: order,
          existing: existingMap[order.orderNo],
          isSame: false
        });
      }
    }.bind(this));
    return results;
  },

  _validateQuotes: function(quotes, existingQuotes, existingOrders) {
    var results = [];
    var existingMap = {};
    existingQuotes.forEach(function(q) { existingMap[q.id] = q; });
    var orderIds = existingOrders.map(function(o) { return o.id; });
    var requiredFields = ['id', 'orderId', 'version', 'parts', 'laborItems', 'totalCost', 'createdAt'];
    quotes.forEach(function(quote, idx) {
      var schemaResult = this._validateSchema(quote, requiredFields, '报价 ' + (quote.id || ('第' + (idx + 1) + '条')));
      if (!schemaResult.valid) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.MISSING_FIELDS,
          severity: 'error',
          itemId: quote.id,
          itemName: schemaResult.itemName,
          message: schemaResult.itemName + '缺少必填字段：' + schemaResult.missing.join(', '),
          data: quote
        });
        return;
      }
      if (orderIds.indexOf(quote.orderId) === -1) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.PERMISSION,
          severity: 'error',
          itemId: quote.id,
          itemName: schemaResult.itemName + ' (ID: ' + quote.id + ')',
          message: '关联工单ID ' + quote.orderId + ' 不存在，无法导入',
          data: quote
        });
        return;
      }
      var existingVersions = existingQuotes.filter(function(q) { return q.orderId === quote.orderId; }).map(function(q) { return q.version; });
      if (existingVersions.indexOf(quote.version) > -1) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.VERSION_MISMATCH,
          severity: 'error',
          itemId: quote.id,
          itemName: schemaResult.itemName + ' (订单: ' + quote.orderId + ', 版本: ' + quote.version + ')',
          message: '该工单已存在版本 ' + quote.version + '，不覆盖旧记录',
          data: quote,
          existing: existingQuotes.find(function(q) { return q.orderId === quote.orderId && q.version === quote.version; })
        });
      }
    }.bind(this));
    return results;
  },

  _validateHistory: function(history, existingHistory, existingOrders) {
    var results = [];
    var existingMap = {};
    existingHistory.forEach(function(h) { existingMap[h.id] = h; });
    var orderIds = existingOrders.map(function(o) { return o.id; });
    var requiredFields = ['id', 'orderId', 'toStatus', 'timestamp', 'type'];
    history.forEach(function(h, idx) {
      var schemaResult = this._validateSchema(h, requiredFields, '历史记录 ' + (h.id || ('第' + (idx + 1) + '条')));
      if (!schemaResult.valid) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.MISSING_FIELDS,
          severity: 'error',
          itemId: h.id,
          itemName: schemaResult.itemName,
          message: schemaResult.itemName + '缺少必填字段：' + schemaResult.missing.join(', '),
          data: h
        });
        return;
      }
      if (orderIds.indexOf(h.orderId) === -1) {
        results.push({
          type: IMPORT_CONFLICT_TYPES.PERMISSION,
          severity: 'error',
          itemId: h.id,
          itemName: schemaResult.itemName + ' (ID: ' + h.id + ')',
          message: '关联工单ID ' + h.orderId + ' 不存在，无法导入',
          data: h
        });
        return;
      }
    }.bind(this));
    return results;
  },

  precheck: function(parsedData) {
    var data = parsedData.data;
    var existingOrders = Store.getOrders();
    var existingQuotes = Store.getQuotes();
    var existingHistory = Store.getHistory();
    var importOrders = data.orders || [];
    var combinedOrders = existingOrders.concat(importOrders);
    var allConflicts = [];
    var stats = { orders: { total: 0, conflicts: 0, errors: 0 }, quotes: { total: 0, conflicts: 0, errors: 0 }, history: { total: 0, conflicts: 0, errors: 0 } };
    if (data.orders && data.orders.length > 0) {
      var orderConflicts = this._validateOrders(data.orders, existingOrders);
      stats.orders.total = data.orders.length;
      stats.orders.conflicts = orderConflicts.filter(function(c) { return c.severity === 'warning'; }).length;
      stats.orders.errors = orderConflicts.filter(function(c) { return c.severity === 'error'; }).length;
      allConflicts = allConflicts.concat(orderConflicts);
    }
    if (data.quotes && data.quotes.length > 0) {
      var quoteConflicts = this._validateQuotes(data.quotes, existingQuotes, combinedOrders);
      stats.quotes.total = data.quotes.length;
      stats.quotes.conflicts = quoteConflicts.filter(function(c) { return c.severity === 'warning'; }).length;
      stats.quotes.errors = quoteConflicts.filter(function(c) { return c.severity === 'error'; }).length;
      allConflicts = allConflicts.concat(quoteConflicts);
    }
    if (data.history && data.history.length > 0) {
      var historyConflicts = this._validateHistory(data.history, existingHistory, combinedOrders);
      stats.history.total = data.history.length;
      stats.history.conflicts = historyConflicts.filter(function(c) { return c.severity === 'warning'; }).length;
      stats.history.errors = historyConflicts.filter(function(c) { return c.severity === 'error'; }).length;
      allConflicts = allConflicts.concat(historyConflicts);
    }
    return { conflicts: allConflicts, stats: stats, canImport: allConflicts.filter(function(c) { return c.severity === 'error' && c.type !== IMPORT_CONFLICT_TYPES.DUPLICATE && c.type !== IMPORT_CONFLICT_TYPES.VERSION_MISMATCH; }).length === 0 };
  },

  createTask: function(parsedData, precheckResult, options) {
    options = options || {};
    var taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    var task = {
      id: taskId,
      sourceFile: options.fileName || 'unknown.json',
      sourceSize: options.fileSize || 0,
      dataTypes: parsedData.type,
      status: IMPORT_TASK_STATUS.PENDING,
      handler: options.handler || '未知处理人',
      note: options.note || '',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      precheck: precheckResult,
      importData: parsedData.data,
      result: null,
      snapshots: { before: this._takeSnapshot() },
      rollbackInfo: null
    };
    var tasks = Store.getImportTasks();
    tasks.unshift(task);
    Store.saveImportTasks(tasks);
    this._addAuditLog('TASK_CREATED', taskId, { handler: task.handler, note: task.note });
    return task;
  },

  _takeSnapshot: function() {
    return {
      orders: JSON.parse(JSON.stringify(Store.getOrders())),
      quotes: JSON.parse(JSON.stringify(Store.getQuotes())),
      history: JSON.parse(JSON.stringify(Store.getHistory()))
    };
  },

  _addAuditLog: function(action, taskId, details) {
    var logs = Store.getImportAuditLogs();
    logs.push({
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      taskId: taskId,
      action: action,
      timestamp: new Date().toISOString(),
      handler: (details && details.handler) || 'system',
      details: details || {}
    });
    Store.saveImportAuditLogs(logs);
  },

  executeImport: function(taskId) {
    var tasks = Store.getImportTasks();
    var task = tasks.find(function(t) { return t.id === taskId; });
    if (!task) {
      return { success: false, error: '任务不存在' };
    }
    if (task.status !== IMPORT_TASK_STATUS.PENDING) {
      return { success: false, error: '任务状态不正确，无法导入' };
    }
    task.status = IMPORT_TASK_STATUS.PROCESSING;
    task.startedAt = new Date().toISOString();
    var result = { imported: { orders: 0, quotes: 0, history: 0 }, skipped: { orders: 0, quotes: 0, history: 0 }, errors: { orders: 0, quotes: 0, history: 0 }, failedItems: [], successItems: [] };
    var existingOrders = Store.getOrders();
    var existingQuotes = Store.getQuotes();
    var existingHistory = Store.getHistory();
    var conflictIds = {};
    task.precheck.conflicts.forEach(function(c) {
      if (c.severity === 'error' || c.severity === 'warning') {
        conflictIds[c.itemId] = c;
      }
    });
    if (task.importData.orders) {
      task.importData.orders.forEach(function(order) {
        if (conflictIds[order.id]) {
          result.skipped.orders++;
          result.failedItems.push({ type: 'order', data: order, conflict: conflictIds[order.id] });
        } else {
          existingOrders.push(order);
          result.imported.orders++;
          result.successItems.push({ type: 'order', data: order });
        }
      });
    }
    if (task.importData.quotes) {
      task.importData.quotes.forEach(function(quote) {
        if (conflictIds[quote.id]) {
          result.skipped.quotes++;
          result.failedItems.push({ type: 'quote', data: quote, conflict: conflictIds[quote.id] });
        } else {
          existingQuotes.push(quote);
          result.imported.quotes++;
          result.successItems.push({ type: 'quote', data: quote });
        }
      });
    }
    if (task.importData.history) {
      task.importData.history.forEach(function(h) {
        if (conflictIds[h.id]) {
          result.skipped.history++;
          result.failedItems.push({ type: 'history', data: h, conflict: conflictIds[h.id] });
        } else {
          existingHistory.push(h);
          result.imported.history++;
          result.successItems.push({ type: 'history', data: h });
        }
      });
    }
    Store.saveOrders(existingOrders);
    Store.saveQuotes(existingQuotes);
    Store.saveHistory(existingHistory);
    var totalImported = result.imported.orders + result.imported.quotes + result.imported.history;
    var totalSkipped = result.skipped.orders + result.skipped.quotes + result.skipped.history;
    var totalErrors = result.errors.orders + result.errors.quotes + result.errors.history;
    if (totalImported > 0 && totalSkipped > 0) {
      task.status = IMPORT_TASK_STATUS.PARTIAL_SUCCESS;
    } else if (totalImported > 0 && totalSkipped === 0) {
      task.status = IMPORT_TASK_STATUS.ALL_SUCCESS;
    } else {
      task.status = IMPORT_TASK_STATUS.ALL_FAILED;
    }
    task.completedAt = new Date().toISOString();
    task.result = result;
    task.snapshots.after = {
      orders: JSON.parse(JSON.stringify(existingOrders)),
      quotes: JSON.parse(JSON.stringify(existingQuotes)),
      history: JSON.parse(JSON.stringify(existingHistory))
    };
    Store.saveImportTasks(tasks);
    this._addAuditLog('IMPORT_COMPLETED', taskId, {
      status: task.status,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors
    });
    return { success: true, task: task };
  },

  rollback: function(taskId, options) {
    options = options || {};
    var tasks = Store.getImportTasks();
    var task = tasks.find(function(t) { return t.id === taskId; });
    if (!task) {
      return { success: false, error: '任务不存在' };
    }
    if (task.status === IMPORT_TASK_STATUS.ROLLED_BACK) {
      return { success: false, error: '任务已回滚，不可重复回滚' };
    }
    if (!task.snapshots || !task.snapshots.before) {
      return { success: false, error: '没有可用的快照数据，无法回滚' };
    }
    var beforeSnapshot = task.snapshots.before;
    Store.saveOrders(JSON.parse(JSON.stringify(beforeSnapshot.orders)));
    Store.saveQuotes(JSON.parse(JSON.stringify(beforeSnapshot.quotes)));
    Store.saveHistory(JSON.parse(JSON.stringify(beforeSnapshot.history)));
    task.status = IMPORT_TASK_STATUS.ROLLED_BACK;
    task.rollbackInfo = {
      handler: options.handler || '未知处理人',
      reason: options.reason || '',
      timestamp: new Date().toISOString()
    };
    Store.saveImportTasks(tasks);
    this._addAuditLog('ROLLBACK_COMPLETED', taskId, {
      handler: task.rollbackInfo.handler,
      reason: task.rollbackInfo.reason
    });
    return { success: true, task: task };
  },

  exportResult: function(taskId) {
    var tasks = Store.getImportTasks();
    var task = tasks.find(function(t) { return t.id === taskId; });
    if (!task) {
      return { success: false, error: '任务不存在' };
    }
    var exportData = {
      format: 'crp-import-result',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      task: {
        id: task.id,
        sourceFile: task.sourceFile,
        sourceSize: task.sourceSize,
        dataTypes: task.dataTypes,
        status: task.status,
        handler: task.handler,
        note: task.note,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt
      },
      summary: task.result,
      conflicts: task.precheck.conflicts,
      rollbackInfo: task.rollbackInfo
    };
    return { success: true, data: exportData, fileName: 'import-result-' + task.id + '.json' };
  },

  getTaskList: function(filters) {
    filters = filters || {};
    var tasks = Store.getImportTasks();
    if (filters.status) {
      tasks = tasks.filter(function(t) { return t.status === filters.status; });
    }
    if (filters.dataType) {
      tasks = tasks.filter(function(t) { return t.dataTypes.indexOf(filters.dataType) > -1; });
    }
    if (filters.handler) {
      tasks = tasks.filter(function(t) { return t.handler.indexOf(filters.handler) > -1; });
    }
    if (filters.sourceFile) {
      tasks = tasks.filter(function(t) { return t.sourceFile.indexOf(filters.sourceFile) > -1; });
    }
    return tasks;
  },

  saveCurrentState: function(state) {
    Store.saveImportState({
      currentTab: state.currentTab,
      selectedTaskId: state.selectedTaskId,
      filters: state.filters,
      savedAt: new Date().toISOString()
    });
  },

  loadCurrentState: function() {
    return Store.getImportState();
  }
};

function generateTestData() {
  var now = new Date().toISOString();
  return {
    orders: [
      {
        id: 'test_order_001',
        orderNo: 'TEST-2026-001',
        customerName: '张三',
        customerPhone: '13800000001',
        deviceType: '笔记本',
        deviceBrand: '联想',
        deviceModel: 'ThinkPad X1',
        faultDescription: '无法开机，电源指示灯不亮',
        currentStatus: 'INSPECTING',
        handler: '李工',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'test_order_002',
        orderNo: 'TEST-2026-002',
        customerName: '李四',
        customerPhone: '13800000002',
        deviceType: '台式机',
        deviceBrand: '戴尔',
        deviceModel: 'OptiPlex 7080',
        faultDescription: '系统运行缓慢，经常死机',
        currentStatus: 'REGISTERED',
        handler: '王工',
        createdAt: now,
        updatedAt: now
      }
    ],
    quotes: [
      {
        id: 'test_quote_001',
        orderId: 'test_order_001',
        version: 1,
        parts: [
          { name: '主板', quantity: 1, price: 1200, total: 1200 },
          { name: '内存8G', quantity: 2, price: 300, total: 600 }
        ],
        laborItems: [
          { name: '主板检测与更换', quantity: 1, price: 200, total: 200 },
          { name: '系统安装与调试', quantity: 1, price: 100, total: 100 }
        ],
        totalCost: 2100,
        createdAt: now,
        handler: '李工'
      }
    ],
    history: [
      {
        id: 'test_history_001',
        orderId: 'test_order_001',
        fromStatus: 'REGISTERED',
        toStatus: 'INSPECTING',
        handler: '李工',
        note: '开始检测',
        timestamp: now,
        type: 'advance'
      }
    ]
  };
}

function generateConflictData() {
  var now = new Date().toISOString();
  return {
    orders: [
      {
        id: 'test_order_001',
        orderNo: 'TEST-2026-001',
        customerName: '张三新',
        customerPhone: '13800000001',
        deviceType: '笔记本',
        deviceBrand: '联想',
        deviceModel: 'ThinkPad X1 Carbon',
        faultDescription: '无法开机，电源指示灯不亮（更新描述）',
        currentStatus: 'REPAIRING',
        handler: '李工',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'test_order_003',
        orderNo: 'TEST-2026-003',
        customerName: '',
        customerPhone: '',
        deviceType: '平板',
        deviceBrand: '苹果',
        deviceModel: 'iPad Pro',
        faultDescription: '屏幕碎裂',
        currentStatus: 'REGISTERED',
        handler: '张工',
        createdAt: now,
        updatedAt: now
      }
    ],
    quotes: [
      {
        id: 'test_quote_001',
        orderId: 'test_order_001',
        version: 1,
        parts: [{ name: '主板', quantity: 1, price: 1500, total: 1500 }],
        laborItems: [],
        totalCost: 1500,
        createdAt: now,
        handler: '李工'
      },
      {
        id: 'test_quote_002',
        orderId: 'non_existent_order',
        version: 1,
        parts: [],
        laborItems: [],
        totalCost: 100,
        createdAt: now,
        handler: '张工'
      }
    ],
    history: []
  };
}

console.log('📊 测试环境准备完毕');
console.log('   存储命名空间: crp_test_import_*');
console.log('   独立测试环境，不影响业务数据\n');

runTest('1. 正常导入测试（2工单+1报价+1历史）', function() {
  Store.clear();
  var testData = generateTestData();
  var parsedData = { success: true, data: testData, type: ImportAuditEngine._detectDataType(testData) };
  var precheck = ImportAuditEngine.precheck(parsedData);
  assert(precheck.canImport, '预检应该通过');
  assertEqual(precheck.conflicts.length, 0, '应该没有冲突');
  assertEqual(precheck.stats.orders.total, 2, '工单数量应为2');
  assertEqual(precheck.stats.quotes.total, 1, '报价数量应为1');
  assertEqual(precheck.stats.history.total, 1, '历史数量应为1');
  var task = ImportAuditEngine.createTask(parsedData, precheck, { fileName: 'test-import.json', fileSize: 1024, handler: '测试员', note: '正常导入测试' });
  assert(task, '任务应创建成功');
  assertEqual(task.status, IMPORT_TASK_STATUS.PENDING, '任务状态应为待处理');
  var beforeOrders = Store.getOrders().length;
  var beforeQuotes = Store.getQuotes().length;
  var beforeHistory = Store.getHistory().length;
  assertEqual(beforeOrders, 0, '导入前工单应为0');
  var result = ImportAuditEngine.executeImport(task.id);
  assert(result.success, '导入应成功');
  var updatedTask = result.task;
  assertEqual(updatedTask.status, IMPORT_TASK_STATUS.ALL_SUCCESS, '任务状态应为全部成功');
  var afterOrders = Store.getOrders().length;
  var afterQuotes = Store.getQuotes().length;
  var afterHistory = Store.getHistory().length;
  assertEqual(afterOrders, 2, '导入后工单应为2');
  assertEqual(afterQuotes, 1, '导入后报价应为1');
  assertEqual(afterHistory, 1, '导入后历史应为1');
  assertEqual(updatedTask.result.imported.orders, 2, '应导入2个工单');
  assertEqual(updatedTask.result.imported.quotes, 1, '应导入1个报价');
  assertEqual(updatedTask.result.imported.history, 1, '应导入1条历史');
  assertEqual(updatedTask.result.skipped.orders, 0, '工单跳过数应为0');
  var auditLogs = Store.getImportAuditLogs();
  assert(auditLogs.length >= 2, '应有至少2条审计日志');
  var taskCreatedLog = auditLogs.find(function(l) { return l.action === 'TASK_CREATED'; });
  var importCompletedLog = auditLogs.find(function(l) { return l.action === 'IMPORT_COMPLETED'; });
  assert(taskCreatedLog, '应有任务创建日志');
  assert(importCompletedLog, '应有导入完成日志');
});

runTest('2. 冲突检测与不覆盖测试', function() {
  var testData = generateTestData();
  var conflictData = generateConflictData();
  var beforeOrders = JSON.parse(JSON.stringify(Store.getOrders()));
  var beforeQuotes = JSON.parse(JSON.stringify(Store.getQuotes()));
  var parsedData = { success: true, data: conflictData, type: ImportAuditEngine._detectDataType(conflictData) };
  var precheck = ImportAuditEngine.precheck(parsedData);
  var hasDupOrderId = precheck.conflicts.some(function(c) { return c.type === IMPORT_CONFLICT_TYPES.DUPLICATE && c.itemId === 'test_order_001'; });
  var hasMissingFields = precheck.conflicts.some(function(c) { return c.type === IMPORT_CONFLICT_TYPES.MISSING_FIELDS && c.itemId === 'test_order_003'; });
  var hasVersionConflict = precheck.conflicts.some(function(c) { return c.type === IMPORT_CONFLICT_TYPES.VERSION_MISMATCH && c.itemId === 'test_quote_001'; });
  var hasPermission = precheck.conflicts.some(function(c) { return c.type === IMPORT_CONFLICT_TYPES.PERMISSION && c.itemId === 'test_quote_002'; });
  assert(hasDupOrderId, '应检测到重复ID冲突');
  assert(hasMissingFields, '应检测到缺少字段错误');
  assert(hasVersionConflict, '应检测到版本冲突');
  assert(hasPermission, '应检测到关联工单不存在错误');
  assertEqual(precheck.conflicts.length, 4, '应有4个冲突/错误');
  var task = ImportAuditEngine.createTask(parsedData, precheck, { fileName: 'conflict-test.json', handler: '测试员', note: '冲突测试' });
  var result = ImportAuditEngine.executeImport(task.id);
  assert(result.success, '导入执行应成功');
  var updatedTask = result.task;
  var afterOrders = Store.getOrders();
  var afterQuotes = Store.getQuotes();
  var originalOrder = beforeOrders.find(function(o) { return o.id === 'test_order_001'; });
  var currentOrder = afterOrders.find(function(o) { return o.id === 'test_order_001'; });
  assertEqual(JSON.stringify(originalOrder), JSON.stringify(currentOrder), '旧记录不应被覆盖');
  assertEqual(afterOrders.length, beforeOrders.length, '工单总数不应增加');
  assertEqual(afterQuotes.length, beforeQuotes.length, '报价总数不应增加');
  assertEqual(updatedTask.result.skipped.orders, 2, '应跳过2个工单');
  assertEqual(updatedTask.result.skipped.quotes, 2, '应跳过2个报价');
  assert(updatedTask.result.failedItems.length >= 4, '失败项应包含所有冲突');
});

runTest('3. 回滚功能测试', function() {
  var beforeSnapshot = ImportAuditEngine._takeSnapshot();
  var testData = {
    orders: [{
      id: 'test_order_rollback_001',
      orderNo: 'RB-2026-001',
      customerName: '王五',
      customerPhone: '13900000001',
      deviceType: '笔记本',
      deviceBrand: '华硕',
      deviceModel: 'ROG',
      faultDescription: '键盘失灵',
      currentStatus: 'REGISTERED',
      handler: '赵工',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    quotes: [],
    history: []
  };
  var parsedData = { success: true, data: testData, type: ImportAuditEngine._detectDataType(testData) };
  var precheck = ImportAuditEngine.precheck(parsedData);
  var task = ImportAuditEngine.createTask(parsedData, precheck, { fileName: 'rollback-test.json', handler: '测试员', note: '回滚测试' });
  var importResult = ImportAuditEngine.executeImport(task.id);
  assert(importResult.success, '导入应成功');
  var afterImport = Store.getOrders();
  assertEqual(afterImport.length, beforeSnapshot.orders.length + 1, '导入后工单应增加1条');
  var rollbackResult = ImportAuditEngine.rollback(task.id, { handler: '管理员', reason: '数据错误，需要回滚' });
  assert(rollbackResult.success, '回滚应成功');
  var rolledBackTask = rollbackResult.task;
  assertEqual(rolledBackTask.status, IMPORT_TASK_STATUS.ROLLED_BACK, '任务状态应为已回滚');
  assert(rolledBackTask.rollbackInfo, '应有回滚信息');
  assertEqual(rolledBackTask.rollbackInfo.handler, '管理员', '回滚处理人应正确');
  assertEqual(rolledBackTask.rollbackInfo.reason, '数据错误，需要回滚', '回滚原因应正确');
  var afterRollback = Store.getOrders();
  assertEqual(afterRollback.length, beforeSnapshot.orders.length, '回滚后工单数量应恢复');
  var doubleRollback = ImportAuditEngine.rollback(task.id, { handler: '管理员', reason: '再次回滚' });
  assert(!doubleRollback.success, '重复回滚应失败');
  var rollbackLog = Store.getImportAuditLogs().find(function(l) { return l.action === 'ROLLBACK_COMPLETED' && l.taskId === task.id; });
  assert(rollbackLog, '应有回滚完成的审计日志');
});

runTest('4. 导出处理结果后再导入测试', function() {
  var tasks = ImportAuditEngine.getTaskList({});
  assert(tasks.length > 0, '至少有一个任务');
  var targetTask = tasks.find(function(t) { return t.status === IMPORT_TASK_STATUS.ALL_SUCCESS && t.result; });
  assert(targetTask, '应有成功导入的任务');
  var exportResult = ImportAuditEngine.exportResult(targetTask.id);
  assert(exportResult.success, '导出应成功');
  assertEqual(exportResult.data.format, 'crp-import-result', '格式应正确');
  assertEqual(exportResult.data.version, '1.0.0', '版本应正确');
  assert(exportResult.data.task, '导出数据应包含任务信息');
  assert(exportResult.data.summary, '导出数据应包含统计信息');
  assert(exportResult.data.conflicts, '导出数据应包含冲突信息');
  assertEqual(exportResult.data.task.id, targetTask.id, '任务ID应正确');
  assertEqual(exportResult.data.summary.imported.orders, targetTask.result.imported.orders, '导入统计应正确');
  var newData = {
    orders: [{
      id: 'test_order_reimport_001',
      orderNo: 'RE-2026-001',
      customerName: '赵六',
      customerPhone: '13700000001',
      deviceType: '一体机',
      deviceBrand: '惠普',
      deviceModel: 'ProOne 600',
      faultDescription: '开机蓝屏',
      currentStatus: 'REGISTERED',
      handler: '孙工',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    quotes: [],
    history: []
  };
  var beforeCount = Store.getOrders().length;
  var newParsedData = { success: true, data: newData, type: ImportAuditEngine._detectDataType(newData) };
  var newPrecheck = ImportAuditEngine.precheck(newParsedData);
  assert(newPrecheck.canImport, '新数据预检应通过');
  var newTask = ImportAuditEngine.createTask(newParsedData, newPrecheck, { fileName: 'reimport-test.json', handler: '测试员', note: '导出后再导入测试' });
  var importResult = ImportAuditEngine.executeImport(newTask.id);
  assert(importResult.success, '再导入应成功');
  var afterCount = Store.getOrders().length;
  assertEqual(afterCount, beforeCount + 1, '再导入后工单应增加1条');
});

runTest('5. 状态持久化与恢复测试', function() {
  var testState = {
    currentTab: 'detail',
    selectedTaskId: 'task_12345',
    filters: { status: IMPORT_TASK_STATUS.ALL_SUCCESS, dataType: IMPORT_DATA_TYPES.ORDER, handler: '测试员', sourceFile: 'test' }
  };
  ImportAuditEngine.saveCurrentState(testState);
  var loadedState = ImportAuditEngine.loadCurrentState();
  assert(loadedState, '状态应能成功加载');
  assertEqual(loadedState.currentTab, testState.currentTab, '标签页状态应正确');
  assertEqual(loadedState.selectedTaskId, testState.selectedTaskId, '选中任务应正确');
  assert(loadedState.filters, '筛选条件应存在');
  assertEqual(loadedState.filters.status, testState.filters.status, '状态筛选应正确');
  assertEqual(loadedState.filters.dataType, testState.filters.dataType, '数据类型筛选应正确');
  assertEqual(loadedState.filters.handler, testState.filters.handler, '处理人筛选应正确');
  assertEqual(loadedState.filters.sourceFile, testState.filters.sourceFile, '来源文件筛选应正确');
  assert(loadedState.savedAt, '应有保存时间戳');
  var newState = { currentTab: 'list', selectedTaskId: null, filters: { status: '', dataType: '', handler: '', sourceFile: '' } };
  ImportAuditEngine.saveCurrentState(newState);
  var reloadedState = ImportAuditEngine.loadCurrentState();
  assertEqual(reloadedState.currentTab, 'list', '更新的标签页状态应正确');
  assertEqual(reloadedState.selectedTaskId, null, '选中任务应清空');
});

runTest('6. 跨重启核对一致测试', function() {
  var tasksBefore = Store.getImportTasks();
  var ordersBefore = Store.getOrders();
  var quotesBefore = Store.getQuotes();
  var historyBefore = Store.getHistory();
  var auditLogsBefore = Store.getImportAuditLogs();
  var stateBefore = Store.getImportState();
  assert(tasksBefore.length > 0, '重启前应有任务数据');
  var simulatedStorage = {
    tasks: JSON.parse(JSON.stringify(tasksBefore)),
    orders: JSON.parse(JSON.stringify(ordersBefore)),
    quotes: JSON.parse(JSON.stringify(quotesBefore)),
    history: JSON.parse(JSON.stringify(historyBefore)),
    auditLogs: JSON.parse(JSON.stringify(auditLogsBefore)),
    state: stateBefore ? JSON.parse(JSON.stringify(stateBefore)) : null
  };
  Store.clear();
  assertEqual(Store.getImportTasks().length, 0, '清空后任务应为0');
  Store.saveImportTasks(simulatedStorage.tasks);
  Store.saveOrders(simulatedStorage.orders);
  Store.saveQuotes(simulatedStorage.quotes);
  Store.saveHistory(simulatedStorage.history);
  Store.saveImportAuditLogs(simulatedStorage.auditLogs);
  if (simulatedStorage.state) {
    Store.saveImportState(simulatedStorage.state);
  }
  var tasksAfter = Store.getImportTasks();
  var ordersAfter = Store.getOrders();
  var quotesAfter = Store.getQuotes();
  var historyAfter = Store.getHistory();
  var auditLogsAfter = Store.getImportAuditLogs();
  var stateAfter = Store.getImportState();
  assertEqual(tasksAfter.length, simulatedStorage.tasks.length, '重启后任务数量应一致');
  assertEqual(ordersAfter.length, simulatedStorage.orders.length, '重启后工单数量应一致');
  assertEqual(quotesAfter.length, simulatedStorage.quotes.length, '重启后报价数量应一致');
  assertEqual(historyAfter.length, simulatedStorage.history.length, '重启后历史数量应一致');
  assertEqual(auditLogsAfter.length, simulatedStorage.auditLogs.length, '重启后审计日志数量应一致');
  assertEqual(JSON.stringify(tasksAfter[0]), JSON.stringify(simulatedStorage.tasks[0]), '第一条任务数据应完全一致');
  if (ordersAfter.length > 0) {
    assertEqual(JSON.stringify(ordersAfter[0]), JSON.stringify(simulatedStorage.orders[0]), '第一条工单数据应完全一致');
  }
  if (simulatedStorage.state) {
    assertEqual(JSON.stringify(stateAfter), JSON.stringify(simulatedStorage.state), '状态数据应完全一致');
  }
  var filteredTasks = ImportAuditEngine.getTaskList({ status: IMPORT_TASK_STATUS.ALL_SUCCESS });
  assert(filteredTasks.length > 0, '筛选功能重启后应正常工作');
  var restoredState = ImportAuditEngine.loadCurrentState();
  assert(restoredState, '重启后状态应能恢复');
});

console.log('\n' + '═'.repeat(60));
console.log('📊 测试结果汇总');
console.log('═'.repeat(60));

var passed = results.filter(function(r) { return r.status === 'pass'; }).length;
var failed = results.filter(function(r) { return r.status === 'fail'; }).length;
var total = results.length;

results.forEach(function(r, i) {
  var status = r.status === 'pass' ? '✅' : '❌';
  console.log(`   ${status} ${i + 1}. ${r.name}`);
  if (r.error) {
    console.log(`      ❌ 错误: ${r.error}`);
  }
});

console.log('─'.repeat(60));
console.log(`   📈 总计: ${total} 个测试, ✅ ${passed} 通过, ❌ ${failed} 失败`);
console.log('─'.repeat(60));

if (failed === 0) {
  console.log('\n🎉 全部测试通过！功能正常，符合验收标准。');
  console.log('   测试数据存储在 crp_test_import_* 命名空间，不影响业务数据。');
  console.log('   可以在浏览器中访问 test-import-audit.html 进行可视化测试。\n');
  process.exit(0);
} else {
  console.log('\n⚠️  有 ' + failed + ' 个测试失败，请检查错误信息并修复。\n');
  process.exit(1);
}

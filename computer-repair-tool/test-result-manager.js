(function(){
'use strict';

var STORAGE_KEY = 'crp_test_results';
var EXPORT_FORMAT_VERSION = '2.0.0';
var MAX_HISTORY = 50;

function uuid() {
  return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
}

function now() {
  return new Date().toISOString();
}

function pad(n) { return n < 10 ? '0' + n : n; }
function formatDateTime(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

var ResultManager = {
  _storage: null,

  _getStorage: function() {
    if (this._storage) return this._storage;
    if (typeof localStorage !== 'undefined') {
      this._storage = {
        getItem: function(k) { return localStorage.getItem(k); },
        setItem: function(k, v) { localStorage.setItem(k, v); },
        removeItem: function(k) { localStorage.removeItem(k); }
      };
    } else {
      var _mem = {};
      this._storage = {
        getItem: function(k) { return _mem[k] || null; },
        setItem: function(k, v) { _mem[k] = String(v); },
        removeItem: function(k) { delete _mem[k]; }
      };
    }
    return this._storage;
  },

  _loadAll: function() {
    try {
      var raw = this._getStorage().getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { runs: [], version: EXPORT_FORMAT_VERSION };
    } catch(e) {
      return { runs: [], version: EXPORT_FORMAT_VERSION };
    }
  },

  _saveAll: function(data) {
    try {
      this._getStorage().setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch(e) {
      console.error('ResultManager save error:', e);
      return false;
    }
  },

  _validateRun: function(run) {
    var errors = [];
    var required = ['runId', 'suiteVersion', 'startedAt', 'total', 'passed', 'failed', 'results'];
    required.forEach(function(field) {
      if (run[field] === undefined || run[field] === null) {
        errors.push('缺少必填字段: ' + field);
      }
    });
    if (run.results && Array.isArray(run.results)) {
      run.results.forEach(function(r, i) {
        if (!r.id) errors.push('results[' + i + '] 缺少 id');
        if (r.pass === undefined) errors.push('results[' + i + '] 缺少 pass 字段');
      });
    } else {
      errors.push('results 不是数组或不存在');
    }
    return { valid: errors.length === 0, errors: errors };
  },

  createRun: function(suiteMeta) {
    return {
      runId: uuid(),
      suiteVersion: suiteMeta ? suiteMeta.suiteVersion : 'unknown',
      suiteName: suiteMeta ? suiteMeta.suiteName : '回归测试',
      startedAt: now(),
      finishedAt: null,
      total: suiteMeta ? suiteMeta.totalCases : 0,
      passed: 0,
      failed: 0,
      status: 'running',
      results: [],
      logs: [],
      env: this._getEnv()
    };
  },

  _getEnv: function() {
    var env = { platform: 'unknown' };
    if (typeof navigator !== 'undefined') {
      env.platform = 'browser';
      env.userAgent = navigator.userAgent;
    } else if (typeof process !== 'undefined') {
      env.platform = 'node';
      env.nodeVersion = process.version;
    }
    return env;
  },

  addResult: function(run, testCase, pass, detail) {
    var result = {
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      pass: pass,
      detail: detail || null,
      timestamp: now()
    };
    run.results.push(result);
    if (pass) {
      run.passed++;
    } else {
      run.failed++;
    }
    return result;
  },

  addLog: function(run, message, type) {
    if (!run.logs) run.logs = [];
    run.logs.push({
      timestamp: now(),
      type: type || 'info',
      message: message
    });
  },

  finishRun: function(run, status) {
    run.finishedAt = now();
    run.status = status || (run.failed === 0 ? 'pass' : 'fail');
    return run;
  },

  saveRun: function(run) {
    var validation = this._validateRun(run);
    if (!validation.valid) {
      return { ok: false, error: '运行结果无效: ' + validation.errors.join(', ') };
    }
    var data = this._loadAll();
    var existingIdx = data.runs.findIndex(function(r) { return r.runId === run.runId; });
    if (existingIdx >= 0) {
      data.runs[existingIdx] = run;
    } else {
      data.runs.unshift(run);
      if (data.runs.length > MAX_HISTORY) {
        data.runs = data.runs.slice(0, MAX_HISTORY);
      }
    }
    data.version = EXPORT_FORMAT_VERSION;
    var ok = this._saveAll(data);
    return { ok: ok, isNew: existingIdx < 0 };
  },

  getRun: function(runId) {
    var data = this._loadAll();
    var run = data.runs.find(function(r) { return r.runId === runId; });
    return run || null;
  },

  getLatestRun: function() {
    var data = this._loadAll();
    return data.runs.length > 0 ? data.runs[0] : null;
  },

  getAllRuns: function() {
    var data = this._loadAll();
    return data.runs.slice();
  },

  getFailedRuns: function() {
    return this.getAllRuns().filter(function(r) { return r.status === 'fail'; });
  },

  deleteRun: function(runId) {
    var data = this._loadAll();
    var before = data.runs.length;
    data.runs = data.runs.filter(function(r) { return r.runId !== runId; });
    this._saveAll(data);
    return data.runs.length < before;
  },

  clearAll: function() {
    this._getStorage().removeItem(STORAGE_KEY);
  },

  exportRuns: function(runIds) {
    var data = this._loadAll();
    var runs;
    if (runIds && runIds.length) {
      runs = data.runs.filter(function(r) { return runIds.indexOf(r.runId) >= 0; });
    } else {
      runs = data.runs.slice();
    }
    return {
      exportFormat: 'crp-test-results',
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: now(),
      runCount: runs.length,
      runs: runs
    };
  },

  importRuns: function(importData) {
    var report = {
      imported: 0,
      duplicates: 0,
      conflicts: 0,
      invalid: 0,
      errors: [],
      importedIds: []
    };

    if (!importData || typeof importData !== 'object') {
      report.errors.push('导入数据不是有效对象');
      report.invalid++;
      return report;
    }

    if (importData.exportFormat !== 'crp-test-results') {
      report.errors.push('格式不匹配：期望 crp-test-results，实际 ' + (importData.exportFormat || '未知'));
      report.invalid++;
      return report;
    }

    if (importData.formatVersion !== EXPORT_FORMAT_VERSION) {
      report.conflicts++;
      report.errors.push('版本警告：导入格式 v' + importData.formatVersion + '，当前 v' + EXPORT_FORMAT_VERSION + '，尝试兼容导入');
    }

    if (!importData.runs || !Array.isArray(importData.runs)) {
      report.errors.push('缺少 runs 数组');
      report.invalid++;
      return report;
    }

    var existing = this._loadAll();
    var existingIds = {};
    existing.runs.forEach(function(r) { existingIds[r.runId] = r; });

    importData.runs.forEach(function(run, idx) {
      var validation = this._validateRun(run);
      if (!validation.valid) {
        report.invalid++;
        report.errors.push('第' + (idx+1) + '条无效: ' + validation.errors.join('; '));
        return;
      }

      if (existingIds[run.runId]) {
        report.duplicates++;
        var existingRun = existingIds[run.runId];
        var sameResult = existingRun.passed === run.passed &&
                        existingRun.failed === run.failed &&
                        existingRun.status === run.status;
        if (!sameResult) {
          report.conflicts++;
          report.errors.push('重复 runId ' + run.runId + ' 结果不一致（已跳过，保留历史版本）');
        }
        return;
      }

      existing.runs.push(run);
      existingIds[run.runId] = run;
      report.imported++;
      report.importedIds.push(run.runId);
    }.bind(this));

    existing.runs.sort(function(a, b) {
      return new Date(b.startedAt) - new Date(a.startedAt);
    });

    if (existing.runs.length > MAX_HISTORY) {
      existing.runs = existing.runs.slice(0, MAX_HISTORY);
    }

    existing.version = EXPORT_FORMAT_VERSION;
    this._saveAll(existing);

    return report;
  },

  compareRuns: function(runIdA, runIdB) {
    var runA = this.getRun(runIdA);
    var runB = this.getRun(runIdB);
    if (!runA || !runB) return null;

    var diffs = [];
    var resultsA = {};
    runA.results.forEach(function(r) { resultsA[r.id] = r; });

    runB.results.forEach(function(rB) {
      var rA = resultsA[rB.id];
      if (!rA) {
        diffs.push({ id: rB.id, name: rB.name, type: 'new', detail: '新增用例' });
      } else if (rA.pass !== rB.pass) {
        diffs.push({
          id: rB.id,
          name: rB.name,
          type: rB.pass ? 'fixed' : 'regression',
          detail: (rA.pass ? '通过' : '失败') + ' → ' + (rB.pass ? '通过' : '失败')
        });
      }
      delete resultsA[rB.id];
    });

    Object.keys(resultsA).forEach(function(id) {
      diffs.push({ id: id, name: resultsA[id].name, type: 'removed', detail: '用例消失' });
    });

    return {
      runA: { id: runIdA, passed: runA.passed, failed: runA.failed, status: runA.status },
      runB: { id: runIdB, passed: runB.passed, failed: runB.failed, status: runB.status },
      diffs: diffs,
      summary: {
        regressions: diffs.filter(function(d) { return d.type === 'regression'; }).length,
        fixed: diffs.filter(function(d) { return d.type === 'fixed'; }).length,
        new: diffs.filter(function(d) { return d.type === 'new'; }).length,
        removed: diffs.filter(function(d) { return d.type === 'removed'; }).length
      }
    };
  },

  formatSummary: function(run) {
    if (!run) return '无运行记录';
    return run.passed + '/' + run.total + ' 通过' +
      (run.failed > 0 ? '，' + run.failed + ' 失败' : '') +
      ' · ' + formatDateTime(run.startedAt);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResultManager;
} else if (typeof window !== 'undefined') {
  window.ResultManager = ResultManager;
}

})();

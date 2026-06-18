/* 回放演练台 - Node.js 自动化测试脚本 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');

global.window = global;
global.document = {
  addEventListener: function(){},
  getElementById: function(){ return { innerHTML:'', textContent:'', style:{}, addEventListener:function(){} }; },
  createElement: function(){ return { innerHTML:'', textContent:'', style:{}, addEventListener:function(){} }; }
};

var memoryStore = {};
global.localStorage = {
  getItem: function(k){ return memoryStore[k] === undefined ? null : memoryStore[k]; },
  setItem: function(k, v){ memoryStore[k] = String(v); },
  removeItem: function(k){ delete memoryStore[k]; },
  clear: function(){ memoryStore = {}; }
};

var args = process.argv.slice(2);
var exportPath = null;
var importPath = null;
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--export' || args[i] === '--output') {
    exportPath = args[i + 1] || ('replay-test-result-' + Date.now() + '.json');
    i++;
  } else if (args[i] === '--import') {
    importPath = args[i + 1];
    i++;
  }
}

console.log('========================================');
console.log('🎬 回放演练台 - Node.js 自动化测试');
console.log('========================================\n');

try {
  var appCode = fs.readFileSync(__dirname + '/app.js', 'utf8');
  console.log('✅ 加载 app.js (' + (appCode.length / 1024).toFixed(1) + ' KB)');
  vm.runInThisContext(appCode, { filename: 'app.js' });

  var testCode = fs.readFileSync(__dirname + '/test-replay-stage.js', 'utf8');
  console.log('✅ 加载 test-replay-stage.js (' + (testCode.length / 1024).toFixed(1) + ' KB)');
  vm.runInThisContext(testCode, { filename: 'test-replay-stage.js' });

  console.log('\n🚀 开始执行测试...\n');
  var startTime = Date.now();

  var p = global.TestReplayStage.runAllTests();

  if (p && typeof p.then === 'function') {
    p.then(function(r) {
      finishTest(r);
    }).catch(function(err) {
      console.error('\n💥 测试执行异常:', err.message);
      console.error(err.stack);
      process.exit(2);
    });
  } else {
    setTimeout(function() {
      finishTest(global.TEST_RESULT || global.TestReplayStage.TestRunner.getSummary());
    }, 3000);
  }
} catch (e) {
  console.error('\n❌ 加载失败:', e.message);
  console.error(e.stack);
  process.exit(3);
}

function finishTest(r) {
  var duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n========================================');
  console.log('📊 测试结果汇总');
  console.log('========================================');
  console.log('总用例:    ' + r.total);
  console.log('通过数:    \x1b[32m' + r.passed + '\x1b[0m');
  console.log('失败数:    \x1b[31m' + r.failed + '\x1b[0m');
  console.log('通过率:    ' + (r.failed === 0 ? '\x1b[32m' : '\x1b[33m') + r.passRate + '%\x1b[0m');
  console.log('耗时:      ' + duration + ' 秒');
  console.log('========================================');

  if (r.failed > 0) {
    console.log('\n❌ 失败用例明细:');
    global.TestReplayStage.TestRunner.getTests().filter(function(t) { return !t.pass; }).forEach(function(t, idx) {
      console.log('  ' + (idx + 1) + '. [' + t.module + '] ' + t.name);
      if (t.error) console.log('     💥 ' + t.error);
      if (t.steps && t.steps.length > 0) {
        var lastSteps = t.steps.slice(-5);
        console.log('     执行步骤 (' + lastSteps.length + '/' + t.steps.length + '):');
        lastSteps.forEach(function(s, j) {
          console.log('       ' + (j + 1) + '. ' + s.substring(0, 120));
        });
      }
    });
  }

  var moduleStats = {};
  global.TestReplayStage.TestRunner.getTests().forEach(function(t) {
    if (!moduleStats[t.module]) moduleStats[t.module] = { total: 0, passed: 0, failed: 0 };
    moduleStats[t.module].total++;
    if (t.pass) moduleStats[t.module].passed++; else moduleStats[t.module].failed++;
  });
  console.log('\n📦 按模块统计:');
  Object.keys(moduleStats).forEach(function(m) {
    var s = moduleStats[m];
    var rate = Math.round((s.passed / s.total) * 100);
    var color = s.failed === 0 ? '\x1b[32m' : '\x1b[33m';
    console.log('  ' + m + ': ' + s.passed + '/' + s.total + ' 通过 (' + color + rate + '%\x1b[0m)');
  });

  if (exportPath) {
    var exportObj = {
      format: 'crp-replay-test-result',
      formatVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      durationSec: duration,
      summary: r,
      tests: global.TestReplayStage.TestRunner.getTests().map(function(t) {
        return {
          module: t.module,
          name: t.name,
          pass: t.pass,
          error: t.error || null,
          stepCount: t.steps ? t.steps.length : 0
        };
      }),
      moduleStats: moduleStats,
      env: { platform: 'nodejs', nodeVersion: process.version }
    };
    try {
      fs.writeFileSync(exportPath, JSON.stringify(exportObj, null, 2), 'utf8');
      console.log('\n📤 结果已导出: ' + path.resolve(exportPath));
    } catch (e) {
      console.error('\n❌ 导出失败: ' + e.message);
    }
  }

  if (importPath) {
    try {
      var importData = JSON.parse(fs.readFileSync(importPath, 'utf8'));
      console.log('\n📥 导入文件校验: ' + path.resolve(importPath));
      var required = ['format', 'formatVersion', 'exportedAt', 'summary'];
      var missing = required.filter(function(k) { return importData[k] === undefined; });
      if (missing.length > 0) {
        console.log('  ❌ 缺失字段: ' + missing.join(', '));
      } else {
        console.log('  ✅ 格式字段完整');
        console.log('  - format: ' + importData.format);
        console.log('  - version: ' + importData.formatVersion);
        console.log('  - 用例数: ' + (importData.summary ? importData.summary.total : 'N/A'));
      }
    } catch (e) {
      console.error('\n❌ 导入校验失败: ' + e.message);
    }
  }

  console.log('\n' + (r.failed === 0 ? '🎉 全部测试通过！' : '⚠️ 存在失败用例，请检查。'));
  process.exit(r.failed === 0 ? 0 : 1);
}

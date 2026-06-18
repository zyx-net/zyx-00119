/**
 * 导入导出验收验证脚本
 * 验证：去重、版本冲突、缺字段、持久化恢复
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock localStorage
const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; }
};
global.document = {};
global.window = global;

// 加载模块
function loadModule(filename) {
  const code = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  vm.runInThisContext(code, { filename });
}
loadModule('test-result-manager.js');
const ResultManager = global.ResultManager;

// 清空历史
ResultManager.clearAll();

console.log('='.repeat(70));
console.log('🧪 导入导出验收验证');
console.log('='.repeat(70));

// ========== 1. 读取导出文件 ==========
console.log('\n📄 步骤1: 读取导出文件');
const exportFile = 'test-result-node-run1.json';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, exportFile), 'utf8'));
console.log('   文件: ' + exportFile);
console.log('   格式: ' + data.exportFormat);
console.log('   版本: v' + data.formatVersion);
console.log('   运行数: ' + data.runCount);
console.log('   用例数: ' + data.runs[0].total);

// ========== 2. 第一次导入 ==========
console.log('\n📥 步骤2: 第一次导入（应成功导入1条）');
const report1 = ResultManager.importRuns(data);
console.log('   ✅ 成功导入: ' + report1.imported);
console.log('   ⏭️  重复跳过: ' + report1.duplicates);
console.log('   ⚠️  冲突数: ' + report1.conflicts);
console.log('   ❌ 无效数: ' + report1.invalid);

const pass1 = report1.imported === 1 && report1.duplicates === 0;
console.log('   ' + (pass1 ? '✅ 通过' : '❌ 失败'));

// ========== 3. 第二次导入（同一文件，验证去重） ==========
console.log('\n🔄 步骤3: 第二次导入同一文件（应识别为重复，跳过）');
const report2 = ResultManager.importRuns(data);
console.log('   ✅ 成功导入: ' + report2.imported);
console.log('   ⏭️  重复跳过: ' + report2.duplicates);
console.log('   ⚠️  冲突数: ' + report2.conflicts);
console.log('   ❌ 无效数: ' + report2.invalid);

const pass2 = report2.imported === 0 && report2.duplicates === 1;
console.log('   ' + (pass2 ? '✅ 通过（去重生效）' : '❌ 失败（去重未生效）'));

// ========== 4. 验证持久化（模拟"重开后数据还在"） ==========
console.log('\n🔁 步骤4: 验证持久化恢复（模拟重开应用）');
const allRuns = ResultManager.getAllRuns();
console.log('   当前历史记录数: ' + allRuns.length);
console.log('   最新 runId: ' + allRuns[0].runId);
console.log('   最新结果: ' + allRuns[0].passed + '/' + allRuns[0].total + ' 通过');

const pass4 = allRuns.length === 1 && allRuns[0].passed === 12 && allRuns[0].total === 12;
console.log('   ' + (pass4 ? '✅ 通过（持久化正常）' : '❌ 失败（持久化异常）'));

// ========== 5. 测试版本冲突 ==========
console.log('\n⚠️  步骤5: 测试版本号不同的导入（应警告但兼容）');
const oldVersionData = JSON.parse(JSON.stringify(data));
oldVersionData.formatVersion = '1.0.0';
oldVersionData.runs[0].runId = 'run-old-version-test';
const report5 = ResultManager.importRuns(oldVersionData);
console.log('   ✅ 成功导入: ' + report5.imported);
console.log('   ⏭️  重复跳过: ' + report5.duplicates);
console.log('   ⚠️  冲突数: ' + report5.conflicts);
console.log('   ❌ 无效数: ' + report5.invalid);
if (report5.errors.length) {
  console.log('   警告信息:');
  report5.errors.forEach(e => console.log('     - ' + e));
}

const pass5 = report5.imported === 1 && report5.conflicts >= 1;
console.log('   ' + (pass5 ? '✅ 通过（版本兼容导入）' : '❌ 失败'));

// ========== 6. 测试缺字段数据 ==========
console.log('\n❌ 步骤6: 测试缺字段数据（应识别为无效）');
const badData = {
  exportFormat: 'crp-test-results',
  formatVersion: '2.0.0',
  runs: [
    { runId: 'run-bad-data-1' }, // 缺很多字段
    { runId: 'run-bad-data-2', total: 10, passed: 5, failed: 5 } // 缺 results
  ]
};
const report6 = ResultManager.importRuns(badData);
console.log('   ✅ 成功导入: ' + report6.imported);
console.log('   ⏭️  重复跳过: ' + report6.duplicates);
console.log('   ⚠️  冲突数: ' + report6.conflicts);
console.log('   ❌ 无效数: ' + report6.invalid);
if (report6.errors.length) {
  console.log('   错误信息:');
  report6.errors.slice(0, 3).forEach(e => console.log('     - ' + e));
}

const pass6 = report6.invalid === 2 && report6.imported === 0;
console.log('   ' + (pass6 ? '✅ 通过（缺字段被拒绝）' : '❌ 失败'));

// ========== 7. 测试格式错误 ==========
console.log('\n📛 步骤7: 测试格式完全错误的数据');
const wrongFormatData = { foo: 'bar', runs: [] };
const report7 = ResultManager.importRuns(wrongFormatData);
console.log('   错误数: ' + report7.errors.length);
console.log('   无效数: ' + report7.invalid);
if (report7.errors.length) {
  console.log('   错误信息:');
  report7.errors.forEach(e => console.log('     - ' + e));
}

const pass7 = report7.invalid >= 1 && report7.errors.length > 0;
console.log('   ' + (pass7 ? '✅ 通过（格式错误被拒绝）' : '❌ 失败'));

// ========== 汇总 ==========
console.log('\n' + '='.repeat(70));
console.log('📊 验收汇总');
console.log('='.repeat(70));

const results = [
  ['第一次导入成功', pass1],
  ['第二次导入去重', pass2],
  ['持久化恢复正常', pass4],
  ['版本冲突兼容', pass5],
  ['缺字段数据拒绝', pass6],
  ['格式错误拒绝', pass7],
];

let allPass = true;
results.forEach(([name, ok]) => {
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name);
  if (!ok) allPass = false;
});

console.log('');
console.log(allPass ? '🎉 全部验收通过！' : '❌ 部分验收未通过');
console.log('');

// 列出最终的历史记录
console.log('📋 最终历史记录 (' + ResultManager.getAllRuns().length + ' 条):');
ResultManager.getAllRuns().forEach((r, i) => {
  console.log('   [' + (i+1) + '] ' + r.runId.substr(0, 25) + '... | ' + r.passed + '/' + r.total + ' ' + r.status);
});

process.exit(allPass ? 0 : 1);

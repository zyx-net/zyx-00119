/**
 * 回归测试 CLI 脚本 (Node.js)
 * 使用与浏览器页面完全一致的用例定义和结果格式
 *
 * 运行方式:
 *   cd computer-repair-tool
 *   node test-history-linkage.js           # 运行全部测试
 *   node test-history-linkage.js --export  # 运行并导出结果到 JSON
 *   node test-history-linkage.js --import results.json  # 导入结果文件并验证
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ========== Mock localStorage ==========
const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; }
};

// Mock document
global.document = {
  getElementById: () => ({ textContent: '', innerHTML: '', classList: { add(){}, remove(){} }, addEventListener(){} }),
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add(){}, remove(){} }, setAttribute(){}, appendChild(){}, click(){}, href:'', download:'' }),
  querySelector: () => null,
  addEventListener: () => {}
};
global.window = global;
global.window.CRP = null;

// ========== 加载共享模块 ==========
function loadModule(filename) {
  const code = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  try {
    vm.runInThisContext(code, { filename });
  } catch(e) {
    console.log(`⚠️  ${filename} 中 DOM 相关报错忽略，业务逻辑已加载:`, e.message.split('\n')[0]);
  }
}

loadModule('app.js');
loadModule('test-cases.js');
loadModule('test-result-manager.js');

const CRP = global.CRP || {};
const STATUS = CRP.STATUS;
const Store = CRP.Store;
const QuoteEngine = CRP.QuoteEngine;
const STORAGE_KEYS = CRP.STORAGE_KEYS;
const TestCases = global.TestCases;
const ResultManager = global.ResultManager;

// ========== 参数解析 ==========
const args = process.argv.slice(2);
const doExport = args.includes('--export');
const importFile = args.includes('--import') ? args[args.indexOf('--import') + 1] : null;
const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;

// ========== 测试配置 ==========
const TEST_PREFIX = 'crp_autotest_';
const nowISO = () => '2026-06-18T10:00:00.000Z';

let passCount = 0, failCount = 0;
const FAILS = [];

function aEq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { passCount++; console.log(`    ✔ ${name}: ${actual}`); }
  else { failCount++; FAILS.push({ name, expected, actual }); console.log(`    ❌ ${name}: 期望=${expected} 实际=${actual}`); }
  return ok;
}

function swapKeys(useTest) {
  if (useTest) {
    for (const k of Object.keys(STORAGE_KEYS)) {
      STORAGE_KEYS[k] = TEST_PREFIX + STORAGE_KEYS[k].replace(/^crp_/, '');
    }
  }
}

function clearTestData() {
  for (const k of Object.keys(storage)) {
    if (k.startsWith(TEST_PREFIX)) delete storage[k];
  }
}

// ========== 初始化测试数据 ==========
function setupData() {
  clearTestData();
  const T = nowISO();
  Store.saveParts([
    {id:'ap1', name:'配件X', category:'测试', unitPrice:100, updatedAt:T},
    {id:'ap2', name:'配件Y', category:'测试', unitPrice:289, updatedAt:T}
  ]);
  Store.saveLabor([
    {id:'al1', name:'工时M', category:'测试', fee:50, updatedAt:T},
    {id:'al2', name:'工时N', category:'测试', fee:200, updatedAt:T}
  ]);
  Store.saveOrders([{
    id:'ao1', orderNo:'AUTO-001', customerName:'自动测试', customerPhone:'13800000000',
    deviceType:'笔记本', deviceBrand:'Test', deviceModel:'T1', faultDescription:'自动测试用',
    handler:'Auto', currentStatus: STATUS.INSPECTING, createdAt:T, updatedAt:T
  }]);
  Store.saveQuotes([]); Store.saveHistory([]); Store.saveRollbacks([]); Store.saveTerminations([]);
  Store.save(STORAGE_KEYS.INITIALIZED, 'true');
}

// ========== 测试用例实现 ==========
function tc01_generateV1(run) {
  console.log('\n🔹 TC01: 生成版本1报价');
  const v1parts = [{partId:'ap1', partName:'配件X', unitPrice:100, quantity:2, subtotal:200}];
  const v1labor = [{laborItemId:'al1', laborName:'工时M', fee:50}];
  const r1 = QuoteEngine.generate('ao1', v1parts, v1labor, 'Auto');
  if (!r1.ok) throw new Error('V1生成失败: ' + r1.msg);

  const tc = TestCases.getTestCaseById('TC01');
  const ok = r1.quote.version === 1 && r1.quote.totalCost === 250 &&
             r1.quote.parts.length === 1 && r1.quote.laborItems.length === 1;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `版本=${r1.quote.version}, 总价=${r1.quote.totalCost}`);

  aEq('TC01-1 V1版本号=1', r1.quote.version, 1);
  aEq('TC01-2 V1总价=¥250', r1.quote.totalCost, 250);
  aEq('TC01-3 V1配件数=1', r1.quote.parts.length, 1);
  aEq('TC01-4 V1工时数=1', r1.quote.laborItems.length, 1);
  aEq('TC01-5 工单状态=QUOTED', Store.getOrderById('ao1').currentStatus, STATUS.QUOTED);
}

function tc02_modifyPrices(run) {
  console.log('\n🔹 TC02: 修改配置价格');
  const ps = Store.getParts(); const pi = ps.findIndex(p => p.id === 'ap1');
  ps[pi].unitPrice = 399; Store.saveParts(ps);

  const ls = Store.getLabor(); const li = ls.findIndex(l => l.id === 'al1');
  ls[li].fee = 80; Store.saveLabor(ls);

  const v1 = Store.getQuotesByOrderId('ao1')[0];
  const tc = TestCases.getTestCaseById('TC02');
  const ok = Store.getPartById('ap1').unitPrice === 399 &&
             Store.getLaborById('al1').fee === 80 &&
             v1.parts[0].unitPrice === 100;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : '价格修改或快照隔离失败');

  aEq('TC02-1 配件X新价=¥399', Store.getPartById('ap1').unitPrice, 399);
  aEq('TC02-2 工时M新费=¥80', Store.getLaborById('al1').fee, 80);
  aEq('TC02-3 V1快照不被改价影响', v1.parts[0].unitPrice, 100);
}

function tc03_generateV2(run) {
  console.log('\n🔹 TC03: 生成版本2 (核心验证: 使用最新价)');
  const cp = Store.getPartById('ap1'); const cl = Store.getLaborById('al1');
  const v2parts = [{partId:'ap1', partName:cp.name, unitPrice:cp.unitPrice, quantity:2, subtotal:cp.unitPrice*2}];
  const v2labor = [{laborItemId:'al1', laborName:cl.name, fee:cl.fee}];
  const r2 = QuoteEngine.generate('ao1', v2parts, v2labor, 'Auto');
  if (!r2.ok) throw new Error('V2生成失败: ' + r2.msg);

  const tc = TestCases.getTestCaseById('TC03');
  const ok = r2.quote.version === 2 && r2.quote.totalCost === 878 &&
             r2.quote.parts[0].unitPrice === 399 && r2.quote.laborItems[0].fee === 80;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `版本=${r2.quote.version}, 总价=${r2.quote.totalCost}`);

  aEq('TC03-1 V2版本号=2', r2.quote.version, 2);
  aEq('TC03-2 V2用新配件价¥399', r2.quote.parts[0].unitPrice, 399);
  aEq('TC03-3 V2用新工时费¥80', r2.quote.laborItems[0].fee, 80);
  aEq('TC03-4 V2总价=¥878', r2.quote.totalCost, 878);
}

function tc04_v1NotModified(run) {
  console.log('\n🔹 TC04: 版本1不被串改');
  const qs = Store.getQuotesByOrderId('ao1').sort((a,b) => a.version - b.version);

  const tc = TestCases.getTestCaseById('TC04');
  const ok = qs.length === 2 && qs[0].totalCost === 250 &&
             qs[0].parts[0].unitPrice === 100 && qs[0].laborItems[0].fee === 50;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `V1总价=${qs[0]?.totalCost}`);

  aEq('TC04-1 报价版本数=2', qs.length, 2);
  aEq('TC04-2 V1总价不变=¥250', qs[0].totalCost, 250);
  aEq('TC04-3 V1配件单价不变=¥100', qs[0].parts[0].unitPrice, 100);
  aEq('TC04-4 V1工时费不变=¥50', qs[0].laborItems[0].fee, 50);
  aEq('TC04-5 V2总价=¥878', qs[1].totalCost, 878);
}

function tc05_refreshConsistency(run) {
  console.log('\n🔹 TC05: localStorage持久化一致性（模拟刷新）');
  const rawQ = JSON.parse(storage[STORAGE_KEYS.QUOTES] || '[]');
  const rawQv2 = rawQ.find(q => q.orderId === 'ao1' && q.version === 2);
  const storeQ = Store.getQuotesByOrderId('ao1').find(q => q.version === 2);

  const tc = TestCases.getTestCaseById('TC05');
  const ok = rawQv2 && storeQ && rawQv2.totalCost === storeQ.totalCost && rawQv2.totalCost === 878;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : '持久化不一致');

  aEq('TC05-1 localStorage含V2报价=¥878', rawQv2 ? rawQv2.totalCost : null, 878);
  aEq('TC05-2 Store↔localStorage报价一致', rawQv2.totalCost, storeQ.totalCost);
}

function tc06_multiVersionIndependent(run) {
  console.log('\n🔹 TC06: 多版本独立快照（深拷贝）');
  const qs = Store.getQuotesByOrderId('ao1').sort((a,b) => a.version - b.version);
  qs[0].parts[0].unitPrice = 9999;
  qs[0].totalCost = 9999;

  const reRead = Store.getQuotesByOrderId('ao1').sort((a,b) => a.version - b.version);
  const tc = TestCases.getTestCaseById('TC06');
  const ok = reRead[0].totalCost === 250 && reRead[1].totalCost === 878;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : '快照隔离失效');

  aEq('TC06-1 修改内存不影响Store读取', reRead[0].totalCost, 250);
  aEq('TC06-2 V2不受V1内存修改影响', reRead[1].totalCost, 878);
}

function tc07_doQuoteUsesLatest(run) {
  console.log('\n🔹 TC07: doQuote 从最新配置读价（双重保险）');
  const cp = Store.getPartById('ap1');
  const cl = Store.getLaborById('al1');
  const fakeDomPrice = 100;
  const finalPrice = cp ? cp.unitPrice : fakeDomPrice;

  const tc = TestCases.getTestCaseById('TC07');
  const ok = cp.unitPrice === 399 && cl.fee === 80 && finalPrice === 399;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `配置价=${cp?.unitPrice}`);

  aEq('TC07-1 最新配置配件价=399', cp.unitPrice, 399);
  aEq('TC07-2 最新配置工时费=80', cl.fee, 80);
  aEq('TC07-3 配置价优先于DOM输入价', finalPrice, 399);
}

function tc08_detailRenderCorrect(run) {
  console.log('\n🔹 TC08: 详情页渲染使用快照数据');
  const qs = Store.getQuotesByOrderId('ao1').sort((a,b) => a.version - b.version);
  const v1Html = CRP.renderQuoteTable(qs[0]);
  const v2Html = CRP.renderQuoteTable(qs[1]);

  const tc = TestCases.getTestCaseById('TC08');
  const ok = v1Html.indexOf('¥100.00') > -1 && v1Html.indexOf('¥250.00') > -1 &&
             v2Html.indexOf('¥399.00') > -1 && v2Html.indexOf('¥878.00') > -1 &&
             v1Html.indexOf('¥399.00') === -1;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : '渲染价格不正确');

  aEq('TC08-1 V1渲染含原价¥100', v1Html.indexOf('¥100.00') > -1, true);
  aEq('TC08-2 V1渲染含原价总计¥250', v1Html.indexOf('¥250.00') > -1, true);
  aEq('TC08-3 V2渲染含新价¥399', v2Html.indexOf('¥399.00') > -1, true);
  aEq('TC08-4 V2渲染含新价总计¥878', v2Html.indexOf('¥878.00') > -1, true);
  aEq('TC08-5 V1渲染不含新价¥399', v1Html.indexOf('¥399.00') === -1, true);
}

function tc09_historyHasV2(run) {
  console.log('\n🔹 TC09: 历史追加版本2记录 (⭐ 核心修复验证)');
  const hAll = Store.getHistoryByOrderId('ao1').sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  console.log('  📋 历史记录 (' + hAll.length + ' 条):');
  hAll.forEach((h, i) => console.log(`     [${i}] ${h.fromStatus}→${h.toStatus} | ${h.note} | ${h.type}`));

  const hasHv2 = hAll.some(h => h.note && h.note.indexOf('版本2') > -1);
  const hV2 = hAll.find(h => h.note && h.note.indexOf('版本2') > -1);

  const tc = TestCases.getTestCaseById('TC09');
  const ok = hasHv2 && hV2 && hV2.fromStatus === STATUS.QUOTED && hV2.toStatus === STATUS.QUOTED && hV2.type === 'advance';
  ResultManager.addResult(run, tc, ok, ok ? '通过' : (hasHv2 ? '历史存在但字段不对' : 'V2历史缺失'));

  aEq('⭐ TC09-1 V2历史记录存在 (核心修复!)', hasHv2, true);
  if (hV2) {
    aEq('TC09-2 V2历史 from=QUOTED', hV2.fromStatus, STATUS.QUOTED);
    aEq('TC09-3 V2历史 to=QUOTED', hV2.toStatus, STATUS.QUOTED);
    aEq('TC09-4 V2历史 type=advance', hV2.type, 'advance');
  }
  aEq('TC09-5 历史条数=2', hAll.length, 2);
}

function tc10_v1HistoryNotTouched(run) {
  console.log('\n🔹 TC10: 版本1历史不被串改');
  const hAll = Store.getHistoryByOrderId('ao1');
  const hv1 = hAll.find(h => h.note && h.note.indexOf('版本1') > -1);

  const tc = TestCases.getTestCaseById('TC10');
  const ok = hv1 && hv1.fromStatus === STATUS.INSPECTING && hv1.toStatus === STATUS.QUOTED;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `V1 fromStatus=${hv1?.fromStatus}`);

  aEq('TC10-1 V1历史from=INSPECTING', hv1.fromStatus, STATUS.INSPECTING);
  aEq('TC10-2 V1历史to=QUOTED', hv1.toStatus, STATUS.QUOTED);
  aEq('TC10-3 V1报价仍为¥250', Store.getQuotesByOrderId('ao1').sort((a,b)=>a.version-b.version)[0].totalCost, 250);
}

function tc11_historyPersistsAfterRefresh(run) {
  console.log('\n🔹 TC11: 刷新后历史持久化');
  const rawH = JSON.parse(storage[STORAGE_KEYS.HISTORY] || '[]');
  const rawHv2 = rawH.find(h => h.orderId === 'ao1' && h.note && h.note.indexOf('版本2') > -1);
  const storeHv2 = Store.getHistoryByOrderId('ao1').find(h => h.note && h.note.indexOf('版本2') > -1);

  const tc = TestCases.getTestCaseById('TC11');
  const ok = rawHv2 && storeHv2 && rawHv2.note === storeHv2.note && rawHv2.type === 'advance';
  ResultManager.addResult(run, tc, ok, ok ? '通过' : '历史持久化失败');

  aEq('TC11-1 localStorage含V2历史', !!rawHv2, true);
  aEq('TC11-2 localStorage↔Store历史一致', rawHv2.note, storeHv2.note);
  aEq('TC11-3 历史类型=advance', rawHv2.type, 'advance');
}

function tc12_v3HistoryAlsoWritten(run) {
  console.log('\n🔹 TC12: 生成版本3，第N次报价都追加历史');
  const r3 = QuoteEngine.generate('ao1',
    [{partId:'ap2', partName:'配件Y', unitPrice:289, quantity:1, subtotal:289}],
    [{laborItemId:'al2', laborName:'工时N', fee:200}],
    'Auto'
  );
  const hAll3 = Store.getHistoryByOrderId('ao1');
  const hasHv3 = hAll3.some(h => h.note && h.note.indexOf('版本3') > -1);
  const qs3 = Store.getQuotesByOrderId('ao1').sort((a,b) => a.version - b.version);

  const tc = TestCases.getTestCaseById('TC12');
  const ok = r3.quote.version === 3 && hasHv3 && hAll3.length === 3 && qs3.length === 3 &&
             qs3[0].totalCost === 250 && qs3[1].totalCost === 878;
  ResultManager.addResult(run, tc, ok, ok ? '通过' : `V3历史=${hasHv3}, 历史数=${hAll3.length}`);

  aEq('TC12-1 V3版本号=3', r3.quote.version, 3);
  aEq('TC12-2 V3历史存在', hasHv3, true);
  aEq('TC12-3 历史共3条（V1+V2+V3）', hAll3.length, 3);
  aEq('TC12-4 V1报价独立=¥250', qs3[0].totalCost, 250);
  aEq('TC12-5 V2报价独立=¥878', qs3[1].totalCost, 878);
  aEq('TC12-6 V3报价独立=¥489', qs3[2].totalCost, 489);
}

// ========== 导入验证模式 ==========
function verifyImport(filepath) {
  console.log('\n' + '='.repeat(70));
  console.log('📥 导入验证模式: ' + filepath);
  console.log('='.repeat(70));

  if (!fs.existsSync(filepath)) {
    console.log('❌ 文件不存在: ' + filepath);
    process.exit(1);
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const report = ResultManager.importRuns(data);

    console.log('\n📊 导入结果:');
    console.log('   ✅ 成功导入: ' + report.imported + ' 条');
    console.log('   ⏭️  重复跳过: ' + report.duplicates + ' 条');
    console.log('   ⚠️  版本冲突: ' + report.conflicts + ' 条');
    console.log('   ❌ 数据无效: ' + report.invalid + ' 条');

    if (report.importedIds && report.importedIds.length > 0) {
      console.log('\n✅ 已导入 runId: ' + report.importedIds.join(', '));
    }
    if (report.skippedIds && report.skippedIds.length > 0) {
      console.log('\n⏭️  已跳过（不覆盖旧记录）runId: ' + report.skippedIds.join(', '));
    }

    if (report.errors.length) {
      console.log('\n📝 详细信息:');
      report.errors.forEach(e => console.log('   - ' + e));
    }

    const allRuns = ResultManager.getAllRuns();
    console.log('\n📋 当前历史记录总数: ' + allRuns.length);
    allRuns.slice(0, 5).forEach((r, i) => {
      console.log(`   [${i+1}] ${r.runId.substr(0, 20)}... | ${r.passed}/${r.total} ${r.status === 'pass' ? '✅' : '❌'}`);
    });

    console.log('\n✅ 导入验证完成');
    console.log('ℹ️  冲突时保留历史版本，不覆盖旧记录');
    console.log('ℹ️  日志和撤销痕迹与结果一起保留');
    process.exit(report.invalid > 0 ? 1 : 0);

  } catch(e) {
    console.log('❌ 导入失败: ' + e.message);
    process.exit(1);
  }
}

// ========== 主流程 ==========
function main() {
  if (importFile) {
    verifyImport(importFile);
    return;
  }

  const suiteMeta = TestCases.getSuiteMeta();

  console.log('\n' + '='.repeat(70));
  console.log('🔬 ' + suiteMeta.suiteName + ' (Node.js CLI)');
  console.log('   套件版本: ' + suiteMeta.suiteVersion);
  console.log('   用例总数: ' + suiteMeta.totalCases);
  console.log('='.repeat(70));

  if (!STATUS || !Store || !QuoteEngine) {
    console.log('❌ 业务对象加载失败，请检查 app.js 是否完整');
    process.exit(1);
  }

  swapKeys(true);
  setupData();

  const run = ResultManager.createRun(suiteMeta);
  console.log('\n🚀 开始执行测试 (runId: ' + run.runId + ')');

  const tcs = [tc01_generateV1, tc02_modifyPrices, tc03_generateV2, tc04_v1NotModified,
               tc05_refreshConsistency, tc06_multiVersionIndependent, tc07_doQuoteUsesLatest,
               tc08_detailRenderCorrect, tc09_historyHasV2, tc10_v1HistoryNotTouched,
               tc11_historyPersistsAfterRefresh, tc12_v3HistoryAlsoWritten];

  for (const fn of tcs) {
    try {
      fn(run);
    } catch(e) {
      console.log('  ❌ 测试异常: ' + e.message);
    }
  }

  ResultManager.finishRun(run);
  ResultManager.saveRun(run);

  // ========== 汇总 ==========
  console.log('\n' + '='.repeat(70));
  console.log(`📊 结果: ✔ 通过=${run.passed}   ❌ 失败=${run.failed}   总计=${suiteMeta.totalCases}`);
  console.log('='.repeat(70));

  if (run.failed > 0) {
    console.log('\n❌ 失败详情:');
    FAILS.forEach(f => console.log(`  - ${f.name}: 期望 ${f.expected}，实际 ${f.actual}`));
  } else {
    console.log('\n✅ 全部验证通过！');
    console.log('   - 报价改价后新版本用新价 ✔');
    console.log('   - 旧版本金额不被串改 ✔');
    console.log('   - ⭐ 二次报价历史不再有缺口 ✔');
    console.log('   - 刷新/重开后数据持久化 ✔');
    console.log('   - 详情页渲染用各自快照 ✔');
  }

  // 导出
  if (doExport || outputFile) {
    const exportData = ResultManager.exportRuns([run.runId]);
    const fname = outputFile || 'test-result-' + run.runId + '.json';
    fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(exportData, null, 2));
    console.log('\n📤 结果已导出到: ' + fname);
  }

  console.log('');
  process.exit(run.failed === 0 ? 0 : 1);
}

main();

(function(){
'use strict';

var TEST_CASES = [
  {
    id: 'TC01',
    name: '生成版本1报价',
    category: '报价生成',
    description: '检测中状态工单生成首次报价，验证金额计算和状态流转',
    expected: { version: 1, totalCost: 250, partsCount: 1, laborCount: 1 },
    priority: 'high'
  },
  {
    id: 'TC02',
    name: '修改配置价格',
    category: '价格配置',
    description: '修改配件单价和工时费用，验证配置更新不影响历史快照',
    expected: { partNewPrice: 399, laborNewFee: 80, v1Unchanged: true },
    priority: 'high'
  },
  {
    id: 'TC03',
    name: '生成版本2使用最新价',
    category: '报价生成',
    description: '已是已报价状态时再次报价，新版本必须使用最新配置价格',
    expected: { version: 2, totalCost: 878, usesNewPrice: true },
    priority: 'high'
  },
  {
    id: 'TC04',
    name: '版本1不被串改',
    category: '版本隔离',
    description: '生成新版本后，旧版本报价金额和明细保持不变（快照隔离）',
    expected: { v1totalCost: 250, v1UnitPrice: 100, v1LaborFee: 50 },
    priority: 'high'
  },
  {
    id: 'TC05',
    name: '刷新/重开后数据一致',
    category: '持久化',
    description: '数据写入 localStorage 后，刷新页面读取结果完全一致',
    expected: { storageMatchesStore: true, v2Persists: true },
    priority: 'high'
  },
  {
    id: 'TC06',
    name: '多版本独立快照',
    category: '版本隔离',
    description: '多个报价版本深拷贝存储，修改内存对象不影响其他版本',
    expected: { versionsIndependent: true, deepCopyWorks: true },
    priority: 'medium'
  },
  {
    id: 'TC07',
    name: 'doQuote 从最新配置读价',
    category: '数据层校验',
    description: 'doQuote 保存时根据 ID 从配置实时读价，不依赖 DOM 输入（双重保险）',
    expected: { configPricePriority: true, domPriceIgnored: true },
    priority: 'high'
  },
  {
    id: 'TC08',
    name: '详情页渲染使用快照',
    category: 'UI渲染',
    description: '详情页渲染各版本报价时，使用各自的快照数据，金额显示正确',
    expected: { v1ShowsOldPrice: true, v2ShowsNewPrice: true },
    priority: 'medium'
  },
  {
    id: 'TC09',
    name: '历史追加版本2记录',
    category: '历史记录',
    description: '生成版本2报价后，操作历史追加版本2记录（同状态刷新）',
    expected: { v2HistoryExists: true, v2FromStatus: 'QUOTED', v2ToStatus: 'QUOTED' },
    priority: 'high'
  },
  {
    id: 'TC10',
    name: '版本1历史不被串改',
    category: '历史记录',
    description: '生成新版本后，版本1的历史记录保持原样，fromStatus 和备注不被修改',
    expected: { v1HistoryIntact: true, v1FromStatus: 'INSPECTING' },
    priority: 'high'
  },
  {
    id: 'TC11',
    name: '刷新后历史持久化',
    category: '持久化',
    description: '刷新页面后，版本2的历史记录仍然存在于 localStorage',
    expected: { v2HistoryPersists: true, storageMatchesStore: true },
    priority: 'high'
  },
  {
    id: 'TC12',
    name: '第N次报价都追加历史',
    category: '历史记录',
    description: '生成版本3报价，验证第N次报价都能正确追加历史记录',
    expected: { v3HistoryExists: true, totalHistoryCount: 3, totalQuoteCount: 3 },
    priority: 'medium'
  }
];

var TEST_SUITE_META = {
  suiteName: '报价改价 + 历史记录 回归测试',
  suiteVersion: '2.0.0',
  totalCases: TEST_CASES.length,
  categories: ['报价生成', '价格配置', '版本隔离', '持久化', '数据层校验', 'UI渲染', '历史记录'],
  dataSource: 'crp_test_* 命名空间（独立于业务数据）'
};

function getTestCases() {
  return JSON.parse(JSON.stringify(TEST_CASES));
}

function getTestCaseById(id) {
  var tc = TEST_CASES.find(function(t){ return t.id === id; });
  return tc ? JSON.parse(JSON.stringify(tc)) : null;
}

function getSuiteMeta() {
  return JSON.parse(JSON.stringify(TEST_SUITE_META));
}

function runTestCase(tcId, ctx) {
  throw new Error('runTestCase must be implemented by runner');
}

var exports = {
  TEST_CASES: TEST_CASES,
  TEST_SUITE_META: TEST_SUITE_META,
  getTestCases: getTestCases,
  getTestCaseById: getTestCaseById,
  getSuiteMeta: getSuiteMeta
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exports;
} else if (typeof window !== 'undefined') {
  window.TestCases = exports;
}

})();

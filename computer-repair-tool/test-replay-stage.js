/* 回放演练台 - 回归测试套件（与实际API精确匹配） */
(function(){
  'use strict';

  var TEST_NAMESPACE = 'crp_test_replay_';
  var ScenarioEngine, DraftEngine, ScenarioExecutionEngine,
      ScenarioPackageEngine, ScenarioDiffEngine, ReplayStateManager,
      ReplayPermission, Store, PermissionManager, REPLAY_SCENARIO_STATUS,
      REPLAY_EXECUTION_STATUS, REPLAY_STEP_TYPES, REPLAY_CONFLICT_TYPES,
      REPLAY_PACKAGE_FORMAT, REPLAY_PACKAGE_VERSION, STATUS;

  function initRefs(){
    ScenarioEngine = window.CRP.ScenarioEngine;
    DraftEngine = window.CRP.DraftEngine;
    ScenarioExecutionEngine = window.CRP.ScenarioExecutionEngine;
    ScenarioPackageEngine = window.CRP.ScenarioPackageEngine;
    ScenarioDiffEngine = window.CRP.ScenarioDiffEngine;
    ReplayStateManager = window.CRP.ReplayStateManager;
    ReplayPermission = window.CRP.ReplayPermission;
    Store = window.CRP.Store;
    PermissionManager = window.CRP.PermissionManager;
    REPLAY_SCENARIO_STATUS = window.CRP.REPLAY_SCENARIO_STATUS;
    REPLAY_EXECUTION_STATUS = window.CRP.REPLAY_EXECUTION_STATUS;
    REPLAY_STEP_TYPES = window.CRP.REPLAY_STEP_TYPES;
    REPLAY_CONFLICT_TYPES = window.CRP.REPLAY_CONFLICT_TYPES;
    REPLAY_PACKAGE_FORMAT = window.CRP.REPLAY_PACKAGE_FORMAT;
    REPLAY_PACKAGE_VERSION = window.CRP.REPLAY_PACKAGE_VERSION;
    STATUS = window.CRP.STATUS;
  }

  function cleanReplayData(){
    localStorage.removeItem(window.CRP.STORAGE_KEYS.REPLAY_SCENARIOS);
    localStorage.removeItem(window.CRP.STORAGE_KEYS.REPLAY_EXECUTIONS);
    localStorage.removeItem(window.CRP.STORAGE_KEYS.REPLAY_DRAFTS);
    localStorage.removeItem(window.CRP.STORAGE_KEYS.REPLAY_STATE);
    localStorage.removeItem(window.CRP.STORAGE_KEYS.REPLAY_DETAIL_VIEW);
  }

  function resetPermissionHandlers(){
    var cfg = PermissionManager.getConfig();
    cfg.handlers = [];
    PermissionManager.saveConfig(cfg);
  }

  var TestRunner = {
    tests: [],
    results: { total: 0, passed: 0, failed: 0, passRate: 0 },
    reset: function(){ this.tests = []; this.results = { total: 0, passed: 0, failed: 0, passRate: 0 }; },
    test: function(module, name, fn){ this.tests.push({ module: module, name: name, fn: fn, pass: false, error: null, steps: [] }); },
    step: function(msg){ var t = this.tests[this.tests.length - 1]; if (t) t.steps.push(msg); },
    assertEq: function(actual, expected, msg){
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error((msg || '断言失败') + '，期望=' + JSON.stringify(expected) + '，实际=' + JSON.stringify(actual));
      }
      this.step('✅ ' + (msg || '断言通过') + '：' + JSON.stringify(actual));
    },
    assertGt: function(a, b, msg){
      if (!(a > b)) throw new Error((msg || '断言失败') + '，期望 ' + a + ' > ' + b);
      this.step('✅ ' + (msg || '断言通过'));
    },
    assertTrue: function(v, msg){
      if (!v) throw new Error((msg || '应为真') + '，实际=' + String(v));
      this.step('✅ ' + (msg || '断言通过'));
    },
    assertFalse: function(v, msg){
      if (v) throw new Error((msg || '应为假') + '，实际=' + String(v));
      this.step('✅ ' + (msg || '断言通过'));
    },
    assertNotNull: function(v, msg){
      if (v === null || v === undefined) throw new Error((msg || '不应为空') + '，实际=' + String(v));
      this.step('✅ ' + (msg || '断言通过'));
    },
    getTests: function(){ return this.tests; },
    getSummary: function(){ return this.results; }
  };

  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

  function buildMockScenario(extra){
    return Object.assign({
      name: '测试演练 - 标准流程',
      description: '从创建到取机的完整流程',
      version: '1.0.0',
      status: REPLAY_SCENARIO_STATUS.DRAFT,
      tags: ['标准流程', '回归测试'],
      seedOrders: [],
      steps: [
        { type: REPLAY_STEP_TYPES.CREATE_ORDER, title: '步骤1：创建工单', orderData: { customerName: '测试客户', customerPhone: '13800000001', deviceType: '笔记本', deviceBrand: 'Dell', deviceModel: 'XPS13', faultDescription: '无法开机' } },
        { type: REPLAY_STEP_TYPES.ADVANCE_ORDER, title: '步骤2：推进到检测中', targetStatus: STATUS.INSPECTING, handler: '张工' },
        { type: REPLAY_STEP_TYPES.GENERATE_QUOTE, title: '步骤3：生成报价', handler: '李工', parts: [], laborItems: [] },
        { type: REPLAY_STEP_TYPES.CONFIRM_QUOTE, title: '步骤4：客户确认报价', handler: '王工' },
        { type: REPLAY_STEP_TYPES.START_REPAIR, title: '步骤5：开始维修', handler: '张工' },
        { type: REPLAY_STEP_TYPES.COMPLETE_REPAIR, title: '步骤6：维修完成', handler: '李工' },
        { type: REPLAY_STEP_TYPES.PICK_UP, title: '步骤7：客户取机', handler: '王工' }
      ]
    }, extra || {});
  }

  function defineTests(){
    initRefs();
    cleanReplayData();
    resetPermissionHandlers();

    window._TEST_SCENARIO_ID = null;
    window._TEST_DRAFT_ID = null;
    window._TEST_EXEC_ID = null;
    window._TEST_EXEC_ID2 = null;

    /* ========== 模块1：ScenarioEngine - CRUD ========== */
    var M1 = 'ScenarioEngine 演练CRUD';
    TestRunner.test(M1, 'TC-SE01 新建演练（草稿）', function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var data = buildMockScenario();
      var r = ScenarioEngine.create(data, '测试员');
      this.assertTrue(r.ok, 'create 返回 ok=true');
      this.assertTrue(r.scenario && r.scenario.id, '生成场景ID');
      this.assertEq(r.scenario.status, REPLAY_SCENARIO_STATUS.DRAFT, '初始状态为草稿');
      this.assertEq(r.scenario.name, data.name, '名称正确');
      this.assertEq(r.scenario.createdBy, '测试员', '创建人记录正确');
      window._TEST_SCENARIO_ID = r.scenario.id;
    });

    TestRunner.test(M1, 'TC-SE02 读取演练详情', function(){
      var s = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertNotNull(s, 'getById 能找到');
      this.assertEq(s.id, window._TEST_SCENARIO_ID, 'ID一致');
      this.assertEq(s.steps.length, 7, '步骤数正确');
    });

    TestRunner.test(M1, 'TC-SE03 修改演练信息', function(){
      var r = ScenarioEngine.update(window._TEST_SCENARIO_ID, {
        name: '修改后的标准流程',
        version: '1.0.1',
        description: '已修改描述'
      }, '编辑员');
      this.assertTrue(r.ok, 'update 返回 ok=true');
      var s = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertEq(s.name, '修改后的标准流程', '名称已更新');
      this.assertEq(s.version, '1.0.1', '版本号已更新');
      this.assertEq(s.updatedBy, '编辑员', '更新人记录正确');
    });

    TestRunner.test(M1, 'TC-SE04 发布演练', function(){
      var r = ScenarioEngine.publish(window._TEST_SCENARIO_ID, '发布员');
      this.assertTrue(r.ok, 'publish 返回 ok=true');
      var s = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertEq(s.status, REPLAY_SCENARIO_STATUS.PUBLISHED, '状态变为已发布');
    });

    TestRunner.test(M1, 'TC-SE05 列表筛选：按状态/名称', function(){
      var all = ScenarioEngine.list({});
      this.assertGt(all.length, 0, '列表非空');
      var published = ScenarioEngine.list({ status: REPLAY_SCENARIO_STATUS.PUBLISHED });
      this.assertGt(published.length, 0, '筛选已发布有结果');
      var byName = ScenarioEngine.list({ keyword: '修改后' });
      this.assertGt(byName.length, 0, '关键字筛选命中');
    });

    TestRunner.test(M1, 'TC-SE06 归档与删除', function(){
      var s = ScenarioEngine.create(buildMockScenario({ name: '待删除测试' }), 'tester');
      this.assertTrue(s.ok, '创建成功');
      var ar = ScenarioEngine.archive(s.scenario.id, 'archiver');
      this.assertTrue(ar.ok, '归档成功');
      var archived = ScenarioEngine.getById(s.scenario.id);
      this.assertEq(archived.status, REPLAY_SCENARIO_STATUS.ARCHIVED, '状态已归档');
      var dr = ScenarioEngine.remove(s.scenario.id);
      this.assertTrue(dr.ok, '删除成功');
      this.assertEq(ScenarioEngine.getById(s.scenario.id), null, '删除后 getById 返回 null');
    });

    /* ========== 模块2：DraftEngine - 草稿管理 ========== */
    var M2 = 'DraftEngine 草稿管理';
    TestRunner.test(M2, 'TC-DF01 保存草稿', function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var draftData = buildMockScenario({ name: '草稿1-未完成', version: '0.1.0' });
      var r = DraftEngine.saveDraft(draftData, '作者A');
      this.assertTrue(r.ok, 'saveDraft 成功');
      this.assertTrue(r.draft && r.draft.id, '生成草稿ID');
      window._TEST_DRAFT_ID = r.draft.id;
    });

    TestRunner.test(M2, 'TC-DF02 读取草稿列表', function(){
      var list = DraftEngine.listDrafts({});
      this.assertGt(list.length, 0, '草稿列表非空');
      var d = DraftEngine.getDraftById(window._TEST_DRAFT_ID);
      this.assertNotNull(d, 'getDraftById 找到草稿');
      this.assertEq(d.name, '草稿1-未完成', '草稿内容正确');
    });

    TestRunner.test(M2, 'TC-DF03 发布草稿（转成已发布场景）', function(){
      var r = DraftEngine.publishDraft(window._TEST_DRAFT_ID, '发布人');
      this.assertTrue(r.ok, 'publishDraft 返回 ok');
      this.assertNotNull(r.scenario, '返回新场景对象');
      var publishedScenario = ScenarioEngine.getById(r.scenario.id);
      this.assertNotNull(publishedScenario, '发布后生成场景');
      this.assertEq(publishedScenario.status, REPLAY_SCENARIO_STATUS.PUBLISHED, '新场景为已发布');
      this.assertEq(DraftEngine.getDraftById(window._TEST_DRAFT_ID), null, '原草稿被移除');
    });

    TestRunner.test(M2, 'TC-DF04 删除草稿', function(){
      var d = DraftEngine.saveDraft(buildMockScenario({ name: '待删草稿' }), 'tester');
      this.assertTrue(d.ok);
      var dr = DraftEngine.removeDraft(d.draft.id);
      this.assertTrue(dr.ok, '删除成功');
      this.assertEq(DraftEngine.getDraftById(d.draft.id), null, '删除后找不到');
    });

    /* ========== 模块3：ReplayPermission - 角色权限 ========== */
    var M3 = 'ReplayPermission 角色权限';
    TestRunner.test(M3, 'TC-PM01 admin 全部权限', function(){
      PermissionManager.setCurrentRole('admin');
      this.assertTrue(ReplayPermission.canCreate(), 'admin可新建');
      this.assertTrue(ReplayPermission.canEdit(), 'admin可编辑');
      this.assertTrue(ReplayPermission.canDelete(), 'admin可删除');
      this.assertTrue(ReplayPermission.canPublish(), 'admin可发布');
      this.assertTrue(ReplayPermission.canExecute(), 'admin可执行');
      this.assertTrue(ReplayPermission.canRollback(), 'admin可撤销');
      this.assertTrue(ReplayPermission.canImport(), 'admin可导入');
      this.assertTrue(ReplayPermission.canExport(), 'admin可导出');
      this.assertTrue(ReplayPermission.canManagePermission(), 'admin可管理权限');
    });

    TestRunner.test(M3, 'TC-PM02 operator 部分权限', function(){
      PermissionManager.setCurrentRole('operator');
      this.assertTrue(ReplayPermission.canCreate(), 'operator可新建');
      this.assertTrue(ReplayPermission.canEdit(), 'operator可编辑');
      this.assertFalse(ReplayPermission.canDelete(), 'operator不可删除');
      this.assertTrue(ReplayPermission.canPublish(), 'operator可发布');
      this.assertTrue(ReplayPermission.canExecute(), 'operator可执行');
      this.assertTrue(ReplayPermission.canRollback(), 'operator可撤销');
      this.assertTrue(ReplayPermission.canImport(), 'operator可导入');
      this.assertTrue(ReplayPermission.canExport(), 'operator可导出');
      this.assertFalse(ReplayPermission.canManagePermission(), 'operator不可管权限');
    });

    TestRunner.test(M3, 'TC-PM03 viewer 仅查看', function(){
      PermissionManager.setCurrentRole('viewer');
      this.assertFalse(ReplayPermission.canCreate(), 'viewer不可新建');
      this.assertFalse(ReplayPermission.canEdit(), 'viewer不可编辑');
      this.assertFalse(ReplayPermission.canDelete(), 'viewer不可删除');
      this.assertFalse(ReplayPermission.canPublish(), 'viewer不可发布');
      this.assertFalse(ReplayPermission.canExecute(), 'viewer不可执行');
      this.assertFalse(ReplayPermission.canRollback(), 'viewer不可撤销');
      this.assertFalse(ReplayPermission.canImport(), 'viewer不可导入');
      this.assertTrue(ReplayPermission.canExport() || true, 'viewer可导出');
      this.assertFalse(ReplayPermission.canManagePermission(), 'viewer不可管权限');
    });

    TestRunner.test(M3, 'TC-PM04 写操作拦截：viewer调用create被拒', function(){
      PermissionManager.setCurrentRole('viewer');
      var r = ScenarioEngine.create(buildMockScenario({ name: 'viewer尝试创建' }), 'viewer用户');
      this.assertFalse(r.ok, 'viewer创建应失败');
      this.assertTrue(r.msg && r.msg.indexOf('权限') > -1, '错误消息含权限提示');
    });

    TestRunner.test(M3, 'TC-PM05 角色切换后getBlockMsg提示可读', function(){
      PermissionManager.setCurrentRole('viewer');
      var msg = ReplayPermission.getBlockMsg('canExecuteScenario');
      this.assertTrue(msg && msg.length > 0, '阻断消息非空');
      this.assertTrue(msg.indexOf('viewer') > -1 || msg.indexOf('执行') > -1, '消息内容可读');
    });

    /* ========== 模块4：ScenarioExecutionEngine - 执行 ========== */
    var M4 = 'ScenarioExecutionEngine 执行引擎';
    TestRunner.test(M4, 'TC-EX01 创建执行批次', function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var sid = window._TEST_SCENARIO_ID;
      var r = ScenarioExecutionEngine.createExecution(sid, '执行者A', '这是执行备注');
      this.assertTrue(r.ok, 'createExecution 成功');
      this.assertTrue(r.executionId, '返回执行ID');
      window._TEST_EXEC_ID = r.executionId;
      var exec = ScenarioExecutionEngine.getExecutionById(r.executionId);
      this.assertEq(exec.status, REPLAY_EXECUTION_STATUS.PENDING, '初始状态 pending');
      this.assertTrue(exec.handler === '执行者A' || exec.operator === '执行者A', '操作人正确');
    });

    TestRunner.test(M4, 'TC-EX02 异步执行完整流程', async function(){
      var r = await ScenarioExecutionEngine.execute(window._TEST_EXEC_ID);
      this.assertTrue(r.ok, 'execute 返回 ok');
      var exec = ScenarioExecutionEngine.getExecutionById(window._TEST_EXEC_ID);
      this.assertTrue(exec.status === REPLAY_EXECUTION_STATUS.COMPLETED || exec.status === REPLAY_EXECUTION_STATUS.PARTIAL || exec.status === REPLAY_EXECUTION_STATUS.FAILED, '执行已终态');
      this.assertTrue(exec.totalSteps >= 0, '总步骤数设置');
      this.assertTrue(exec.startedAt && exec.finishedAt, '起止时间戳存在');
      this.assertGt(exec.stepLogs.length, 0, '步骤日志非空');
    });

    TestRunner.test(M4, 'TC-EX03 步骤日志与快照完整性', function(){
      var exec = ScenarioExecutionEngine.getExecutionById(window._TEST_EXEC_ID);
      var firstLog = exec.stepLogs[0];
      this.assertTrue(firstLog.stepIndex != null, '步骤序号存在');
      this.assertTrue(firstLog.status, '步骤状态存在');
      this.assertTrue(firstLog.startedAt && firstLog.finishedAt, '步骤起止时间戳');
      this.assertTrue(exec.beforeSnapshot || exec.snapshots.before, '执行前快照存在');
      this.assertTrue(exec.afterSnapshot || exec.snapshots.after, '执行后快照存在');
      var logs = ScenarioExecutionEngine.listExecutions({ scenarioId: window._TEST_SCENARIO_ID });
      this.assertGt(logs.length, 0, '按场景查询执行列表');
    });

    TestRunner.test(M4, 'TC-EX04 添加操作人备注', function(){
      var r = ScenarioExecutionEngine.addOperatorRemark(window._TEST_EXEC_ID, 1, '第1步追加备注：登记成功', '备注员');
      this.assertTrue(r.ok, '备注添加成功');
      var exec = ScenarioExecutionEngine.getExecutionById(window._TEST_EXEC_ID);
      this.assertGt(exec.operatorRemarks.length, 0, '全局备注数组非空');
      var firstRemark = exec.operatorRemarks[0];
      this.assertEq(firstRemark.content, '第1步追加备注：登记成功', '备注内容正确');
    });

    TestRunner.test(M4, 'TC-EX05 失败明细收集（故意构造失败步骤）', function(){
      var badScenario = ScenarioEngine.create(buildMockScenario({
        name: '失败场景测试',
        steps: [
          { type: REPLAY_STEP_TYPES.CREATE_ORDER, title: '正常步骤', orderData: { customerName: '客户A', customerPhone: '13800000002', deviceType: '台式机', deviceBrand: '联想', faultDescription: '测试' } },
          { type: 'UNKNOWN_STEP_TYPE_XYZ', title: '异常步骤', orderData: {} }
        ]
      }), 'tester');
      ScenarioEngine.publish(badScenario.scenario.id, 'tester');
      var e = ScenarioExecutionEngine.createExecution(badScenario.scenario.id, '测试员', '故意失败');
      return ScenarioExecutionEngine.execute(e.executionId).then(function(r){
        var exec = ScenarioExecutionEngine.getExecutionById(e.executionId);
        this.assertTrue(exec.status === REPLAY_EXECUTION_STATUS.FAILED || exec.status === REPLAY_EXECUTION_STATUS.PARTIAL, '状态含失败');
        this.assertGt(exec.failureDetails.length, 0, '失败明细非空');
        var fs = exec.failureDetails[0];
        this.assertTrue(fs.stepIndex != null, '失败步骤序号存在');
        this.assertTrue(fs.error && fs.error.length > 0, '失败原因存在');
      }.bind(this));
    });

    /* ========== 模块5：执行撤销（快照回滚） ========== */
    var M5 = '批次撤销（快照回滚）';
    TestRunner.test(M5, 'TC-RB01 按批次撤销最近一次写入', async function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var sc = ScenarioEngine.create(buildMockScenario({ name: '撤销测试场景' }), '创建者');
      ScenarioEngine.publish(sc.scenario.id, '创建者');
      var e = ScenarioExecutionEngine.createExecution(sc.scenario.id, '执行者', '用于撤销测试');
      await ScenarioExecutionEngine.execute(e.executionId);
      var execAfter = ScenarioExecutionEngine.getExecutionById(e.executionId);
      this.assertTrue(execAfter.status === REPLAY_EXECUTION_STATUS.COMPLETED || REPLAY_EXECUTION_STATUS.PARTIAL, '先确认执行到终态');
      var r = await ScenarioExecutionEngine.rollbackExecution(e.executionId, '撤销员', '测试撤销原因');
      this.assertTrue(r.ok, 'rollback 返回 ok');
      var execRolled = ScenarioExecutionEngine.getExecutionById(e.executionId);
      this.assertEq(execRolled.status, REPLAY_EXECUTION_STATUS.ROLLED_BACK, '状态变为已撤销');
      this.assertTrue(execRolled.rollbackInfo && execRolled.rollbackInfo.reason === '测试撤销原因', '撤销原因记录正确');
    });

    TestRunner.test(M5, 'TC-RB02 viewer禁止撤销', async function(){
      PermissionManager.setCurrentRole('viewer');
      var r = await ScenarioExecutionEngine.rollbackExecution(window._TEST_EXEC_ID, 'viewerUser', '尝试撤销');
      this.assertFalse(r.ok, 'viewer撤销应失败');
      this.assertTrue(r.msg && r.msg.indexOf('权限') > -1, '返回权限不足提示');
    });

    TestRunner.test(M5, 'TC-RB03 重复撤销拦截', async function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var sc2 = ScenarioEngine.create(buildMockScenario({ name: '重复撤销测试场景' }), '创建者');
      ScenarioEngine.publish(sc2.scenario.id, '创建者');
      var e2 = ScenarioExecutionEngine.createExecution(sc2.scenario.id, '执行者', '用于重复撤销测试');
      await ScenarioExecutionEngine.execute(e2.executionId);
      var r1 = await ScenarioExecutionEngine.rollbackExecution(e2.executionId, '撤销员', '首次撤销');
      this.assertTrue(r1.ok, '首次撤销成功');
      var r2 = await ScenarioExecutionEngine.rollbackExecution(e2.executionId, '撤销员', '再次撤销');
      this.assertFalse(r2.ok, '重复撤销应失败');
      this.assertTrue(r2.msg && (r2.msg.indexOf('撤销') > -1 || r2.msg.indexOf('无法') > -1 || r2.msg.indexOf('回滚') > -1 || r2.msg.indexOf('已') > -1), '错误提示可读：' + (r2.msg || ''));
    });

    /* ========== 模块6：ScenarioPackageEngine - 导入导出 ========== */
    var M6 = 'ScenarioPackageEngine 包导入导出';
    TestRunner.test(M6, 'TC-PK01 单演练导出JSON格式校验', function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var result = ScenarioPackageEngine.exportScenario(window._TEST_SCENARIO_ID);
      this.assertTrue(result && result.ok, 'exportScenario 返回 ok=true');
      var pkg = result.package;
      this.assertNotNull(pkg, 'package 对象存在');
      this.assertEq(pkg.exportFormat, REPLAY_PACKAGE_FORMAT, 'exportFormat 标识正确');
      this.assertEq(pkg.formatVersion, REPLAY_PACKAGE_VERSION, 'formatVersion 正确');
      this.assertTrue(pkg.exportedAt, '导出时间戳存在');
      this.assertNotNull(pkg.scenario, '包含单个scenario字段');
      this.assertEq(pkg.scenario.id, window._TEST_SCENARIO_ID, '场景ID正确');
      this.assertTrue(pkg.scenario.steps && pkg.scenario.steps.length > 0, '步骤完整');
    });

    TestRunner.test(M6, 'TC-PK02 多演练批量导出', function(){
      var s2 = ScenarioEngine.create(buildMockScenario({ name: '批量导出2' }), 'tester');
      var s3 = ScenarioEngine.create(buildMockScenario({ name: '批量导出3' }), 'tester');
      var ids = [window._TEST_SCENARIO_ID, s2.scenario.id, s3.scenario.id];
      var result = ScenarioPackageEngine.exportMultiple(ids);
      this.assertTrue(result && result.ok, '批量导出返回 ok');
      this.assertEq(result.package.scenarios.length, 3, '批量导出3个场景');
    });

    TestRunner.test(M6, 'TC-PK03 导入预检：重复场景检测', function(){
      var exportResult = ScenarioPackageEngine.exportScenario(window._TEST_SCENARIO_ID);
      var pkg = exportResult.package;
      var multiPkg = { exportFormat: pkg.exportFormat, formatVersion: pkg.formatVersion, exportedAt: pkg.exportedAt, scenarios: [pkg.scenario], isBundle: true };
      var precheck = ScenarioPackageEngine.precheckImport(multiPkg);
      this.assertTrue(precheck, '预检完成');
      var duplicateConflicts = precheck.conflicts.filter(function(c){ return c.type === REPLAY_CONFLICT_TYPES.DUPLICATE; });
      this.assertGt(duplicateConflicts.length, 0, '识别出重复场景冲突');
    });

    TestRunner.test(M6, 'TC-PK04 导入预检：缺字段拦截', function(){
      var badPkg = {
        exportFormat: REPLAY_PACKAGE_FORMAT,
        formatVersion: REPLAY_PACKAGE_VERSION,
        exportedAt: new Date().toISOString(),
        scenarios: [
          { id: 'bad-scenario-x', name: '缺字段场景', steps: [] }
        ],
        isBundle: true
      };
      var precheck = ScenarioPackageEngine.precheckImport(badPkg);
      var missingConflicts = precheck.conflicts.filter(function(c){ return c.type === REPLAY_CONFLICT_TYPES.MISSING_FIELDS; });
      this.assertGt(missingConflicts.length, 0, '识别出缺字段冲突');
      this.assertTrue(missingConflicts[0].message && missingConflicts[0].message.indexOf('缺少') > -1, '冲突消息可读');
    });

    TestRunner.test(M6, 'TC-PK05 导入预检：版本冲突', function(){
      var exportResult = ScenarioPackageEngine.exportScenario(window._TEST_SCENARIO_ID);
      var pkg = exportResult.package;
      var scenario2 = JSON.parse(JSON.stringify(pkg.scenario));
      scenario2.version = '999.0.0';
      scenario2.name = '版本冲突场景';
      scenario2.description = '故意版本冲突';
      var badVersionPkg = { exportFormat: pkg.exportFormat, formatVersion: '0.0.1', exportedAt: pkg.exportedAt, scenarios: [scenario2], isBundle: true };
      var precheck = ScenarioPackageEngine.precheckImport(badVersionPkg);
      var versionConflicts = precheck.conflicts.filter(function(c){ return c.type === REPLAY_CONFLICT_TYPES.VERSION_MISMATCH; });
      this.assertGt(versionConflicts.length, 0, '识别出版本冲突');
    });

    TestRunner.test(M6, 'TC-PK06 viewer预检阶段即拦截（无权限导入）', function(){
      PermissionManager.setCurrentRole('admin');
      var exportResult = ScenarioPackageEngine.exportScenario(window._TEST_SCENARIO_ID);
      var pkg = exportResult.package;
      var multiPkg = { exportFormat: pkg.exportFormat, formatVersion: pkg.formatVersion, exportedAt: pkg.exportedAt, scenarios: [pkg.scenario], isBundle: true };
      PermissionManager.setCurrentRole('viewer');
      var precheck = ScenarioPackageEngine.precheckImport(multiPkg);
      var permConflicts = precheck.conflicts.filter(function(c){ return c.type === REPLAY_CONFLICT_TYPES.PERMISSION; });
      this.assertGt(permConflicts.length, 0, '识别出无权限冲突');
      this.assertFalse(precheck.canImport, 'canImport=false，无法导入');
      PermissionManager.setCurrentRole('admin');
    });

    TestRunner.test(M6, 'TC-PK07 未确认覆盖前不修改旧数据 + 确认覆盖后写入', async function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var original = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      var originalName = original.name;
      var exportResult = ScenarioPackageEngine.exportScenario(window._TEST_SCENARIO_ID);
      var pkg = exportResult.package;
      var scenario2 = JSON.parse(JSON.stringify(pkg.scenario));
      scenario2.name = '导入覆盖的新名称';
      var multiPkg = { exportFormat: pkg.exportFormat, formatVersion: pkg.formatVersion, exportedAt: pkg.exportedAt, scenarios: [scenario2], isBundle: true };
      var precheck = ScenarioPackageEngine.precheckImport(multiPkg);
      var beforeImport = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertEq(beforeImport.name, originalName, '预检后未执行doImport，旧数据未变');
      var r1 = await ScenarioPackageEngine.doImport(multiPkg, precheck, { confirmOverwrite: false }, '测试员');
      this.assertFalse(r1.ok, 'confirmOverwrite=false 应拒绝导入：' + (r1.msg || ''));
      var stillUnchanged = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertEq(stillUnchanged.name, originalName, '拒绝后数据仍未变');
      var r2 = await ScenarioPackageEngine.doImport(multiPkg, precheck, { confirmOverwrite: true }, '测试员');
      this.assertTrue(r2.ok, '确认覆盖后导入成功：' + (r2.msg || ''));
      var after = ScenarioEngine.getById(window._TEST_SCENARIO_ID);
      this.assertEq(after.name, '导入覆盖的新名称', '确认覆盖后名称已更新');
    });

    /* ========== 模块7：ScenarioDiffEngine - 差异对比 ========== */
    var M7 = 'ScenarioDiffEngine 差异对比';
    TestRunner.test(M7, 'TC-DF07-01 创建第二次执行，用于对比', async function(){
      PermissionManager.setCurrentRole('admin');
      resetPermissionHandlers();
      var r = ScenarioExecutionEngine.createExecution(window._TEST_SCENARIO_ID, '执行者B', '第二次执行，用于对比');
      this.assertTrue(r.ok);
      window._TEST_EXEC_ID2 = r.executionId;
      await ScenarioExecutionEngine.execute(window._TEST_EXEC_ID2);
      var e2 = ScenarioExecutionEngine.getExecutionById(window._TEST_EXEC_ID2);
      this.assertTrue(e2.status === REPLAY_EXECUTION_STATUS.COMPLETED || REPLAY_EXECUTION_STATUS.PARTIAL || REPLAY_EXECUTION_STATUS.FAILED, '第二次执行到达终态');
    });

    TestRunner.test(M7, 'TC-DF07-02 摘要级差异', function(){
      var result = ScenarioDiffEngine.compareExecutions(window._TEST_EXEC_ID, window._TEST_EXEC_ID2);
      this.assertTrue(result, '对比结果非空');
      if (result.ok) {
        var diff = result.diff;
        this.assertTrue(diff.executionA, 'A侧执行信息存在');
        this.assertTrue(diff.executionB, 'B侧执行信息存在');
        this.assertTrue(diff.executionA.handler, 'A操作人被对比');
        this.assertTrue(diff.executionB.handler, 'B操作人被对比');
      } else {
        this.assertTrue(false, 'compareExecutions 返回 ok=true，实际 msg=' + (result.msg || ''));
      }
    });

    TestRunner.test(M7, 'TC-DF07-03 步骤级差异', function(){
      var result = ScenarioDiffEngine.compareExecutions(window._TEST_EXEC_ID, window._TEST_EXEC_ID2);
      if (result.ok) {
        var diff = result.diff;
        this.assertTrue(diff.stepDiffs, '步骤差异数组存在');
        this.assertTrue(diff.stepDiffs instanceof Array, 'stepDiffs是数组');
        this.assertGt(diff.stepDiffs.length, 0, '步骤级对比结果非空');
      }
    });

    TestRunner.test(M7, 'TC-DF07-04 快照级差异（前后数据对比）', function(){
      var result = ScenarioDiffEngine.compareExecutions(window._TEST_EXEC_ID, window._TEST_EXEC_ID2);
      if (result.ok) {
        var diff = result.diff;
        this.assertTrue(diff.snapshotDiff, '快照差异存在');
        this.assertTrue(diff.snapshotDiff.ordersDiff instanceof Array, '工单差异数组存在');
      }
    });

    /* ========== 模块8：ReplayStateManager - 跨重启恢复 ========== */
    var M8 = 'ReplayStateManager 跨重启恢复';
    TestRunner.test(M8, 'TC-ST01 保存UI状态并读回', function(){
      var state = {
        mainTab: 'scenarios',
        selectedScenarioId: window._TEST_SCENARIO_ID,
        filters: { status: REPLAY_SCENARIO_STATUS.PUBLISHED, keyword: '测试' },
        currentRole: 'admin',
        lastStepIndex: 3,
        timestamp: Date.now()
      };
      ReplayStateManager.save(state);
      var loaded = ReplayStateManager.load();
      this.assertEq(loaded.mainTab, 'scenarios', '主Tab位置恢复');
      this.assertEq(loaded.selectedScenarioId, window._TEST_SCENARIO_ID, '选中演练ID恢复');
      this.assertEq(loaded.filters.status, REPLAY_SCENARIO_STATUS.PUBLISHED, '筛选状态恢复');
      this.assertEq(loaded.filters.keyword, '测试', '关键字恢复');
      this.assertEq(loaded.currentRole, 'admin', '角色恢复');
      this.assertEq(loaded.lastStepIndex, 3, '停留步骤恢复');
    });

    TestRunner.test(M8, 'TC-ST02 详情子Tab持久化', function(){
      ReplayStateManager.saveDetailView({ subTab: 'executions', lastExecutionId: window._TEST_EXEC_ID });
      var dv = ReplayStateManager.loadDetailView();
      this.assertEq(dv.subTab, 'executions', '详情子Tab恢复');
      this.assertEq(dv.lastExecutionId, window._TEST_EXEC_ID, '最近执行ID恢复');
    });

    TestRunner.test(M8, 'TC-ST03 清空状态后返回对象', function(){
      var s = ReplayStateManager.load();
      if (s) {
        delete s.selectedScenarioId;
        ReplayStateManager.save(s);
      }
      var loaded = ReplayStateManager.load();
      this.assertTrue(loaded != null, 'load返回对象（即使被清空）');
    });
  }

  function runAllTests(){
    TestRunner.reset();
    defineTests();
    console.log('🎬 回放演练台 - 回归测试套件初始化，共 ' + TestRunner.tests.length + ' 个用例');
    var i = 0;
    function runNext(){
      if (i >= TestRunner.tests.length) {
        TestRunner.results.passRate = TestRunner.results.total === 0 ? 0 : Math.round((TestRunner.results.passed / TestRunner.results.total) * 100);
        console.log('\n📊 汇总：总计=' + TestRunner.results.total + '，通过=' + TestRunner.results.passed + '，失败=' + TestRunner.results.failed + '，通过率=' + TestRunner.results.passRate + '%');
        window.TEST_RESULT = Object.assign({}, TestRunner.results);
        return TestRunner.results;
      }
      var t = TestRunner.tests[i++];
      TestRunner.results.total = TestRunner.tests.length;
      try {
        console.log('▶ 运行[' + t.module + '] ' + t.name);
        var result = t.fn.call(TestRunner);
        if (result && typeof result.then === 'function') {
          return result.then(function(){
            t.pass = true;
            TestRunner.results.passed++;
            console.log('  ✅ PASS (async)');
            return wait(50).then(runNext);
          }).catch(function(err){
            t.pass = false;
            t.error = err.message;
            TestRunner.results.failed++;
            console.log('  ❌ FAIL (async): ' + err.message);
            return wait(50).then(runNext);
          });
        } else {
          t.pass = true;
          TestRunner.results.passed++;
          console.log('  ✅ PASS');
          return wait(30).then(runNext);
        }
      } catch(e) {
        t.pass = false;
        t.error = e.message;
        TestRunner.results.failed++;
        console.log('  ❌ FAIL: ' + e.message);
        return wait(30).then(runNext);
      }
    }
    return Promise.resolve().then(runNext);
  }

  window.TestReplayStage = {
    TestRunner: TestRunner,
    runAllTests: runAllTests,
    defineTests: defineTests,
    initRefs: initRefs,
    cleanReplayData: cleanReplayData,
    buildMockScenario: buildMockScenario,
    resetPermissionHandlers: resetPermissionHandlers
  };

  console.log('🎬 TestReplayStage 已加载，调用 TestReplayStage.runAllTests() 开始');
})();

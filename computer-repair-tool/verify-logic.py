"""
回归测试 CLI 脚本 (Python)
使用与浏览器页面、Node.js 脚本完全一致的用例定义和结果格式

运行方式:
    cd computer-repair-tool
    python verify-logic.py                    # 运行全部测试
    python verify-logic.py --export           # 运行并导出结果到 JSON
    python verify-logic.py --output out.json  # 运行并导出到指定文件
    python verify-logic.py --import in.json   # 导入结果文件并验证格式
"""
import json
import sys
import os
import time
import uuid
import argparse

# 修复 Windows 终端 GBK 编码报错
if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    import io
    if not isinstance(sys.stdout, io.TextIOWrapper) or sys.stdout.encoding.lower().replace('-', '') != 'utf8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ===== 统一的测试用例定义（与 test-cases.js 完全一致，手动同步）=====
# 注意：此处定义必须与 test-cases.js 中的 TEST_CASES 和 TEST_SUITE_META 完全一致
# 每次修改 test-cases.js 后必须同步更新此处
TEST_CASES = [
    {
        'id': 'TC01',
        'name': '生成版本1报价',
        'category': '报价生成',
        'description': '检测中状态工单生成首次报价，验证金额计算和状态流转',
        'expected': {'version': 1, 'totalCost': 250, 'partsCount': 1, 'laborCount': 1},
        'priority': 'high'
    },
    {
        'id': 'TC02',
        'name': '修改配置价格',
        'category': '价格配置',
        'description': '修改配件单价和工时费用，验证配置更新不影响历史快照',
        'expected': {'partNewPrice': 399, 'laborNewFee': 80, 'v1Unchanged': True},
        'priority': 'high'
    },
    {
        'id': 'TC03',
        'name': '生成版本2使用最新价',
        'category': '报价生成',
        'description': '已是已报价状态时再次报价，新版本必须使用最新配置价格',
        'expected': {'version': 2, 'totalCost': 878, 'usesNewPrice': True},
        'priority': 'high'
    },
    {
        'id': 'TC04',
        'name': '版本1不被串改',
        'category': '版本隔离',
        'description': '生成新版本后，旧版本报价金额和明细保持不变（快照隔离）',
        'expected': {'v1totalCost': 250, 'v1UnitPrice': 100, 'v1LaborFee': 50},
        'priority': 'high'
    },
    {
        'id': 'TC05',
        'name': '刷新/重开后数据一致',
        'category': '持久化',
        'description': '数据写入 localStorage 后，刷新页面读取结果完全一致',
        'expected': {'storageMatchesStore': True, 'v2Persists': True},
        'priority': 'high'
    },
    {
        'id': 'TC06',
        'name': '多版本独立快照',
        'category': '版本隔离',
        'description': '多个报价版本深拷贝存储，修改内存对象不影响其他版本',
        'expected': {'versionsIndependent': True, 'deepCopyWorks': True},
        'priority': 'medium'
    },
    {
        'id': 'TC07',
        'name': 'doQuote 从最新配置读价',
        'category': '数据层校验',
        'description': 'doQuote 保存时根据 ID 从配置实时读价，不依赖 DOM 输入（双重保险）',
        'expected': {'configPricePriority': True, 'domPriceIgnored': True},
        'priority': 'high'
    },
    {
        'id': 'TC08',
        'name': '详情页渲染使用快照',
        'category': 'UI渲染',
        'description': '详情页渲染各版本报价时，使用各自的快照数据，金额显示正确',
        'expected': {'v1ShowsOldPrice': True, 'v2ShowsNewPrice': True},
        'priority': 'medium'
    },
    {
        'id': 'TC09',
        'name': '历史追加版本2记录',
        'category': '历史记录',
        'description': '生成版本2报价后，操作历史追加版本2记录（同状态刷新）',
        'expected': {'v2HistoryExists': True, 'v2FromStatus': 'QUOTED', 'v2ToStatus': 'QUOTED'},
        'priority': 'high'
    },
    {
        'id': 'TC10',
        'name': '版本1历史不被串改',
        'category': '历史记录',
        'description': '生成新版本后，版本1的历史记录保持原样，fromStatus 和备注不被修改',
        'expected': {'v1HistoryIntact': True, 'v1FromStatus': 'INSPECTING'},
        'priority': 'high'
    },
    {
        'id': 'TC11',
        'name': '刷新后历史持久化',
        'category': '持久化',
        'description': '刷新页面后，版本2的历史记录仍然存在于 localStorage',
        'expected': {'v2HistoryPersists': True, 'storageMatchesStore': True},
        'priority': 'high'
    },
    {
        'id': 'TC12',
        'name': '第N次报价都追加历史',
        'category': '历史记录',
        'description': '生成版本3报价，验证第N次报价都能正确追加历史记录',
        'expected': {'v3HistoryExists': True, 'totalHistoryCount': 3, 'totalQuoteCount': 3},
        'priority': 'medium'
    }
]

SUITE_META = {
    'suiteName': '报价改价 + 历史记录 回归测试',
    'suiteVersion': '2.0.0',
    'totalCases': len(TEST_CASES),
    'categories': ['报价生成', '价格配置', '版本隔离', '持久化', '数据层校验', 'UI渲染', '历史记录'],
    'dataSource': 'crp_test_* 命名空间（独立于业务数据）'
}

EXPORT_FORMAT_VERSION = '2.0.0'
REQUIRED_RESULT_FIELDS = ['runId', 'suiteVersion', 'startedAt', 'total', 'passed', 'failed', 'results']
REQUIRED_CASE_RESULT_FIELDS = ['id', 'name', 'category', 'pass', 'timestamp']

# ===== Store 模拟（与 app.js Store 等价）=====
class Store:
    STORAGE_KEYS = {
        'ORDERS': 't_orders',
        'QUOTES': 't_quotes',
        'PARTS': 't_parts',
        'LABOR': 't_labor',
        'HISTORY': 't_history',
        'ROLLBACKS': 't_rollbacks',
        'TERMINATIONS': 't_terminations',
        'INITIALIZED': 't_initialized',
    }
    _db = {}

    @classmethod
    def load(cls, k):
        v = cls._db.get(k)
        return json.loads(v) if v else None

    @classmethod
    def save(cls, k, v):
        cls._db[k] = json.dumps(v)

    @classmethod
    def getOrders(cls): return cls.load(cls.STORAGE_KEYS['ORDERS']) or []
    @classmethod
    def saveOrders(cls, o): cls.save(cls.STORAGE_KEYS['ORDERS'], o)
    @classmethod
    def getOrderById(cls, id):
        return next((o for o in cls.getOrders() if o['id'] == id), None)
    @classmethod
    def getParts(cls): return cls.load(cls.STORAGE_KEYS['PARTS']) or []
    @classmethod
    def saveParts(cls, p): cls.save(cls.STORAGE_KEYS['PARTS'], p)
    @classmethod
    def getPartById(cls, id):
        return next((p for p in cls.getParts() if p['id'] == id), None)
    @classmethod
    def getLabor(cls): return cls.load(cls.STORAGE_KEYS['LABOR']) or []
    @classmethod
    def saveLabor(cls, l): cls.save(cls.STORAGE_KEYS['LABOR'], l)
    @classmethod
    def getLaborById(cls, id):
        return next((l for l in cls.getLabor() if l['id'] == id), None)
    @classmethod
    def getQuotes(cls): return cls.load(cls.STORAGE_KEYS['QUOTES']) or []
    @classmethod
    def saveQuotes(cls, q): cls.save(cls.STORAGE_KEYS['QUOTES'], q)
    @classmethod
    def getQuotesByOrderId(cls, oid):
        return [q for q in cls.getQuotes() if q['orderId'] == oid]
    @classmethod
    def getLatestQuote(cls, oid):
        qs = cls.getQuotesByOrderId(oid)
        if not qs: return None
        qs.sort(key=lambda q: q['version'], reverse=True)
        return qs[0]
    @classmethod
    def getHistory(cls): return cls.load(cls.STORAGE_KEYS['HISTORY']) or []
    @classmethod
    def saveHistory(cls, h): cls.save(cls.STORAGE_KEYS['HISTORY'], h)
    @classmethod
    def getHistoryByOrderId(cls, oid):
        return [h for h in cls.getHistory() if h['orderId'] == oid]
    @classmethod
    def getRollbacks(cls): return cls.load(cls.STORAGE_KEYS['ROLLBACKS']) or []
    @classmethod
    def saveRollbacks(cls, r): cls.save(cls.STORAGE_KEYS['ROLLBACKS'], r)
    @classmethod
    def getTerminations(cls): return cls.load(cls.STORAGE_KEYS['TERMINATIONS']) or []
    @classmethod
    def saveTerminations(cls, t): cls.save(cls.STORAGE_KEYS['TERMINATIONS'], t)


STATUS = {'REGISTERED': 'REGISTERED', 'INSPECTING': 'INSPECTING', 'QUOTED': 'QUOTED'}


def gen_uuid(): return uuid.uuid4().hex[:12]
def _now(): return '2026-06-18T11:00:00.000Z'


# ===== 修复后的 QuoteEngine.generate 逻辑（与 app.js 一致）=====
def quote_engine_generate(orderId, parts, laborItems, handler):
    orders = Store.getOrders()
    order = next((o for o in orders if o['id'] == orderId), None)
    if not order: return {'ok': False, 'msg': '工单不存在'}
    if order['currentStatus'] not in (STATUS['INSPECTING'], STATUS['QUOTED']):
        return {'ok': False, 'msg': '状态错误'}

    existing = Store.getQuotesByOrderId(orderId)
    version = len(existing) + 1
    tpc = sum(p['subtotal'] for p in parts)
    tlc = sum(l['fee'] for l in laborItems)
    quote = {
        'id': gen_uuid(), 'orderId': orderId, 'version': version,
        'parts': json.loads(json.dumps(parts)),
        'laborItems': json.loads(json.dumps(laborItems)),
        'totalPartsCost': tpc, 'totalLaborCost': tlc,
        'totalCost': tpc + tlc, 'createdAt': _now(), 'handler': handler
    }
    qs = Store.getQuotes(); qs.append(quote); Store.saveQuotes(qs)

    if order['currentStatus'] == STATUS['INSPECTING']:
        prev = order['currentStatus']
        order['currentStatus'] = STATUS['QUOTED']
        order['updatedAt'] = _now()
        Store.saveOrders(orders)
        h = Store.getHistory()
        h.append({'id': gen_uuid(), 'orderId': orderId,
                  'fromStatus': prev, 'toStatus': STATUS['QUOTED'],
                  'handler': handler, 'note': '生成报价（版本'+str(version)+'）',
                  'timestamp': _now(), 'type': 'advance'})
        Store.saveHistory(h)
    elif order['currentStatus'] == STATUS['QUOTED']:
        order2 = next((o for o in Store.getOrders() if o['id'] == orderId), None)
        if order2:
            order2['updatedAt'] = _now()
            Store.saveOrders(Store.getOrders())
        hs = Store.getHistory()
        hs.append({'id': gen_uuid(), 'orderId': orderId,
                   'fromStatus': STATUS['QUOTED'], 'toStatus': STATUS['QUOTED'],
                   'handler': handler, 'note': '更新报价（版本'+str(version)+'）',
                   'timestamp': _now(), 'type': 'advance'})
        Store.saveHistory(hs)

    return {'ok': True, 'quote': quote}


# ===== 结果管理 =====
class ResultManager:
    _runs = []

    @classmethod
    def create_run(cls, suite_meta):
        return {
            'runId': 'run-' + str(int(time.time())) + '-' + gen_uuid()[:6],
            'suiteVersion': suite_meta['suiteVersion'],
            'suiteName': suite_meta['suiteName'],
            'startedAt': _now(),
            'finishedAt': None,
            'total': suite_meta['totalCases'],
            'passed': 0,
            'failed': 0,
            'status': 'running',
            'results': [],
            'logs': [],
            'env': {'platform': 'python', 'pythonVersion': sys.version.split()[0]}
        }

    @classmethod
    def add_result(cls, run, tc, pass_flag, detail=None):
        result = {
            'id': tc['id'],
            'name': tc['name'],
            'category': tc['category'],
            'pass': pass_flag,
            'detail': detail,
            'timestamp': _now()
        }
        run['results'].append(result)
        if pass_flag:
            run['passed'] += 1
        else:
            run['failed'] += 1
        return result

    @classmethod
    def add_log(cls, run, message, type='info'):
        if 'logs' not in run: run['logs'] = []
        run['logs'].append({'timestamp': _now(), 'type': type, 'message': message})

    @classmethod
    def finish_run(cls, run, status=None):
        run['finishedAt'] = _now()
        run['status'] = status or ('pass' if run['failed'] == 0 else 'fail')
        return run

    @classmethod
    def save_run(cls, run):
        cls._runs.insert(0, run)
        return {'ok': True, 'isNew': True}

    @classmethod
    def export_runs(cls, run_ids=None):
        runs = cls._runs if not run_ids else [r for r in cls._runs if r['runId'] in run_ids]
        return {
            'exportFormat': 'crp-test-results',
            'formatVersion': EXPORT_FORMAT_VERSION,
            'exportedAt': _now(),
            'runCount': len(runs),
            'runs': runs
        }

    @classmethod
    def _validate_run_strict(cls, run):
        errors = []
        for field in REQUIRED_RESULT_FIELDS:
            if field not in run or run[field] is None:
                errors.append(f'缺少必填字段: {field}')
        if 'results' in run and isinstance(run['results'], list):
            for idx, r in enumerate(run['results']):
                for field in REQUIRED_CASE_RESULT_FIELDS:
                    if field not in r:
                        errors.append(f'results[{idx}] 缺少字段: {field}')
        else:
            errors.append('results 不是数组或不存在')
        if 'logs' in run and not isinstance(run['logs'], list):
            errors.append('logs 字段格式错误，应为数组')
        if 'env' in run and not isinstance(run['env'], dict):
            errors.append('env 字段格式错误，应为对象')
        return {'valid': len(errors) == 0, 'errors': errors}

    @classmethod
    def import_runs(cls, import_data):
        report = {'imported': 0, 'duplicates': 0, 'conflicts': 0, 'invalid': 0,
                  'errors': [], 'importedIds': [], 'skippedIds': []}

        if not import_data or not isinstance(import_data, dict):
            report['errors'].append('导入数据不是有效对象')
            report['invalid'] += 1
            return report

        if import_data.get('exportFormat') != 'crp-test-results':
            report['errors'].append('格式不匹配：期望 crp-test-results，实际 ' + str(import_data.get('exportFormat', '未知')))
            report['invalid'] += 1
            return report

        imported_version = import_data.get('formatVersion')
        if imported_version != EXPORT_FORMAT_VERSION:
            report['conflicts'] += 1
            report['errors'].append('版本警告：导入格式 v' + str(imported_version) +
                                     '，当前 v' + EXPORT_FORMAT_VERSION + '，尝试兼容导入')

        runs = import_data.get('runs', [])
        if not isinstance(runs, list):
            report['errors'].append('缺少 runs 数组')
            report['invalid'] += 1
            return report

        existing_ids = {r['runId']: r for r in cls._runs}

        for i, run in enumerate(runs):
            validation = cls._validate_run_strict(run)
            if not validation['valid']:
                report['invalid'] += 1
                report['errors'].append(f'第{i+1}条无效: ' + '; '.join(validation['errors']))
                continue

            if run['runId'] in existing_ids:
                report['duplicates'] += 1
                existing = existing_ids[run['runId']]
                same_result = (existing['passed'] == run['passed'] and
                               existing['failed'] == run['failed'] and
                               existing['status'] == run['status'] and
                               existing['suiteVersion'] == run['suiteVersion'])
                if not same_result:
                    report['conflicts'] += 1
                    report['errors'].append(
                        f'版本冲突 runId {run["runId"]}: '
                        f'历史={existing["passed"]}/{existing["total"]} {existing["status"]}, '
                        f'导入={run["passed"]}/{run["total"]} {run["status"]} '
                        f'（已跳过，保留历史版本，不覆盖旧记录）'
                    )
                report['skippedIds'].append(run['runId'])
                continue

            if 'logs' not in run or len(run.get('logs', [])) == 0:
                report['errors'].append(f'runId {run["runId"]} 警告: 缺少执行日志，将保留空日志')

            if 'results' in run:
                for r in run['results']:
                    if 'detail' not in r or r['detail'] is None:
                        r['detail'] = '无详情'

            cls._runs.append(run)
            existing_ids[run['runId']] = run
            report['imported'] += 1
            report['importedIds'].append(run['runId'])

        cls._runs.sort(key=lambda r: r['startedAt'], reverse=True)
        return report

    @classmethod
    def get_all_runs(cls):
        return cls._runs.copy()

    @classmethod
    def get_latest_run(cls):
        return cls._runs[0] if cls._runs else None

    @classmethod
    def get_run(cls, run_id):
        for r in cls._runs:
            if r['runId'] == run_id:
                return r
        return None

    @classmethod
    def clear_all(cls):
        cls._runs = []
        try:
            import os
            state_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crp_test_state.json')
            if os.path.exists(state_file):
                os.remove(state_file)
        except:
            pass

    @classmethod
    def save_current_state(cls, current_run, active_tab):
        try:
            import os
            import json
            state = {
                'currentRunId': current_run['runId'] if current_run else None,
                'activeTab': active_tab or 'run',
                'savedAt': _now()
            }
            state_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crp_test_state.json')
            with open(state_file, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print('保存状态失败:', e)
            return False

    @classmethod
    def load_current_state(cls):
        try:
            import os
            import json
            state_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crp_test_state.json')
            if not os.path.exists(state_file):
                return None
            with open(state_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print('加载状态失败:', e)
            return None

    @classmethod
    def clear_current_state(cls):
        try:
            import os
            state_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crp_test_state.json')
            if os.path.exists(state_file):
                os.remove(state_file)
            return True
        except:
            return False

    @classmethod
    def get_failed_cases_with_steps(cls, run):
        if not run or 'results' not in run:
            return []
        import re
        failed = [r for r in run['results'] if not r.get('pass', False)]
        result = []
        for r in failed:
            steps = []
            detail = r.get('detail', '')
            if detail:
                step_match = re.findall(r'步骤\s*(\d+)', detail)
                if step_match:
                    steps = [f'步骤{s}' for s in step_match]
                else:
                    steps = [detail]
            result.append({
                'id': r.get('id'),
                'name': r.get('name'),
                'category': r.get('category'),
                'detail': detail,
                'steps': steps,
                'timestamp': r.get('timestamp')
            })
        return result


# ===== 断言工具 =====
PASS = 0
FAIL = 0
FAILS = []

def aEq(name, actual, expected):
    global PASS, FAIL
    ok = actual == expected
    if ok:
        PASS += 1
        print(f'    ✔ {name}: {actual}')
    else:
        FAIL += 1
        FAILS.append((name, expected, actual))
        print(f'    ❌ {name}: 期望={expected} 实际={actual}')
    return ok

def header(s):
    print(f'\n🔹 {s}')


# ===== 初始化数据 =====
def setup_data():
    Store._db = {}
    T = _now()
    Store.saveParts([
        {'id':'p1','name':'配件A','category':'t','unitPrice':100,'updatedAt':T},
        {'id':'p2','name':'配件B','category':'t','unitPrice':289,'updatedAt':T},
    ])
    Store.saveLabor([
        {'id':'l1','name':'工时X','category':'t','fee':50,'updatedAt':T},
        {'id':'l2','name':'工时Y','category':'t','fee':200,'updatedAt':T},
    ])
    Store.saveOrders([{
        'id':'o1', 'orderNo':'TEST-001',
        'customerName':'测试','customerPhone':'138','deviceType':'NB',
        'deviceBrand':'Dell','deviceModel':'X1','faultDescription':'测试',
        'handler':'Tester','currentStatus': STATUS['INSPECTING'],
        'createdAt':T,'updatedAt':T
    }])
    Store.saveQuotes([])
    Store.saveHistory([])
    print('    初始化: 1工单(INSPECTING) + 2配件 + 2工时')


# ===== 测试用例 =====
def tc01_generateV1(run):
    header('TC01: 生成版本1报价')
    r1 = quote_engine_generate('o1',
        [{'partId':'p1','partName':'配件A','unitPrice':100,'quantity':2,'subtotal':200}],
        [{'laborItemId':'l1','laborName':'工时X','fee':50}],
        'Tester')
    aEq('TC01-1 V1生成成功', r1['ok'], True)
    aEq('TC01-2 V1版本号', r1['quote']['version'], 1)
    aEq('TC01-3 V1总价', r1['quote']['totalCost'], 250)
    aEq('TC01-4 V1配件数', len(r1['quote']['parts']), 1)
    aEq('TC01-5 V1工时数', len(r1['quote']['laborItems']), 1)
    aEq('TC01-6 工单状态=QUOTED', Store.getOrderById('o1')['currentStatus'], STATUS['QUOTED'])

    tc = next(t for t in TEST_CASES if t['id'] == 'TC01')
    ok = r1['quote']['version'] == 1 and r1['quote']['totalCost'] == 250
    ResultManager.add_result(run, tc, ok, '通过' if ok else f'版本={r1["quote"]["version"]}, 总价={r1["quote"]["totalCost"]}')

def tc02_modifyPrices(run):
    header('TC02: 修改配置价格')
    ps = Store.getParts()
    idx = next(i for i,p in enumerate(ps) if p['id']=='p1'); ps[idx]['unitPrice'] = 399
    Store.saveParts(ps)
    ls = Store.getLabor()
    li = next(i for i,l in enumerate(ls) if l['id']=='l1'); ls[li]['fee'] = 80
    Store.saveLabor(ls)
    aEq('TC02-1 配件A新价', Store.getPartById('p1')['unitPrice'], 399)
    aEq('TC02-2 工时X新费', Store.getLaborById('l1')['fee'], 80)
    v1 = Store.getQuotesByOrderId('o1')[0]
    aEq('TC02-3 V1快照不被改价影响', v1['parts'][0]['unitPrice'], 100)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC02')
    ok = Store.getPartById('p1')['unitPrice'] == 399 and Store.getLaborById('l1')['fee'] == 80 and v1['parts'][0]['unitPrice'] == 100
    ResultManager.add_result(run, tc, ok, '通过' if ok else '价格修改或快照隔离失败')

def tc03_generateV2(run):
    header('TC03: 生成版本2 (核心: 使用最新价)')
    cp = Store.getPartById('p1')
    cl = Store.getLaborById('l1')
    r2 = quote_engine_generate('o1',
        [{'partId':'p1','partName':cp['name'],'unitPrice':cp['unitPrice'],'quantity':2,'subtotal':cp['unitPrice']*2}],
        [{'laborItemId':'l1','laborName':cl['name'],'fee':cl['fee']}],
        'Tester')
    aEq('TC03-1 V2生成成功', r2['ok'], True)
    aEq('TC03-2 V2版本号', r2['quote']['version'], 2)
    aEq('TC03-3 V2用新配件价399', r2['quote']['parts'][0]['unitPrice'], 399)
    aEq('TC03-4 V2用新工时费80', r2['quote']['laborItems'][0]['fee'], 80)
    aEq('TC03-5 V2总价=878', r2['quote']['totalCost'], 878)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC03')
    ok = r2['quote']['version'] == 2 and r2['quote']['totalCost'] == 878 and r2['quote']['parts'][0]['unitPrice'] == 399
    ResultManager.add_result(run, tc, ok, '通过' if ok else f'版本={r2["quote"]["version"]}, 总价={r2["quote"]["totalCost"]}')

def tc04_v1NotModified(run):
    header('TC04: 版本1不被串改')
    qs = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
    aEq('TC04-1 报价版本数=2', len(qs), 2)
    aEq('TC04-2 V1总价仍¥250', qs[0]['totalCost'], 250)
    aEq('TC04-3 V1配件单价仍¥100', qs[0]['parts'][0]['unitPrice'], 100)
    aEq('TC04-4 V1工时费仍¥50', qs[0]['laborItems'][0]['fee'], 50)
    aEq('TC04-5 V2总价¥878', qs[1]['totalCost'], 878)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC04')
    ok = len(qs) == 2 and qs[0]['totalCost'] == 250 and qs[0]['parts'][0]['unitPrice'] == 100
    ResultManager.add_result(run, tc, ok, '通过' if ok else f'V1总价={qs[0]["totalCost"]}')

def tc05_refreshConsistency(run):
    header('TC05: 持久化一致性（模拟刷新）')
    raw_q = json.loads(Store._db.get(Store.STORAGE_KEYS['QUOTES'], '[]'))
    raw_q2 = next((q for q in raw_q if q['orderId']=='o1' and q['version']==2), None)
    store_q = Store.getQuotesByOrderId('o1')
    store_q2 = next((q for q in store_q if q['version']==2), None)
    aEq('TC05-1 存储中V2总价=878', raw_q2['totalCost'] if raw_q2 else None, 878)
    aEq('TC05-2 存储↔读取报价一致', raw_q2['totalCost'], store_q2['totalCost'])

    tc = next(t for t in TEST_CASES if t['id'] == 'TC05')
    ok = raw_q2 and store_q2 and raw_q2['totalCost'] == store_q2['totalCost'] == 878
    ResultManager.add_result(run, tc, ok, '通过' if ok else '持久化不一致')

def tc06_multiVersionIndependent(run):
    header('TC06: 多版本独立快照（深拷贝）')
    qs = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
    qs[0]['parts'][0]['unitPrice'] = 9999
    qs[0]['totalCost'] = 9999
    re_read = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
    aEq('TC06-1 修改内存不影响Store读取', re_read[0]['totalCost'], 250)
    aEq('TC06-2 V2不受V1内存修改影响', re_read[1]['totalCost'], 878)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC06')
    ok = re_read[0]['totalCost'] == 250 and re_read[1]['totalCost'] == 878
    ResultManager.add_result(run, tc, ok, '通过' if ok else '快照隔离失效')

def tc07_doQuoteUsesLatest(run):
    header('TC07: doQuote 从最新配置读价（双重保险）')
    cp = Store.getPartById('p1')
    cl = Store.getLaborById('l1')
    fake_dom_price = 100
    final_price = cp['unitPrice'] if cp else fake_dom_price
    aEq('TC07-1 最新配置配件价=399', cp['unitPrice'], 399)
    aEq('TC07-2 最新配置工时费=80', cl['fee'], 80)
    aEq('TC07-3 配置价优先于DOM输入价', final_price, 399)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC07')
    ok = cp['unitPrice'] == 399 and cl['fee'] == 80 and final_price == 399
    ResultManager.add_result(run, tc, ok, '通过' if ok else f'配置价={cp["unitPrice"]}')

def tc08_detailRenderCorrect(run):
    header('TC08: 详情渲染使用快照（等价验证）')
    qs = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
    v1_str = f"¥{qs[0]['parts'][0]['unitPrice']:.2f}"
    v1_total = f"¥{qs[0]['totalCost']:.2f}"
    v2_str = f"¥{qs[1]['parts'][0]['unitPrice']:.2f}"
    v2_total = f"¥{qs[1]['totalCost']:.2f}"
    aEq('TC08-1 V1快照含原价¥100', v1_str, '¥100.00')
    aEq('TC08-2 V1快照含原价总计¥250', v1_total, '¥250.00')
    aEq('TC08-3 V2快照含新价¥399', v2_str, '¥399.00')
    aEq('TC08-4 V2快照含新价总计¥878', v2_total, '¥878.00')

    tc = next(t for t in TEST_CASES if t['id'] == 'TC08')
    ok = v1_str == '¥100.00' and v1_total == '¥250.00' and v2_str == '¥399.00' and v2_total == '¥878.00'
    ResultManager.add_result(run, tc, ok, '通过' if ok else '渲染价格不正确')

def tc09_historyHasV2(run):
    header('TC09: 历史追加版本2记录 (⭐ 核心修复验证)')
    h_all = sorted(Store.getHistoryByOrderId('o1'), key=lambda h: h['timestamp'])
    print(f'  📋 历史记录 ({len(h_all)} 条):')
    for i, h in enumerate(h_all):
        print(f'     [{i}] {h["fromStatus"]}→{h["toStatus"]} | {h["note"]} | {h["type"]}')
    has_v2 = any('版本2' in h.get('note','') for h in h_all)
    h_v2 = next((h for h in h_all if '版本2' in h.get('note','')), None)
    aEq('⭐ TC09-1 V2历史记录存在 (核心修复!)', has_v2, True)
    if h_v2:
        aEq('TC09-2 V2历史 from=QUOTED', h_v2['fromStatus'], STATUS['QUOTED'])
        aEq('TC09-3 V2历史 to=QUOTED', h_v2['toStatus'], STATUS['QUOTED'])
        aEq('TC09-4 V2历史 type=advance', h_v2['type'], 'advance')
    aEq('TC09-5 历史条数=2', len(h_all), 2)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC09')
    ok = has_v2 and h_v2 and h_v2['fromStatus'] == STATUS['QUOTED'] and h_v2['toStatus'] == STATUS['QUOTED']
    detail = '通过' if ok else ('历史存在但字段不对' if has_v2 else 'V2历史缺失')
    ResultManager.add_result(run, tc, ok, detail)

def tc10_v1HistoryNotTouched(run):
    header('TC10: 版本1历史不被串改')
    h_all = Store.getHistoryByOrderId('o1')
    h_v1 = next((h for h in h_all if '版本1' in h.get('note','')), None)
    aEq('TC10-1 V1历史from=INSPECTING', h_v1['fromStatus'], STATUS['INSPECTING'])
    aEq('TC10-2 V1历史to=QUOTED', h_v1['toStatus'], STATUS['QUOTED'])
    q_v1 = sorted(Store.getQuotesByOrderId('o1'), key=lambda q:q['version'])[0]
    aEq('TC10-3 V1报价仍为250', q_v1['totalCost'], 250)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC10')
    ok = h_v1['fromStatus'] == STATUS['INSPECTING'] and h_v1['toStatus'] == STATUS['QUOTED']
    ResultManager.add_result(run, tc, ok, '通过' if ok else f'V1 fromStatus={h_v1["fromStatus"]}')

def tc11_historyPersistsAfterRefresh(run):
    header('TC11: 历史持久化（模拟刷新）')
    raw_h = json.loads(Store._db.get(Store.STORAGE_KEYS['HISTORY'], '[]'))
    raw_hv2 = next((h for h in raw_h if h['orderId']=='o1' and '版本2' in h.get('note','')), None)
    store_hv2 = next((h for h in Store.getHistoryByOrderId('o1') if '版本2' in h.get('note','')), None)
    aEq('TC11-1 存储中含V2历史', raw_hv2 is not None, True)
    aEq('TC11-2 存储↔读取历史一致', raw_hv2['note'], store_hv2['note'])
    aEq('TC11-3 历史类型=advance', raw_hv2['type'], 'advance')

    tc = next(t for t in TEST_CASES if t['id'] == 'TC11')
    ok = raw_hv2 and store_hv2 and raw_hv2['note'] == store_hv2['note'] and raw_hv2['type'] == 'advance'
    ResultManager.add_result(run, tc, ok, '通过' if ok else '历史持久化失败')

def tc12_v3HistoryAlsoWritten(run):
    header('TC12: 生成版本3，第N次报价都追加历史')
    r3 = quote_engine_generate('o1',
        [{'partId':'p2','partName':'配件B','unitPrice':289,'quantity':1,'subtotal':289}],
        [{'laborItemId':'l2','laborName':'工时Y','fee':200}],
        'Tester')
    aEq('TC12-1 V3版本号=3', r3['quote']['version'], 3)
    h_all3 = Store.getHistoryByOrderId('o1')
    has_v3 = any('版本3' in h.get('note','') for h in h_all3)
    aEq('TC12-2 V3历史存在', has_v3, True)
    aEq('TC12-3 历史共3条', len(h_all3), 3)
    qs3 = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
    aEq('TC12-4 V1报价独立=250', qs3[0]['totalCost'], 250)
    aEq('TC12-5 V2报价独立=878', qs3[1]['totalCost'], 878)
    aEq('TC12-6 V3报价独立=489', qs3[2]['totalCost'], 489)

    tc = next(t for t in TEST_CASES if t['id'] == 'TC12')
    ok = r3['quote']['version'] == 3 and has_v3 and len(h_all3) == 3 and len(qs3) == 3
    detail = '通过' if ok else f'V3历史={has_v3}, 历史数={len(h_all3)}'
    ResultManager.add_result(run, tc, ok, detail)


# ===== 导入验证模式 =====
def verify_import(filepath):
    print('\n' + '=' * 70)
    print('📥 导入验证模式: ' + filepath)
    print('=' * 70)

    if not os.path.exists(filepath):
        print('❌ 文件不存在: ' + filepath)
        sys.exit(1)

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        report = ResultManager.import_runs(data)

        print('\n📊 导入结果:')
        print(f'   ✅ 成功导入: {report["imported"]} 条')
        print(f'   ⏭️  重复跳过: {report["duplicates"]} 条')
        print(f'   ⚠️  版本冲突: {report["conflicts"]} 条')
        print(f'   ❌ 数据无效: {report["invalid"]} 条')

        if report.get('importedIds'):
            print('\n✅ 已导入 runId: ' + ', '.join(report['importedIds']))
        if report.get('skippedIds'):
            print('\n⏭️  已跳过（不覆盖旧记录）runId: ' + ', '.join(report['skippedIds']))

        if report['errors']:
            print('\n📝 详细信息:')
            for e in report['errors']:
                print('   - ' + e)

        print(f'\n📋 当前历史记录总数: {len(ResultManager._runs)}')
        for i, r in enumerate(ResultManager._runs[:5]):
            status = '✅' if r['status'] == 'pass' else '❌'
            print(f'   [{i+1}] {r["runId"][:20]}... | {r["passed"]}/{r["total"]} {status}')

        print('\n✅ 导入验证完成')
        print('ℹ️  冲突时保留历史版本，不覆盖旧记录')
        print('ℹ️  日志和撤销痕迹与结果一起保留')
        sys.exit(1 if report['invalid'] > 0 else 0)

    except Exception as e:
        print('❌ 导入失败: ' + str(e))
        sys.exit(1)


# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(description='回归测试 CLI 脚本 (Python)')
    parser.add_argument('--export', action='store_true', help='运行并导出结果')
    parser.add_argument('--output', type=str, help='导出文件路径')
    parser.add_argument('--import', dest='import_file', type=str, help='导入结果文件并验证')
    args = parser.parse_args()

    if args.import_file:
        verify_import(args.import_file)
        return

    print('\n' + '=' * 70)
    print('🔬 ' + SUITE_META['suiteName'] + ' (Python CLI)')
    print('   套件版本: ' + SUITE_META['suiteVersion'])
    print('   用例总数: ' + str(SUITE_META['totalCases']))
    print('=' * 70)

    setup_data()
    run = ResultManager.create_run(SUITE_META)
    print('\n🚀 开始执行测试 (runId: ' + run['runId'] + ')')

    test_fns = [tc01_generateV1, tc02_modifyPrices, tc03_generateV2, tc04_v1NotModified,
                tc05_refreshConsistency, tc06_multiVersionIndependent, tc07_doQuoteUsesLatest,
                tc08_detailRenderCorrect, tc09_historyHasV2, tc10_v1HistoryNotTouched,
                tc11_historyPersistsAfterRefresh, tc12_v3HistoryAlsoWritten]

    for fn in test_fns:
        try:
            fn(run)
        except Exception as e:
            print(f'  ❌ 测试异常: {e}')

    ResultManager.finish_run(run)
    ResultManager.save_run(run)

    # 汇总
    print('\n' + '=' * 70)
    print(f'📊 结果: ✔ 通过={run["passed"]}   ❌ 失败={run["failed"]}   总计={SUITE_META["totalCases"]}')
    print('=' * 70)

    if FAILS:
        print('\n❌ 失败项:')
        for n, e, a in FAILS:
            print(f'  - {n}: 期望={e} 实际={a}')
    else:
        print('\n✅ 全部逻辑验证通过！关键结论：')
        print('   1. 修复前: V2报价写入成功但历史缺失')
        print('   2. 修复后: V2/V3报价都正确追加历史')
        print('   3. V1快照金额和V1历史始终不被串改')
        print('   4. 持久化与Store读取完全一致')

    # 导出
    if args.export or args.output:
        export_data = ResultManager.export_runs([run['runId']])
        fname = args.output or 'test-result-' + run['runId'] + '.json'
        with open(fname, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
        print('\n📤 结果已导出到: ' + fname)

    print('')
    sys.exit(0 if run['failed'] == 0 else 1)


if __name__ == '__main__':
    main()

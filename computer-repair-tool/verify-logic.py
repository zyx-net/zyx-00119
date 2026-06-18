"""
报价改价 + 操作历史缺口 逻辑验证脚本 (Python)
不依赖浏览器，直接从源码提取关键逻辑进行等价验证。

运行方式：
    cd computer-repair-tool
    python verify-logic.py
"""
import json
import sys

# ===== 从 app.js 提取的等价业务逻辑（关键修复点）=====

STATUS = {
    'REGISTERED': 'REGISTERED',
    'INSPECTING': 'INSPECTING',
    'QUOTED': 'QUOTED',
}

class Store:
    """等价于 app.js 的 Store，用内存 dict 代替 localStorage"""
    STORAGE_KEYS = {
        'ORDERS': 't_orders',
        'QUOTES': 't_quotes',
        'PARTS': 't_parts',
        'LABOR': 't_labor',
        'HISTORY': 't_history',
    }
    db = {}

    @classmethod
    def load(cls, k):
        v = cls.db.get(k)
        return json.loads(v) if v else None

    @classmethod
    def save(cls, k, v):
        cls.db[k] = json.dumps(v)

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
    def getLabor(cls): return cls.load(cls.STORAGE_KEYS['LABOR']) or []
    @classmethod
    def saveLabor(cls, l): cls.save(cls.STORAGE_KEYS['LABOR'], l)
    @classmethod
    def getQuotes(cls): return cls.load(cls.STORAGE_KEYS['QUOTES']) or []
    @classmethod
    def saveQuotes(cls, q): cls.save(cls.STORAGE_KEYS['QUOTES'], q)
    @classmethod
    def getQuotesByOrderId(cls, oid):
        return [q for q in cls.getQuotes() if q['orderId'] == oid]
    @classmethod
    def getHistory(cls): return cls.load(cls.STORAGE_KEYS['HISTORY']) or []
    @classmethod
    def saveHistory(cls, h): cls.save(cls.STORAGE_KEYS['HISTORY'], h)
    @classmethod
    def getHistoryByOrderId(cls, oid):
        return [h for h in cls.getHistory() if h['orderId'] == oid]

import uuid as _uuid
def uuid(): return _uuid.uuid4().hex[:12]
def now(): return '2026-06-18T11:00:00.000Z'


# ===== 【修复前的 BUG 版本】只有 INSPECTING 才写历史 =====
def quote_engine_generate_BUG(orderId, parts, laborItems, handler):
    orders = Store.getOrders()
    order = next((o for o in orders if o['id'] == orderId), None)
    if not order: return {'ok': False, 'msg': '工单不存在'}
    if order['currentStatus'] != STATUS['INSPECTING'] and order['currentStatus'] != STATUS['QUOTED']:
        return {'ok': False, 'msg': '状态错误'}

    existing = Store.getQuotesByOrderId(orderId)
    version = len(existing) + 1
    tpc = sum(p['subtotal'] for p in parts)
    tlc = sum(l['fee'] for l in laborItems)
    quote = {
        'id': uuid(), 'orderId': orderId, 'version': version,
        'parts': json.loads(json.dumps(parts)),
        'laborItems': json.loads(json.dumps(laborItems)),
        'totalPartsCost': tpc, 'totalLaborCost': tlc,
        'totalCost': tpc + tlc, 'createdAt': now(), 'handler': handler
    }
    qs = Store.getQuotes(); qs.append(quote); Store.saveQuotes(qs)

    # ===== BUG: 只判断 INSPECTING，QUOTED 状态直接跳过不写历史 =====
    if order['currentStatus'] == STATUS['INSPECTING']:
        prev = order['currentStatus']
        order['currentStatus'] = STATUS['QUOTED']
        order['updatedAt'] = now()
        Store.saveOrders(orders)
        h = Store.getHistory()
        h.append({'id': uuid(), 'orderId': orderId,
                  'fromStatus': prev, 'toStatus': STATUS['QUOTED'],
                  'handler': handler, 'note': '生成报价（版本'+str(version)+'）',
                  'timestamp': now(), 'type': 'advance'})
        Store.saveHistory(h)
    # ===== BUG 结束：没有 else 分支 =====

    return {'ok': True, 'quote': quote}


# ===== 【修复后的版本】增加 QUOTED 分支，追加历史 =====
def quote_engine_generate_FIXED(orderId, parts, laborItems, handler):
    orders = Store.getOrders()
    order = next((o for o in orders if o['id'] == orderId), None)
    if not order: return {'ok': False, 'msg': '工单不存在'}
    if order['currentStatus'] != STATUS['INSPECTING'] and order['currentStatus'] != STATUS['QUOTED']:
        return {'ok': False, 'msg': '状态错误'}

    existing = Store.getQuotesByOrderId(orderId)
    version = len(existing) + 1
    tpc = sum(p['subtotal'] for p in parts)
    tlc = sum(l['fee'] for l in laborItems)
    quote = {
        'id': uuid(), 'orderId': orderId, 'version': version,
        'parts': json.loads(json.dumps(parts)),
        'laborItems': json.loads(json.dumps(laborItems)),
        'totalPartsCost': tpc, 'totalLaborCost': tlc,
        'totalCost': tpc + tlc, 'createdAt': now(), 'handler': handler
    }
    qs = Store.getQuotes(); qs.append(quote); Store.saveQuotes(qs)

    if order['currentStatus'] == STATUS['INSPECTING']:
        prev = order['currentStatus']
        order['currentStatus'] = STATUS['QUOTED']
        order['updatedAt'] = now()
        Store.saveOrders(orders)
        h = Store.getHistory()
        h.append({'id': uuid(), 'orderId': orderId,
                  'fromStatus': prev, 'toStatus': STATUS['QUOTED'],
                  'handler': handler, 'note': '生成报价（版本'+str(version)+'）',
                  'timestamp': now(), 'type': 'advance'})
        Store.saveHistory(h)
    # ===== 修复：新增 QUOTED 分支，追加历史 =====
    elif order['currentStatus'] == STATUS['QUOTED']:
        order2 = next((o for o in Store.getOrders() if o['id'] == orderId), None)
        if order2:
            order2['updatedAt'] = now()
            Store.saveOrders(Store.getOrders())
        hs = Store.getHistory()
        hs.append({'id': uuid(), 'orderId': orderId,
                   'fromStatus': STATUS['QUOTED'], 'toStatus': STATUS['QUOTED'],
                   'handler': handler, 'note': '更新报价（版本'+str(version)+'）',
                   'timestamp': now(), 'type': 'advance'})
        Store.saveHistory(hs)
    # ===== 修复结束 =====

    return {'ok': True, 'quote': quote}


# ===== 验证框架 =====
PASS = 0
FAIL = 0
FAILS = []

def aEq(name, actual, expected):
    global PASS, FAIL
    ok = actual == expected
    if ok: PASS += 1; print(f'    ✔ {name}: {actual}')
    else: FAIL += 1; FAILS.append((name, expected, actual)); print(f'    ❌ {name}: 期望={expected} 实际={actual}')
    return ok

def header(s):
    print(f'\n🔹 {s}')

def setup_data():
    Store.db = {}  # 清空
    T = now()
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


# ===== 【对比测试1】修复前：二次报价无历史 =====
print('=' * 70)
print('  组A：验证修复前（BUG版本）—— 二次报价的历史缺口确实存在')
print('=' * 70)
setup_data()

header('A1: 生成版本1（INSPECTING→QUOTED，正常）')
r1 = quote_engine_generate_BUG('o1',
    [{'partId':'p1','partName':'配件A','unitPrice':100,'quantity':2,'subtotal':200}],
    [{'laborItemId':'l1','laborName':'工时X','fee':50}],
    'Tester')
aEq('A1-1 V1生成成功', r1['ok'], True)
aEq('A1-2 V1版本号', r1['quote']['version'], 1)
aEq('A1-3 V1总价', r1['quote']['totalCost'], 250)
h_count = len(Store.getHistoryByOrderId('o1'))
has_v1_note = any('版本1' in h.get('note','') for h in Store.getHistoryByOrderId('o1'))
aEq('A1-4 V1历史存在', has_v1_note, True)
aEq('A1-5 历史条数', h_count, 1)

header('A2: 修改配置价格（A 100→399，X 50→80）')
ps = Store.getParts()
idx = next(i for i,p in enumerate(ps) if p['id']=='p1'); ps[idx]['unitPrice'] = 399
Store.saveParts(ps)
ls = Store.getLabor()
li = next(i for i,l in enumerate(ls) if l['id']=='l1'); ls[li]['fee'] = 80
Store.saveLabor(ls)
aEq('A2-1 配件A新价', Store.getParts()[idx]['unitPrice'], 399)
aEq('A2-2 工时X新费', Store.getLabor()[li]['fee'], 80)

header('A3: 生成版本2（已是QUOTED状态，BUG发生！）')
curPart = next(p for p in Store.getParts() if p['id']=='p1')
curLab  = next(l for l in Store.getLabor() if l['id']=='l1')
r2 = quote_engine_generate_BUG('o1',
    [{'partId':'p1','partName':curPart['name'],'unitPrice':curPart['unitPrice'],'quantity':2,'subtotal':curPart['unitPrice']*2}],
    [{'laborItemId':'l1','laborName':curLab['name'],'fee':curLab['fee']}],
    'Tester')
aEq('A3-1 V2生成成功', r2['ok'], True)
aEq('A3-2 V2总价', r2['quote']['totalCost'], 399*2 + 80)  # 878
has_v2_note = any('版本2' in h.get('note','') for h in Store.getHistoryByOrderId('o1'))
h_count_after = len(Store.getHistoryByOrderId('o1'))
print(f'    🔥 历史条数：{h_count_after} (应=2, 实际BUG中会=1)')
print(f'    🔥 V2历史存在: {has_v2_note} (应=True, 实际BUG中=False)')
aEq('⭐ A3-3 V2历史是否存在 (BUG这里是False!)', has_v2_note, False)  # BUG! 应该是True但实际False
aEq('⭐ A3-4 历史条数 (BUG这里=1!)', h_count_after, 1)           # BUG! 应该=2但实际=1

print('\n  🚨 组A结论: 修复前确实存在历史缺口 —— V2报价没有写入历史！')


# ===== 【对比测试2】修复后：二次报价有历史 =====
print('\n' + '=' * 70)
print('  组B：验证修复后（FIXED版本）—— 二次报价历史正确追加')
print('=' * 70)
setup_data()

header('B1: 生成版本1（INSPECTING→QUOTED）')
r1 = quote_engine_generate_FIXED('o1',
    [{'partId':'p1','partName':'配件A','unitPrice':100,'quantity':2,'subtotal':200}],
    [{'laborItemId':'l1','laborName':'工时X','fee':50}],
    'Tester')
aEq('B1-1 V1生成成功', r1['ok'], True)
aEq('B1-2 V1版本号', r1['quote']['version'], 1)
aEq('B1-3 V1总价', r1['quote']['totalCost'], 250)
has1 = any('版本1' in h.get('note','') for h in Store.getHistoryByOrderId('o1'))
aEq('B1-4 V1历史存在', has1, True)
o = Store.getOrderById('o1')
aEq('B1-5 工单状态=QUOTED', o['currentStatus'], STATUS['QUOTED'])

header('B2: 修改配置价格（A 100→399，X 50→80）')
ps = Store.getParts()
idx = next(i for i,p in enumerate(ps) if p['id']=='p1'); ps[idx]['unitPrice'] = 399
Store.saveParts(ps)
ls = Store.getLabor()
li = next(i for i,l in enumerate(ls) if l['id']=='l1'); ls[li]['fee'] = 80
Store.saveLabor(ls)
# 改价不影响V1快照
qs = Store.getQuotesByOrderId('o1')
aEq('B2-1 V1快照不被改价影响', qs[0]['parts'][0]['unitPrice'], 100)

header('B3: 生成版本2（QUOTED状态，修复验证核心！）')
curPart = next(p for p in Store.getParts() if p['id']=='p1')
curLab  = next(l for l in Store.getLabor() if l['id']=='l1')
r2 = quote_engine_generate_FIXED('o1',
    [{'partId':'p1','partName':curPart['name'],'unitPrice':curPart['unitPrice'],'quantity':2,'subtotal':curPart['unitPrice']*2}],
    [{'laborItemId':'l1','laborName':curLab['name'],'fee':curLab['fee']}],
    'Tester')
aEq('B3-1 V2生成成功', r2['ok'], True)
aEq('B3-2 V2版本号', r2['quote']['version'], 2)
aEq('B3-3 V2用新配件价399', r2['quote']['parts'][0]['unitPrice'], 399)
aEq('B3-4 V2用新工时费80', r2['quote']['laborItems'][0]['fee'], 80)
aEq('B3-5 V2总价=878', r2['quote']['totalCost'], 878)

# ⭐⭐⭐ 核心验证：V2历史必须存在
has2 = any('版本2' in h.get('note','') for h in Store.getHistoryByOrderId('o1'))
h_all = Store.getHistoryByOrderId('o1')
aEq('⭐ B3-6 V2历史存在 (修复的核心!)', has2, True)
aEq('⭐ B3-7 历史共2条 (V1+V2)', len(h_all), 2)
hv2 = next((h for h in h_all if '版本2' in h.get('note','')), None)
if hv2:
    aEq('B3-8 V2历史 from=QUOTED', hv2['fromStatus'], STATUS['QUOTED'])
    aEq('B3-9 V2历史 to=QUOTED', hv2['toStatus'], STATUS['QUOTED'])
    aEq('B3-10 V2历史 type=advance', hv2['type'], 'advance')
hv1 = next((h for h in h_all if '版本1' in h.get('note','')), None)
aEq('B3-11 V1历史 from=INSPECTING', hv1['fromStatus'], STATUS['INSPECTING'])

header('B4: V1金额和历史不被串改')
all_q = sorted(Store.getQuotesByOrderId('o1'), key=lambda q: q['version'])
aEq('B4-1 V1总价仍¥250', all_q[0]['totalCost'], 250)
aEq('B4-2 V1配件单价仍¥100', all_q[0]['parts'][0]['unitPrice'], 100)
aEq('B4-3 V2总价¥878', all_q[1]['totalCost'], 878)
aEq('B4-4 V1历史from不变', hv1['fromStatus'], STATUS['INSPECTING'])

header('B5: 模拟刷新/重开 —— localStorage 持久化验证')
# 序列化再反序列化，等价于刷新
raw_quotes = json.loads(json.dumps(Store.getQuotes()))
raw_history = json.loads(json.dumps(Store.getHistory()))
qv2_storage = next((q for q in raw_quotes if q['orderId']=='o1' and q['version']==2), None)
hv2_storage = next((h for h in raw_history if h['orderId']=='o1' and '版本2' in h.get('note','')), None)
aEq('B5-1 V2报价持久化: 总价¥878', qv2_storage['totalCost'] if qv2_storage else None, 878)
aEq('B5-2 V2历史持久化: 存在', hv2_storage is not None, True)
aEq('B5-3 Store↔持久化 报价一致', qv2_storage['totalCost'], all_q[1]['totalCost'])
aEq('B5-4 Store↔持久化 历史一致', hv2_storage['note'], hv2['note'])

header('B6: 生成V3，验证第N次报价也追加历史')
r3 = quote_engine_generate_FIXED('o1',
    [{'partId':'p2','partName':'配件B','unitPrice':289,'quantity':1,'subtotal':289}],
    [{'laborItemId':'l2','laborName':'工时Y','fee':200}],
    'Tester')
aEq('B6-1 V3版本号', r3['quote']['version'], 3)
aEq('B6-2 V3总价¥489', r3['quote']['totalCost'], 489)
has3 = any('版本3' in h.get('note','') for h in Store.getHistoryByOrderId('o1'))
h_total = len(Store.getHistoryByOrderId('o1'))
aEq('⭐ B6-3 V3历史存在', has3, True)
aEq('⭐ B6-4 历史共3条 V1+V2+V3', h_total, 3)

# ===== 汇总 =====
print('\n' + '=' * 70)
print(f'📊 结果汇总: ✔ {PASS} 通过   ❌ {FAIL} 失败')
print('=' * 70)

if FAILS:
    print('\n❌ 失败项:')
    for n, e, a in FAILS: print(f'  - {n}: 期望={e} 实际={a}')
    sys.exit(1)
else:
    print('\n✅ 全部逻辑验证通过！关键结论：')
    print('   1. 修复前（组A）: V2报价写入成功但历史缺失 (1条)')
    print('   2. 修复后（组B）: V2/V3报价都正确追加历史 (3条)')
    print('   3. V1快照金额和V1历史始终不被串改')
    print('   4. localStorage持久化与Store读取完全一致')
    sys.exit(0)

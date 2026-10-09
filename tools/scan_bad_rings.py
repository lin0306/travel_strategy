"""
区边界文件里**走丢的多边形**（stray ring）的扫描 / 清理。

## 症状：一个区的轮廓有一半在半省之外
腾讯 `getchildren(polygon=1)` 偶尔返回一个错的多边形成员。实测天津 120102 河东区
的第 2 个环质心落在 **438 km 之外**的邢台一带，而正常的多环互相都在 20 km 内。
它同时污染两件事：

- **入口取景**：`loadCityBox` 取所有环外接框的并集 —— 一个 438km 的坏环把天津的框
  从 1.5° 拉到 4.3°，省级页一进门镜头落在河北，天津被甩到屏幕边上。
- **构建期归区**：`assign_district` 的"点在多边形"会把落在那个错误多边形里的点
  判成属于这个区。收录之前发现不算晚，收录之后就是悄悄错的数据。

## 判据是踩出来的三条
① **不能只算"环质心到区中心的距离"**：大片县域（阿拉善、和田）的行政中心（政府驻地）
   与几何质心天然差几十公里，照这一条判会把主干多边形一起删掉 ——
   **一个环都不剩比留着坏环更糟**（那个区从此既没面也没框）。
② **不能两边都判坏**（相对距离是对称的）—— 否则 `keep` 为空，改动退化成"什么都不删"。
   必须回答"留哪一边"。
③ 所以：先按 <50 km 做**单链聚类**，再算各簇到**区政府驻地**的最近距离，
   **丢掉超过 100 km 的簇**，并**永远至少留住最近那一簇**。

用法：python _tmp/scan_bad_rings.py [--ap]
  --ap  真的写回清理（默认只报告）
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'data' / '_generated' / 'districts'
SUB = ROOT / 'data' / '_generated' / 'subdistricts'

#: 单链聚类的邻域半径（km）—— 同一个区的各块在这个距离内算一簇
CLUSTER_KM = 50.0
#: 簇到区政府驻地超过这个距离才算"远"
STRAY_KM = 100.0
#: ★★ 真正的判据是**同城尺度**：把本城所有区两两之间的典型距离（90 分位）当尺子，
#    只有比它还要远好几倍的那块才算走丢。
#    · 天津 436 km，而天津各区之间最多一百来公里 → 明显错了
#    · 三沙各区之间本来就是几百公里（辖整个南海）→ 那是真的，一个都不许删
#    · 巴州、海西这类西部大市同理
SCALE_FACTOR = 3.0


def km_d(lng0, lat0, lng1, lat1):
    """粗略球面距离（判定量级是上百公里，平面近似足够）"""
    return math.hypot((lng0 - lng1) * 96.0, (lat0 - lat1) * 111.0)


def centroid_of(ring):
    xs = ring[0::2]
    ys = ring[1::2]
    if not xs:
        return None
    return sum(xs) / len(xs), sum(ys) / len(ys)


def min_dist_to_point(rings, pt):
    """这一簇的所有顶点到某点的最近距离"""
    best = float('inf')
    for r in rings:
        xs = r[0::2]
        ys = r[1::2]
        for i in range(len(xs)):
            d = km_d(xs[i], ys[i], pt[0], pt[1])
            if d < best:
                best = d
    return best


def city_scale_km(centers):
    """同城各区两两距离的 **90 分位** —— "这座城市有多大"的一把通用尺子"""
    pts = list(centers.values())
    if len(pts) < 2:
        return 0.0
    ds = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            ds.append(km_d(pts[i][0], pts[i][1], pts[j][0], pts[j][1]))
    ds.sort()
    idx = int(len(ds) * 0.9)
    return ds[min(idx, len(ds) - 1)]


def span_km(rings):
    """这一簇的外接框对角线（km）—— 用来回答"主体本身有多大" """
    xs: list[float] = []
    ys: list[float] = []
    for r in rings:
        xs.extend(r[0::2])
        ys.extend(r[1::2])
    if not xs:
        return 0.0
    return math.hypot((max(xs) - min(xs)) * 96.0, (max(ys) - min(ys)) * 111.0)


def cluster_rings(rings):
    """单链聚类：两簇质心距离 < CLUSTER_KM 就并入同一簇。返回 [[ring, ...], ...]"""
    left = list(rings)
    centroids = [centroid_of(r) for r in rings]
    groups = []
    while left:
        seed = left.pop(0)
        ce_seed = centroids[rings.index(seed)]
        group = [seed]
        changed = True
        while changed:
            changed = False
            for r in list(left):
                ce = centroids[rings.index(r)]
                if ce is None or ce_seed is None:
                    continue
                if km_d(ce[0], ce[1], ce_seed[0], ce_seed[1]) < CLUSTER_KM:
                    group.append(r)
                    left.remove(r)
                    changed = True
        groups.append(group)
    return groups


def main() -> int:
    apply_fix = '--ap' in sys.argv

    n_files = 0
    n_dropped = 0
    rows = []

    for geo in sorted(DIST.glob('*.geo.json')):
        adcode = geo.name.split('.')[0]
        data = json.loads(geo.read_text(encoding='utf-8'))
        polys = data.get('polygons') or {}
        if not polys:
            continue

        # 区政府驻地 = 权威参考点（分片里那个 `center` 就是接口给的中心）
        centers: dict[str, tuple[float, float]] = {}
        sub_file = SUB / f'{adcode}.json'
        if sub_file.exists():
            sub = json.loads(sub_file.read_text(encoding='utf-8'))
            for c in sub.get('children') or []:
                ctr = c.get('center') or {}
                if ctr.get('lng') is not None:
                    centers[str(c.get('adcode'))] = (ctr['lng'], ctr['lat'])

        dirty = False
        for dcode, rings in polys.items():
            if len(rings) < 2:
                continue
            groups = cluster_rings(rings)
            if len(groups) < 2:
                continue
            center = centers.get(str(dcode))
            if not center:
                continue

            scored = sorted(((min_dist_to_point(g, center), g) for g in groups), key=lambda t: t[0])
            city_scale = city_scale_km(centers)
            threshold = max(STRAY_KM, SCALE_FACTOR * city_scale)
            kept = [scored[0][1]]
            dropped = []
            for d, g in scored[1:]:
                if d > threshold:
                    dropped.append((round(d, 1), sum(len(r) // 2 for r in g)))
                else:
                    kept.append(g)

            if not dropped:
                continue
            n_dropped += len(dropped)
            rows.append((adcode, data.get('name') or '', str(dcode), dropped))
            if apply_fix:
                polys[str(dcode)] = [r for g in kept for r in g]
                dirty = True

        if apply_fix and dirty:
            n_files += 1
            geo.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    print(f'聚类半径 {CLUSTER_KM} km · 阈值 max({STRAY_KM} km, {SCALE_FACTOR}× 同城区间距的 90 分位)')
    print(f'共 {len(rows)} 个区里有 {n_dropped} 块跑丢的多边形\n')
    for adcode, name, dcode, dropped in rows:
        ds = ' / '.join(f'{d} km·{n}点' for d, n in dropped)
        print(f'  {adcode} {name} · {dcode}：丢掉的块 {ds}')
    if apply_fix:
        print(f'\n✅ 已写回 {n_files} 个文件（去掉 {n_dropped} 块走丢的多边形）')
    else:
        print('\n（只报告。加 --ap 真的清理）')
    return 0


if __name__ == '__main__':
    sys.exit(main())

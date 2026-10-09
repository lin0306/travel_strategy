/**
 * 34 个省级单位清单 —— 用于预渲染省级路由。
 *
 * 两条必须说清的事：
 *
 * 1. **这里只放 adcode 与名称，不放任何边界几何。**
 *    省 / 市轮廓**只能**来自腾讯 District 服务 —— 这是国家版图完整性问题
 *    （台湾、藏南、南海诸岛的表达），属于《地图管理条例》范畴。
 *    严禁引入任何第三方 GeoJSON。
 *
 * 2. **34 个一个都不能少，且必须含中国台湾 / 中国香港 / 中国澳门。**
 *    把清单写死在代码里，正是为了让"缺一个"变成显式错误而不是静默遗漏：
 *    `scripts/validate.py` 会断言本数组长度为 34。
 */

export interface ProvinceEntry {
  adcode: string
  /** 简称，用于地图标注（"内蒙古"） */
  name: string
  /** 全称，用于 SEO 标题（"内蒙古自治区"） */
  fullname: string
}

export const PROVINCES: ProvinceEntry[] = [
  { adcode: '110000', name: '北京', fullname: '北京市' },
  { adcode: '120000', name: '天津', fullname: '天津市' },
  { adcode: '130000', name: '河北', fullname: '河北省' },
  { adcode: '140000', name: '山西', fullname: '山西省' },
  { adcode: '150000', name: '内蒙古', fullname: '内蒙古自治区' },
  { adcode: '210000', name: '辽宁', fullname: '辽宁省' },
  { adcode: '220000', name: '吉林', fullname: '吉林省' },
  { adcode: '230000', name: '黑龙江', fullname: '黑龙江省' },
  { adcode: '310000', name: '上海', fullname: '上海市' },
  { adcode: '320000', name: '江苏', fullname: '江苏省' },
  { adcode: '330000', name: '浙江', fullname: '浙江省' },
  { adcode: '340000', name: '安徽', fullname: '安徽省' },
  { adcode: '350000', name: '福建', fullname: '福建省' },
  { adcode: '360000', name: '江西', fullname: '江西省' },
  { adcode: '370000', name: '山东', fullname: '山东省' },
  { adcode: '410000', name: '河南', fullname: '河南省' },
  { adcode: '420000', name: '湖北', fullname: '湖北省' },
  { adcode: '430000', name: '湖南', fullname: '湖南省' },
  { adcode: '440000', name: '广东', fullname: '广东省' },
  { adcode: '450000', name: '广西', fullname: '广西壮族自治区' },
  { adcode: '460000', name: '海南', fullname: '海南省' },
  { adcode: '500000', name: '重庆', fullname: '重庆市' },
  { adcode: '510000', name: '四川', fullname: '四川省' },
  { adcode: '520000', name: '贵州', fullname: '贵州省' },
  { adcode: '530000', name: '云南', fullname: '云南省' },
  { adcode: '540000', name: '西藏', fullname: '西藏自治区' },
  { adcode: '610000', name: '陕西', fullname: '陕西省' },
  { adcode: '620000', name: '甘肃', fullname: '甘肃省' },
  { adcode: '630000', name: '青海', fullname: '青海省' },
  { adcode: '640000', name: '宁夏', fullname: '宁夏回族自治区' },
  { adcode: '650000', name: '新疆', fullname: '新疆维吾尔自治区' },
  // ★ 以下三个必须存在，不得缺失（合规红线）
  { adcode: '710000', name: '台湾', fullname: '台湾省' },
  { adcode: '810000', name: '香港', fullname: '香港特别行政区' },
  { adcode: '820000', name: '澳门', fullname: '澳门特别行政区' },
]

export const PROVINCE_ADCODES: string[] = PROVINCES.map((p) => p.adcode)

const BY_ADCODE = new Map(PROVINCES.map((p) => [p.adcode, p]))

export function findProvince(adcode: string): ProvinceEntry | undefined {
  return BY_ADCODE.get(adcode)
}

/** 直辖市与港澳：省级下**直接是区级**，没有第二级结构。下钻时不能因此报错 */
export const MUNICIPALITY_ADCODES = new Set(['110000', '120000', '310000', '500000', '810000', '820000'])

/** 中国范围内非行政区划区域（如东海 999999）：过滤掉，不入树、不显示 */
export const NON_DISTRICT_ADCODE = '999999'

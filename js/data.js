/**
 * data.js - 小说数据、章节内容和音色数据
 * AI 有声小说播放器
 */

// ============ 音色数据（图4） ============
const VOICE_DATA = [
  { id: 'voice-1', name: '软萌萝莉', color: '#E8D5F5', downloaded: true },
  { id: 'voice-2', name: '萌娃童声', color: '#D5E8F5', downloaded: true },
  { id: 'voice-3', name: '深沉大叔', color: '#E0E0E0', downloaded: true },
  { id: 'voice-4', name: '温柔少年', color: '#D5F0E8', downloaded: true },
  { id: 'voice-5', name: '清朗男声', color: '#F0E8D5', downloaded: false },
  { id: 'voice-6', name: '成熟男声', color: '#E8E0D5', downloaded: false },
  { id: 'voice-7', name: '温柔女声', color: '#F5D5E8', downloaded: true },
  { id: 'voice-8', name: '清冷女声', color: '#D5E8F0', downloaded: false },
  { id: 'voice-9', name: '标准男声', color: '#E8E8E8', downloaded: false },
  { id: 'voice-10', name: '东北女声', color: '#F0E8D5', downloaded: true }
];

// ============ 书籍数据 ============
const BOOKS_DATA = [
  {
    id: 'book-1',
    title: '剑来',
    author: '烽火戏诸侯',
    coverColor: '#2C3E50',
    progress: 67,
    description: '大千世界，无奇不有。我陈平安，唯有一剑，可搬山，倒海，降妖，镇魔，敕神，摘星，断江，摧城，开天！',
    chapters: [
      { id: 'c1', title: '第一章 少年' },
      { id: 'c2', title: '第二章 泥瓶巷' },
      { id: 'c3', title: '第三章 老槐树' },
      { id: 'c4', title: '第四章 四境' },
      { id: 'c5', title: '第五章 机缘' },
      { id: 'c6', title: '第六章 剑气' }
    ]
  },
  {
    id: 'book-2',
    title: '雪中悍刀行',
    author: '烽火戏诸侯',
    coverColor: '#8B0000',
    progress: 42,
    description: '北凉王府，世子徐凤年，不愿坐以待毙，毅然踏上了江湖路。',
    chapters: [
      { id: 'c2-1', title: '第一章 北凉' },
      { id: 'c2-2', title: '第二章 世子' },
      { id: 'c2-3', title: '第三章 江湖' }
    ]
  },
  {
    id: 'book-3',
    title: '大奉打更人',
    author: '卖报小郎君',
    coverColor: '#4A6741',
    progress: 88,
    description: '穿越成狱卒，掌握仙术，破案如神，大奉京城从此多了一个传说。',
    chapters: [
      { id: 'c3-1', title: '第一章 狱卒' },
      { id: 'c3-2', title: '第二章 仙术' },
      { id: 'c3-3', title: '第三章 破案' }
    ]
  },
  {
    id: 'book-4',
    title: '凡人修仙传',
    author: '忘语',
    coverColor: '#2E4057',
    progress: 15,
    description: '一个普通的山村少年，偶然踏入修仙之门，从此开启了一段传奇。',
    chapters: [
      { id: 'c4-1', title: '第一章 山村少年' },
      { id: 'c4-2', title: '第二章 七玄门' },
      { id: 'c4-3', title: '第三章 修仙' }
    ]
  },
  {
    id: 'book-5',
    title: '斗破苍穹',
    author: '天蚕土豆',
    coverColor: '#6B3A2A',
    progress: 0,
    description: '三十年河东三十年河西，莫欺少年穷！',
    chapters: [
      { id: 'c5-1', title: '第一章 陨落的天才' },
      { id: 'c5-2', title: '第二章 纳兰嫣然' },
      { id: 'c5-3', title: '第三章 药老' }
    ]
  }
];

// ============ 章节内容（示例文本） ============
const CHAPTER_CONTENT = {
  // === 剑来 第一章 ===
  'c1': {
    title: '第一章 少年',
    paragraphs: [
      '天色尚未完全放亮，濛濛亮的晨光中，一个瘦弱少年蹲在井边，捧起冰凉的井水洗了把脸。',
      '少年名叫陈平安，今年十五岁，是泥瓶巷最穷的人家出身。父母早亡，留给他只有这三间漏雨的破屋和一口老井。',
      '"今天要去龙窑开工了。"陈平安自言自语，用粗糙的袖口擦干脸上的水珠。',
      '泥瓶巷在泥瓶城的最东边，这里住着的都是城中最穷苦的人。巷子狭窄而曲折，两旁的墙壁上爬满了青苔，脚下的石板路坑坑洼洼，积着昨夜的雨水。',
      '陈平安走出巷口，拐上了通往龙窑的大道。路上已经有不少赶着去上工的窑工，都是些面色黝黑、双手粗糙的汉子。',
      '"平安！"身后传来一个熟悉的声音。',
      '陈平安回头，看到一个身材魁梧的中年汉子大步走来，正是龙窑的工头刘师傅。',
      '"刘师傅早。"陈平安恭敬地喊了一声。',
      '刘师傅走到他身边，打量了他一眼，叹了口气："你这孩子，年纪轻轻就来做这种苦力活。也罢，龙窑虽然辛苦，但总不会亏待你。"',
      '陈平安点点头。他知道这份工作来之不易，是隔壁王婶帮他求来的。龙窑的工钱虽然不多，但至少能让他吃上饱饭。',
      '两人并肩走着，刘师傅忽然压低声音说："平安，听说最近城外不太平，有妖兽作乱。你晚上别到处乱跑。"',
      '"妖兽？"陈平安愣了一下。',
      '"是啊，据说是从骊珠洞天跑出来的。"刘师傅摇摇头，"那些高高在上的神仙老爷们的事，我们这些凡人管不了。还是老老实实烧我们的窑吧。"',
      '陈平安没有再说话，但他的心里却泛起了波澜。骊珠洞天，那是传说中的地方，听说那里住着仙人，有数不尽的机缘和宝物。',
      '龙窑到了，远远就能看到那巨大的窑口像一头卧伏的巨兽，吞吐着灼热的气息。窑工们已经开始忙碌起来，有的在搬运泥坯，有的在检查窑火。',
      '陈平安深吸一口气，走了进去。他不知道的是，命运的车轮已经从今天开始悄然转动，而他，将成为这个大时代中最耀眼的那颗星辰。',
      '"和他们废话作甚？那陈平安不过是个泥瓶巷的穷小子罢了。"一个不屑的声音从窑口深处传来。',
      '陈平安脚步一顿，但随即又若无其事地继续往前走。这样的话他听得太多了，早就学会了充耳不闻。',
      '男子身姿高大匀称，一袭白衣如雪，长发披肩，腰悬三尺青锋。他静静站在远处的屋檐上，俯瞰着整个龙窑，目光落在了那个瘦弱的少年身上。',
      '"有点意思。"白衣男子嘴角微微上扬，身形一晃，便消失在了晨光之中。',
      '而此时，没有人注意到，那头巨大的老槐树底下，一枚古朴的玉佩正在微微发光，像是感应到了什么。',
      '陈平安走到自己的工位前，卷起袖子，开始了一天的工作。汗水很快浸湿了他的后背，但他的眼神却异常坚定。',
      '他知道，想要改变命运，就必须先活下来。而活下来，就需要这份工作。',
      '只是他不知道，在不远的将来，一场席卷整个天地的风暴即将来临，而他，将站在风暴的中心。'
    ]
  },
  // === 剑来 第二章 ===
  'c2': {
    title: '第二章 泥瓶巷',
    paragraphs: [
      '傍晚时分，陈平安拖着疲惫的身子回到泥瓶巷。',
      '夕阳的余晖洒在巷子里，给斑驳的墙壁镀上了一层金色。空气中飘着各家各户的饭菜香，让他的肚子不争气地叫了起来。',
      '"平安回来了？"隔壁的王婶端着一碗热粥走出来，"来，喝碗粥，今天刚熬的。"',
      '陈平安接过粥碗，感激地说："谢谢王婶。"',
      '"谢什么，你爹娘走得早，我不照顾你谁照顾你。"王婶叹了口气，"今天在龙窑还好吧？"',
      '"还好，刘师傅很照顾我。"陈平安一边喝粥一边说。',
      '"那就好。"王婶点点头，忽然压低声音说："平安，你知道吗？今天城里来了个白衣剑客，听说是个仙人！"',
      '陈平安手里的勺子顿了一下。他想起了早上看到的那个人影。',
      '"好多人都去看了，说是那剑客在找人。"王婶继续说道，"你说他找谁呢？咱们这种小地方，能有什么值得仙人找的？"',
      '陈平安没有说话，只是埋头喝粥。但他心里却隐隐有一种感觉——那个白衣剑客，和他有关。',
      '这种感觉没有任何来由，却异常强烈。',
      '夜深了，陈平安躺在床上，久久不能入睡。月光透过破窗洒进来，在地上投下一片银白。',
      '他翻了个身，忽然看到枕头下透出微微的光芒。',
      '陈平安心中一紧，伸手摸去，触碰到一件温润的东西。他拿起来一看，是一枚古朴的玉佩，上面刻着他看不懂的纹路。',
      '"这是……"他愣住了，这不是他的东西。',
      '玉佩散发着柔和的光芒，在他掌心中微微发烫。陈平安忽然想起，今天在老槐树下休息时，似乎看到什么东西闪了一下。',
      '原来如此。',
      '他不知道这意味着什么，但直觉告诉他，这枚玉佩不简单。',
      '窗外的月光忽然暗了一下，一个修长的身影出现在窗外。',
      '"谁？"陈平安警觉地坐起身。',
      '"不必紧张。"一个温和的声音响起，"我找你，是有一桩机缘要送给你。"',
      '白衣剑客站在月光下，身姿挺拔如松，脸上带着淡淡的笑意。',
      '"你是谁？"陈平安握紧了手中的玉佩。',
      '"我姓齐，你可以叫我齐先生。"白衣剑客说道，"陈平安，你可愿随我修行？"'
    ]
  },
  // 其他章节的占位数据
  'c3': { title: '第三章 老槐树', paragraphs: ['老槐树下的秘密，远比你想象的更加深远。'] },
  'c4': { title: '第四章 四境', paragraphs: ['修行四境，各有玄妙。'] },
  'c5': { title: '第五章 机缘', paragraphs: ['机缘巧合之下，命运悄然改变。'] },
  'c6': { title: '第六章 剑气', paragraphs: ['一剑破万法。'] },
  // 其他书籍占位章节
  'c2-1': { title: '第一章 北凉', paragraphs: ['北凉王府，世子徐凤年。'] },
  'c2-2': { title: '第二章 世子', paragraphs: ['世子殿下，并非池中之物。'] },
  'c2-3': { title: '第三章 江湖', paragraphs: ['江湖路远，但终究要走一遭。'] },
  'c3-1': { title: '第一章 狱卒', paragraphs: ['穿越成大奉狱卒，前路茫茫。'] },
  'c3-2': { title: '第二章 仙术', paragraphs: ['无意中获得仙术传承。'] },
  'c3-3': { title: '第三章 破案', paragraphs: ['离奇命案，抽丝剥茧。'] },
  'c4-1': { title: '第一章 山村少年', paragraphs: ['青山镇，一个普通的少年。'] },
  'c4-2': { title: '第二章 七玄门', paragraphs: ['七玄门收徒，命运转折。'] },
  'c4-3': { title: '第三章 修仙', paragraphs: ['踏入修仙之路。'] },
  'c5-1': { title: '第一章 陨落的天才', paragraphs: ['萧炎，曾经的天才少年。'] },
  'c5-2': { title: '第二章 纳兰嫣然', paragraphs: ['三年之约，莫欺少年穷！'] },
  'c5-3': { title: '第三章 药老', paragraphs: ['戒指中的神秘老者。'] }
};

// ============ localStorage 存储管理 ============
const Storage = {
  // 获取阅读进度
  getProgress(bookId) {
    const key = `novel_progress_${bookId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : { chapterIdx: 0, pageIdx: 0, scrollPos: 0 };
  },

  // 保存阅读进度
  saveProgress(bookId, progress) {
    const key = `novel_progress_${bookId}`;
    localStorage.setItem(key, JSON.stringify(progress));
  },

  // 获取设置
  getSettings() {
    const data = localStorage.getItem('novel_settings');
    if (data) return JSON.parse(data);
    return {
      theme: 'day',       // day / night / eye / parchment
      fontSize: 16,        // 12-24
      lineHeight: 1.8,     // 1.4-2.4
      bgColor: '#F9F7F4',  // 背景色
      pageEffect: 'updown', // push / cover / simulation / updown
      brightness: 100       // 0-100
    };
  },

  // 保存设置
  saveSettings(settings) {
    localStorage.setItem('novel_settings', JSON.stringify(settings));
  },

  // 获取书架信息
  getBookshelf() {
    const data = localStorage.getItem('novel_bookshelf');
    return data ? JSON.parse(data) : {};
  },

  // 保存书架信息
  saveToBookshelf(bookId, info) {
    const shelf = this.getBookshelf();
    shelf[bookId] = { ...shelf[bookId], ...info, lastRead: Date.now() };
    localStorage.setItem('novel_bookshelf', JSON.stringify(shelf));
  }
};
